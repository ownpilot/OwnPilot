/**
 * User Container Orchestrator
 *
 * Manages Docker container lifecycle for isolated user workspaces.
 * Each user gets their own container with strict security controls.
 */

import { spawn, execSync, execFileSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { getLog } from '../services/get-log.js';
import { getErrorMessage } from '../services/error-utils.js';

const log = getLog('Workspace');
import type {
  ContainerConfig,
  ContainerStatus,
  ExecutionLanguage,
  ExecutionResult,
  ResourceUsage,
} from './types.js';

/**
 * Docker security arguments for maximum isolation
 */
const DOCKER_SECURITY_ARGS = [
  '--rm', // Remove container after exit
  '--read-only', // Read-only root filesystem
  '--no-new-privileges', // Prevent privilege escalation
  '--cap-drop=ALL', // Drop all capabilities
  '--security-opt=no-new-privileges:true',
  '--pids-limit=100', // Limit processes
  '-u',
  '1000:1000', // Non-root user
];

/**
 * Validate Docker container ID format (12-64 hex characters)
 */
function validateContainerId(id: string): string {
  if (!/^[a-f0-9]{12,64}$/.test(id)) {
    throw new Error(`Invalid container ID format`);
  }
  return id;
}

/**
 * Validate Docker image name format
 */
function validateImageName(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:-]*$/.test(name) || name.length > 200) {
    throw new Error(`Invalid Docker image name`);
  }
  return name;
}

/**
 * Container info stored in memory
 */
interface ContainerInfo {
  containerId: string;
  userId: string;
  workspaceId: string;
  image: string;
  status: ContainerStatus;
  config: ContainerConfig;
  startedAt: Date;
  lastActivityAt: Date;
}

/**
 * Check if Docker is available
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    execSync('docker info', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure Docker image is available
 */
export async function ensureImage(image: string): Promise<boolean> {
  const validImage = validateImageName(image);
  try {
    // Check if image exists locally
    execFileSync('docker', ['image', 'inspect', validImage], { stdio: 'ignore' });
    return true;
  } catch {
    // Try to pull the image
    try {
      log.info(`Pulling Docker image: ${validImage}`);
      execFileSync('docker', ['pull', validImage], { stdio: 'inherit', timeout: 300000 });
      return true;
    } catch (err) {
      log.error(`Failed to pull image ${validImage}:`, err);
      return false;
    }
  }
}

/**
 * Get image for language
 */
export function getImageForLanguage(language: ExecutionLanguage, customImage?: string): string {
  if (customImage) return customImage;

  switch (language) {
    case 'python':
      return 'python:3.11-slim';
    case 'javascript':
      return 'node:20-slim';
    case 'shell':
      return 'alpine:latest';
    default:
      return 'alpine:latest';
  }
}

/**
 * User Container Orchestrator
 */
export class UserContainerOrchestrator {
  private containers: Map<string, ContainerInfo> = new Map();
  private dockerAvailable: boolean | null = null;

  /**
   * Check Docker availability (cached)
   */
  async checkDocker(): Promise<boolean> {
    if (this.dockerAvailable === null) {
      this.dockerAvailable = await isDockerAvailable();
    }
    return this.dockerAvailable;
  }

