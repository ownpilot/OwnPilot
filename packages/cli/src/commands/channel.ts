/**
 * Channel Management Commands
 *
 * Manages messaging channels (Telegram, Discord) via the gateway REST API.
 * All state lives in the gateway — the CLI is a thin client.
 */

import { input, select, confirm } from '@inquirer/prompts';

// ============================================================================
// Types
// ============================================================================

interface ChannelInfo {
  id: string;
  type: string;
  name: string;
  status: string;
  botInfo?: { username: string; firstName: string };
}

interface ChannelListResponse {
  channels: ChannelInfo[];
  summary: { total: number; connected: number; disconnected: number };
  availableTypes: string[];
}

interface SetupResponse {
  pluginId: string;
  status: string;
  botInfo?: { username: string; firstName: string };
}

// ============================================================================
// Gateway API Helper
// ============================================================================

const getBaseUrl = () => process.env.OWNPILOT_GATEWAY_URL ?? 'http://localhost:8080';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}/api/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // Gateway returns { error: { code, message } } or { error: "string" }
    const errField = body.error;
    const msg =
      typeof errField === 'object' && errField !== null
        ? ((errField as Record<string, string>).message ?? JSON.stringify(errField))
        : ((errField as string) ?? (body.message as string) ?? `HTTP ${res.status}`);
    throw new Error(msg);
  }

  const json = (await res.json()) as Record<string, unknown>;
  return (json.data ?? json) as T;
}

function ensureGatewayError(error: unknown): never {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
    console.error(
      '\nCould not reach gateway at ' +
        getBaseUrl() +
        '.\n' +
        'Make sure the server is running: ownpilot start\n'
    );
  } else {
    console.error(`\nError: ${msg}\n`);
  }
  process.exit(1);
}

// ============================================================================
// Helpers
// ============================================================================

const STATUS_ICONS: Record<string, string> = {
  connected: '\u2705', // green check
  connecting: '\u23F3', // hourglass
  disconnected: '\u26AA', // white circle
  error: '\u274C', // red cross
};

function statusIcon(status: string): string {
  return STATUS_ICONS[status] ?? '\u2753'; // question mark fallback
}

async function fetchChannels(): Promise<ChannelListResponse> {
  return apiFetch<ChannelListResponse>('/channels');
}

async function pickChannel(channels: ChannelInfo[], message: string): Promise<string> {
  if (channels.length === 1) return channels[0]!.id;

  return select({
    message,
    choices: channels.map((ch) => ({
      name: `${ch.name} (${ch.type}) ${statusIcon(ch.status)} ${ch.status}`,
      value: ch.id,
    })),
  });
}

// ============================================================================
// Public Commands
// ============================================================================

/**
 * List all channels from the gateway.
 */
export async function channelList(): Promise<void> {
  try {
    const data = await fetchChannels();

    console.log('\nChannels:');
    console.log('\u2500'.repeat(74));
    console.log(
      `${'ID'.padEnd(24)} ${'TYPE'.padEnd(12)} ${'NAME'.padEnd(18)} ${'STATUS'.padEnd(14)} BOT`
    );
    console.log('\u2500'.repeat(74));

    if (data.channels.length === 0) {
      console.log('  No channels configured.');
      console.log('  Use "ownpilot channel add" to add one.\n');
      return;
    }

    for (const ch of data.channels) {
      const bot = ch.botInfo?.username ? `@${ch.botInfo.username}` : '';
      console.log(
        `${ch.id.padEnd(24)} ${ch.type.padEnd(12)} ${ch.name.padEnd(18)} ${statusIcon(ch.status)} ${ch.status.padEnd(12)} ${bot}`
      );
    }

    console.log('\u2500'.repeat(74));
    console.log(
      `  ${data.summary.total} total, ${data.summary.connected} connected, ${data.summary.disconnected} disconnected\n`
    );
  } catch (error) {
    ensureGatewayError(error);
  }
}

