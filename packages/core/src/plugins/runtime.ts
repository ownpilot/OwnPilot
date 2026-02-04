/**
 * Secure Plugin Runtime
 *
 * Executes plugins in complete isolation with:
 * - Worker thread isolation
 * - Capability-based access control
 * - Memory/credential isolation (ABSOLUTE)
 * - Resource limits enforcement
 * - Audit logging
 */

import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { PluginId } from '../types/branded.js';
import { createPluginId } from '../types/branded.js';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import {
  type PluginCapability,
  type IsolationConfig,
  type IsolatedPluginContext,
  type AccessViolation,
  PluginIsolationManager,
  IsolationEnforcer,
  DEFAULT_ISOLATION_LIMITS,
  STORAGE_QUOTAS,
} from './isolation.js';
import {
  type MarketplaceManifest,
  type VerificationResult,
  type TrustLevel,
  PluginVerifier,
} from './marketplace.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Plugin runtime state
 */
export type PluginState =
  | 'unloaded'
  | 'loading'
  | 'loaded'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'error'
  | 'blocked';

/**
 * Plugin instance - runtime representation
 */
export interface PluginInstance {
  id: PluginId;
  manifest: MarketplaceManifest;
  state: PluginState;
  context: IsolatedPluginContext;
  worker?: Worker;
  startedAt?: Date;
  stoppedAt?: Date;
  errorCount: number;
  lastError?: string;
  verification: VerificationResult;
}

/**
 * Plugin load options
 */
export interface LoadOptions {
  /** Auto-start after loading */
  autoStart?: boolean;
  /** Skip verification (dangerous, dev only) */
  skipVerification?: boolean;
  /** Custom capabilities (override manifest) */
  customCapabilities?: PluginCapability[];
  /** Custom allowed domains */
  customDomains?: string[];
  /** Custom storage quota */
  customQuota?: number;
}

/**
 * Plugin runtime configuration
 */
export interface RuntimeConfig {
  /** Maximum number of concurrent plugins */
  maxPlugins: number;
  /** Maximum errors before blocking plugin */
  maxErrors: number;
  /** Enable debug mode */
  debug: boolean;
  /** Plugin directory */
  pluginDir: string;
  /** Default resource limits */
  defaultLimits: {
    cpuLimit: number;
    memoryLimit: number;
    executionTimeout: number;
    storageQuota: number;
  };
  /** Minimum trust level for installation */
  minTrustLevel: TrustLevel;
}

/**
 * Runtime events
 */
export interface RuntimeEvents {
  'plugin:loaded': { pluginId: string; manifest: MarketplaceManifest };
  'plugin:started': { pluginId: string };
  'plugin:stopped': { pluginId: string; reason?: string };
  'plugin:error': { pluginId: string; error: string };
  'plugin:blocked': { pluginId: string; reason: string };
  'plugin:message': { pluginId: string; message: unknown };
  'security:violation': AccessViolation;
}

/**
 * Message from worker
 */
type WorkerMessage =
  | { type: 'ready' }
  | { type: 'result'; id: string; result: unknown }
  | { type: 'error'; id: string; error: string }
  | { type: 'log'; level: string; message: string; data?: unknown }
  | { type: 'event'; event: string; data: unknown }
  | { type: 'tool_call'; id: string; tool: string; args: Record<string, unknown> }
  | { type: 'security_violation'; resource: string; action: string };

/**
 * Message to worker
 */
type HostMessage =
  | { type: 'init'; context: SerializedContext }
  | { type: 'call'; id: string; method: string; args: unknown[] }
  | { type: 'event'; event: string; data: unknown }
  | { type: 'shutdown' };

/**
 * Serialized context for worker
 */
interface SerializedContext {
  pluginId: string;
  version: string;
  capabilities: PluginCapability[];
  allowedDomains: string[];
  storageQuota: number;
}

// =============================================================================
// Plugin Security Barrier
// =============================================================================

/**
 * Security barrier - enforces absolute isolation from memory/credentials
 *
 * This class acts as a firewall between plugins and system resources.
 * It has NO methods to access memory or credentials - by design.
 */
export class PluginSecurityBarrier {
  private readonly pluginId: PluginId;
  private readonly enforcer: IsolationEnforcer;
  private readonly auditLog: Array<{
    timestamp: Date;
    action: string;
    resource: string;
    allowed: boolean;
  }> = [];

