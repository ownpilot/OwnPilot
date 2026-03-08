/**
 * Coding Agent Providers
 *
 * Constants, helpers, and provider-specific execution adapters
 * for built-in coding CLI agents (Claude Code, Codex, Gemini CLI).
 */

import {
  type CodingAgentTask,
  type CodingAgentResult,
  type BuiltinCodingAgentProvider,
  type CodingAgentPermissions,
  type CodingAgentSkill,
  DEFAULT_CODING_AGENT_PERMISSIONS,
  getErrorMessage,
} from '@ownpilot/core';
import { tryImport } from '@ownpilot/core';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { type CliProviderRecord } from '../db/repositories/cli-providers.js';
import { validateCwd, createSanitizedEnv, spawnCliProcess } from './binary-utils.js';
import { getAllowedDirs } from '../routes/settings.js';

// =============================================================================
// CONSTANTS
// =============================================================================

export const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
export const MAX_TIMEOUT_MS = 1_800_000; // 30 minutes
export const DEFAULT_MAX_TURNS = 10;
export const DEFAULT_MAX_BUDGET_USD = 1.0;

/** Config Center service names for built-in providers */
export const CONFIG_SERVICE_NAMES: Record<BuiltinCodingAgentProvider, string> = {
  'claude-code': 'coding-claude-code',
  codex: 'coding-codex',
  'gemini-cli': 'coding-gemini',
};

/** Environment variable names for built-in provider API keys */
export const API_KEY_ENV_VARS: Record<BuiltinCodingAgentProvider, string> = {
  'claude-code': 'ANTHROPIC_API_KEY',
  codex: 'CODEX_API_KEY',
  'gemini-cli': 'GEMINI_API_KEY',
};

/** Display names for built-in providers */
export const DISPLAY_NAMES: Record<BuiltinCodingAgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'OpenAI Codex',
  'gemini-cli': 'Gemini CLI',
};

/** CLI binary names for built-in providers */
export const CLI_BINARIES: Record<BuiltinCodingAgentProvider, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  'gemini-cli': 'gemini',
};

/** npm install commands for built-in providers */
export const INSTALL_COMMANDS: Record<BuiltinCodingAgentProvider, string> = {
  'claude-code': 'npm install -g @anthropic-ai/claude-code',
  codex: 'npm install -g @openai/codex',
  'gemini-cli': 'npm install -g @google/gemini-cli',
};

/**
 * Auth method for each built-in provider:
 * - 'api-key': SDK mode requires an API key (Claude Code SDK)
 * - 'both': CLI supports login-based auth OR API key (Codex, Gemini, Claude CLI)
 */
