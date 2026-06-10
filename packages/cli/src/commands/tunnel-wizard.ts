/**
 * Tunnel Wizard
 *
 * Interactive CLI wizard for starting/managing Cloudflare tunnels.
 * Replaces the old non-interactive tunnel subcommands.
 */

import { input, select, confirm } from '@inquirer/prompts';
import { env } from 'node:process';

// ============================================================================
// Types
// ============================================================================

interface TunnelStatus {
  status: 'stopped' | 'starting' | 'running' | 'error';
  url?: string | null;
  error?: string | null;
  startedAt?: string | null;
}

interface TunnelStartResponse {
  url: string;
  status: string;
}

// ============================================================================
// Gateway API Helper
// ============================================================================
// apiFetch + auth-header attachment lives in `./gateway-client.ts`.

import { apiFetch, ensureGatewayError } from './gateway-client.js';

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// CLI Wizard
// ============================================================================

export async function tunnelWizard(): Promise<void> {
  console.log('\n=== Cloudflare Tunnel Wizard ===\n');

  // Check if tunnel already running
  try {
    const currentStatus = await apiFetch<TunnelStatus>('/tunnel');
    if (currentStatus.status === 'running' && currentStatus.url) {
      console.log(`Tunnel already running: ${currentStatus.url}`);
      const stop = await confirm({ message: 'Stop it first?', default: false });
      if (stop) {
        await apiFetch('/tunnel/stop', { method: 'POST' });
        console.log('Tunnel stopped.\n');
      } else {
        console.log('Aborted.\n');
        return;
      }
    }
  } catch {
    // Ignore — gateway may not have the tunnel service initialized yet
  }

  // Step 1: Select provider
  const provider = await select({
    message: 'Select tunnel provider:',
    choices: [
      {
        name: 'Cloudflare Quick Tunnel',
        value: 'cloudflare',
        description: 'Free, no account needed. Ephemeral URL that changes on restart.',
      },
      {
        name: 'Cloudflare Named Tunnel',
        value: 'cloudflare-named',
        description: 'Requires Cloudflare account. Persistent URL with your own hostname.',
      },
      {
        name: 'ngrok',
        value: 'ngrok',
        description: 'Requires ngrok account and auth token.',
      },
    ],
  });

  // Step 2: Port
  const defaultPort = env.PORT ?? '8080';
  const portStr = await input({
    message: `Local port to expose:`,
    default: defaultPort,
    validate: (v: string) => {
      const n = parseInt(v, 10);
      return n > 0 && n < 65536 ? true : 'Enter a valid port number (1-65535)';
    },
  });

  // Step 3: Password (optional — enables Basic Auth)
  const password = await input({
    message: 'Password (leave empty to skip Basic Auth, press Enter):',
    default: '',
  });
  const effectivePassword = password.trim() || undefined;

  // Step 4: Domain (for named tunnel only)
  let hostname: string | undefined;
  if (provider === 'cloudflare-named') {
    hostname = await input({
      message: 'Custom hostname (e.g. tunnel.example.com):',
      validate: (v: string) => (v.length > 0 ? true : 'Hostname required for named tunnels'),
    });
  }

  // Step 5: Confirm
  console.log('\nConfiguration:');
  console.log(
    `  Provider:  ${provider === 'cloudflare-named' ? 'Cloudflare Named Tunnel' : provider === 'cloudflare' ? 'Cloudflare Quick Tunnel' : 'ngrok'}`
  );
  console.log(`  Port:      ${portStr}`);
  console.log(
    `  Auth:      ${effectivePassword ? `Basic Auth (op:${'*'.repeat(effectivePassword.length)})` : 'None (public)'}`
  );
  if (hostname) console.log(`  Domain:    ${hostname}`);

  const confirmed = await confirm({ message: '\nStart tunnel?', default: true });
  if (!confirmed) {
    console.log('Aborted.\n');
    return;
  }

  // Start the tunnel
  console.log('\nStarting tunnel...\n');

  try {
    if (provider === 'ngrok') {
      // ngrok uses the gateway's ngrok integration — but for now just report not implemented
      console.error('ngrok tunnel via API not implemented yet. Use Cloudflare tunnel.');
      return;
    }

    // Configure first (port + hostname)
    await apiFetch('/tunnel/config', {
      method: 'PUT',
      body: JSON.stringify({ port: parseInt(portStr, 10), hostname }),
    });

    // Start with optional password
    const result = await apiFetch<TunnelStartResponse>('/tunnel/start', {
      method: 'POST',
      body: JSON.stringify({ password: effectivePassword }),
    });

    console.log(`\nTunnel started!`);
    console.log(`  URL: ${result.url}`);
    if (effectivePassword) {
      console.log(`  Auth:  op:${effectivePassword}`);
    }
    console.log(
      '\nAccess the tunnel URL in your browser. Basic Auth will prompt for credentials if password was set.\n'
    );

    // Poll status until running
    let pollCount = 0;
    while (pollCount < 15) {
      await sleep(2000);
      const status = await apiFetch<TunnelStatus>('/tunnel');
      if (status.status === 'running') {
        console.log(`Tunnel active: ${status.url}\n`);
        break;
      }
      if (status.status === 'error') {
        console.error(`Tunnel error: ${status.error}\n`);
        break;
      }
      pollCount++;
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('ExitPromptError')) return;
    ensureGatewayError(error);
  }
}

/**
 * Show tunnel status.
 */
export async function tunnelStatus(): Promise<void> {
  try {
    const status = await apiFetch<TunnelStatus>('/tunnel');
    console.log(`\nTunnel Status: ${status.status}`);
    if (status.url) console.log(`URL: ${status.url}`);
    if (status.startedAt) console.log(`Started: ${new Date(status.startedAt).toLocaleString()}`);
    if (status.error) console.error(`Error: ${status.error}`);
    console.log();
  } catch (error) {
    ensureGatewayError(error);
  }
}

/**
 * Stop the active tunnel.
 */
export async function tunnelStop(): Promise<void> {
  try {
    await apiFetch('/tunnel/stop', { method: 'POST' });
    console.log('Tunnel stopped.\n');
  } catch (error) {
    ensureGatewayError(error);
  }
}