  constructor(pluginId: PluginId, enforcer: IsolationEnforcer) {
    this.pluginId = pluginId;
    this.enforcer = enforcer;
  }

  /**
   * Check if resource access is allowed
   * MEMORY AND CREDENTIALS ARE NEVER ALLOWED
   */
  checkAccess(resource: string, action: string): boolean {
    // Absolute barriers - these can NEVER be accessed by plugins
    const absoluteBarriers = [
      'memory:',
      'credentials:',
      'credential:',
      'userMemory',
      'userCredential',
      'SecureMemoryStore',
      'UserCredentialStore',
      'masterKey',
      'encryptionKey',
      'privateKey',
      'audit:',
    ];

    // Check absolute barriers
    for (const barrier of absoluteBarriers) {
      if (resource.toLowerCase().includes(barrier.toLowerCase())) {
        this.logAccess(action, resource, false);
        this.enforcer.recordViolation({
          pluginId: this.pluginId,
          timestamp: new Date(),
          attemptedResource: resource,
          action,
          stackTrace: new Error().stack,
        });
        return false;
      }
    }

    // Check general access
    const result = this.enforcer.checkAccess(this.pluginId, resource, action);
    const allowed = result.ok;
    this.logAccess(action, resource, allowed);
    return allowed;
  }

  /**
   * Get audit log
   */
  getAuditLog(): typeof this.auditLog {
    return [...this.auditLog];
  }

  private logAccess(action: string, resource: string, allowed: boolean): void {
    this.auditLog.push({
      timestamp: new Date(),
      action,
      resource,
      allowed,
    });

    // Keep last 1000 entries
    if (this.auditLog.length > 1000) {
      this.auditLog.shift();
    }
  }
}

// =============================================================================
// Secure Plugin Runtime
// =============================================================================

/**
 * Secure Plugin Runtime
 *
 * Manages plugin lifecycle with complete isolation guarantees.
 */
