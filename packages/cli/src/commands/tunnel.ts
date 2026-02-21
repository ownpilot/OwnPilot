/**
 * Tunnel Commands
 *
 * Start/stop tunnels (ngrok, Cloudflare) for webhook mode.
 * Automatically registers the tunnel URL as the Telegram webhook.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';

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

// ============================================================================
// Public Commands
// ============================================================================

/**
 * Start an ngrok tunnel and register webhook.
 */
export async function tunnelStartNgrok(options: {
  token?: string;
  port?: string;
}): Promise<void> {
  if (activeTunnel) {
    console.error('A tunnel is already running. Stop it first with: ownpilot tunnel stop');
    return void process.exit(1);
  }

  const port = parseInt(options.port ?? '8080', 10);

  console.log(`Starting ngrok tunnel to localhost:${port}...`);

  let ngrok: typeof import('@ngrok/ngrok');
  try {
    ngrok = await import('@ngrok/ngrok');
  } catch {
    console.error(
      'ngrok SDK not found. Install it with:\n  pnpm add @ngrok/ngrok\n\nOr use Cloudflare tunnel instead:\n  ownpilot tunnel start cloudflare',
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

    // Keep process alive
    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        console.log('\nStopping tunnel...');
        await doTunnelStop();
        resolve();
      };
      process.once('SIGINT', () => void shutdown());
      process.once('SIGTERM', () => void shutdown());
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`ngrok tunnel failed: ${msg}`);
    if (msg.includes('authtoken')) {
      console.error(
        '\nYou may need to provide an ngrok auth token:\n  ownpilot tunnel start ngrok --token YOUR_TOKEN\n\nGet a free token at: https://dashboard.ngrok.com/get-started/your-authtoken',
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

  const port = options.port ?? '8080';

  console.log(`Starting Cloudflare tunnel to localhost:${port}...`);

  const args = ['tunnel', '--url', `http://localhost:${port}`];
  if (options.domain) {
    args.push('--hostname', options.domain);
  }

  try {
    const child = spawn('cloudflared', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Parse URL from cloudflared stderr output
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Cloudflare tunnel startup timed out (30s)')),
        30_000,
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

    await registerWebhookUrl(url, parseInt(port, 10));

    console.log('\nTunnel is running. Press Ctrl+C to stop.');

    // Keep process alive
    await new Promise<void>((resolve) => {
      const shutdown = async () => {
        console.log('\nStopping tunnel...');
        await doTunnelStop();
        resolve();
      };
      process.once('SIGINT', () => void shutdown());
      process.once('SIGTERM', () => void shutdown());
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('ENOENT') || msg.includes('spawn cloudflared')) {
      console.error(
        'cloudflared binary not found. Install it:\n  https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/',
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

  if (tunnel.ngrokListener) {
    try {
      await tunnel.ngrokListener.close();
    } catch { /* best effort */ }
  }
  if (tunnel.process) {
    tunnel.process.kill('SIGTERM');
  }
}

/**
 * Register the tunnel URL as the Telegram webhook in Config Center.
 * Calls the gateway REST API to update the config and reconnect the channel.
 */
async function registerWebhookUrl(tunnelUrl: string, port: number): Promise<void> {
  const baseUrl = `http://localhost:${port}`;
  const secret = randomBytes(32).toString('hex');

  console.log('Registering webhook with gateway...');

  try {
    // 1. Get the telegram_bot service to find the default entry ID
    const svcRes = await fetch(`${baseUrl}/api/v1/config-services/telegram_bot`);
    if (!svcRes.ok) {
      console.warn('Could not find telegram_bot service. Make sure the server is running and Telegram plugin is registered.');
      return;
    }
    const svcData = (await svcRes.json()) as {
      data: { entries: Array<{ id: string; isDefault: boolean; data: Record<string, unknown> }> };
    };

    const entries = svcData.data?.entries ?? [];
    const defaultEntry = entries.find((e) => e.isDefault) ?? entries[0];

    if (!defaultEntry) {
      console.warn('No telegram_bot config entry found. Configure Telegram first via Config Center.');
      return;
    }

    // 2. Update the entry with webhook URL and secret
    const updateRes = await fetch(
      `${baseUrl}/api/v1/config-services/telegram_bot/entries/${defaultEntry.id}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            ...defaultEntry.data,
            webhook_url: tunnelUrl,
            webhook_secret: secret,
          },
        }),
      },
    );

    if (!updateRes.ok) {
      console.warn('Failed to update webhook config. You may need to update it manually in Config Center.');
      return;
    }

    console.log('Webhook config updated.');

    // 3. Reconnect the Telegram channel to apply webhook mode
    const reconnRes = await fetch(`${baseUrl}/api/v1/channels/channel.telegram/reconnect`, {
      method: 'POST',
    });

    if (reconnRes.ok) {
      console.log('Telegram reconnected in webhook mode.');
    } else {
      console.warn('Channel reconnect failed. The webhook will be used on next server restart.');
    }
  } catch {
    console.warn(
      'Could not reach gateway at ' + baseUrl + '. Make sure the server is running.\n' +
      'You can start the server first and then run the tunnel command.',
    );
  }
}
