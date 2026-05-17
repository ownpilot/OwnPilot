#!/usr/bin/env node
/**
 * OwnPilot CLI
 */

import { Command } from 'commander';
import { VERSION } from '@ownpilot/core';
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
  initializeAdapter,
  initializeSettingsRepo,
  initializeConfigServicesRepo,
  initializeLocalProvidersRepo,
  initializePluginsRepo,
  seedConfigServices,
} from '@ownpilot/gateway';

/**
 * Initialize database adapter and all repository caches.
 * Must run before any code that accesses settings or local providers.
 */
async function initializeAll(): Promise<void> {
  await initializeAdapter();
  await initializeSettingsRepo();
  await initializeConfigServicesRepo();
  await seedConfigServices();
  await initializePluginsRepo();
  await initializeLocalProvidersRepo();
}
import {
  channelList,
  channelAdd,
  channelRemove,
  channelStatus,
  channelConnect,
  channelDisconnect,
} from './commands/channel.js';
import {
  tunnelStartNgrok,
  tunnelStartCloudflare,
  tunnelStop,
  tunnelStatus,
} from './commands/tunnel.js';
import {
  skillList,
  skillSearch,
  skillInstall,
  skillUninstall,
  skillEnable,
  skillDisable,
  skillCheckUpdates,
  skillAudit,
} from './commands/skill.js';
import {
  soulList,
  soulGet,
  soulDelete,
  soulFeedback,
  soulVersions,
  crewList,
  crewGet,
  crewPause,
  crewResume,
  crewDisband,
  crewTemplates,
  msgList,
  msgSend,
  msgAgent,
  heartbeatList,
  heartbeatStats,
  heartbeatAgent,
} from './commands/soul.js';

// Load environment variables from .env (fallback)
loadEnv({ quiet: true });

const program = new Command();

program.name('ownpilot').description('Privacy-first AI Gateway CLI').version(VERSION);

// Setup command - first-time configuration
program
  .command('setup')
  .description('Initialize the gateway with encrypted credential storage')
  .option('-p, --password <password>', 'Master password (will prompt if not provided)')
  .action(setup);

// Server command - initializes repos before starting
program
  .command('server')
  .description('Start the HTTP API server')
  .option('-p, --port <port>', 'Port to listen on', '8080')
  .option('-h, --host <host>', 'Host to bind to', '0.0.0.0')
  .option('--no-auth', 'Disable authentication')
  .option('--no-rate-limit', 'Disable rate limiting')
  .action(async (options) => {
    await initializeAll();
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
    await initializeAll();
    await loadCredentialsToEnv();
    await startBot(options);
  });

// Start all command - initializes repos before starting
program
  .command('start')
  .description('Start both server and bot')
  .option('-p, --port <port>', 'Server port', '8080')
  .option('--no-bot', 'Skip starting the Telegram bot')
  .action(async (options) => {
    await initializeAll();
    await loadCredentialsToEnv();
    await startAll(options);
  });

// Config commands for secure credential management
const configCmd = program
  .command('config')
  .description('Manage encrypted API keys and credentials');

configCmd
  .command('set <key> [value]')
  .description(
    'Store a credential (openai-api-key, anthropic-api-key, telegram-bot-token, jwt-secret)'
  )
  .action((key, value) => configSet({ key, value }));

configCmd
  .command('get <key>')
  .description('Show a credential (masked)')
  .action((key) => configGet({ key }));

configCmd
  .command('delete <key>')
  .description('Remove a credential')
  .action((key) => configDelete({ key }));

configCmd.command('list').description('List all stored credentials').action(configList);

configCmd
  .command('change-password')
  .description('Change the master password')
  .action(configChangePassword);

// Channel commands for multi-channel management
const channelCmd = program
  .command('channel')
  .description('Manage messaging channels (Telegram, Discord)');

channelCmd.command('list').description('List all configured channels').action(channelList);

channelCmd.command('add').description('Add a new channel').action(channelAdd);

