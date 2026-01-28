/**
 * Channel management commands
 */

import { input, select, confirm } from '@inquirer/prompts';

interface ChannelConfig {
  id: string;
  type: string;
  name: string;
  config: Record<string, string>;
}

// In-memory channel storage (would be persisted in real implementation)
const channels = new Map<string, ChannelConfig>();

/**
 * List all configured channels
 */
export async function channelList(): Promise<void> {
  console.log('\nConfigured Channels:');
  console.log('─'.repeat(60));

  if (channels.size === 0) {
    console.log('  No channels configured yet.');
    console.log('  Use "ownpilot channel add" to add a channel.\n');
    return;
  }

  for (const [id, channel] of channels) {
    console.log(`  ${channel.type.padEnd(12)} ${channel.name.padEnd(20)} [${id}]`);
  }
  console.log();
}

/**
 * Add a new channel
 */
export async function channelAdd(): Promise<void> {
  console.log('\n📱 Add a new channel\n');

  // Select channel type
  const type = await select({
    message: 'Select channel type:',
    choices: [
      { name: 'Telegram', value: 'telegram', description: 'Telegram bot via Bot API' },
      { name: 'Discord', value: 'discord', description: 'Discord bot' },
      { name: 'Slack', value: 'slack', description: 'Slack bot via Socket Mode' },
      { name: 'Matrix', value: 'matrix', description: 'Matrix chat protocol' },
      { name: 'WhatsApp', value: 'whatsapp', description: 'WhatsApp Business API' },
      { name: 'WebChat', value: 'webchat', description: 'Embedded web widget' },
    ],
  });

  // Get channel name
  const name = await input({
    message: 'Channel display name:',
    default: `My ${type.charAt(0).toUpperCase() + type.slice(1)} Bot`,
  });

  // Get type-specific configuration
  const config: Record<string, string> = {};

  switch (type) {
    case 'telegram': {
      config.botToken = await input({
        message: 'Bot token (from @BotFather):',
        validate: (value: string) => (value.includes(':') ? true : 'Invalid bot token format'),
      });

      const restrictUsers = await confirm({
        message: 'Restrict to specific users?',
        default: false,
      });

      if (restrictUsers) {
        config.allowedUsers = await input({
          message: 'Allowed user IDs (comma-separated):',
        });
      }
      break;
    }

    case 'discord': {
      config.botToken = await input({
        message: 'Bot token:',
      });
      config.applicationId = await input({
        message: 'Application ID:',
      });
      break;
    }

    case 'slack': {
      config.botToken = await input({
        message: 'Bot token (xoxb-...):',
      });
      config.appToken = await input({
        message: 'App token for Socket Mode (xapp-...):',
      });
      break;
    }

    case 'matrix': {
      config.homeserverUrl = await input({
        message: 'Homeserver URL:',
        default: 'https://matrix.org',
      });
      config.accessToken = await input({
        message: 'Access token:',
      });
      config.userId = await input({
        message: 'User ID (@user:server):',
      });
      break;
    }

    case 'whatsapp': {
      config.phoneNumberId = await input({
        message: 'Phone number ID:',
      });
      config.businessAccountId = await input({
        message: 'Business Account ID:',
      });
      config.accessToken = await input({
        message: 'Access token:',
      });
      break;
    }

    case 'webchat': {
      const customOrigins = await confirm({
        message: 'Restrict to specific origins?',
        default: false,
      });

      if (customOrigins) {
        config.allowedOrigins = await input({
          message: 'Allowed origins (comma-separated):',
        });
      }
      break;
    }
  }

  // Generate ID
  const id = `${type}-${Date.now().toString(36)}`;

  // Store channel
  channels.set(id, { id, type, name, config });

  console.log(`\n✅ Channel "${name}" added successfully!`);
  console.log(`   ID: ${id}`);
  console.log(`   Type: ${type}`);
  console.log('\nRun "ownpilot start" to connect the channel.\n');
}

/**
 * Remove a channel
 */