export const AUTH_METHODS: Record<BuiltinCodingAgentProvider, 'api-key' | 'login' | 'both'> = {
  'claude-code': 'both',
  codex: 'both',
  'gemini-cli': 'both',
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Resolve API key for a built-in provider from Config Center or environment.
 * Returns undefined if no key is configured — this is OK for CLI providers
 * that support login-based auth.
 */
export function resolveBuiltinApiKey(provider: BuiltinCodingAgentProvider): string | undefined {
  const serviceName = CONFIG_SERVICE_NAMES[provider];
  const key = configServicesRepo.getApiKey(serviceName);
  if (key) return key;
  return process.env[API_KEY_ENV_VARS[provider]];
}

/**
 * Resolve API key for a custom provider from Config Center or environment.
 */
export function resolveCustomApiKey(customProvider: CliProviderRecord): string | undefined {
  if (customProvider.authMethod === 'config_center' && customProvider.configServiceName) {
    const key = configServicesRepo.getApiKey(customProvider.configServiceName);
    if (key) return key;
  }
  if (customProvider.apiKeyEnvVar) {
    return process.env[customProvider.apiKeyEnvVar];
  }
  return undefined;
}

/**
 * Build a skills preamble string to prepend to the prompt.
 * Each skill's content is wrapped in a section header.
 */
export function buildSkillsPreamble(skills: CodingAgentSkill[]): string {
  if (skills.length === 0) return '';
  const sections = skills.map((s) => `## Skill: ${s.name}\n\n${s.content}`);
  return `# Instructions & Skills\n\n${sections.join('\n\n---\n\n')}\n\n---\n\n# Task\n\n`;
}

/**
 * Build permission-related CLI flags for Claude Code.
 * Maps CodingAgentPermissions to --allowed-tools, --disallowed-tools, etc.
 */
export function buildClaudeCodePermissionArgs(perms: CodingAgentPermissions): string[] {
  const args: string[] = [];

  if (perms.fileAccess === 'none') {
    args.push('--disallowed-tools', 'Edit,Write,MultiEdit');
  } else if (perms.fileAccess === 'read-only') {
    args.push('--disallowed-tools', 'Edit,Write,MultiEdit,Bash(rm|mv|cp|mkdir)');
  }

  if (perms.autonomy === 'full-auto') {
    args.push('--dangerously-skip-permissions');
  }

  if (perms.networkAccess === false) {
    args.push('--disallowed-tools', 'WebFetch,WebSearch');
  }

  return args;
}

/**
 * Merge user-supplied permissions with defaults.
 */
export function resolvePermissions(perms?: CodingAgentPermissions): Required<CodingAgentPermissions> {
  if (!perms) return { ...DEFAULT_CODING_AGENT_PERMISSIONS };
  return { ...DEFAULT_CODING_AGENT_PERMISSIONS, ...perms };
}

// =============================================================================
// PROVIDER ADAPTERS
// =============================================================================

/**
 * Run a task using the Claude Code SDK.
 * SDK mode REQUIRES an API key (ANTHROPIC_API_KEY).
 */
export async function runClaudeCode(
  task: CodingAgentTask,
  apiKey?: string
): Promise<CodingAgentResult> {
  const start = Date.now();

  if (!apiKey) {
    return {
      success: false,
      output: '',
      provider: 'claude-code',
      durationMs: Date.now() - start,
      error:
        'Claude Code SDK mode requires an API key. Set ANTHROPIC_API_KEY or configure it in Config Center. Alternatively, install the Claude CLI and use PTY mode for OAuth login.',
    };
  }

  process.env.ANTHROPIC_API_KEY = apiKey;

  let sdkModule: { query: (...args: unknown[]) => AsyncIterable<Record<string, unknown>> };
  try {
    sdkModule = (await tryImport('@anthropic-ai/claude-agent-sdk')) as typeof sdkModule;
  } catch {
    return {
      success: false,
      output: '',
      provider: 'claude-code',
      durationMs: Date.now() - start,
      error:
        'Claude Code SDK not installed. Install it with: pnpm add @anthropic-ai/claude-agent-sdk',
    };
  }

  const cwd = task.cwd ? validateCwd(task.cwd, await getAllowedDirs()) : process.cwd();
  let output = '';

  const skillsPreamble = task.skills?.length ? buildSkillsPreamble(task.skills) : '';
  const fullPrompt = skillsPreamble + task.prompt;

  const perms = resolvePermissions(task.permissions);

  let allowedTools = task.allowedTools ?? ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write'];
  if (perms.fileAccess === 'read-only') {
    allowedTools = allowedTools.filter((t) => !['Edit', 'Write'].includes(t));
  } else if (perms.fileAccess === 'none') {
    allowedTools = allowedTools.filter(
      (t) => !['Read', 'Edit', 'Write', 'Glob', 'Grep'].includes(t)
    );
  }

  try {
    for await (const msg of sdkModule.query({
      prompt: fullPrompt,
      options: {
        allowedTools,
        permissionMode: perms.autonomy === 'full-auto' ? 'bypassPermissions' : 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        cwd,
        model: task.model,
        maxTurns: task.maxTurns ?? DEFAULT_MAX_TURNS,
        maxBudgetUsd: task.maxBudgetUsd ?? DEFAULT_MAX_BUDGET_USD,
      },
    })) {
      if (msg && 'result' in msg) {
        output = String(msg.result);
      }
    }
  } catch (err) {
    return {
      success: false,
      output: '',
      provider: 'claude-code',
      durationMs: Date.now() - start,
      error: getErrorMessage(err),
    };
  }

  return {
    success: true,
    output,
    provider: 'claude-code',
    durationMs: Date.now() - start,
    mode: 'sdk',
  };
}

/**
 * Run a task using the OpenAI Codex CLI.
 * API key is optional — Codex supports ChatGPT account login.
 */
export async function runCodex(
  task: CodingAgentTask,
  apiKey?: string
): Promise<CodingAgentResult> {
  const start = Date.now();
  const cwd = task.cwd ? validateCwd(task.cwd, await getAllowedDirs()) : process.cwd();
  const timeout = Math.min(task.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  const args = ['exec', '--json', '--full-auto'];
  if (task.model) args.push('--model', task.model);
  args.push(task.prompt);

  try {
    const result = await spawnCliProcess('codex', args, {
      cwd,
      env: createSanitizedEnv('codex', apiKey),
      timeout,
    });

    let output = '';
    const lines = result.stdout.trim().split('\n');
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.type === 'message' && parsed.role === 'assistant') {
          output = String(parsed.content ?? '');
        } else if (parsed.content) {
          output = String(parsed.content);
        }
      } catch {
        if (line.trim()) output += line + '\n';
      }
    }

    if (!output && result.stdout.trim()) {
      output = result.stdout.trim();
    }

    return {
      success: result.exitCode === 0,
      output,
      provider: 'codex',
      durationMs: Date.now() - start,
      exitCode: result.exitCode,
      error:
        result.exitCode !== 0 ? result.stderr || `Exited with code ${result.exitCode}` : undefined,
      mode: 'sdk',
    };
  } catch (err) {
    return {
      success: false,
      output: '',
      provider: 'codex',
      durationMs: Date.now() - start,
      error: getErrorMessage(err),
    };
  }
}

/**
 * Run a task using the Google Gemini CLI.
 * API key is optional — Gemini supports Google account login.
 */
export async function runGeminiCli(
  task: CodingAgentTask,
  apiKey?: string
): Promise<CodingAgentResult> {
  const start = Date.now();
  const cwd = task.cwd ? validateCwd(task.cwd, await getAllowedDirs()) : process.cwd();
  const timeout = Math.min(task.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  const args = ['-p', task.prompt, '--yolo', '--output-format', 'json'];
  if (task.model) args.push('--model', task.model);

  try {
    const result = await spawnCliProcess('gemini', args, {
      cwd,
      env: createSanitizedEnv('gemini-cli', apiKey),
      timeout,
    });

    let output = '';
    try {
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      output = String(parsed.response ?? parsed.content ?? result.stdout);
    } catch {
      output = result.stdout.trim();
    }

    return {
      success: result.exitCode === 0,
      output,
      provider: 'gemini-cli',
      durationMs: Date.now() - start,
      exitCode: result.exitCode,
      error:
        result.exitCode !== 0 ? result.stderr || `Exited with code ${result.exitCode}` : undefined,
      mode: 'sdk',
    };
  } catch (err) {
    return {
      success: false,
      output: '',
      provider: 'gemini-cli',
      durationMs: Date.now() - start,
      error: getErrorMessage(err),
    };
  }
}
