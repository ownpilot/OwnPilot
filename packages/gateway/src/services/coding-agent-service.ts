/**
 * Coding Agent Service
 *
 * Manages external AI coding CLI agents (Claude Code, Codex, Gemini CLI).
 * Each provider has an adapter:
 *   - Claude Code: Native SDK (@anthropic-ai/claude-agent-sdk) — requires API key
 *   - Codex: child_process.spawn with --json — supports ChatGPT login OR API key
 *   - Gemini CLI: child_process.spawn with --output-format json — supports Google login OR API key
 *
 * API keys are OPTIONAL for CLI-based providers. They support login-based auth
 * (OAuth, Google account, ChatGPT account) when no API key is provided.
 *
 * PTY fallback is available when node-pty is installed (optional dependency).
 */

import {
  type ICodingAgentService,
  type CodingAgentTask,
  type CodingAgentResult,
  type CodingAgentStatus,
  type CodingAgentProvider,
  type BuiltinCodingAgentProvider,
  type CodingAgentSession,
  type CreateCodingSessionInput,
  isBuiltinProvider,
  getCustomProviderName,
  getErrorMessage,
} from '@ownpilot/core';
import { tryImport } from '@ownpilot/core';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { cliProvidersRepo, type CliProviderRecord } from '../db/repositories/cli-providers.js';
import {
  isBinaryInstalled,
  getBinaryVersion,
  validateCwd,
  createSanitizedEnv,
  spawnCliProcess,
  MAX_OUTPUT_SIZE,
} from './binary-utils.js';
import { getLog } from './log.js';

const log = getLog('CodingAgent');

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_TIMEOUT_MS = 300_000; // 5 minutes
const MAX_TIMEOUT_MS = 1_800_000; // 30 minutes
const DEFAULT_MAX_TURNS = 10;
const DEFAULT_MAX_BUDGET_USD = 1.0;

/** Config Center service names for built-in providers */
const CONFIG_SERVICE_NAMES: Record<BuiltinCodingAgentProvider, string> = {
  'claude-code': 'coding-claude-code',
  codex: 'coding-codex',
  'gemini-cli': 'coding-gemini',
};

/** Environment variable names for built-in provider API keys */
const API_KEY_ENV_VARS: Record<BuiltinCodingAgentProvider, string> = {
  'claude-code': 'ANTHROPIC_API_KEY',
  codex: 'CODEX_API_KEY',
  'gemini-cli': 'GEMINI_API_KEY',
};

/** Display names for built-in providers */
const DISPLAY_NAMES: Record<BuiltinCodingAgentProvider, string> = {
  'claude-code': 'Claude Code',
  codex: 'OpenAI Codex',
  'gemini-cli': 'Gemini CLI',
};

/** CLI binary names for built-in providers */
const CLI_BINARIES: Record<BuiltinCodingAgentProvider, string> = {
  'claude-code': 'claude',
  codex: 'codex',
  'gemini-cli': 'gemini',
};

/**
 * Auth method for each built-in provider:
 * - 'api-key': SDK mode requires an API key (Claude Code SDK)
 * - 'both': CLI supports login-based auth OR API key (Codex, Gemini, Claude CLI)
 */