/**
 * Add and connect a new channel via quick setup.
 */
export async function channelAdd(): Promise<void> {
  console.log('\nAdd a new channel\n');

  try {
    // 1. Select channel type
    const type = await select({
      message: 'Select channel type:',
      choices: [{ name: 'Telegram', value: 'telegram', description: 'Telegram bot via Bot API' }],
    });

    // 2. Collect token
    const config: Record<string, string> = {};

    if (type === 'telegram') {
      config.bot_token = await input({
        message: 'Bot token (from @BotFather):',
        validate: (v: string) =>
          v.includes(':') ? true : 'Invalid token format (expected number:string)',
      });

      const restrictUsers = await confirm({
        message: 'Restrict to specific users?',
        default: false,
      });
      if (restrictUsers) {
        config.allowed_users = await input({
          message: 'Allowed user IDs (comma-separated):',
        });
      }
    }

    // 3. Determine plugin ID
    const pluginId = `channel.${type}`;

    // 4. Call quick setup endpoint
    console.log(`\nConnecting ${type} bot...`);

    const result = await apiFetch<SetupResponse>(`/channels/${pluginId}/setup`, {
      method: 'POST',
      body: JSON.stringify({ config }),
    });

    // 5. Show result
    console.log(`\nChannel connected!`);
    console.log(`  Plugin: ${result.pluginId}`);
    console.log(`  Status: ${statusIcon(result.status)} ${result.status}`);
    if (result.botInfo) {
      console.log(`  Bot:    @${result.botInfo.username} (${result.botInfo.firstName})`);
    }
    console.log('\nYou can now chat with your bot. Messages appear in the Inbox.\n');
  } catch (error) {
    if (error instanceof Error && error.message.includes('ExitPromptError')) return;
    ensureGatewayError(error);
  }
}

/**
 * Show channel status (alias for list).
 */
export async function channelStatus(): Promise<void> {
  return channelList();
}

/**
 * Connect a channel.
 */
export async function channelConnect(options: { id?: string }): Promise<void> {
  try {
    const data = await fetchChannels();

    if (data.channels.length === 0) {
      console.log('\nNo channels configured. Use "ownpilot channel add" first.\n');
      return;
    }

    const channelId =
      options.id ?? (await pickChannel(data.channels, 'Select channel to connect:'));

    console.log(`\nConnecting ${channelId}...`);

    const result = await apiFetch<{ pluginId: string; status: string }>(
      `/channels/${channelId}/connect`,
      { method: 'POST' }
    );

    console.log(`${statusIcon(result.status)} ${result.pluginId} — ${result.status}\n`);
  } catch (error) {
    ensureGatewayError(error);
  }
}

/**
 * Disconnect a channel.
 */
export async function channelDisconnect(options: { id?: string }): Promise<void> {
  try {
    const data = await fetchChannels();

    if (data.channels.length === 0) {
      console.log('\nNo channels configured.\n');
      return;
    }

    const connected = data.channels.filter((ch) => ch.status === 'connected');
    if (connected.length === 0) {
      console.log('\nNo connected channels to disconnect.\n');
      return;
    }

    const channelId = options.id ?? (await pickChannel(connected, 'Select channel to disconnect:'));

    console.log(`\nDisconnecting ${channelId}...`);

    const result = await apiFetch<{ pluginId: string; status: string }>(
      `/channels/${channelId}/disconnect`,
      { method: 'POST' }
    );

    console.log(`${statusIcon(result.status)} ${result.pluginId} — ${result.status}\n`);
  } catch (error) {
    ensureGatewayError(error);
  }
}

/**
 * Remove a channel — explains that channels are plugin-based.
 */
export async function channelRemove(_options: { id?: string }): Promise<void> {
  console.log(
    '\nChannels are managed as plugins and cannot be removed individually.\n' +
      'Use "ownpilot channel disconnect" to stop a channel.\n' +
      'To remove the configuration, delete the entry in Config Center.\n'
  );
}