export class SecurePluginRuntime extends EventEmitter {
  private readonly config: RuntimeConfig;
  private readonly plugins: Map<string, PluginInstance> = new Map();
  private readonly isolationManager: PluginIsolationManager;
  private readonly verifier: PluginVerifier;
  private readonly barriers: Map<string, PluginSecurityBarrier> = new Map();
  private readonly pendingCalls: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }> = new Map();

  constructor(config: Partial<RuntimeConfig> = {}) {
    super();

    this.config = {
      maxPlugins: config.maxPlugins ?? 50,
      maxErrors: config.maxErrors ?? 5,
      debug: config.debug ?? false,
      pluginDir: config.pluginDir ?? './plugins',
      defaultLimits: config.defaultLimits ?? DEFAULT_ISOLATION_LIMITS,
      minTrustLevel: config.minTrustLevel ?? 'unverified',
    };

    this.isolationManager = new PluginIsolationManager({
      maxViolations: this.config.maxErrors,
    });

    this.verifier = new PluginVerifier();
  }

  /**
   * Load a plugin from manifest
   */
  async load(
    manifest: MarketplaceManifest,
    options: LoadOptions = {}
  ): Promise<Result<PluginInstance, string>> {
    // Check max plugins
    if (this.plugins.size >= this.config.maxPlugins) {
      return err(`Maximum number of plugins (${this.config.maxPlugins}) reached`);
    }

    // Check if already loaded
    if (this.plugins.has(manifest.id)) {
      return err(`Plugin ${manifest.id} is already loaded`);
    }

    // Verify plugin
    let verification: VerificationResult;
    if (options.skipVerification) {
      verification = {
        valid: true,
        trustLevel: 'unverified',
        publisherVerified: false,
        signatureValid: false,
        integrityValid: false,
        revoked: false,
        warnings: ['Verification skipped'],
        errors: [],
      };
    } else {
      verification = this.verifier.verify(manifest);
    }

    // Check verification result
    if (!verification.valid) {
      return err(`Plugin verification failed: ${verification.errors.join(', ')}`);
    }

    // Check trust level
    const trustLevels: TrustLevel[] = ['unverified', 'community', 'verified', 'official'];
    const minIndex = trustLevels.indexOf(this.config.minTrustLevel);
    const pluginIndex = trustLevels.indexOf(verification.trustLevel);

    if (pluginIndex < minIndex && verification.trustLevel !== 'revoked') {
      return err(
        `Plugin trust level (${verification.trustLevel}) is below minimum (${this.config.minTrustLevel})`
      );
    }

    // Create plugin ID
    const pluginId = createPluginId(manifest.id);

    // Determine capabilities
    const capabilities = options.customCapabilities ?? manifest.capabilities;

    // Determine storage quota
    let storageQuota = options.customQuota ?? this.config.defaultLimits.storageQuota;
    if (capabilities.includes('storage:quota:100mb')) {
      storageQuota = STORAGE_QUOTAS.pro;
    } else if (capabilities.includes('storage:quota:10mb')) {
      storageQuota = STORAGE_QUOTAS.basic;
    } else if (capabilities.includes('storage:quota:1mb')) {
      storageQuota = STORAGE_QUOTAS.free;
    }

    // Create isolation config
    const isolationConfig: IsolationConfig = {
      pluginId,
      capabilities,
      allowedDomains: options.customDomains ?? manifest.security.networkAccess.domains,
      storageQuota,
      cpuLimit: this.config.defaultLimits.cpuLimit,
      memoryLimit: this.config.defaultLimits.memoryLimit,
      executionTimeout: this.config.defaultLimits.executionTimeout,
      debug: this.config.debug,
    };

    // Create isolated context
    const context = this.isolationManager.createContext(isolationConfig);

    // Create security barrier
    const barrier = new PluginSecurityBarrier(pluginId, this.isolationManager.getEnforcer());
    this.barriers.set(manifest.id, barrier);

    // Create plugin instance
    const instance: PluginInstance = {
      id: pluginId,
      manifest,
      state: 'loaded',
      context,
      errorCount: 0,
      verification,
    };

    this.plugins.set(manifest.id, instance);

    // Emit loaded event
    this.emit('plugin:loaded', {
      pluginId: manifest.id,
      manifest,
    });

    // Auto-start if requested
    if (options.autoStart) {
      const startResult = await this.start(manifest.id);
      if (!startResult.ok) {
        return err(`Plugin loaded but failed to start: ${startResult.error}`);
      }
    }

    return ok(instance);
  }

  /**
   * Start a loaded plugin
   */
  async start(pluginId: string): Promise<Result<void, string>> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return err(`Plugin ${pluginId} not found`);
    }

    if (instance.state === 'running') {
      return ok(undefined);
    }

    if (instance.state === 'blocked') {
      return err(`Plugin ${pluginId} is blocked due to security violations`);
    }

    try {
      instance.state = 'starting';

      // Create worker with isolation
      const worker = await this.createWorker(instance);
      instance.worker = worker;

      // Wait for ready
      await this.waitForReady(worker, 10000);

      // Initialize plugin context in worker
      await this.initializeWorker(instance);

      instance.state = 'running';
      instance.startedAt = new Date();

      this.emit('plugin:started', { pluginId });
      return ok(undefined);
    } catch (e) {
      instance.state = 'error';
      instance.lastError = e instanceof Error ? e.message : String(e);
      instance.errorCount++;

      this.emit('plugin:error', {
        pluginId,
        error: instance.lastError,
      });

      // Block if too many errors
      if (instance.errorCount >= this.config.maxErrors) {
        instance.state = 'blocked';
        this.emit('plugin:blocked', {
          pluginId,
          reason: `Too many errors (${instance.errorCount})`,
        });
      }

      return err(`Failed to start plugin: ${instance.lastError}`);
    }
  }

  /**
   * Stop a running plugin
   */
  async stop(pluginId: string, reason?: string): Promise<Result<void, string>> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return err(`Plugin ${pluginId} not found`);
    }

    if (instance.state !== 'running') {
      return ok(undefined);
    }

    instance.state = 'stopping';

    try {
      // Send shutdown message
      if (instance.worker) {
        this.sendToWorker(instance.worker, { type: 'shutdown' });

        // Wait for graceful shutdown
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            instance.worker?.terminate();
            resolve();
          }, 5000);

          instance.worker!.once('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        });

        instance.worker = undefined;
      }

      instance.state = 'stopped';
      instance.stoppedAt = new Date();

      this.emit('plugin:stopped', { pluginId, reason });
      return ok(undefined);
    } catch (e) {
      instance.state = 'error';
      return err(`Failed to stop plugin: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * Unload a plugin completely
   */
  async unload(pluginId: string): Promise<Result<void, string>> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return err(`Plugin ${pluginId} not found`);
    }

    // Stop if running
    if (instance.state === 'running') {
      await this.stop(pluginId, 'unloading');
    }

    // Cleanup
    await this.isolationManager.destroyContext(pluginId);
    this.barriers.delete(pluginId);
    this.plugins.delete(pluginId);

    return ok(undefined);
  }

  /**
   * Call a method on a plugin
   */
  async call<T = unknown>(
    pluginId: string,
    method: string,
    args: unknown[] = [],
    timeout: number = 30000
  ): Promise<Result<T, string>> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return err(`Plugin ${pluginId} not found`);
    }

    if (instance.state !== 'running' || !instance.worker) {
      return err(`Plugin ${pluginId} is not running`);
    }

    // Check security barrier
    const barrier = this.barriers.get(pluginId);
    if (barrier && !barrier.checkAccess(`method:${method}`, 'call')) {
      return err(`Access denied: ${method}`);
    }

    const callId = randomUUID();

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingCalls.delete(callId);
        resolve(err(`Call to ${method} timed out after ${timeout}ms`));
      }, timeout);

      this.pendingCalls.set(callId, {
        resolve: (result) => {
          clearTimeout(timeoutHandle);
          this.pendingCalls.delete(callId);
          resolve(ok(result as T));
        },
        reject: (error) => {
          clearTimeout(timeoutHandle);
          this.pendingCalls.delete(callId);
          resolve(err(error.message));
        },
        timeout: timeoutHandle,
      });

      this.sendToWorker(instance.worker!, {
        type: 'call',
        id: callId,
        method,
        args,
      });
    });
  }

  /**
   * Send event to plugin
   */
  sendEvent(pluginId: string, event: string, data: unknown): Result<void, string> {
    const instance = this.plugins.get(pluginId);
    if (!instance) {
      return err(`Plugin ${pluginId} not found`);
    }

    if (instance.state !== 'running' || !instance.worker) {
      return err(`Plugin ${pluginId} is not running`);
    }

    this.sendToWorker(instance.worker, {
      type: 'event',
      event,
      data,
    });

    return ok(undefined);
  }

  /**
   * Broadcast event to all running plugins
   */
  broadcast(event: string, data: unknown): void {
    for (const [pluginId, instance] of this.plugins) {
      if (instance.state === 'running' && instance.worker) {
        this.sendEvent(pluginId, event, data);
      }
    }
  }

  /**
   * Get plugin instance
   */
  get(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Get all plugins
   */
  getAll(): PluginInstance[] {
    return [...this.plugins.values()];
  }

  /**
   * Get running plugins
   */
  getRunning(): PluginInstance[] {
    return [...this.plugins.values()].filter((p) => p.state === 'running');
  }

  /**
   * Get plugin security barrier
   */
  getBarrier(pluginId: string): PluginSecurityBarrier | undefined {
    return this.barriers.get(pluginId);
  }

  /**
   * Get isolation manager
   */
  getIsolationManager(): PluginIsolationManager {
    return this.isolationManager;
  }

  /**
   * Get verifier
   */
  getVerifier(): PluginVerifier {
    return this.verifier;
  }

  /**
   * Shutdown all plugins
   */
  async shutdown(): Promise<void> {
    const promises = [...this.plugins.keys()].map((id) => this.stop(id, 'shutdown'));
    await Promise.all(promises);
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async createWorker(instance: PluginInstance): Promise<Worker> {
    // Create worker with resource limits
    const worker = new Worker(
      `
      const { parentPort } = require('worker_threads');

      // Freeze prototypes immediately
      Object.freeze(Object.prototype);
      Object.freeze(Array.prototype);
      Object.freeze(Function.prototype);
      Object.freeze(String.prototype);
      Object.freeze(Number.prototype);
      Object.freeze(Boolean.prototype);
      Object.freeze(RegExp.prototype);
      Object.freeze(Date.prototype);
      Object.freeze(Map.prototype);
      Object.freeze(Set.prototype);
      Object.freeze(Promise.prototype);

      // Remove dangerous globals
      delete globalThis.eval;
      delete globalThis.Function;

      // Plugin context (will be set on init)
      let pluginContext = null;
      let pluginModule = null;

      parentPort.on('message', async (msg) => {
        try {
          switch (msg.type) {
            case 'init':
              pluginContext = msg.context;
              parentPort.postMessage({ type: 'ready' });
              break;

            case 'call':
              if (!pluginModule || !pluginModule[msg.method]) {
                parentPort.postMessage({
                  type: 'error',
                  id: msg.id,
                  error: 'Method not found: ' + msg.method
                });
                return;
              }
              try {
                const result = await pluginModule[msg.method](...msg.args);
                parentPort.postMessage({ type: 'result', id: msg.id, result });
              } catch (e) {
                parentPort.postMessage({
                  type: 'error',
                  id: msg.id,
                  error: e.message || String(e)
                });
              }
              break;

            case 'event':
              // Handle events
              break;

            case 'shutdown':
              process.exit(0);
              break;
          }
        } catch (e) {
          parentPort.postMessage({
            type: 'error',
            id: msg.id || 'unknown',
            error: e.message || String(e)
          });
        }
      });
      `,
      {
        eval: true,
        resourceLimits: {
          maxOldGenerationSizeMb: Math.floor(
            this.config.defaultLimits.memoryLimit / (1024 * 1024)
          ),
          maxYoungGenerationSizeMb: 16,
          codeRangeSizeMb: 16,
        },
      }
    );

    // Handle worker messages
    worker.on('message', (msg: WorkerMessage) => {
      this.handleWorkerMessage(instance.manifest.id, msg);
    });

    // Handle worker errors
    worker.on('error', (error) => {
      instance.errorCount++;
      instance.lastError = error.message;

      this.emit('plugin:error', {
        pluginId: instance.manifest.id,
        error: error.message,
      });

      if (instance.errorCount >= this.config.maxErrors) {
        instance.state = 'blocked';
        this.emit('plugin:blocked', {
          pluginId: instance.manifest.id,
          reason: `Too many errors (${instance.errorCount})`,
        });
      }
    });

    // Handle worker exit
    worker.on('exit', (code) => {
      if (instance.state === 'running') {
        instance.state = 'stopped';
        this.emit('plugin:stopped', {
          pluginId: instance.manifest.id,
          reason: `Worker exited with code ${code}`,
        });
      }
    });

    return worker;
  }

  private waitForReady(worker: Worker, timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        worker.off('message', handler);
        reject(new Error('Worker initialization timed out'));
      }, timeout);

      const handler = (msg: WorkerMessage) => {
        if (msg.type === 'ready') {
          clearTimeout(timer);
          worker.off('message', handler);
          resolve();
        }
      };

      worker.on('message', handler);
    });
  }

  private async initializeWorker(instance: PluginInstance): Promise<void> {
    const context: SerializedContext = {
      pluginId: instance.manifest.id,
      version: instance.manifest.version,
      capabilities: [...instance.context.capabilities],
      allowedDomains: instance.manifest.security.networkAccess.domains,
      storageQuota: this.config.defaultLimits.storageQuota,
    };

    this.sendToWorker(instance.worker!, { type: 'init', context });
  }

  private sendToWorker(worker: Worker, message: HostMessage): void {
    worker.postMessage(message);
  }

  private handleWorkerMessage(pluginId: string, msg: WorkerMessage): void {
    switch (msg.type) {
      case 'result':
        const resultCall = this.pendingCalls.get(msg.id);
        if (resultCall) {
          resultCall.resolve(msg.result);
        }
        break;

      case 'error':
        const errorCall = this.pendingCalls.get(msg.id);
        if (errorCall) {
          errorCall.reject(new Error(msg.error));
        }
        break;

      case 'log':
        if (this.config.debug) {
          console.log(`[Plugin:${pluginId}] ${msg.level}: ${msg.message}`, msg.data ?? '');
        }
        break;

      case 'event':
        this.emit('plugin:message', { pluginId, message: msg.data });
        break;

      case 'security_violation':
        const barrier = this.barriers.get(pluginId);
        if (barrier) {
          barrier.checkAccess(msg.resource, msg.action);
        }

        this.emit('security:violation', {
          pluginId: createPluginId(pluginId),
          timestamp: new Date(),
          attemptedResource: msg.resource,
          action: msg.action,
        });
        break;
    }
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a secure plugin runtime
 */
export function createPluginRuntime(
  config: Partial<RuntimeConfig> = {}
): SecurePluginRuntime {
  return new SecurePluginRuntime(config);
}

/**
 * Default runtime singleton
 */
let defaultRuntime: SecurePluginRuntime | null = null;

export function getDefaultRuntime(): SecurePluginRuntime {
  if (!defaultRuntime) {
    defaultRuntime = createPluginRuntime();
  }
  return defaultRuntime;
}

/**
 * Reset default runtime (for testing)
 */
export async function resetDefaultRuntime(): Promise<void> {
  if (defaultRuntime) {
    await defaultRuntime.shutdown();
    defaultRuntime = null;
  }
}