const AUTH_METHODS: Record<BuiltinCodingAgentProvider, 'api-key' | 'login' | 'both'> = {
  'claude-code': 'both', // SDK needs key, but CLI supports OAuth login
  codex: 'both', // ChatGPT login or CODEX_API_KEY
  'gemini-cli': 'both', // Google account login or GEMINI_API_KEY
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Resolve API key for a built-in provider from Config Center or environment.
 * Returns undefined if no key is configured — this is OK for CLI providers
 * that support login-based auth.
 */
function resolveBuiltinApiKey(provider: BuiltinCodingAgentProvider): string | undefined {
  const serviceName = CONFIG_SERVICE_NAMES[provider];
  // Try Config Center first
  const key = configServicesRepo.getApiKey(serviceName);
  if (key) return key;

  // Fall back to environment variable
  return process.env[API_KEY_ENV_VARS[provider]];
}

/**
 * Resolve API key for a custom provider from Config Center or environment.
 */
function resolveCustomApiKey(customProvider: CliProviderRecord): string | undefined {
  if (customProvider.authMethod === 'config_center' && customProvider.configServiceName) {
    const key = configServicesRepo.getApiKey(customProvider.configServiceName);
    if (key) return key;
  }
  if (customProvider.apiKeyEnvVar) {
    return process.env[customProvider.apiKeyEnvVar];
  }
  return undefined;
}

// isBinaryInstalled, getBinaryVersion, validateCwd, createSanitizedEnv, spawnCliProcess
// are imported from './binary-utils.js'

// =============================================================================
// PROVIDER ADAPTERS
// =============================================================================

/**
 * Run a task using the Claude Code SDK.
 * SDK mode REQUIRES an API key (ANTHROPIC_API_KEY).
 */
async function runClaudeCode(task: CodingAgentTask, apiKey?: string): Promise<CodingAgentResult> {
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

  // Set API key in environment for SDK
  process.env.ANTHROPIC_API_KEY = apiKey;

  // Lazy-load the SDK
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

  const cwd = task.cwd ? validateCwd(task.cwd) : process.cwd();
  let output = '';

  try {
    for await (const msg of sdkModule.query({
      prompt: task.prompt,
      options: {
        allowedTools: task.allowedTools ?? ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write'],
        permissionMode: 'bypassPermissions',
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
async function runCodex(task: CodingAgentTask, apiKey?: string): Promise<CodingAgentResult> {
  const start = Date.now();
  const cwd = task.cwd ? validateCwd(task.cwd) : process.cwd();
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

    // Parse JSON Lines output — extract the last message
    let output = '';
    const lines = result.stdout.trim().split('\n');
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        // Codex JSON Lines: look for the final assistant message
        if (parsed.type === 'message' && parsed.role === 'assistant') {
          output = String(parsed.content ?? '');
        } else if (parsed.content) {
          output = String(parsed.content);
        }
      } catch {
        // Not JSON — append as plain text
        if (line.trim()) output += line + '\n';
      }
    }

    // If no parsed output, use raw stdout
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
async function runGeminiCli(task: CodingAgentTask, apiKey?: string): Promise<CodingAgentResult> {
  const start = Date.now();
  const cwd = task.cwd ? validateCwd(task.cwd) : process.cwd();
  const timeout = Math.min(task.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  const args = ['-p', task.prompt, '--output-format', 'json'];
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

// =============================================================================
// SERVICE
// =============================================================================

class CodingAgentService implements ICodingAgentService {
  private ptyAvailable: boolean | null = null;

  async runTask(task: CodingAgentTask, _userId?: string): Promise<CodingAgentResult> {
    const { provider, prompt } = task;

    if (!prompt || prompt.trim().length === 0) {
      return {
        success: false,
        output: '',
        provider,
        durationMs: 0,
        error: 'Prompt is required',
      };
    }

    // Only built-in providers are supported in legacy runTask mode
    if (!isBuiltinProvider(provider)) {
      return {
        success: false,
        output: '',
        provider,
        durationMs: 0,
        error: `Custom providers must use session-based execution (run_coding_task tool). Provider: ${provider}`,
      };
    }

    // Resolve API key (optional for CLI providers — they support login-based auth)
    const apiKey = resolveBuiltinApiKey(provider);

    // Check binary availability (for CLI-based providers)
    if (provider !== 'claude-code' || task.mode === 'pty') {
      const binary = CLI_BINARIES[provider];
      if (!isBinaryInstalled(binary)) {
        return {
          success: false,
          output: '',
          provider,
          durationMs: 0,
          error: `${DISPLAY_NAMES[provider]} CLI not found. Install '${binary}' and ensure it's on your PATH.`,
        };
      }
    }

    log.info(`Running coding task with ${DISPLAY_NAMES[provider]}`, {
      provider,
      cwd: task.cwd,
      model: task.model,
      mode: task.mode ?? 'auto',
      hasApiKey: !!apiKey,
    });

    // PTY fallback: if mode is 'pty', use PTY adapter
    if (task.mode === 'pty') {
      return this.runWithPtyFallback(task, apiKey);
    }

    // Primary execution: SDK or CLI spawn
    switch (provider) {
      case 'claude-code':
        return runClaudeCode(task, apiKey);
      case 'codex':
        return runCodex(task, apiKey);
      case 'gemini-cli':
        return runGeminiCli(task, apiKey);
      default:
        return {
          success: false,
          output: '',
          provider,
          durationMs: 0,
          error: `Unknown provider: ${provider}`,
        };
    }
  }

  async getStatus(): Promise<CodingAgentStatus[]> {
    const builtinProviders: BuiltinCodingAgentProvider[] = ['claude-code', 'codex', 'gemini-cli'];
    const ptyAvailable = await this.checkPtyAvailable();

    const builtinStatuses = builtinProviders.map((provider) => {
      const binary = CLI_BINARIES[provider];
      const installed =
        provider === 'claude-code'
          ? this.isClaudeCodeSdkInstalled() || isBinaryInstalled(binary)
          : isBinaryInstalled(binary);

      const hasApiKey = !!resolveBuiltinApiKey(provider);
      return {
        provider: provider as CodingAgentProvider,
        displayName: DISPLAY_NAMES[provider],
        installed,
        hasApiKey,
        configured: hasApiKey,
        authMethod: AUTH_METHODS[provider],
        version: installed ? getBinaryVersion(binary) : undefined,
        ptyAvailable,
      };
    });

    // Load custom providers
    try {
      const customProviders = await cliProvidersRepo.listActive();
      const customStatuses: CodingAgentStatus[] = customProviders.map((cp) => ({
        provider: `custom:${cp.name}` as CodingAgentProvider,
        displayName: cp.displayName,
        installed: isBinaryInstalled(cp.binary),
        hasApiKey: !!resolveCustomApiKey(cp),
        configured: !!resolveCustomApiKey(cp),
        authMethod: cp.authMethod === 'none' ? ('login' as const) : ('both' as const),
        version: isBinaryInstalled(cp.binary) ? getBinaryVersion(cp.binary) : undefined,
        ptyAvailable,
      }));
      return [...builtinStatuses, ...customStatuses];
    } catch {
      // DB not ready — return only built-in
      return builtinStatuses;
    }
  }

  async isAvailable(provider: CodingAgentProvider): Promise<boolean> {
    if (isBuiltinProvider(provider)) {
      if (provider === 'claude-code') {
        return this.isClaudeCodeSdkInstalled() || isBinaryInstalled(CLI_BINARIES[provider]);
      }
      return isBinaryInstalled(CLI_BINARIES[provider]);
    }

    // Custom provider: check binary
    const customName = getCustomProviderName(provider);
    if (customName) {
      const cp = await cliProvidersRepo.getByName(customName);
      return cp ? isBinaryInstalled(cp.binary) : false;
    }
    return false;
  }

  // ===========================================================================
  // PTY Fallback
  // ===========================================================================

  private async runWithPtyFallback(
    task: CodingAgentTask,
    apiKey?: string
  ): Promise<CodingAgentResult> {
    const start = Date.now();

    let runWithPty: typeof import('./coding-agent-pty.js').runWithPty;
    try {
      const ptyModule = await import('./coding-agent-pty.js');
      runWithPty = ptyModule.runWithPty;
    } catch {
      return {
        success: false,
        output: '',
        provider: task.provider,
        durationMs: Date.now() - start,
        error: 'PTY fallback not available. Install node-pty: pnpm add node-pty',
      };
    }

    // PTY fallback only supports built-in providers
    if (!isBuiltinProvider(task.provider)) {
      return {
        success: false,
        output: '',
        provider: task.provider,
        durationMs: Date.now() - start,
        error: 'PTY fallback is only available for built-in providers',
        mode: 'pty',
      };
    }

    const binary = CLI_BINARIES[task.provider];
    const cwd = task.cwd ? validateCwd(task.cwd) : process.cwd();
    const timeout = Math.min(task.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    // Build CLI args based on provider
    let args: string[];
    switch (task.provider) {
      case 'claude-code':
        args = ['-p', task.prompt];
        if (task.model) args.push('--model', task.model);
        break;
      case 'codex':
        args = ['exec', '--full-auto', task.prompt];
        if (task.model) args.push('--model', task.model);
        break;
      case 'gemini-cli':
        args = ['-p', task.prompt];
        if (task.model) args.push('--model', task.model);
        break;
      default:
        args = [task.prompt];
    }

    try {
      const result = await runWithPty(binary, args, {
        cwd,
        env: createSanitizedEnv(task.provider, apiKey),
        timeout,
      });

      return {
        success: result.exitCode === 0,
        output: result.output,
        provider: task.provider,
        durationMs: Date.now() - start,
        exitCode: result.exitCode,
        mode: 'pty',
        error: result.exitCode !== 0 ? `Exited with code ${result.exitCode}` : undefined,
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        provider: task.provider,
        durationMs: Date.now() - start,
        error: getErrorMessage(err),
        mode: 'pty',
      };
    }
  }

  // ===========================================================================
  // Session-based API (interactive PTY terminals)
  // ===========================================================================

  async createSession(
    input: CreateCodingSessionInput,
    userId: string
  ): Promise<CodingAgentSession> {
    const provider = input.provider;
    let apiKey: string | undefined;
    let binary: string;
    let apiKeyEnvVar: string | undefined;

    const customName = getCustomProviderName(provider);
    if (customName) {
      // Custom provider: load from DB
      const cp = await cliProvidersRepo.getByName(customName, userId);
      if (!cp) {
        throw new Error(
          `Custom CLI provider '${customName}' not found. Register it first via Settings.`
        );
      }
      binary = cp.binary;
      apiKeyEnvVar = cp.apiKeyEnvVar;
      apiKey = resolveCustomApiKey(cp);
    } else if (isBuiltinProvider(provider)) {
      // Built-in provider
      binary = CLI_BINARIES[provider];
      apiKey = resolveBuiltinApiKey(provider);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    // All session modes require the CLI binary
    if (!isBinaryInstalled(binary)) {
      const displayName =
        customName ?? (isBuiltinProvider(provider) ? DISPLAY_NAMES[provider] : provider);
      throw new Error(
        `${displayName} CLI not found. Install '${binary}' and ensure it's on your PATH.`
      );
    }

    const cwd = input.cwd ? validateCwd(input.cwd) : process.cwd();
    const env = createSanitizedEnv(provider, apiKey, apiKeyEnvVar);

    // Build CLI args: custom providers get their own template, built-in use existing logic
    let cliArgs: string[];
    if (customName) {
      const cp = await cliProvidersRepo.getByName(customName, userId);
      cliArgs = this.buildCustomSessionArgs(input, cp!);
    } else {
      cliArgs = this.buildSessionArgs(input);
    }

    const displayName = customName
      ? customName
      : isBuiltinProvider(provider)
        ? DISPLAY_NAMES[provider]
        : provider;

    log.info(`Creating coding agent session with ${displayName}`, {
      provider,
      mode: input.mode ?? 'auto',
      cwd,
      hasApiKey: !!apiKey,
    });

    const { getCodingAgentSessionManager } = await import('./coding-agent-sessions.js');
    const mgr = getCodingAgentSessionManager();
    this.sessionManager = mgr; // Cache for sync methods (listSessions, getSession, etc.)
    return mgr.createSession(input, userId, env, binary, cliArgs);
  }

  getSession(sessionId: string, userId: string): CodingAgentSession | undefined {
    return this.getSessionManager()?.getSession(sessionId, userId);
  }

  listSessions(userId: string): CodingAgentSession[] {
    return this.getSessionManager()?.listSessions(userId) ?? [];
  }

  writeToSession(sessionId: string, userId: string, data: string): boolean {
    return this.getSessionManager()?.writeToSession(sessionId, userId, data) ?? false;
  }

  resizeSession(sessionId: string, userId: string, cols: number, rows: number): boolean {
    return this.getSessionManager()?.resizeSession(sessionId, userId, cols, rows) ?? false;
  }

  terminateSession(sessionId: string, userId: string): boolean {
    return this.getSessionManager()?.terminateSession(sessionId, userId) ?? false;
  }

  getOutputBuffer(sessionId: string, userId: string): string | undefined {
    return this.getSessionManager()?.getOutputBuffer(sessionId, userId);
  }

  /** Build CLI args for a session based on provider and mode */
  private buildSessionArgs(input: CreateCodingSessionInput): string[] {
    const isInteractive = input.mode === 'interactive';

    switch (input.provider) {
      case 'claude-code':
        if (isInteractive) return [];
        // -p: non-interactive print mode (plain text output)
        // --dangerously-skip-permissions: bypass all tool permission prompts
        // --output-format stream-json --verbose: structured JSON event stream
        //   (tool calls, results, costs) for rich UI display
        return [
          '-p',
          input.prompt,
          '--dangerously-skip-permissions',
          '--output-format',
          'stream-json',
          '--verbose',
          ...(input.model ? ['--model', input.model] : []),
        ];
      case 'codex':
        if (isInteractive) return [];
        return [
          'exec',
          '--full-auto',
          input.prompt,
          ...(input.model ? ['--model', input.model] : []),
        ];
      case 'gemini-cli':
        if (isInteractive) return [];
        return ['-p', input.prompt, ...(input.model ? ['--model', input.model] : [])];
      default:
        return [input.prompt];
    }
  }

  /**
   * Build CLI args for a custom provider session.
   * Uses the provider's defaultArgs and optional promptTemplate.
   */
  private buildCustomSessionArgs(input: CreateCodingSessionInput, cp: CliProviderRecord): string[] {
    const args = [...cp.defaultArgs];

    if (cp.promptTemplate) {
      // Expand template placeholders: {prompt}, {cwd}, {model}
      const expanded = cp.promptTemplate
        .replace(/\{prompt\}/g, input.prompt)
        .replace(/\{cwd\}/g, input.cwd ?? process.cwd())
        .replace(/\{model\}/g, input.model ?? '');
      args.push(expanded);
    } else {
      // No template: pass prompt as the last argument
      args.push(input.prompt);
    }

    return args;
  }

  private sessionManager: import('./coding-agent-sessions.js').CodingAgentSessionManager | null =
    null;
  private sessionManagerInitPromise: Promise<void> | null = null;

  private getSessionManager():
    | import('./coding-agent-sessions.js').CodingAgentSessionManager
    | null {
    return this.sessionManager;
  }

  /** Eagerly load the session manager module (async, best-effort). */
  initSessionManager(): void {
    if (this.sessionManagerInitPromise) return;
    this.sessionManagerInitPromise = import('./coding-agent-sessions.js')
      .then(({ getCodingAgentSessionManager }) => {
        this.sessionManager = getCodingAgentSessionManager();
        log.info('CodingAgentSessionManager initialized');
      })
      .catch((err) => {
        log.debug(`Session manager init deferred: ${err instanceof Error ? err.message : err}`);
        this.sessionManagerInitPromise = null; // Allow retry
      });
  }

  // ===========================================================================
  // Internal helpers
  // ===========================================================================

  private isClaudeCodeSdkInstalled(): boolean {
    try {
      require.resolve('@anthropic-ai/claude-agent-sdk');
      return true;
    } catch {
      return false;
    }
  }

  private async checkPtyAvailable(): Promise<boolean> {
    if (this.ptyAvailable !== null) return this.ptyAvailable;
    try {
      await tryImport('node-pty');
      this.ptyAvailable = true;
    } catch {
      this.ptyAvailable = false;
    }
    return this.ptyAvailable;
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: CodingAgentService | null = null;

export function getCodingAgentService(): CodingAgentService {
  if (!instance) {
    instance = new CodingAgentService();
    instance.initSessionManager(); // Eagerly load session manager (async, best-effort)
  }
  return instance;
}

export { CodingAgentService };
