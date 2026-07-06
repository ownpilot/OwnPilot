/**
 * Tunnel Service
 *
 * Manages Cloudflare tunnel (cloudflared) process for exposing the gateway
 * to the internet without port forwarding. Supports password-protected
 * tunnels via cloudflared's --basic-auth flag.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { env } from 'node:process';
import { getLog } from './log.js';
import { wsGateway } from '../ws/server.js';

const log = getLog('TunnelService');

// ============================================================================
// Types
// ============================================================================

interface TunnelConfig {
  port: number;
  password?: string;
  hostname?: string;
}

interface TunnelStatus {
  status: 'stopped' | 'starting' | 'running' | 'error';
  url?: string | null;
  error?: string | null;
  startedAt?: Date | null;
}

interface ITunnelService {
  start(password?: string): Promise<TunnelStatus>;
  stop(): Promise<void>;
  getStatus(): TunnelStatus;
  getUrl(): string | null;
  configure(config: Partial<TunnelConfig>): void;
}

const TUNNEL_URL_RE = /(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/;
const STARTUP_TIMEOUT_MS = 30_000;

// ============================================================================
// Service Implementation
// ============================================================================

class TunnelServiceImpl implements ITunnelService {
  private config: TunnelConfig = {
    port: parseInt(env.PORT ?? '8080', 10),
    password: env.CLOUDFLARED_TUNNEL_PASSWORD,
    hostname: undefined,
  };

  private state: TunnelStatus = { status: 'stopped', url: null, error: null, startedAt: null };

  private childProcess: ChildProcess | null = null;
  private clearStartupListeners: (() => void) | null = null;

  configure(config: Partial<TunnelConfig>): void {
    if (config.port !== undefined) this.config.port = config.port;
    if (config.password !== undefined) this.config.password = config.password;
    if (config.hostname !== undefined) this.config.hostname = config.hostname;
  }

  async start(password?: string): Promise<TunnelStatus> {
    // If already running, return current status
    if (this.state.status === 'running' && this.state.url) {
      return this.state;
    }

    // Stop any existing process first
    await this.stopProcess();

    const effectivePassword = password ?? this.config.password;

    this.state = { status: 'starting', url: null, error: null, startedAt: new Date() };
    this.broadcastStatus();

    try {
      const url = await this.spawnCloudflared(effectivePassword);
      this.state = { status: 'running', url, error: null, startedAt: this.state.startedAt };
      this.broadcastStatus();
      this.broadcastUrl(url);
      return this.state;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.state = { status: 'error', url: null, error, startedAt: null };
      this.broadcastStatus();
      throw err;
    }
  }

  async stop(): Promise<void> {
    await this.stopProcess();
    this.state = { status: 'stopped', url: null, error: null, startedAt: null };
    this.broadcastStatus();
  }

  getStatus(): TunnelStatus {
    return { ...this.state };
  }

  getUrl(): string | null {
    return this.state.url ?? null;
  }

  private async spawnCloudflared(password?: string): Promise<string> {
    const args = ['tunnel', '--url', `http://localhost:${this.config.port}`];

    if (password) {
      // cloudflared accepts user:password format for --basic-auth
      args.push('--basic-auth', `op:${password}`);
    }

    if (this.config.hostname) {
      args.push('--hostname', this.config.hostname);
    }

    log.info('Starting cloudflared', {
      args: password ? args.map((arg) => (arg === `op:${password}` ? 'op:********' : arg)) : args,
      port: this.config.port,
    });

    return new Promise((resolve, reject) => {
      const child = spawn('cloudflared', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      this.childProcess = child;

      const settleStartup = (settle: () => void): void => {
        clearTimeout(timeout);
        this.clearStartupListeners?.();
        this.clearStartupListeners = null;
        settle();
      };

      const timeout = setTimeout(() => {
        settleStartup(() => {
          this.killChildProcess();
          reject(new Error('Cloudflare tunnel startup timed out (30s)'));
        });
      }, STARTUP_TIMEOUT_MS);

      const onData = (data: Buffer) => {
        const line = data.toString();
        log.debug('cloudflared output', { line: line.trim() });

        // Check for cloudflared not found error
        if (
          line.includes('ENOENT') ||
          line.includes('spawn cloudflared') ||
          line.includes('not found')
        ) {
          settleStartup(() => {
            this.killChildProcess();
            reject(
              new Error(
                'cloudflared binary not found. Install it: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/'
              )
            );
          });
          return;
        }

        const match = line.match(TUNNEL_URL_RE);
        if (match) {
          const url = match[1]!;
          log.info('Tunnel URL obtained', { url });
          settleStartup(() => resolve(url));
        }
      };

      const onStartupError = (err: Error) => {
        settleStartup(() => {
          this.childProcess = null;
          reject(err);
        });
      };

      const onStartupExit = (code: number | null) => {
        settleStartup(() => {
          this.childProcess = null;
          reject(
            new Error(`cloudflared exited with code ${code ?? 0} before tunnel URL was found`)
          );
        });
      };

      const onRuntimeExit = (code: number | null) => {
        if (this.childProcess === child) {
          this.childProcess = null;
        }
        if (this.state.status === 'running') {
          this.state = {
            status: 'error',
            url: null,
            error: `cloudflared exited unexpectedly (code ${code})`,
            startedAt: null,
          };
          this.broadcastStatus();
        }
      };

      this.clearStartupListeners = () => {
        child.stdout?.off('data', onData);
        child.stderr?.off('data', onData);
        child.off('error', onStartupError);
        child.off('exit', onStartupExit);
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.once('error', onStartupError);
      child.once('exit', onStartupExit);
      child.once('exit', onRuntimeExit);
    });
  }

  private cleanupStartupListeners(): void {
    this.clearStartupListeners?.();
    this.clearStartupListeners = null;
  }

  private killChildProcess(): void {
    const child = this.childProcess;
    if (!child) return;
    this.childProcess = null;
    try {
      child.kill('SIGTERM');
    } catch {
      /* best effort */
    }
  }

  private async stopProcess(): Promise<void> {
    this.cleanupStartupListeners();
    this.killChildProcess();
  }

  private broadcastStatus(): void {
    try {
      wsGateway.broadcast('tunnel:status', {
        status: this.state.status,
        url: this.state.url,
        error: this.state.error,
        startedAt: this.state.startedAt?.toISOString() ?? null,
      });
    } catch {
      /* ws may not be initialized yet */
    }
  }

  private broadcastUrl(url: string): void {
    try {
      wsGateway.broadcast('tunnel:url', { url });
    } catch {
      /* ws may not be initialized yet */
    }
  }
}

// ============================================================================
// Singleton Accessor
// ============================================================================

let _instance: TunnelServiceImpl | null = null;

export function getTunnelService(): ITunnelService {
  if (!_instance) {
    _instance = new TunnelServiceImpl();
  }
  return _instance;
}
