#!/usr/bin/env node
/**
 * OwnPilot CLI
 */

import { Command } from 'commander';
import { VERSION } from '@ownpilot/core/version';
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
} from '@ownpilot/gateway/db';

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
import { tunnelWizard, tunnelStop, tunnelStatus } from './commands/tunnel-wizard.js';
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
import { startAcpServe } from './commands/acp.js';
import {
  agenticRun,
  agenticList,
  agenticStatus,
  agenticCancel,
  agenticRerun,
  agenticPlan,
  agenticCapabilities,
  agenticStats,
  agenticWatch,
  agenticHelp,
} from './commands/agentic.js';
import {
  clawList,
  clawGet,
  clawStats,
  clawPresets,
  clawStart,
  clawPause,
  clawResume,
  clawStop,
  clawDelete,
  clawSendMessage,
  clawNextIntent,
  clawSteer,
  clawResetFailures,
  clawApproveEscalation,
  clawDenyEscalation,
  clawHistory,
  clawWatch,
} from './commands/claw.js';

// Load environment variables from .env (fallback)
loadEnv({ quiet: true });

const program = new Command();

program.name('ownpilot').description('Privacy-first AI Gateway CLI').version(VERSION);

// Setup command - first-time configuration.
// `--password` used to live here; the encrypted-credential-store has been
// removed (see configChangePassword in commands/config.ts), so the flag is
// dropped to avoid lulling users into thinking a master password is being
// stored or required.
program.command('setup').description('Initialize the gateway database').action(setup);

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