channelCmd
  .command('remove [id]')
  .description('Remove a channel')
  .action((id) => channelRemove({ id }));

channelCmd.command('status').description('Show channel status').action(channelStatus);

channelCmd
  .command('connect [id]')
  .description('Connect a channel to the gateway')
  .action((id) => channelConnect({ id }));

channelCmd
  .command('disconnect [id]')
  .description('Disconnect a channel from the gateway')
  .action((id) => channelDisconnect({ id }));

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

tunnelCmd.command('stop').description('Stop the active tunnel').action(tunnelStop);

tunnelCmd.command('status').description('Show tunnel status').action(tunnelStatus);

// Skill commands for npm-based skill management
const skillCmd = program
  .command('skill')
  .description('Manage skills (install, search, permissions)');

skillCmd.command('list').description('List installed skills').action(skillList);

skillCmd
  .command('search <query>')
  .description('Search npm for OwnPilot skills')
  .action(skillSearch);

skillCmd
  .command('install <name>')
  .description('Install a skill from npm or local path')
  .action(skillInstall);

skillCmd
  .command('uninstall [id]')
  .description('Uninstall a skill')
  .action((id) => skillUninstall(id));

skillCmd
  .command('remove [id]')
  .alias('rm')
  .description('Remove a skill')
  .action((id) => skillUninstall(id));

skillCmd
  .command('enable [id]')
  .description('Enable a disabled skill')
  .action((id) => skillEnable(id));

skillCmd
  .command('disable [id]')
  .description('Disable a skill')
  .action((id) => skillDisable(id));

skillCmd
  .command('update-check')
  .description('Check for skill updates from npm')
  .action(skillCheckUpdates);

skillCmd
  .command('audit [id]')
  .description('Run security audit on a skill')
  .action((id) => skillAudit(id));

// Soul commands for agent identity management
const soulCmd = program.command('soul').description('Manage agent souls (persistent identities)');

soulCmd.command('list').description('List all agent souls').action(soulList);

soulCmd.command('get <agentId>').description('Show soul details (JSON)').action(soulGet);

soulCmd.command('delete <agentId>').description('Delete an agent soul').action(soulDelete);

soulCmd
  .command('feedback <agentId> <type> <content>')
  .description('Send feedback (praise/correction/directive/personality_tweak)')
  .action(soulFeedback);

soulCmd.command('versions <agentId>').description('List soul version history').action(soulVersions);

// Crew commands for autonomous teams
const crewCmd = program.command('crew').description('Manage agent crews (autonomous teams)');

crewCmd.command('list').description('List all crews').action(crewList);

crewCmd.command('get <id>').description('Show crew details (JSON)').action(crewGet);

crewCmd.command('pause <id>').description('Pause a crew').action(crewPause);

crewCmd.command('resume <id>').description('Resume a paused crew').action(crewResume);

crewCmd.command('disband <id>').description('Disband a crew').action(crewDisband);

crewCmd.command('templates').description('List available crew templates').action(crewTemplates);

// Message commands for inter-agent communication
const msgCmd = program.command('msg').description('Agent inter-communication messages');

msgCmd.command('list').description('List recent agent messages').action(msgList);

msgCmd
  .command('send <agentId> <content>')
  .description('Send a message to an agent')
  .action(msgSend);

msgCmd
  .command('agent <agentId>')
  .description('Show messages for a specific agent')
  .action(msgAgent);

// Heartbeat commands for autonomous execution logs
const heartbeatCmd = program.command('heartbeat').description('View heartbeat execution logs');

heartbeatCmd.command('list').description('List recent heartbeat logs').action(heartbeatList);

heartbeatCmd
  .command('stats [agentId]')
  .description('Show heartbeat statistics')
  .action(heartbeatStats);

heartbeatCmd
  .command('agent <agentId>')
  .description('Show heartbeat logs for a specific agent')
  .action(heartbeatAgent);

// Parse arguments
program.parse();
