import { spawn } from 'node:child_process';

import {
  createProvider,
  type Result,
  ok,
  err,
  InternalError,
  ValidationError,
  TimeoutError,
  type AIProvider,
  type CompletionRequest,
  type CompletionResponse,
  type IProvider,
  type Message,
  type ProviderConfig,
  type StreamChunk,
} from '@ownpilot/core';

import { localProvidersRepo } from '../db/repositories/index.js';
import { getApiKey, resolveProviderAndModel } from '../routes/settings.js';
import {
  createSanitizedEnv,
  createLoginOnlyCliEnv,
  getBinaryVersion,
  isBinaryInstalled,
  spawnCliProcess,
} from './binary-utils.js';
import { getLog } from './log.js';

const log = getLog('ModelExecution');

export type RuntimeTransport = 'http' | 'cli' | 'local';
export type RuntimeAuthMethod = 'api-key' | 'login' | 'both' | 'none';

export interface RuntimeProviderMetadata {
  id: string;
  displayName: string;
  transport: RuntimeTransport;
  family: string;
  authMethod: RuntimeAuthMethod;
  isAvailable: boolean;
  isConfigured: boolean;
  fallbackProviderId?: string;
  docsUrl?: string;
  installCommand?: string;
  envVar?: string;
  version?: string;
}

interface CliRuntimeProviderDefinition {
  id: 'claude-cli' | 'codex-cli' | 'gemini-cli';
  displayName: string;
  family: 'anthropic' | 'openai' | 'google';
  binary: string;
  authMethod: 'both';
  envVar: string;
  docsUrl: string;
  installCommand: string;
  defaultModel: string;
  presetModels: Array<{ id: string; name: string }>;
  fallbackProviderId: 'anthropic' | 'openai' | 'google';
}

const CLI_PROVIDER_DEFS: Record<CliRuntimeProviderDefinition['id'], CliRuntimeProviderDefinition> = {
  'claude-cli': {
    id: 'claude-cli',
    displayName: 'Claude CLI',
    family: 'anthropic',
    binary: 'claude',
    authMethod: 'both',
    envVar: 'ANTHROPIC_API_KEY',
    docsUrl: 'https://console.anthropic.com',
    installCommand: 'npm i -g @anthropic-ai/claude-code',
    defaultModel: 'default',
    presetModels: [
      { id: 'default', name: 'Default' },
      { id: 'sonnet', name: 'Sonnet' },
      { id: 'opus', name: 'Opus' },
      { id: 'haiku', name: 'Haiku' },
    ],
    fallbackProviderId: 'anthropic',
  },
  'codex-cli': {
    id: 'codex-cli',
    displayName: 'Codex CLI',
    family: 'openai',
    binary: 'codex',
    authMethod: 'both',
    envVar: 'CODEX_API_KEY',
    docsUrl: 'https://platform.openai.com',
    installCommand: 'npm i -g @openai/codex',
    defaultModel: 'gpt-5.1-codex-mini',
    presetModels: [
      { id: 'gpt-5.3-codex', name: 'GPT-5.3 Codex' },
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-5.2-codex', name: 'GPT-5.2 Codex' },
      { id: 'gpt-5.1-codex-max', name: 'GPT-5.1 Codex Max' },
      { id: 'gpt-5.2', name: 'GPT-5.2' },
      { id: 'gpt-5.1-codex-mini', name: 'GPT-5.1 Codex Mini' },
    ],
    fallbackProviderId: 'openai',
  },
  'gemini-cli': {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    family: 'google',
    binary: 'gemini',
    authMethod: 'both',
    envVar: 'GEMINI_API_KEY',
    docsUrl: 'https://aistudio.google.com',
    installCommand: 'npm i -g @google/gemini-cli',
    defaultModel: 'gemini-2.5-flash-lite',
    presetModels: [
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro Preview' },
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash Preview' },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
    ],
    fallbackProviderId: 'google',
  },
};

export function isCliRuntimeProvider(providerId: string): providerId is keyof typeof CLI_PROVIDER_DEFS {
  return providerId in CLI_PROVIDER_DEFS;
}

export function listCliRuntimeProviderIds(): string[] {
  return Object.keys(CLI_PROVIDER_DEFS);
}

