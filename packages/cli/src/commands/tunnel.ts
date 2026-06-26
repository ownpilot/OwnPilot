/**
 * Tunnel Commands
 *
 * Start/stop tunnels (ngrok, Cloudflare) for webhook mode.
 * Automatically registers the tunnel URL as the Telegram webhook.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { replaceShutdownSignalHandlers } from './shutdown-signals.js';

/**
 * Validate a port argument from the CLI. Must be a finite integer in the
 * usable TCP range. Reject silently-coerced garbage like `"8080; rm -rf"`
 * (`parseInt` would return `8080`) by also enforcing the raw input matches
 * `/^\d+$/` when it's a string.
 */
function parsePort(raw: string | number | undefined, fallback: number): number {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw === 'string' && !/^\d+$/.test(raw)) {
    throw new Error(`Invalid port: ${raw}. Must be a positive integer.`);
  }
  const n = typeof raw === 'number' ? raw : parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid port: ${raw}. Must be 1-65535.`);
  }
  return n;
}

/**
 * Build a sanitized environment for child processes. The CLI eagerly hydrates
 * provider API keys into process.env via loadCredentialsToEnv (so the agent
 * SDKs can read them), but a spawned binary like cloudflared has no need for
 * any of those — leaving them in the child's env exposes them via
 * /proc/<pid>/environ on Linux, `ps eww` on BSD, and crash-report uploads.
 * Allow-list only generic OS plumbing.
 */
function buildSpawnEnv(): NodeJS.ProcessEnv {
  const ALLOWED_ENV_KEYS = new Set([
    'PATH',
    'HOME',
    'USER',
    'USERPROFILE', // Windows
    'USERNAME', // Windows
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'SHELL',
    'TERM',
    'COMSPEC', // Windows
    'SYSTEMROOT', // Windows
    'WINDIR', // Windows
    'APPDATA', // Windows
    'LOCALAPPDATA', // Windows
    'PROGRAMFILES', // Windows
    'PROGRAMDATA', // Windows
    'HOSTNAME',
    // ngrok / cloudflared specific — these the child legitimately needs.
    'NGROK_AUTHTOKEN',
    'CLOUDFLARED_AUTOUPDATE_FREQ',
    'CLOUDFLARE_API_TOKEN',
    'TUNNEL_TOKEN',
  ]);
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (ALLOWED_ENV_KEYS.has(k)) out[k] = v;
  }
  return out;
}

// ============================================================================
// Types & State
// ============================================================================

interface TunnelState {
  provider: 'ngrok' | 'cloudflare';
  url: string;
  process?: ChildProcess;
  ngrokListener?: { close(): Promise<void> };
}

let activeTunnel: TunnelState | null = null;
let resolveTunnelWait: (() => void) | null = null;
let unregisterTunnelSignals: (() => void) | null = null;

// ============================================================================
// Public Commands
// ============================================================================

/**
 * Start an ngrok tunnel and register webhook.
 */
export async function tunnelStartNgrok(options: { token?: string; port?: string }): Promise<void> {
  if (activeTunnel) {
    console.error('A tunnel is already running. Stop it first with: ownpilot tunnel stop');
    return void process.exit(1);
  }

  let port: number;
  try {
    port = parsePort(options.port, 8080);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return void process.exit(1);
  }

  console.log(`Starting ngrok tunnel to localhost:${port}...`);

  let ngrok: typeof import('@ngrok/ngrok');
  try {
    ngrok = await import('@ngrok/ngrok');
  } catch {
    console.error(
      'ngrok SDK not found. Install it with:\n  pnpm add @ngrok/ngrok\n\nOr use Cloudflare tunnel instead:\n  ownpilot tunnel start cloudflare'
    );
    process.exit(1);
  }

  // Set auth token if provided
  if (options.token) {
    await ngrok.authtoken(options.token);
  }

  try {
    const listener = await ngrok.forward({ addr: port, authtoken_from_env: true });
    const url = listener.url();

    if (!url) {
      throw new Error('Failed to get tunnel URL from ngrok');
    }

    activeTunnel = { provider: 'ngrok', url, ngrokListener: listener };
    console.log(`\nTunnel active: ${url}`);

    await registerWebhookUrl(url, port);

    console.log('\nTunnel is running. Press Ctrl+C to stop.');

    await waitForTunnelShutdown();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`ngrok tunnel failed: ${msg}`);
    if (msg.includes('authtoken')) {
      console.error(
        '\nYou may need to provide an ngrok auth token:\n  ownpilot tunnel start ngrok --token YOUR_TOKEN\n\nGet a free token at: https://dashboard.ngrok.com/get-started/your-authtoken'
      );
    }
    process.exit(1);
  }
}

/**
 * Start a Cloudflare quick tunnel and register webhook.
 */
export async function tunnelStartCloudflare(options: {
  domain?: string;
  port?: string;
}): Promise<void> {
  if (activeTunnel) {
    console.error('A tunnel is already running. Stop it first with: ownpilot tunnel stop');
    return void process.exit(1);
  }

  let port: number;
  try {
    port = parsePort(options.port, 8080);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return void process.exit(1);
  }

  console.log(`Starting Cloudflare tunnel to localhost:${port}...`);

  const args = ['tunnel', '--url', `http://localhost:${port}`];
  if (options.domain) {
    args.push('--hostname', options.domain);
  }

  try {
    const child = spawn('cloudflared', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Sanitized env — do NOT leak provider API keys, JWT secrets, or
      // Telegram bot tokens via /proc/<pid>/environ / `ps eww` /
      // cloudflared crash uploads.
      env: buildSpawnEnv(),
    });

    // Parse URL from cloudflared stderr output
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Cloudflare tunnel startup timed out (30s)')),
        30_000
      );

      const onData = (data: Buffer) => {
        const line = data.toString();
        // cloudflared outputs the URL in various formats
        const match = line.match(/(https:\/\/[a-z0-9-]+\.trycloudflare\.com)/);
        if (match) {
          clearTimeout(timeout);
          resolve(match[1]!);
        }
      };

      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);

      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      child.on('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`cloudflared exited with code ${code ?? 0} before tunnel URL was found`));
      });
    });

    activeTunnel = { provider: 'cloudflare', url, process: child };
    console.log(`\nTunnel active: ${url}`);
    console.log('Note: Cloudflare quick tunnels use ephemeral URLs that change on restart.');

    await registerWebhookUrl(url, port);

    console.log('\nTunnel is running. Press Ctrl+C to stop.');

    await waitForTunnelShutdown();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('ENOENT') || msg.includes('spawn cloudflared')) {
      console.error(
        'cloudflared binary not found. Install it:\n  https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/'
      );
    } else {
      console.error(`Cloudflare tunnel failed: ${msg}`);
    }
    process.exit(1);
  }
}

