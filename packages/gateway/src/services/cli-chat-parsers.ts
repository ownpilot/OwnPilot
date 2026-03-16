/**
 * CLI Chat Parsers & Arg Builders
 *
 * Output parsers and command argument builders for each supported CLI tool
 * (Claude Code, Codex, Gemini CLI). Extracted from cli-chat-provider.ts
 * to keep the provider class focused on execution flow.
 */

import { platform } from 'node:os';
import type { Message } from '@ownpilot/core';

export type CliChatBinary = 'claude' | 'codex' | 'gemini';

/** Whether we're running on Windows */
export const IS_WIN = platform() === 'win32';

// =============================================================================
// Message Conversion
// =============================================================================

/**
 * Flatten a message array into a single text prompt for CLI input.
 * Returns { prompt, systemPrompt } — systemPrompt is extracted separately
 * so it can be passed via CLI flags (e.g. claude --system-prompt).
 */
export function messagesToPrompt(messages: readonly Message[]): {
  prompt: string;
  systemPrompt: string;
} {
  const parts: string[] = [];
  let systemPrompt = '';

  for (const msg of messages) {
    const text =
      typeof msg.content === 'string'
        ? msg.content
        : msg.content
            .filter((p) => p.type === 'text')
            .map((p) => (p as { type: 'text'; text: string }).text)
            .join('\n');

    if (msg.role === 'system') {
      systemPrompt = text;
    } else if (msg.role === 'user') {
      parts.push(`User: ${text}`);
    } else if (msg.role === 'assistant') {
      parts.push(`Assistant: ${text}`);
    }
  }

  const userMessages = parts.filter((p) => p.startsWith('User: '));
  if (userMessages.length === 1 && parts.length === 1) {
    return { prompt: userMessages[0]!.slice(6), systemPrompt };
  }

  const sections: string[] = [];
  if (parts.length > 1) {
    sections.push(
      `<conversation_history>\n${parts.slice(0, -1).join('\n\n')}\n</conversation_history>`
    );
  }
  const lastPart = parts[parts.length - 1];
  if (lastPart) {
    const currentMessage = lastPart.startsWith('User: ') ? lastPart.slice(6) : lastPart;
    sections.push(currentMessage);
  }

  return { prompt: sections.join('\n\n'), systemPrompt };
}

// =============================================================================
// Output Parsers
// =============================================================================

export function parseClaudeOutput(stdout: string): string {
  const lines = stdout.trim().split('\n');
  let result = '';

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type === 'result' && parsed.result) {
        result = String(parsed.result);
      } else if (parsed.type === 'assistant' && parsed.message) {
        const message = parsed.message as Record<string, unknown>;
        if (message.content && Array.isArray(message.content)) {
          const textParts = (message.content as Record<string, unknown>[])
            .filter((p) => p.type === 'text')
            .map((p) => String(p.text ?? ''));
          if (textParts.length > 0) {
            result = textParts.join('');
          }
        }
      } else if (parsed.content) {
        result = String(parsed.content);
      }
    } catch {
      if (!result) result += line + '\n';
    }
  }

  return result.trim() || stdout.trim();
}