  /**
   * Create and start a container for user workspace
   */
  async createContainer(
    userId: string,
    workspaceId: string,
    workspacePath: string,
    config: ContainerConfig,
    language: ExecutionLanguage = 'shell'
  ): Promise<string> {
    if (!(await this.checkDocker())) {
      throw new Error('Docker is not available');
    }

    const image = getImageForLanguage(language, config.image);

    // Ensure image is available
    if (!(await ensureImage(image))) {
      throw new Error(`Failed to get Docker image: ${image}`);
    }

    const containerName = `workspace_${userId}_${Date.now()}`;

    // Build docker run arguments
    const args: string[] = [
      'run',
      '-d', // Detached mode
      '--name',
      containerName,
      ...DOCKER_SECURITY_ARGS,
      `--memory=${config.memoryMB}m`,
      `--cpus=${config.cpuCores}`,
      `--pids-limit=100`,
      // Temporary filesystem for /tmp
      '--tmpfs',
      '/tmp:rw,noexec,nosuid,size=64m',
      // Mount user workspace
      '-v',
      `${workspacePath}:/workspace:rw`,
      // Working directory
      '-w',
      '/workspace',
    ];

    // Network policy
    if (config.networkPolicy === 'none') {
      args.push('--network=none');
    } else if (config.networkPolicy === 'restricted' && config.allowedHosts) {
      // For restricted, we'd need a custom network setup
      // For now, default to none for safety
      args.push('--network=none');
    }

    // Environment variables
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        args.push('-e', `${key}=${value}`);
      }
    }

    // Image and command (keep container running)
    args.push(image);
    args.push('tail', '-f', '/dev/null'); // Keep container alive

    try {
      const result = execFileSync('docker', args, {
        encoding: 'utf-8',
        timeout: 30000,
      });

      const containerId = validateContainerId(result.trim());

      // Store container info
      this.containers.set(containerId, {
        containerId,
        userId,
        workspaceId,
        image,
        status: 'running',
        config,
        startedAt: new Date(),
        lastActivityAt: new Date(),
      });

      log.info(`Container created: ${containerId.substring(0, 12)} for user ${userId}`);

      return containerId;
    } catch (err) {
      log.error('Failed to create container:', err);
      throw new Error(`Failed to create container: ${getErrorMessage(err)}`);
    }
  }

  /**
   * Execute code in a container
   */
  async executeInContainer(
    containerId: string,
    code: string,
    language: ExecutionLanguage,
    timeoutMs: number = 30000
  ): Promise<ExecutionResult> {
    const executionId = randomUUID();
    const startTime = Date.now();

    // Update last activity
    const info = this.containers.get(containerId);
    if (info) {
      info.lastActivityAt = new Date();
    }

    // Build exec command based on language
    let _execCmd: string[];
    switch (language) {
      case 'python':
        _execCmd = ['python', '-c', code];
        break;
      case 'javascript':
        _execCmd = ['node', '-e', code];
        break;
      case 'shell':
        _execCmd = ['sh', '-c', code];
        break;
      default:
        return {
          executionId,
          status: 'failed',
          error: `Unsupported language: ${language}`,
        };
    }

    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Build docker exec args without shell interpolation
      const validId = validateContainerId(containerId);
      let execArgs: string[];

      switch (language) {
        case 'python':
          execArgs = ['exec', validId, 'python', '-c', code];
          break;
        case 'javascript':
          execArgs = ['exec', validId, 'node', '-e', code];
          break;
        case 'shell':
          execArgs = ['exec', validId, 'sh', '-c', code];
          break;
        default:
          resolve({
            executionId,
            status: 'failed',
            error: `Unsupported language: ${language}`,
          });
          return;
      }

      const child: ChildProcess = spawn('docker', execArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 1000);
      }, timeoutMs);

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Limit output size
        if (stdout.length > 1024 * 1024) {
          stdout = stdout.substring(0, 1024 * 1024) + '\n... [output truncated]';
          child.kill('SIGTERM');
        }
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
        if (stderr.length > 1024 * 1024) {
          stderr = stderr.substring(0, 1024 * 1024) + '\n... [output truncated]';
        }
      });

      child.on('close', (exitCode: number | null) => {
        clearTimeout(timeoutHandle);
        const executionTimeMs = Date.now() - startTime;

        if (timedOut) {
          resolve({
            executionId,
            status: 'timeout',
            stdout: stdout || undefined,
            stderr: stderr || undefined,
            error: `Execution timed out after ${timeoutMs}ms`,
            executionTimeMs,
          });
        } else {
          resolve({
            executionId,
            status: exitCode === 0 ? 'completed' : 'failed',
            stdout: stdout || undefined,
            stderr: stderr || undefined,
            exitCode: exitCode ?? undefined,
            executionTimeMs,
          });
        }
      });

      child.on('error', (err: Error) => {
        clearTimeout(timeoutHandle);
        resolve({
          executionId,
          status: 'failed',
          error: `Execution error: ${err.message}`,
          executionTimeMs: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Stop a container
   */
  async stopContainer(containerId: string): Promise<void> {
    const validId = validateContainerId(containerId);
    try {
      execFileSync('docker', ['stop', validId], {
        timeout: 10000,
        stdio: 'ignore',
      });
      this.containers.delete(containerId);
      log.info(`Container stopped: ${containerId.substring(0, 12)}`);
    } catch {
      // Container might already be stopped
      this.containers.delete(containerId);
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(containerId: string): Promise<void> {
    const validId = validateContainerId(containerId);
    try {
      execFileSync('docker', ['rm', '-f', validId], {
        timeout: 10000,
        stdio: 'ignore',
      });
      this.containers.delete(containerId);
    } catch {
      this.containers.delete(containerId);
    }
  }

  /**
   * Get container status
   */
  async getContainerStatus(containerId: string): Promise<ContainerStatus> {
    const validId = validateContainerId(containerId);
    try {
      const result = execFileSync('docker', ['inspect', '--format={{.State.Status}}', validId], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      const status = result.trim();

      switch (status) {
        case 'running':
          return 'running';
        case 'created':
        case 'restarting':
          return 'starting';
        case 'paused':
        case 'exited':
        case 'dead':
          return 'stopped';
        default:
          return 'error';
      }
    } catch {
      return 'stopped';
    }
  }

  /**
   * Get container resource usage
   */
  async getResourceUsage(containerId: string): Promise<ResourceUsage | null> {
    const validId = validateContainerId(containerId);
    try {
      const result = execFileSync(
        'docker',
        ['stats', validId, '--no-stream', '--format', '{{.MemUsage}},{{.CPUPerc}},{{.NetIO}}'],
        { encoding: 'utf-8', timeout: 5000 }
      );

      const [memUsage, cpuPerc, netIO] = result.trim().split(',');

      // Parse memory (e.g., "100MiB / 512MiB")
      const memMatch = memUsage?.match(/(\d+(?:\.\d+)?)\s*(\w+)\s*\/\s*(\d+(?:\.\d+)?)\s*(\w+)/);
      let memoryMB = 0;
      let memoryLimitMB = 512;
      if (memMatch && memMatch[1] && memMatch[2] && memMatch[3] && memMatch[4]) {
        memoryMB = parseFloat(memMatch[1]);
        if (memMatch[2].toLowerCase().includes('gib')) memoryMB *= 1024;
        memoryLimitMB = parseFloat(memMatch[3]);
        if (memMatch[4].toLowerCase().includes('gib')) memoryLimitMB *= 1024;
      }

      // Parse CPU (e.g., "50.00%")
      const cpuPercent = parseFloat(cpuPerc?.replace('%', '') || '0');

      // Parse network (e.g., "1.5kB / 2.3kB")
      const netMatch = netIO?.match(/(\d+(?:\.\d+)?)\s*(\w+)\s*\/\s*(\d+(?:\.\d+)?)\s*(\w+)/);
      let networkBytesIn = 0;
      let networkBytesOut = 0;
      if (netMatch && netMatch[1] && netMatch[2] && netMatch[3] && netMatch[4]) {
        networkBytesIn = parseFloat(netMatch[1]);
        if (netMatch[2].toLowerCase().includes('kb')) networkBytesIn *= 1024;
        if (netMatch[2].toLowerCase().includes('mb')) networkBytesIn *= 1024 * 1024;
        networkBytesOut = parseFloat(netMatch[3]);
        if (netMatch[4].toLowerCase().includes('kb')) networkBytesOut *= 1024;
        if (netMatch[4].toLowerCase().includes('mb')) networkBytesOut *= 1024 * 1024;
      }

      return {
        memoryMB,
        memoryLimitMB,
        cpuPercent,
        storageMB: 0, // Would need to calculate from workspace
        storageLimitMB: 2048, // Default 2GB
        networkBytesIn,
        networkBytesOut,
      };
    } catch {
      return null;
    }
  }

  /**
   * Get container logs
   */
  async getContainerLogs(containerId: string, tail: number = 100): Promise<string> {
    const validId = validateContainerId(containerId);
    try {
      const result = execFileSync('docker', ['logs', '--tail', String(tail), validId], {
        encoding: 'utf-8',
        timeout: 5000,
      });
      return result;
    } catch {
      return '';
    }
  }

  /**
   * Clean up idle containers
   */
  async cleanupIdleContainers(idleTimeoutMs: number = 30 * 60 * 1000): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    const entries = Array.from(this.containers.entries());
    for (const [containerId, info] of entries) {
      const idleTime = now - info.lastActivityAt.getTime();
      if (idleTime > idleTimeoutMs) {
        await this.stopContainer(containerId);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Get all active containers
   */
  getActiveContainers(): ContainerInfo[] {
    return Array.from(this.containers.values());
  }

  /**
   * Get container by user ID
   */
  getContainerByUserId(userId: string): ContainerInfo | undefined {
    return Array.from(this.containers.values()).find((c) => c.userId === userId);
  }

  /**
   * Get container by workspace ID
   */
  getContainerByWorkspaceId(workspaceId: string): ContainerInfo | undefined {
    return Array.from(this.containers.values()).find((c) => c.workspaceId === workspaceId);
  }
}

// Singleton instance
let orchestratorInstance: UserContainerOrchestrator | null = null;

/**
 * Get the global orchestrator instance
 */
export function getOrchestrator(): UserContainerOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new UserContainerOrchestrator();
  }
  return orchestratorInstance;
}