/**
 * Stop the active tunnel.
 */
export async function tunnelStop(): Promise<void> {
  if (!activeTunnel) {
    console.log('No active tunnel.');
    return;
  }
  await doTunnelStop();
  console.log('Tunnel stopped.');
}

/**
 * Show tunnel status.
 */
export function tunnelStatus(): void {
  if (!activeTunnel) {
    console.log('No active tunnel.');
    return;
  }
  console.log(`Provider:  ${activeTunnel.provider}`);
  console.log(`URL:       ${activeTunnel.url}`);
  console.log(`Status:    running`);
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function doTunnelStop(): Promise<void> {
  const tunnel = activeTunnel;
  if (!tunnel) return;
  activeTunnel = null; // Clear immediately to prevent re-entrant calls

  try {
    if (tunnel.ngrokListener) {
      try {
        await tunnel.ngrokListener.close();
      } catch {
        /* best effort */
      }
    }
    if (tunnel.process) {
      tunnel.process.kill('SIGTERM');
    }
  } finally {
    unregisterTunnelSignals?.();
    unregisterTunnelSignals = null;
    const resolve = resolveTunnelWait;
    resolveTunnelWait = null;
    resolve?.();
  }
}

async function waitForTunnelShutdown(): Promise<void> {
  await new Promise<void>((resolve) => {
    resolveTunnelWait = resolve;
    unregisterTunnelSignals = replaceShutdownSignalHandlers('tunnel', async () => {
      console.log('\nStopping tunnel...');
      await doTunnelStop();
    });
  });
}

// Auth-header builder lives in `./gateway-client.ts` so every CLI subcommand
// that talks to the gateway attaches the same `Authorization: Bearer …`
// from OWNPILOT_API_KEY / OWNPILOT_JWT.

import { gatewayHeaders } from './gateway-client.js';

/**
 * Probe the gateway with a lightweight health check before sending any
 * webhook-secret material. Without this, another process listening on the
 * same loopback port (a malicious local app, a docker port-forward, a
 * misconfigured container) would receive a freshly-minted 256-bit webhook
 * secret + the public tunnel URL, then could register itself as Telegram's
 * webhook recipient. The health endpoint returns the gateway's version
 * field — we only proceed if the response shape matches.
 */
async function verifyGatewayFingerprint(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/v1/health`, { headers: gatewayHeaders() });
    if (!res.ok) return false;
    const body = (await res.json()) as unknown;
    if (!body || typeof body !== 'object') return false;
    // Health endpoint may wrap in `{ data: { version, ... } }` (apiResponse
    // envelope) or return it at the top level — accept either shape.
    const candidate =
      'version' in body
        ? (body as { version?: unknown }).version
        : (body as { data?: { version?: unknown } }).data?.version;
    return typeof candidate === 'string' && candidate.length > 0;
  } catch {
    return false;
  }
}

/**
 * Register the tunnel URL as the Telegram webhook in Config Center.
 * Calls the gateway REST API to update the config and reconnect the channel.
 */
async function registerWebhookUrl(tunnelUrl: string, port: number): Promise<void> {
  const baseUrl = `http://localhost:${port}`;

  console.log('Registering webhook with gateway...');

  if (!(await verifyGatewayFingerprint(baseUrl))) {
    console.warn(
      `Refusing to register webhook: ${baseUrl} did not respond as an OwnPilot gateway.\n` +
        `Start the gateway first (\`ownpilot server --port ${port}\`) before running the tunnel command.`
    );
    return;
  }

  const secret = randomBytes(32).toString('hex');

  try {
    // 1. Get the telegram_bot service to find the default entry ID
    const svcRes = await fetch(`${baseUrl}/api/v1/config-services/telegram_bot`, {
      headers: gatewayHeaders(),
    });
    if (!svcRes.ok) {
      console.warn(
        'Could not find telegram_bot service. Make sure the server is running and Telegram plugin is registered.'
      );
      return;
    }
    const svcData = (await svcRes.json()) as {
      data: { entries: Array<{ id: string; isDefault: boolean; data: Record<string, unknown> }> };
    };

    const entries = svcData.data?.entries ?? [];
    const defaultEntry = entries.find((e) => e.isDefault) ?? entries[0];

    if (!defaultEntry) {
      console.warn(
        'No telegram_bot config entry found. Configure Telegram first via Config Center.'
      );
      return;
    }

    // 2. Update the entry with webhook URL and secret
    const updateRes = await fetch(
      `${baseUrl}/api/v1/config-services/telegram_bot/entries/${defaultEntry.id}`,
      {
        method: 'PUT',
        headers: gatewayHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          data: {
            ...defaultEntry.data,
            webhook_url: tunnelUrl,
            webhook_secret: secret,
          },
        }),
      }
    );

    if (!updateRes.ok) {
      console.warn(
        'Failed to update webhook config. You may need to update it manually in Config Center.'
      );
      return;
    }

    console.log('Webhook config updated.');

    // 3. Reconnect the Telegram channel to apply webhook mode
    const reconnRes = await fetch(`${baseUrl}/api/v1/channels/channel.telegram/reconnect`, {
      method: 'POST',
      headers: gatewayHeaders(),
    });

    if (reconnRes.ok) {
      console.log('Telegram reconnected in webhook mode.');
    } else {
      console.warn('Channel reconnect failed. The webhook will be used on next server restart.');
    }
  } catch {
    console.warn(
      'Could not reach gateway at ' +
        baseUrl +
        '. Make sure the server is running.\n' +
        'You can start the server first and then run the tunnel command.'
    );
  }
}
