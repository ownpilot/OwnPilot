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
 *
 * Implementation split:
 * - coding-agent-providers.ts: Constants, helpers, provider adapters
 * - coding-agent-service.ts:   CodingAgentService class (this file)
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
import { cliProvidersRepo, type CliProviderRecord } from '../db/repositories/cli-providers.js';
import { isBinaryInstalled, getBinaryVersion, validateCwd, createSanitizedEnv } from './binary-utils.js';
import { getLog } from './log.js';
import { getAllowedDirs } from '../routes/settings.js';
import {
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  DISPLAY_NAMES,
  CLI_BINARIES,
  INSTALL_COMMANDS,
  AUTH_METHODS,
  resolveBuiltinApiKey,
  resolveCustomApiKey,
  resolvePermissions,
  buildClaudeCodePermissionArgs,
  runClaudeCode,
  runCodex,
  runGeminiCli,
} from './coding-agent-providers.js';

const log = getLog('CodingAgent');

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
        installCommand: INSTALL_COMMANDS[provider],
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
    const cwd = task.cwd ? validateCwd(task.cwd, await getAllowedDirs()) : process.cwd();
    const timeout = Math.min(task.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

    // Build CLI args based on provider
    let args: string[];
    switch (task.provider) {
      case 'claude-code':
        args = ['-p', task.prompt];
        if (task.model) args.push('--model', task.model);
        break;
      case 'codex':
        args = ['exec', '--full-auto', '--skip-git-repo-check', task.prompt];
        if (task.model) args.push('--model', task.model);
        break;
      case 'gemini-cli':
        args = ['-p', task.prompt, '--yolo'];
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
      binary = CLI_BINARIES[provider];
      apiKey = resolveBuiltinApiKey(provider);
    } else {
      throw new Error(`Unknown provider: ${provider}`);
    }

    // All session modes require the CLI binary
    if (!isBinaryInstalled(binary)) {
      const installHint = INSTALL_COMMANDS[provider as BuiltinCodingAgentProvider];
      const displayName =
        customName ?? (isBuiltinProvider(provider) ? DISPLAY_NAMES[provider] : provider);
      throw new Error(
        `${displayName} CLI ('${binary}') not found on PATH.` +
          (installHint ? ` Install: ${installHint}` : ' Ensure the binary is on your PATH.')
      );
    }

    const allowedDirs = await getAllowedDirs();
    const cwd = input.cwd ? validateCwd(input.cwd, allowedDirs) : process.cwd();
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
      skillIds: input.skillIds,
      permissions: input.permissions,
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

  waitForCompletion(
    sessionId: string,
    userId: string,
    timeoutMs?: number
  ): Promise<import('@ownpilot/core').CodingAgentSession> {
    const mgr = this.getSessionManager();
    if (!mgr) return Promise.reject(new Error('Session manager not available'));
    return mgr.waitForCompletion(sessionId, userId, timeoutMs);
  }

  /** Build CLI args for a session based on provider and mode */
  private buildSessionArgs(input: CreateCodingSessionInput): string[] {
    const isInteractive = input.mode === 'interactive';
    const perms = resolvePermissions(input.permissions);

    const prompt = input.prompt;

    switch (input.provider) {
      case 'claude-code': {
        if (isInteractive) return [];
        const args = [
          '-p',
          prompt,
          '--output-format',
          'stream-json',
          '--verbose',
          ...(input.model ? ['--model', input.model] : []),
        ];

        if (perms.autonomy === 'full-auto') {
          args.push('--dangerously-skip-permissions');
        } else if (perms.autonomy === 'semi-auto') {
          args.push('--dangerously-skip-permissions');
        }

        args.push(...buildClaudeCodePermissionArgs(perms));

        if (input.maxBudgetUsd) {
          args.push('--max-cost', String(input.maxBudgetUsd));
        }

        return args;
      }
      case 'codex':
        if (isInteractive) return [];
        return [
          'exec',
          '--full-auto',
          '--skip-git-repo-check',
          prompt,
          ...(input.model ? ['--model', input.model] : []),
        ];
      case 'gemini-cli':
        if (isInteractive) return [];
        return ['-p', prompt, '--yolo', ...(input.model ? ['--model', input.model] : [])];
      default:
        return [prompt];
    }
  }

  /**
   * Build CLI args for a custom provider session.
   * Uses the provider's defaultArgs and optional promptTemplate.
   */
  private buildCustomSessionArgs(input: CreateCodingSessionInput, cp: CliProviderRecord): string[] {
    const args = [...cp.defaultArgs];

    if (cp.promptTemplate) {
      const expanded = cp.promptTemplate
        .replace(/\{prompt\}/g, input.prompt)
        .replace(/\{cwd\}/g, input.cwd ?? process.cwd())
        .replace(/\{model\}/g, input.model ?? '');
      args.push(expanded);
    } else {
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
    instance.initSessionManager();
  }
  return instance;
}

export { CodingAgentService };