export function extractJsonObjects(stdout: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < stdout.length; i += 1) {
    const char = stdout[i];

    if (start === -1) {
      if (char === '{') {
        start = i;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        objects.push(stdout.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

export function parseCodexOutput(stdout: string): string {
  const lines = extractJsonObjects(stdout);
  let result = '';

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (parsed.type === 'ownpilot_tool_intent' || parsed.type === 'ownpilot_final_response') {
        result = line;
      } else if (parsed.type === 'message' && parsed.role === 'assistant') {
        result = String(parsed.content ?? '');
      } else if (parsed.type === 'message.completed' && parsed.message) {
        const msg = parsed.message as Record<string, unknown>;
        if (Array.isArray(msg.content)) {
          const textParts = (msg.content as Record<string, unknown>[])
            .filter((p) => p.type === 'output_text' || p.type === 'text')
            .map((p) => String(p.text ?? ''));
          if (textParts.length > 0) result = textParts.join('');
        } else if (msg.content) {
          result = String(msg.content);
        }
      } else if (parsed.type === 'item.completed' && parsed.item) {
        const item = parsed.item as Record<string, unknown>;
        if (item.type === 'agent_message' && typeof item.text === 'string') {
          result = item.text;
        } else if (item.type === 'message' && Array.isArray(item.content)) {
          const textParts = (item.content as Record<string, unknown>[])
            .filter((p) => p.type === 'output_text' || p.type === 'text')
            .map((p) => String(p.text ?? ''));
          if (textParts.length > 0) result = textParts.join('');
        }
      } else if (parsed.content && typeof parsed.content === 'string') {
        result = parsed.content;
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  return result.trim() || stdout.trim();
}

export function parseGeminiOutput(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;
    if (parsed.type === 'ownpilot_tool_intent' || parsed.type === 'ownpilot_final_response') {
      return stdout.trim();
    }
    return String(parsed.response ?? parsed.content ?? parsed.text ?? stdout);
  } catch {
    return stdout.trim();
  }
}

export const OUTPUT_PARSERS: Record<CliChatBinary, (stdout: string) => string> = {
  claude: parseClaudeOutput,
  codex: parseCodexOutput,
  gemini: parseGeminiOutput,
};

// =============================================================================
// CLI Command Builders
// =============================================================================

const CLAUDE_MCP_ALLOWED_TOOLS = [
  'mcp__ownpilot__search_tools',
  'mcp__ownpilot__get_tool_help',
  'mcp__ownpilot__use_tool',
  'mcp__ownpilot__batch_use_tool',
];

export function buildClaudeArgs(
  prompt: string,
  model?: string,
  streaming?: boolean,
  systemPrompt?: string
): string[] {
  const args = IS_WIN
    ? ['-p', '--output-format', streaming ? 'stream-json' : 'json']
    : ['-p', prompt, '--output-format', streaming ? 'stream-json' : 'json'];
  if (streaming) args.push('--verbose');
  args.push('--dangerously-skip-permissions');
  if (systemPrompt) args.push('--system-prompt', systemPrompt);
  if (model && model !== 'default') args.push('--model', model);
  args.push('--mcp-config', '.mcp.json');
  args.push('--allowedTools', CLAUDE_MCP_ALLOWED_TOOLS.join(','));
  return args;
}

export function inlineSystemPrompt(prompt: string, systemPrompt?: string): string {
  if (!systemPrompt) return prompt;
  return `<system_prompt>\n${systemPrompt}\n</system_prompt>\n\n${prompt}`;
}

export function injectWorkspaceGuidance(
  binary: CliChatBinary,
  prompt: string,
  cwd?: string
): string {
  if (!cwd) return prompt;

  const common = [
    `You are running inside the shared OwnPilot workspace at: ${cwd}`,
    'Use only this workspace for chat tasks.',
    'Read and follow the local instruction files in this workspace: AGENTS.md and .mcp.json.',
    'Never call OwnPilot HTTP endpoints directly; use the provided tool flow instead.',
  ];

  if (binary === 'codex') {
    common.push(
      'Also read and follow CODEX.md before answering.',
      'Do not switch to another directory unless the user explicitly asks.'
    );
  }
  if (binary === 'gemini') {
    common.push('Also read and follow GEMINI.md before answering.');
  }

  return `${common.join('\n')}\n\n${prompt}`;
}

export function buildCodexArgs(prompt: string, model?: string, cwd?: string): string[] {
  const effectivePrompt = injectWorkspaceGuidance('codex', prompt, cwd);
  const args = ['exec', '--json', '--full-auto'];
  if (model && model !== 'default' && model !== 'cli-default') {
    args.push('--model', model);
  }
  if (!IS_WIN) args.push(effectivePrompt);
  return args;
}

export function buildGeminiArgs(prompt: string, model?: string, cwd?: string): string[] {
  const effectivePrompt = injectWorkspaceGuidance('gemini', prompt, cwd);
  const args = IS_WIN
    ? ['--prompt', '', '--yolo', '--output-format', 'json']
    : ['-p', effectivePrompt, '--yolo', '--output-format', 'json'];
  if (model && model !== 'default' && model !== 'cli-default') {
    args.push('--model', model);
  }
  return args;
}
