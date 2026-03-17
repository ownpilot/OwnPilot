/**
 * Command Handlers — Configuration Commands
 *
 * Phase 2: Commands that modify per-session CC spawn configuration.
 * Overrides are stored in bridge memory and applied as CLI flags at next spawn.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { commandRegistry } from '../registry.ts';

/** Known model aliases → full model IDs */
const MODEL_ALIASES: Record<string, string> = {
  opus: 'claude-opus-4-6',
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5-20251001',
};

commandRegistry.register({
  name: 'model',
  description: 'Change model for next message',
  usage: '/model <name|alias>',
  category: 'config',
  handler: async (args, ctx) => {
    if (!args) {
      const current = ctx.getConfigOverrides().model;
      return {
        handled: true,
        response: current
          ? `Current model override: ${current}\nAliases: opus, sonnet, haiku`
          : 'No model override set (using default). Usage: /model <name>\nAliases: opus, sonnet, haiku',
      };
    }

    const model = MODEL_ALIASES[args.toLowerCase()] ?? args;
    ctx.setConfigOverrides({ model });
    return { handled: true, response: `Model changed to ${model}. Takes effect on next message.` };
  },
});

commandRegistry.register({
  name: 'effort',
  description: 'Set reasoning effort level',
  usage: '/effort <low|medium|high>',
  category: 'config',
  handler: async (args, ctx) => {
    const valid = ['low', 'medium', 'high'];
    if (!args || !valid.includes(args.toLowerCase())) {
      const current = ctx.getConfigOverrides().effort;
      return {
        handled: true,
        response: `${current ? `Current effort: ${current}. ` : ''}Usage: /effort <low|medium|high>`,
      };
    }

    ctx.setConfigOverrides({ effort: args.toLowerCase() });
    return { handled: true, response: `Effort level set to ${args.toLowerCase()}. Takes effect on next message.` };
  },
});

commandRegistry.register({
  name: 'add-dir',
  description: 'Add directory to CC context',
  usage: '/add-dir <path>',
  category: 'config',
  handler: async (args, ctx) => {
    if (!args) {
      const dirs = ctx.getConfigOverrides().additionalDirs ?? [];
      return {
        handled: true,
        response: dirs.length
          ? `Additional directories:\n${dirs.map(d => `  ${d}`).join('\n')}`
          : 'No additional directories. Usage: /add-dir <absolute-path>',
      };
    }

    const dirPath = resolve(args);
    if (!existsSync(dirPath)) {
      return { handled: true, response: `Directory not found: ${dirPath}` };
    }

    const current = ctx.getConfigOverrides().additionalDirs ?? [];
    if (current.includes(dirPath)) {
      return { handled: true, response: `Directory already added: ${dirPath}` };
    }

    ctx.setConfigOverrides({ additionalDirs: [...current, dirPath] });
    return { handled: true, response: `Added directory: ${dirPath}. Takes effect on next message.` };
  },
});

commandRegistry.register({
  name: 'plan',
  description: 'Toggle plan permission mode',
  usage: '/plan',
  category: 'config',
  handler: async (_args, ctx) => {
    const current = ctx.getConfigOverrides().permissionMode;
    const newMode = current === 'plan' ? undefined : 'plan';
    ctx.setConfigOverrides({ permissionMode: newMode });
    return {
      handled: true,
      response: newMode
        ? 'Plan mode enabled. CC will require approval for changes.'
        : 'Plan mode disabled. CC will use default permissions.',
    };
  },
});

commandRegistry.register({
  name: 'fast',
  description: 'Toggle fast output mode',
  usage: '/fast [on|off]',
  category: 'config',
  handler: async (args, ctx) => {
    const current = ctx.getConfigOverrides().fast ?? false;
    let newValue: boolean;

    if (args === 'on') newValue = true;
    else if (args === 'off') newValue = false;
    else newValue = !current;

    ctx.setConfigOverrides({ fast: newValue });
    return {
      handled: true,
      response: `Fast mode ${newValue ? 'enabled' : 'disabled'}.`,
    };
  },
});