export function getCliRuntimeProviderDefinition(
  providerId: string
): CliRuntimeProviderDefinition | null {
  return isCliRuntimeProvider(providerId) ? CLI_PROVIDER_DEFS[providerId] : null;
}

export function getRuntimeTransport(providerId: string): RuntimeTransport {
  if (isCliRuntimeProvider(providerId)) return 'cli';
  return 'http';
}

export function getRuntimeFallbackProviderId(providerId: string): string | undefined {
  if (isCliRuntimeProvider(providerId)) {
    return getCliRuntimeProviderDefinition(providerId)?.fallbackProviderId;
  }
  return undefined;
}

export function getRuntimeDefaultModel(providerId: string): string | null {
  if (isCliRuntimeProvider(providerId)) {
    return CLI_PROVIDER_DEFS[providerId].defaultModel;
  }
  return null;
}

function getCliRuntimePresetModels(providerId: string): Array<{ id: string; name: string }> {
  const def = getCliRuntimeProviderDefinition(providerId);
  if (!def) return [];
  return def.presetModels;
}

export async function getCliRuntimeModels(
  providerId: string
): Promise<Array<{ id: string; name: string }>> {
  const def = getCliRuntimeProviderDefinition(providerId);
  if (!def) return [];
  return getCliRuntimePresetModels(def.id);
}

export function isCliRuntimeProviderAvailable(providerId: string): boolean {
  const def = getCliRuntimeProviderDefinition(providerId);
  return def ? isBinaryInstalled(def.binary) : false;
}

export function hasAnyCliRuntimeProviderAvailable(): boolean {
  return listCliRuntimeProviderIds().some((id) => isCliRuntimeProviderAvailable(id));
}

export function getCliRuntimeProviderMetadata(providerId: string): RuntimeProviderMetadata | null {
  const def = getCliRuntimeProviderDefinition(providerId);
  if (!def) return null;

  const isAvailable = isBinaryInstalled(def.binary);
  return {
    id: def.id,
    displayName: def.displayName,
    transport: 'cli',
    family: def.family,
    authMethod: def.authMethod,
    isAvailable,
    isConfigured: isAvailable,
    fallbackProviderId: def.fallbackProviderId,
    docsUrl: def.docsUrl,
    installCommand: def.installCommand,
    envVar: def.envVar,
    version: isAvailable ? getBinaryVersion(def.binary) : undefined,
  };
}

function buildCliPrompt(request: CompletionRequest): string {
  const lines: string[] = [];
  for (const message of request.messages) {
    const content =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .map((part) => (part.type === 'text' ? part.text : `[${part.type}]`))
            .join('\n');
    lines.push(`${message.role.toUpperCase()}: ${content}`);
  }

  if (request.tools?.length) {
    lines.push(
      'TOOLS AVAILABLE: OwnPilot tool calling is not available in CLI-backed runtime mode. Answer without invoking tool calls.'
    );
  }

  return lines.join('\n\n');
}

function normalizeCliModel(model: string | undefined): string | undefined {
  if (!model || model === 'default') return undefined;
  return model;
}

function parseCodexOutput(stdout: string): string {
  let output = '';
  const lines = stdout.trim().split('\n');
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

  return output.trim() || stdout.trim();
}

async function collectStreamingProcess(
  command: string,
  args: string[],
  env: Record<string, string>,
  cwd?: string
): Promise<Array<Result<StreamChunk, InternalError>>> {
  return new Promise((resolve) => {
    const chunks: Array<Result<StreamChunk, InternalError>> = [];
    const proc = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (text) {
        chunks.push(ok({ id: crypto.randomUUID(), content: text, done: false }));
      }
    });

    let stderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on('error', (error) => {
      chunks.push(err(new InternalError(String(error))));
      resolve(chunks);
    });

    proc.on('close', (code) => {
      if ((code ?? 1) !== 0) {
        chunks.push(err(new InternalError(stderr || `Process exited with code ${code ?? 1}`)));
      } else {
        chunks.push(ok({ id: crypto.randomUUID(), content: '', done: true }));
      }
      resolve(chunks);
    });
  });
}