export async function channelRemove(options: { id?: string }): Promise<void> {
  if (channels.size === 0) {
    console.log('\nNo channels configured.\n');
    return;
  }

  let channelId = options.id;

  if (!channelId) {
    // Interactive selection
    const choices = Array.from(channels.entries()).map(([id, ch]) => ({
      name: `${ch.name} (${ch.type})`,
      value: id,
    }));

    channelId = await select({
      message: 'Select channel to remove:',
      choices,
    });
  }

  if (!channelId) {
    console.log('\n❌ No channel selected.\n');
    return;
  }

  const channel = channels.get(channelId);
  if (!channel) {
    console.log(`\n❌ Channel not found: ${channelId}\n`);
    return;
  }

  const confirmed = await confirm({
    message: `Remove channel "${channel.name}"?`,
    default: false,
  });

  if (confirmed) {
    channels.delete(channelId);
    console.log(`\n✅ Channel "${channel.name}" removed.\n`);
  } else {
    console.log('\nCancelled.\n');
  }
}

/**
 * Show channel status
 */
export async function channelStatus(): Promise<void> {
  console.log('\n📊 Channel Status\n');
  console.log('─'.repeat(70));
  console.log(`${'TYPE'.padEnd(12)} ${'NAME'.padEnd(20)} ${'STATUS'.padEnd(12)} LAST ACTIVITY`);
  console.log('─'.repeat(70));

  if (channels.size === 0) {
    console.log('  No channels configured.\n');
    return;
  }

  // In real implementation, this would query the gateway
  for (const channel of channels.values()) {
    const status = '🔴 offline';
    const lastActivity = 'N/A';
    console.log(
      `${channel.type.padEnd(12)} ${channel.name.padEnd(20)} ${status.padEnd(12)} ${lastActivity}`
    );
  }
  console.log();
}

/**
 * Connect a channel (sends request to gateway)
 */
export async function channelConnect(options: { id?: string }): Promise<void> {
  if (channels.size === 0) {
    console.log('\nNo channels configured. Use "ownpilot channel add" first.\n');
    return;
  }

  let channelId = options.id;

  if (!channelId) {
    const choices = Array.from(channels.entries()).map(([id, ch]) => ({
      name: `${ch.name} (${ch.type})`,
      value: id,
    }));

    channelId = await select({
      message: 'Select channel to connect:',
      choices,
    });
  }

  if (!channelId) {
    console.log('\n❌ No channel selected.\n');
    return;
  }

  const channel = channels.get(channelId);
  if (!channel) {
    console.log(`\n❌ Channel not found: ${channelId}\n`);
    return;
  }

  console.log(`\n🔄 Connecting "${channel.name}"...`);

  // In real implementation, this would send WebSocket message to gateway
  // For now, simulate connection
  await new Promise((resolve) => setTimeout(resolve, 1000));

  console.log(`✅ Channel "${channel.name}" connected!\n`);
}

/**
 * Disconnect a channel
 */
export async function channelDisconnect(options: { id?: string }): Promise<void> {
  if (channels.size === 0) {
    console.log('\nNo channels configured.\n');
    return;
  }

  let channelId = options.id;

  if (!channelId) {
    const choices = Array.from(channels.entries()).map(([id, ch]) => ({
      name: `${ch.name} (${ch.type})`,
      value: id,
    }));

    channelId = await select({
      message: 'Select channel to disconnect:',
      choices,
    });
  }

  if (!channelId) {
    console.log('\n❌ No channel selected.\n');
    return;
  }

  const channel = channels.get(channelId);
  if (!channel) {
    console.log(`\n❌ Channel not found: ${channelId}\n`);
    return;
  }

  console.log(`\n🔄 Disconnecting "${channel.name}"...`);

  // In real implementation, this would send WebSocket message to gateway
  await new Promise((resolve) => setTimeout(resolve, 500));

  console.log(`✅ Channel "${channel.name}" disconnected.\n`);
}
