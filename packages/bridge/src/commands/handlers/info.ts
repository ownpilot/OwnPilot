/**
 * Command Handlers — Info & Noop Commands
 *
 * Phase 1: Bridge-direct commands that return information without spawning CC.
 * All handlers self-register into the command registry at module load time.
 */

import { execFileSync } from 'node:child_process';
import { commandRegistry } from '../registry.ts';
import { config } from '../../config.ts';

// ---------------------------------------------------------------------------
// Info commands
// ---------------------------------------------------------------------------

commandRegistry.register({
  name: 'help',
  description: 'Show available bridge commands',
  usage: '/help',
  category: 'info',
  handler: async () => {
    const commands = commandRegistry.getAll();
    const grouped: Record<string, string[]> = {};

    for (const cmd of commands) {
      const cat = cmd.category;
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(`  /${cmd.name} — ${cmd.description}`);
    }

    const sections: string[] = [];
    const order = ['info', 'session', 'config', 'delegate', 'noop'];
    const labels: Record<string, string> = {
      info: 'Information',
      session: 'Session Management',
      config: 'Configuration',
      delegate: 'Delegated to CC',
      noop: 'Terminal Only',
    };

    for (const cat of order) {
      if (grouped[cat]?.length) {
        sections.push(`${labels[cat] ?? cat}:\n${grouped[cat].join('\n')}`);
      }
    }

    return {
      handled: true,
      response: `Available bridge commands:\n\n${sections.join('\n\n')}\n\nUnknown /commands are passed through to Claude Code (e.g., /gsd:health).`,
    };
  },
});

commandRegistry.register({
  name: 'status',
  description: 'Show bridge session status',
  usage: '/status',
  category: 'info',
  handler: async (_args, ctx) => {
    if (!ctx.sessionInfo) {
      return { handled: true, response: 'No active session.' };
    }
    const s = ctx.sessionInfo;
    const lines = [
      `Session: ${s.sessionId}`,
      `Project: ${s.projectDir}`,
      `Process alive: ${s.processAlive}`,
      `Tokens used: ${s.tokensUsed.toLocaleString()}`,
      `Budget used: $${s.budgetUsed.toFixed(2)}`,
      `Last activity: ${s.lastActivity.toISOString()}`,
    ];
    if (s.pendingApproval) {
      lines.push(`Pending: ${s.pendingApproval.pattern} — ${s.pendingApproval.text.slice(0, 80)}`);
    }
    return { handled: true, response: lines.join('\n') };
  },
});

commandRegistry.register({
  name: 'cost',
  description: 'Show session token usage and cost',
  usage: '/cost',
  category: 'info',
  handler: async (_args, ctx) => {
    if (!ctx.sessionInfo) {
      return { handled: true, response: 'No active session — no cost data available.' };
    }
    return {
      handled: true,
      response: `Tokens used: ${ctx.sessionInfo.tokensUsed.toLocaleString()}\nBudget used: $${ctx.sessionInfo.budgetUsed.toFixed(2)} / $${config.claudeMaxBudgetUsd.toFixed(2)}`,
    };
  },
});

commandRegistry.register({
  name: 'context',
  description: 'Show token count and budget remaining',
  usage: '/context',
  category: 'info',
  handler: async (_args, ctx) => {
    if (!ctx.sessionInfo) {
      return { handled: true, response: 'No active session — no context data available.' };
    }
    const remaining = config.claudeMaxBudgetUsd - ctx.sessionInfo.budgetUsed;
    return {
      handled: true,
      response: `Tokens: ${ctx.sessionInfo.tokensUsed.toLocaleString()}\nBudget remaining: $${remaining.toFixed(2)} / $${config.claudeMaxBudgetUsd.toFixed(2)}`,
    };
  },
});

commandRegistry.register({
  name: 'usage',
  description: 'Show bridge-side usage summary',
  usage: '/usage',
  category: 'info',
  handler: async (_args, ctx) => {
    if (!ctx.sessionInfo) {
      return { handled: true, response: 'No active session.' };
    }
    const s = ctx.sessionInfo;
    return {
      handled: true,
      response: [
        `Session: ${s.sessionId}`,
        `Model: ${config.claudeModel}`,
        `Tokens: ${s.tokensUsed.toLocaleString()}`,
        `Budget: $${s.budgetUsed.toFixed(2)} / $${config.claudeMaxBudgetUsd.toFixed(2)}`,
      ].join('\n'),
    };
  },
});

commandRegistry.register({
  name: 'config',
  description: 'Show current session configuration',
  usage: '/config',
  category: 'info',
  handler: async (_args, ctx) => {
    const lines = [
      `Model: ${config.claudeModel}`,
      `Max budget: $${config.claudeMaxBudgetUsd.toFixed(2)}`,
      `Default project: ${config.defaultProjectDir}`,
      `Allowed tools: ${config.allowedTools.length}`,
      `Session project: ${ctx.projectDir}`,
    ];
    if (ctx.sessionInfo) {
      lines.push(`Session: ${ctx.sessionInfo.sessionId}`);
    }
    return { handled: true, response: lines.join('\n') };
  },
});

// ---------------------------------------------------------------------------
// Utility commands (spawn child processes)
// ---------------------------------------------------------------------------

commandRegistry.register({
  name: 'diff',
  description: 'Show git diff in project directory',
  usage: '/diff [args]',
  category: 'info',
  handler: async (args, ctx) => {
    try {
      const gitArgs = args
        ? ['diff', ...args.split(/\s+/).filter(Boolean)]
        : ['diff'];
      const output = execFileSync('git', gitArgs, {
        cwd: ctx.projectDir,
        encoding: 'utf-8',
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      });
      return {
        handled: true,
        response: output.trim() || 'No changes (working tree clean).',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('not a git repository') || msg.includes('Not a git repository')) {
        return { handled: true, response: `Not a git repository: ${ctx.projectDir}` };
      }
      return { handled: true, response: `git diff failed: ${msg.slice(0, 500)}` };
    }
  },
});


// ---------------------------------------------------------------------------
// Noop commands (terminal-only features)
// ---------------------------------------------------------------------------

const noopCommands: Array<{ name: string; description: string; response: string }> = [
  {
    name: 'theme',
    description: 'Change visual theme (terminal only)',
    response: 'Theme changes require an interactive terminal. This feature is not available through the bridge.',
  },
  {
    name: 'vim',
    description: 'Toggle vim mode (terminal only)',
    response: 'Vim mode requires an interactive terminal. This feature is not available through the bridge.',
  },
  {
    name: 'login',
    description: 'Authenticate with Anthropic (terminal only)',
    response: 'Authentication requires an interactive terminal. Run `claude login` in your terminal.',
  },
  {
    name: 'logout',
    description: 'Sign out (terminal only)',
    response: 'Sign out requires an interactive terminal. Run `claude logout` in your terminal.',
  },
  {
    name: 'doctor',
    description: 'Run diagnostics (terminal only)',
    response: 'Diagnostics require an interactive terminal. Run `claude doctor` in your terminal.',
  },
  {
    name: 'compact',
    description: 'Compact conversation context (CC-internal)',
    response:
      'The /compact command is handled internally by Claude Code\'s interactive mode.\n\n' +
      'To compact context via bridge, send a natural language request like:\n' +
      '"please summarize and compact the conversation context"',
  },
];

for (const cmd of noopCommands) {
  commandRegistry.register({
    name: cmd.name,
    description: cmd.description,
    category: 'noop',
    handler: async () => ({ handled: true, response: cmd.response }),
  });
}