class CliRuntimeProvider implements IProvider {
  readonly type: AIProvider = 'custom';

  constructor(
    private readonly def: CliRuntimeProviderDefinition,
    private readonly apiKey?: string
  ) {}

  isReady(): boolean {
    return isBinaryInstalled(this.def.binary);
  }

  async complete(request: CompletionRequest) {
    if (!this.isReady()) {
      return err(new ValidationError(`${this.def.displayName} CLI is not installed`));
    }

    const prompt = buildCliPrompt(request);
    const env = this.apiKey
      ? createSanitizedEnv(this.def.id, this.apiKey, this.def.envVar)
      : createLoginOnlyCliEnv(this.def.id, this.def.envVar);

    try {
      let output = '';
      if (this.def.id === 'claude-cli') {
        const args = ['-p', prompt];
        const model = normalizeCliModel(request.model.model);
        if (model) args.push('--model', model);
        const result = await spawnCliProcess(this.def.binary, args, {
          cwd: process.cwd(),
          env,
          timeout: 300_000,
        });
        if (result.exitCode !== 0) {
          return err(new InternalError(result.stderr || `Exited with code ${result.exitCode}`));
        }
        output = result.stdout.trim();
      } else if (this.def.id === 'codex-cli') {
        const args = ['exec', '--json', '--full-auto'];
        const model = normalizeCliModel(request.model.model);
        if (model) args.push('--model', model);
        args.push(prompt);
        const result = await spawnCliProcess(this.def.binary, args, {
          cwd: process.cwd(),
          env,
          timeout: 300_000,
        });
        if (result.exitCode !== 0) {
          return err(new InternalError(result.stderr || `Exited with code ${result.exitCode}`));
        }
        output = parseCodexOutput(result.stdout);
      } else {
        const args = ['-p', prompt, '--output-format', 'json'];
        const model = normalizeCliModel(request.model.model);
        if (model) args.push('--model', model);
        const result = await spawnCliProcess(this.def.binary, args, {
          cwd: process.cwd(),
          env,
          timeout: 300_000,
        });
        if (result.exitCode !== 0) {
          return err(new InternalError(result.stderr || `Exited with code ${result.exitCode}`));
        }
        try {
          const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
          output = String(parsed.response ?? parsed.content ?? result.stdout).trim();
        } catch {
          output = result.stdout.trim();
        }
      }

      const response: CompletionResponse = {
        id: crypto.randomUUID(),
        content: output,
        finishReason: 'stop',
        model: normalizeCliModel(request.model.model) ?? this.def.defaultModel,
        createdAt: new Date(),
      };

      return ok(response);
    } catch (error) {
      if (error instanceof TimeoutError) return err(error);
      return err(new InternalError(error instanceof Error ? error.message : String(error)));
    }
  }

  async *stream(request: CompletionRequest) {
    if (!this.isReady()) {
      yield err(new InternalError(`${this.def.displayName} CLI is not installed`));
      return;
    }

    const prompt = buildCliPrompt(request);
    const env = this.apiKey
      ? createSanitizedEnv(this.def.id, this.apiKey, this.def.envVar)
      : createLoginOnlyCliEnv(this.def.id, this.def.envVar);

    let args: string[];
    if (this.def.id === 'claude-cli') {
      args = ['-p', prompt];
      const model = normalizeCliModel(request.model.model);
      if (model) args.push('--model', model);
    } else if (this.def.id === 'codex-cli') {
      args = ['exec', '--full-auto', prompt];
      const model = normalizeCliModel(request.model.model);
      if (model) args.push('--model', model);
    } else {
      args = ['-p', prompt];
      const model = normalizeCliModel(request.model.model);
      if (model) args.push('--model', model);
    }

    const chunks = await collectStreamingProcess(this.def.binary, args, env, process.cwd());
    for (const chunk of chunks) {
      yield chunk;
    }
  }

  countTokens(messages: readonly Message[]): number {
    return Math.ceil(
      messages.reduce((sum, msg) => {
        const content =
          typeof msg.content === 'string'
            ? msg.content
            : msg.content.map((part) => ('text' in part ? part.text : '')).join('');
        return sum + content.length;
      }, 0) / 4
    );
  }

