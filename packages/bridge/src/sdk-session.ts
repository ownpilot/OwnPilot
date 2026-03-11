// Agent SDK V2 abstraction layer — dual-mode support (SDK or CLI fallback)
//
// USE_SDK_SESSION=true (experimental): routes ClaudeManager.runClaude() through
// SdkSessionWrapper instead of CLI subprocess. Falls back to CLI if SDK is not
// installed or if SdkSessionWrapper.send() throws.
//
// NOTE: @anthropic-ai/claude-agent-sdk uses "unstable_v2_*" prefix — API may
// change. This wrapper isolates the surface area for easy updates.

import type { StreamChunk } from './types.ts';

export function isSdkAvailable(): boolean {
  try {
    // Dynamic check — SDK may not be installed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("@anthropic-ai/claude-agent-sdk");
    return true;
  } catch {
    return false;
  }
}

export interface SdkSessionOptions {
  projectDir: string;
  systemPrompt?: string;
}

export interface CostInfo {
  inputTokens: number;
  outputTokens: number;
}

export class SdkSessionWrapper {
  private alive = false;
  private costInfo: CostInfo | null = null;

  async create(_options: SdkSessionOptions): Promise<void> {
    // TODO: when SDK is installed, call unstable_v2_createSession() here
    this.alive = true;
  }

  async *send(_message: string): AsyncGenerator<StreamChunk> {
    // TODO: when SDK is installed, stream real SDK events here
    // Stub yields a minimal StreamChunk sequence so downstream consumers work
    yield { type: 'text', text: '' };
    yield { type: 'done' };
  }

  async terminate(): Promise<void> {
    this.alive = false;
  }

  isAlive(): boolean {
    return this.alive;
  }

  getCost(): CostInfo | null {
    return this.costInfo;
  }
}

export async function createSdkSession(options: SdkSessionOptions): Promise<SdkSessionWrapper> {
  const wrapper = new SdkSessionWrapper();
  await wrapper.create(options);
  return wrapper;
}
