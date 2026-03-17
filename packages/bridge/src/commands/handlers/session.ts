/**
 * Command Handlers — Session Management
 *
 * Phase 2: Commands that manage bridge sessions.
 * All data stored in bridge memory only — NEVER written to JSONL.
 */

import { readFileSync } from 'node:fs';
import { commandRegistry } from '../registry.ts';

commandRegistry.register({
  name: 'rename',
  description: 'Rename current session',
  usage: '/rename <name>',
  category: 'session',
  handler: async (args, ctx) => {
    if (!args) {
      const current = ctx.getDisplayName();
      if (current) return { handled: true, response: `Current session name: ${current}` };
      return { handled: true, response: 'Usage: /rename <name>' };
    }
    ctx.setDisplayName(args);
    return { handled: true, response: `Session renamed to: ${args}` };
  },
});

commandRegistry.register({
  name: 'clear',
  description: 'Clear current session and start fresh',
  usage: '/clear',
  category: 'session',
  handler: async (_args, ctx) => {
    if (!ctx.sessionInfo) {
      return { handled: true, response: 'No active session to clear.' };
    }
    ctx.terminate();
    return { handled: true, response: 'Session cleared. Next message will start a new session.' };
  },
});

commandRegistry.register({
  name: 'resume',
  description: 'List available disk sessions to resume',
  usage: '/resume',
  category: 'session',
  handler: async (_args, ctx) => {
    const sessions = await ctx.listDiskSessions(ctx.projectDir);
    if (sessions.length === 0) {
      return { handled: true, response: 'No sessions found on disk.' };
    }
    const lines = sessions
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
      .slice(0, 10)
      .map((s) => {
        const size = (s.sizeBytes / 1024).toFixed(0);
        const tracked = s.isTracked ? ' [active]' : '';
        return `  ${s.sessionId} — ${size}KB — ${s.lastModified}${tracked}`;
      });
    return {
      handled: true,
      response: `Recent sessions (${ctx.projectDir}):\n${lines.join('\n')}\n\nTo resume, send a message with X-Session-Id header.`,
    };
  },
});

commandRegistry.register({
  name: 'export',
  description: 'Export session conversation as text (read-only)',
  usage: '/export',
  category: 'session',
  handler: async (_args, ctx) => {
    const jsonlPath = ctx.getSessionJsonlPath();
    if (!jsonlPath) {
      return { handled: true, response: 'No active session to export.' };
    }

    try {
      const raw = readFileSync(jsonlPath, 'utf-8');
      const lines = raw.split('\n').filter(Boolean);
      const conversation: string[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === 'human' || entry.type === 'user') {
            const text = typeof entry.message?.content === 'string'
              ? entry.message.content
              : JSON.stringify(entry.message?.content ?? '');
            conversation.push(`[User] ${text.slice(0, 200)}`);
          } else if (entry.type === 'assistant') {
            const text = typeof entry.message?.content === 'string'
              ? entry.message.content
              : Array.isArray(entry.message?.content)
                ? entry.message.content
                    .filter((b: { type?: string }) => b.type === 'text')
                    .map((b: { text?: string }) => b.text ?? '')
                    .join('')
                : '';
            if (text) conversation.push(`[Assistant] ${text.slice(0, 300)}`);
          }
        } catch {
          // Skip unparseable lines
        }
      }

      if (conversation.length === 0) {
        return { handled: true, response: 'Session file exists but no conversation entries found.' };
      }
      return { handled: true, response: `Session export (${conversation.length} turns):\n\n${conversation.join('\n\n')}` };
    } catch {
      return { handled: true, response: 'Could not read session file. It may not exist on disk yet.' };
    }
  },
});