// ACP server — exposes OwnPilot as an Agent Client Protocol agent over
// stdio. IDEs (Zed) and other ACP-compliant tools spawn this and talk
// JSON-RPC on stdin/stdout. Diagnostics MUST go to stderr only.
program
  .command('acp-serve')
  .description('Run OwnPilot as an ACP agent over stdio (for IDE integrations)')
  .action(async () => {
    await startAcpServe(async () => {
      await initializeAll();
      await loadCredentialsToEnv();
    });
    process.exit(0);
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

tunnelCmd.command('stop').description('Stop the active tunnel').action(tunnelStop);

tunnelCmd.command('status').description('Show tunnel status').action(tunnelStatus);

// Default: no subcommand → interactive wizard
tunnelCmd.action(tunnelWizard);

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

// Agentic commands — unified task execution across all agent types
const agenticCmd = program
  .command('agentic')
  .description('Unified task execution across all agent types (run/list/status/cancel/plan/capabilities/stats)');

agenticCmd
  .command('run <task...>')
  .description('Execute an autonomous agentic task')
  .option('--name <name>', 'Task name (auto-generated from description if not set)')
  .option('--priority <level>', 'Priority: low, normal, high, critical')
  .option('--trigger <type>', 'Trigger: immediate, interval, continuous (default: immediate)')
  .option('--interval <ms>', 'Interval in ms for interval trigger (default: 300000)')
  .option('--timeout <ms>', 'Step timeout in ms (default: 60000)')
  .option('--output <path>', 'Save results to file')
  .option('--provider <provider>', 'AI provider (uses system default if not set)')
  .option('--model <model>', 'Model name (uses system default if not set)')
  .option('--prompt <text>', 'System prompt override for the agent')
  .option('--json', 'Output as JSON')
  .action(agenticRun);

agenticCmd
  .command('list')
  .description('List recent executions')
  .option('-l, --limit <n>', 'Max results (default: 20)', (v) => Number(v))
  .option('-o, --offset <n>', 'Offset for pagination', (v) => Number(v))
  .option('--json', 'Output as JSON')
  .action(agenticList);

agenticCmd
  .command('status <id>')
  .description('Show detailed execution report')
  .option('--json', 'JSON output format')
  .action(agenticStatus);

agenticCmd
  .command('cancel <id>')
  .description('Cancel a running execution')
  .action(agenticCancel);

agenticCmd
  .command('rerun <id>')
  .description('Re-run a previous execution (same task, new settings)')
  .option('--provider <id>', 'Override AI provider')
  .option('--model <name>', 'Override model name')
  .option('--prompt <text>', 'Override system prompt')
  .option('--priority <lvl>', 'Override priority')
  .action(agenticRerun);

agenticCmd
  .command('plan <task...>')
  .description('Analyze a task and show execution plan (no execution)')
  .option('--name <name>', 'Task name')
  .option('--trigger <type>', 'Trigger: immediate, interval, continuous')
  .option('--interval <ms>', 'Interval in ms for interval trigger')
  .option('--provider <provider>', 'AI provider (uses system default if not set)')
  .option('--model <model>', 'Model name (uses system default if not set)')
  .option('--prompt <text>', 'System prompt override')
  .action(agenticPlan);

agenticCmd
  .command('capabilities')
  .description('List registered agent capabilities')
  .option('--kind <kind>', 'Filter by executor kind (comma-separated)')
  .option('--search <keywords>', 'Search by keywords (comma-separated)')
  .option('--provider <id>', 'Filter by provider ID')
  .option('--json', 'Output as JSON')
  .action(agenticCapabilities);

agenticCmd
  .command('stats')
  .description('Show aggregated execution statistics')
  .option('--json', 'Output as JSON')
  .action(agenticStats);

agenticCmd
  .command('watch')
  .description('Live-tail agentic execution events via WebSocket')
  .option('-v, --verbose', 'print full JSON payloads instead of summary lines')
  .option('-l, --limit <n>', 'exit after N events', (v: string) => Number(v))
  .option('--token <token>', 'API token (overrides OWNPILOT_API_KEY env)')
  .action((opts) => agenticWatch(opts));

// Default: no subcommand → show help
agenticCmd.action(agenticHelp);

// Claw commands — drive the unified autonomous agent runtime
const clawCmd = program
  .command('claw')
  .description('Manage Claw autonomous agent runtimes (start/pause/steer/inspect)');

clawCmd
  .command('list')
  .description('List all claws with state, cycles, cost, focus')
  .action(clawList);
clawCmd.command('get <id>').description('Show claw config + session (JSON)').action(clawGet);
clawCmd.command('stats').description('Aggregate stats across all claws').action(clawStats);
clawCmd.command('presets').description('List available claw presets').action(clawPresets);

clawCmd.command('start <id>').description('Start a claw').action(clawStart);
clawCmd.command('pause <id>').description('Pause a running claw').action(clawPause);
clawCmd.command('resume <id>').description('Resume a paused claw').action(clawResume);
clawCmd.command('stop <id>').description('Stop a claw').action(clawStop);
clawCmd.command('delete <id>').description('Delete a claw permanently').action(clawDelete);

clawCmd
  .command('send-message <id> <message...>')
  .description('Queue inbox message (read on next cycle)')
  .action(clawSendMessage);

clawCmd
  .command('next-intent <id> <directive...>')
  .description('Queue [OPERATOR] directive for next cycle (no interrupt)')
  .action(clawNextIntent);

clawCmd
  .command('steer <id> <directive...>')
  .description('Interrupt the current cycle and restart with this directive now')
  .action(clawSteer);

clawCmd
  .command('reset-failures <id>')
  .description('Clear consecutiveErrors + recentFailures (lifts reflection mode)')
  .action(clawResetFailures);

clawCmd
  .command('approve-escalation <id>')
  .description('Approve a pending escalation request')
  .action(clawApproveEscalation);

clawCmd
  .command('deny-escalation <id> [reason...]')
  .description('Deny a pending escalation request')
  .action(clawDenyEscalation);

clawCmd
  .command('history <id> [limit]')
  .description('Show recent execution history (default 20)')
  .action(clawHistory);

clawCmd
  .command('watch [id]')
  .description('Live-tail WebSocket claw events (id or "all"; --verbose for full payloads)')
  .option('-v, --verbose', 'print full JSON payloads instead of summary lines')
  .option('-l, --limit <n>', 'exit after N events', (v) => Number(v))
  .option('--token <token>', 'API token (overrides OWNPILOT_API_KEY env)')
  .action((id, opts) => clawWatch(id, opts));

// Parse arguments
program.parse();
