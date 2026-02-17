#!/usr/bin/env node
/**
 * OwnPilot CLI
 */

import { Command } from 'commander';
import { config as loadEnv } from 'dotenv';
import { startServer } from './commands/server.js';
import { startBot } from './commands/bot.js';
import { startAll } from './commands/start.js';
import {
  setup,
  configSet,
  configGet,
  configDelete,
  configList,
  configChangePassword,
  loadCredentialsToEnv,
} from './commands/config.js';
import {
  channelList,
  channelAdd,
  channelRemove,
  channelStatus,
  channelConnect,
  channelDisconnect,
} from './commands/channel.js';
import {
  workspaceList,
  workspaceCreate,
  workspaceDelete,
  workspaceSwitch,
  workspaceInfo,
} from './commands/workspace.js';
import {
  tunnelStartNgrok,
  tunnelStartCloudflare,
  tunnelStop,
  tunnelStatus,
} from './commands/tunnel.js';

// Load environment variables from .env (fallback)
loadEnv();

const program = new Command();

program
  .name('ownpilot')
  .description('Privacy-first AI Gateway CLI')
  .version('0.1.0');

// Setup command - first-time configuration
program
  .command('setup')
  .description('Initialize the gateway with encrypted credential storage')
  .option('-p, --password <password>', 'Master password (will prompt if not provided)')
  .action(setup);

// Server command - loads credentials before starting
program
  .command('server')
  .description('Start the HTTP API server')
  .option('-p, --port <port>', 'Port to listen on', '8080')
  .option('-h, --host <host>', 'Host to bind to', '0.0.0.0')
  .option('--no-auth', 'Disable authentication')
  .option('--no-rate-limit', 'Disable rate limiting')
  .action(async (options) => {
    await loadCredentialsToEnv();
    await startServer(options);
  });

// Bot command - loads credentials before starting
program
  .command('bot')
  .description('Start the Telegram bot')
  .option('-t, --token <token>', 'Telegram bot token (or use TELEGRAM_BOT_TOKEN env)')
  .option('-w, --webhook <url>', 'Webhook URL (uses long polling if not set)')
  .option('--users <ids>', 'Comma-separated allowed user IDs')
  .option('--chats <ids>', 'Comma-separated allowed chat IDs')
  .action(async (options) => {
    await loadCredentialsToEnv();
    await startBot(options);
  });

// Start all command - loads credentials before starting
program
  .command('start')
  .description('Start both server and bot')
  .option('-p, --port <port>', 'Server port', '8080')
  .option('--no-bot', 'Skip starting the Telegram bot')
  .action(async (options) => {
    await loadCredentialsToEnv();
    await startAll(options);
  });

// Config commands for secure credential management
const configCmd = program
  .command('config')
  .description('Manage encrypted API keys and credentials');

configCmd
  .command('set <key> [value]')
  .description('Store a credential (openai-api-key, anthropic-api-key, telegram-bot-token, jwt-secret)')
  .action((key, value) => configSet({ key, value }));

configCmd
  .command('get <key>')
  .description('Show a credential (masked)')
  .action((key) => configGet({ key }));

configCmd
  .command('delete <key>')
  .description('Remove a credential')
  .action((key) => configDelete({ key }));

configCmd
  .command('list')
  .description('List all stored credentials')
  .action(configList);

configCmd
  .command('change-password')
  .description('Change the master password')
  .action(configChangePassword);

// Channel commands for multi-channel management
const channelCmd = program
  .command('channel')
  .description('Manage messaging channels (Telegram, Discord)');

channelCmd
  .command('list')
  .description('List all configured channels')
  .action(channelList);

channelCmd
  .command('add')
  .description('Add a new channel')
  .action(channelAdd);

channelCmd
  .command('remove [id]')
  .description('Remove a channel')
  .action((id) => channelRemove({ id }));

channelCmd
  .command('status')
  .description('Show channel status')
  .action(channelStatus);

channelCmd
  .command('connect [id]')
  .description('Connect a channel to the gateway')
  .action((id) => channelConnect({ id }));

channelCmd
  .command('disconnect [id]')
  .description('Disconnect a channel from the gateway')
  .action((id) => channelDisconnect({ id }));

// Workspace commands for isolated agent sessions
const workspaceCmd = program
  .command('workspace')
  .description('Manage workspaces (isolated agent sessions)');

workspaceCmd
  .command('list')
  .description('List all workspaces')
  .action(workspaceList);

workspaceCmd
  .command('create')
  .description('Create a new workspace')
  .action(workspaceCreate);

workspaceCmd
  .command('delete [id]')
  .description('Delete a workspace')
  .action((id) => workspaceDelete({ id }));

workspaceCmd
  .command('switch [id]')
  .description('Switch to a workspace')
  .action((id) => workspaceSwitch({ id }));

workspaceCmd
  .command('info [id]')
  .description('Show workspace details')
  .action((id) => workspaceInfo({ id }));

// Tunnel commands for external access (webhook mode)
const tunnelCmd = program
  .command('tunnel')
  .description('Manage tunnels for external access (webhook mode)');

const tunnelStartCmd = tunnelCmd
  .command('start')
  .description('Start a tunnel to expose the gateway');

tunnelStartCmd
  .command('ngrok')
  .description('Start an ngrok tunnel')
  .option('-t, --token <token>', 'ngrok auth token (or set NGROK_AUTHTOKEN env)')
  .option('-p, --port <port>', 'Local port to tunnel', '8080')
  .action(tunnelStartNgrok);

tunnelStartCmd
  .command('cloudflare')
  .description('Start a Cloudflare quick tunnel (requires cloudflared)')
  .option('-d, --domain <domain>', 'Custom hostname (requires Cloudflare setup)')
  .option('-p, --port <port>', 'Local port to tunnel', '8080')
  .action(tunnelStartCloudflare);

tunnelCmd
  .command('stop')
  .description('Stop the active tunnel')
  .action(tunnelStop);

tunnelCmd
  .command('status')
  .description('Show tunnel status')
  .action(tunnelStatus);

// Parse arguments
program.parse();