  async getModels() {
    return ok([this.def.defaultModel]);
  }
}

class GatewayFallbackProvider implements IProvider {
  readonly type: AIProvider;

  constructor(private readonly providers: IProvider[]) {
    this.type = providers[0]?.type ?? 'custom';
  }

  isReady(): boolean {
    return this.providers.some((provider) => provider.isReady());
  }

  async complete(request: CompletionRequest) {
    let lastError: InternalError | TimeoutError | ValidationError | null = null;
    for (const provider of this.providers) {
      if (!provider.isReady()) continue;
      const result = await provider.complete(request);
      if (result.ok) return result;
      lastError = result.error;
      log.warn(`Provider fallback triggered from ${provider.type}: ${result.error.message}`);
    }
    return err(lastError ?? new InternalError('No providers are configured or ready'));
  }

  async *stream(request: CompletionRequest) {
    let yielded = false;
    for (const provider of this.providers) {
      if (!provider.isReady()) continue;
      for await (const result of provider.stream(request)) {
        if (!result.ok && !yielded) {
          break;
        }
        if (result.ok) yielded = true;
        yield result;
      }
      if (yielded) return;
    }
    yield err(new InternalError('No providers are configured or ready'));
  }

  countTokens(messages: readonly Message[]): number {
    return this.providers[0]?.countTokens(messages) ?? 0;
  }

  async getModels() {
    const models = new Set<string>();
    for (const provider of this.providers) {
      const result = await provider.getModels();
      if (result.ok) {
        for (const model of result.value) models.add(model);
      }
    }
    return ok([...models]);
  }
}

export async function createRuntimeProvider(
  providerId: string,
  fallbackProviderId?: string
): Promise<IProvider | null> {
  const providers: IProvider[] = [];

  const primary = await createSingleRuntimeProvider(providerId);
  if (primary) providers.push(primary);

  if (fallbackProviderId && fallbackProviderId !== providerId) {
    const fallback = await createSingleRuntimeProvider(fallbackProviderId);
    if (fallback) providers.push(fallback);
  } else {
    const familyFallbackId = getRuntimeFallbackProviderId(providerId);
    if (familyFallbackId && familyFallbackId !== providerId) {
      const fallback = await createSingleRuntimeProvider(familyFallbackId);
      if (fallback) providers.push(fallback);
    }
  }

  if (providers.length === 0) return null;
  if (providers.length === 1) return providers[0] ?? null;
  return new GatewayFallbackProvider(providers);
}

export async function resolveRuntimeProvider(
  providerOverride?: string,
  modelOverride?: string,
  fallbackProviderId?: string
): Promise<{ providerId: string | null; model: string | null; instance: IProvider | null }> {
  const resolved = await resolveProviderAndModel(
    providerOverride ?? 'default',
    modelOverride ?? 'default'
  );

  if (!resolved.provider || !resolved.model) {
    return { providerId: null, model: null, instance: null };
  }

  const instance = await createRuntimeProvider(resolved.provider, fallbackProviderId);
  return {
    providerId: resolved.provider,
    model: resolved.model,
    instance,
  };
}

async function createSingleRuntimeProvider(providerId: string): Promise<IProvider | null> {
  if (isCliRuntimeProvider(providerId)) {
    const def = getCliRuntimeProviderDefinition(providerId);
    if (!def) return null;

    const apiKey = await getApiKey(providerId);
    return new CliRuntimeProvider(def, apiKey);
  }

  const localProvider = await localProvidersRepo.getProvider(providerId);
  if (localProvider) {
    return createProvider({
      provider: 'openai',
      apiKey: localProvider.apiKey || 'local-no-key',
      baseUrl: localProvider.baseUrl,
    });
  }

  const apiKey = await getApiKey(providerId);
  if (!apiKey) return null;

  const { getProviderConfig } = await import('@ownpilot/core');
  const config = getProviderConfig(providerId);
  const providerType = [
    'openai',
    'anthropic',
    'google',
  ].includes(providerId)
    ? providerId
    : 'openai';

  return createProvider({
    provider: providerType as ProviderConfig['provider'],
    apiKey,
    baseUrl: config?.baseUrl,
    headers: config?.headers,
  });
}
