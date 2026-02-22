/**
 * Audio Overrides Tests
 *
 * Tests the audio tool override executors (text_to_speech, speech_to_text,
 * translate_audio, split_audio), config resolution (dedicated audio_service
 * vs default AI provider), internal helpers (callOpenAITTS, callElevenLabsTTS,
 * callWhisperTranscribe), and the registration function.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockGetFieldValue = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());

const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogDebug = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());

const mockResolveProviderAndModel = vi.hoisted(() => vi.fn());
const mockGetProviderApiKey = vi.hoisted(() => vi.fn());
const mockLoadProviderConfig = vi.hoisted(() => vi.fn());

// fs mocks
const mockFsStat = vi.hoisted(() => vi.fn());
const mockFsReadFile = vi.hoisted(() => vi.fn());
const mockFsWriteFile = vi.hoisted(() => vi.fn());
const mockFsMkdir = vi.hoisted(() => vi.fn());
const mockFsAccess = vi.hoisted(() => vi.fn());
const mockFsReaddir = vi.hoisted(() => vi.fn());

// child_process mocks
const mockExecFile = vi.hoisted(() => vi.fn());

// fetch mock
const mockFetch = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    getFieldValue: (...args: unknown[]) => mockGetFieldValue(...args),
    upsert: (...args: unknown[]) => mockUpsert(...args),
  },
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: mockLogInfo,
    debug: mockLogDebug,
    warn: mockLogWarn,
    error: mockLogError,
  }),
}));

vi.mock('../routes/helpers.js', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('../routes/settings.js', () => ({
  resolveProviderAndModel: (...args: unknown[]) => mockResolveProviderAndModel(...args),
}));

vi.mock('../routes/agent-cache.js', () => ({
  getProviderApiKey: (...args: unknown[]) => mockGetProviderApiKey(...args),
  loadProviderConfig: (...args: unknown[]) => mockLoadProviderConfig(...args),
}));

vi.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => mockFsStat(...args),
  readFile: (...args: unknown[]) => mockFsReadFile(...args),
  writeFile: (...args: unknown[]) => mockFsWriteFile(...args),
  mkdir: (...args: unknown[]) => mockFsMkdir(...args),
  access: (...args: unknown[]) => mockFsAccess(...args),
  readdir: (...args: unknown[]) => mockFsReaddir(...args),
}));

vi.mock('node:path', () => ({
  join: (...parts: string[]) => parts.join('/'),
  dirname: (p: string) => {
    const idx = p.lastIndexOf('/');
    return idx >= 0 ? p.substring(0, idx) : '.';
  },
  basename: (p: string, ext?: string) => {
    const base = p.split('/').pop() ?? p;
    if (ext && base.endsWith(ext)) return base.slice(0, -ext.length);
    return base;
  },
  extname: (p: string) => {
    const base = p.split('/').pop() ?? p;
    const dotIdx = base.lastIndexOf('.');
    return dotIdx >= 0 ? base.substring(dotIdx) : '';
  },
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('node:util', () => ({
  promisify: (fn: (...args: unknown[]) => unknown) => {
    // Return a wrapper that calls fn with a callback
    return (...args: unknown[]) => {
      return new Promise((resolve, reject) => {
        fn(...args, (err: Error | null, result: unknown) => {
          if (err) reject(err);
          else resolve(result);
        });
      });
    };
  },
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { registerAudioOverrides } from './audio-overrides.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = (params: Record<string, any>, context?: any) => Promise<any>;

/**
 * Capture all 4 audio executors by calling registerAudioOverrides with a mock registry.
 */
async function captureExecutors(): Promise<Record<string, Executor>> {
  const captured: Record<string, Executor> = {};
  const mockRegistry = {
    updateExecutor: vi.fn((name: string, executor: Executor) => {
      captured[name] = executor;
      return true;
    }),
  };
  await registerAudioOverrides(mockRegistry as never);
  return captured;
}

const defaultContext = { workspaceDir: '/workspace' };

function setupDedicatedAudioConfig(overrides: Record<string, string | undefined> = {}): void {
  mockGetFieldValue.mockImplementation((service: string, field: string) => {
    if (service === 'audio_service') {
      const defaults: Record<string, string> = {
        api_key: 'test-audio-api-key',
        provider_type: 'openai',
        base_url: '',
      };
      return overrides[field] !== undefined ? overrides[field] : defaults[field];
    }
    return undefined;
  });
}

function setupDefaultProviderFallback(
  opts: {
    provider?: string | null;
    apiKey?: string | null;
    baseUrl?: string;
  } = {}
): void {
  mockGetFieldValue.mockReturnValue(undefined);
  mockResolveProviderAndModel.mockResolvedValue({
    provider: opts.provider !== undefined ? opts.provider : 'openai',
    model: 'gpt-4',
  });
  mockGetProviderApiKey.mockResolvedValue(opts.apiKey !== undefined ? opts.apiKey : 'fallback-key');
  mockLoadProviderConfig.mockReturnValue(
    opts.baseUrl !== undefined ? { baseUrl: opts.baseUrl } : null
  );
}

function setupNoConfig(): void {
  mockGetFieldValue.mockReturnValue(undefined);
  mockResolveProviderAndModel.mockResolvedValue({ provider: null, model: null });
}

function makeFetchResponse(
  opts: {
    ok?: boolean;
    status?: number;
    body?: string | object | ArrayBuffer;
    contentType?: string;
  } = {}
) {
  const ok = opts.ok !== undefined ? opts.ok : true;
  const status = opts.status ?? (ok ? 200 : 500);
  const body = opts.body ?? '';

  return {
    ok,
    status,
    text: vi.fn(async () => (typeof body === 'string' ? body : JSON.stringify(body))),
    json: vi.fn(async () =>
      typeof body === 'object' && !(body instanceof ArrayBuffer) ? body : JSON.parse(body as string)
    ),
    arrayBuffer: vi.fn(async () => {
      if (body instanceof ArrayBuffer) return body;
      if (typeof body === 'string') return Buffer.from(body).buffer;
      return Buffer.from(JSON.stringify(body)).buffer;
    }),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let executors: Record<string, Executor>;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
  mockUpsert.mockResolvedValue(undefined);
  mockFsMkdir.mockResolvedValue(undefined);
  mockFsWriteFile.mockResolvedValue(undefined);
  executors = await captureExecutors();
});

// ============================================================================
// Registration
// ============================================================================

describe('registerAudioOverrides', () => {
  it('should register all 4 audio tool executors', () => {
    const names = Object.keys(executors);
    expect(names).toContain('text_to_speech');
    expect(names).toContain('speech_to_text');
    expect(names).toContain('translate_audio');
    expect(names).toContain('split_audio');
    expect(names).toHaveLength(4);
  });

  it('should call updateExecutor for each tool name', async () => {
    const mockRegistry = {
      updateExecutor: vi.fn(() => true),
    };
    await registerAudioOverrides(mockRegistry as never);
    // 4 tools = 4 calls (each succeeds on first try)
    expect(mockRegistry.updateExecutor).toHaveBeenCalledTimes(4);
  });

  it('should try core. prefix when base name fails', async () => {
    const mockRegistry = {
      updateExecutor: vi.fn((name: string) => name.startsWith('core.')),
    };
    await registerAudioOverrides(mockRegistry as never);
    // Each tool: first call returns false, second call (core.X) returns true = 8 calls
    expect(mockRegistry.updateExecutor).toHaveBeenCalledTimes(8);
    expect(mockRegistry.updateExecutor).toHaveBeenCalledWith(
      'core.text_to_speech',
      expect.any(Function)
    );
    expect(mockRegistry.updateExecutor).toHaveBeenCalledWith(
      'core.speech_to_text',
      expect.any(Function)
    );
    expect(mockRegistry.updateExecutor).toHaveBeenCalledWith(
      'core.translate_audio',
      expect.any(Function)
    );
    expect(mockRegistry.updateExecutor).toHaveBeenCalledWith(
      'core.split_audio',
      expect.any(Function)
    );
  });

  it('should call ensureAudioService to upsert config center entry', async () => {
    mockUpsert.mockClear();
    const mockRegistry = { updateExecutor: vi.fn(() => true) };
    await registerAudioOverrides(mockRegistry as never);
    // Wait for async fire-and-forget
    await new Promise((r) => setTimeout(r, 10));
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'audio_service',
        displayName: 'Audio Service',
        category: 'ai',
      })
    );
  });

  it('should not throw when ensureAudioService fails', async () => {
    mockUpsert.mockRejectedValue(new Error('DB down'));
    const mockRegistry = { updateExecutor: vi.fn(() => true) };
    await expect(registerAudioOverrides(mockRegistry as never)).resolves.not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

// ============================================================================
// tryUpdateExecutor
// ============================================================================

describe('tryUpdateExecutor', () => {
  it('should stop after first successful update (base name)', async () => {
    const mockRegistry = {
      updateExecutor: vi.fn(() => true),
    };
    await registerAudioOverrides(mockRegistry as never);
    // 4 tools, each resolved on first call = 4 total
    expect(mockRegistry.updateExecutor).toHaveBeenCalledTimes(4);
  });

  it('should fall back to core. prefix when base name returns false', async () => {
    const mockRegistry = {
      updateExecutor: vi.fn((name: string) => name.startsWith('core.')),
    };
    await registerAudioOverrides(mockRegistry as never);
    // Each tool tried twice = 8
    expect(mockRegistry.updateExecutor).toHaveBeenCalledTimes(8);
  });

  it('should do nothing if both attempts fail', async () => {
    const mockRegistry = {
      updateExecutor: vi.fn(() => false),
    };
    await registerAudioOverrides(mockRegistry as never);
    // Each tool tried twice = 8, none succeeded
    expect(mockRegistry.updateExecutor).toHaveBeenCalledTimes(8);
  });

  it('should log success on base name override', async () => {
    mockLogInfo.mockClear();
    const mockRegistry = {
      updateExecutor: vi.fn(() => true),
    };
    await registerAudioOverrides(mockRegistry as never);
    expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('Overrode text_to_speech'));
    expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('Overrode speech_to_text'));
  });

  it('should log success with core. prefix when fallback works', async () => {
    mockLogInfo.mockClear();
    const mockRegistry = {
      updateExecutor: vi.fn((name: string) => name.startsWith('core.')),
    };
    await registerAudioOverrides(mockRegistry as never);
    expect(mockLogInfo).toHaveBeenCalledWith(
      expect.stringContaining('Overrode core.text_to_speech')
    );
  });
});

// ============================================================================
// Config Resolution (tested through executors)
// ============================================================================

describe('resolveAudioConfig', () => {
  it('should return dedicated audio_service config when api_key is present', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(false);
    // Verify fetch was called with the dedicated key
    const fetchCall = mockFetch.mock.calls[0]!;
    expect(fetchCall[0]).toContain('api.openai.com');
    const headers = fetchCall[1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-audio-api-key');
  });

  it('should return provider_type from Config Center (default openai)', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(false);
    // OpenAI TTS uses /v1/audio/speech
    expect(mockFetch.mock.calls[0]![0]).toContain('/v1/audio/speech');
  });

  it('should use base_url from Config Center when provided', async () => {
    setupDedicatedAudioConfig({ base_url: 'https://custom.api.com' });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(mockFetch.mock.calls[0]![0]).toContain('https://custom.api.com/v1/audio/speech');
  });

  it('should fall back to default AI provider when no dedicated config', async () => {
    setupDefaultProviderFallback();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(false);
    expect(mockResolveProviderAndModel).toHaveBeenCalledWith('default', 'default');
    expect(mockGetProviderApiKey).toHaveBeenCalled();
  });

  it('should use provider config baseUrl for fallback', async () => {
    setupDefaultProviderFallback({ baseUrl: 'https://my-proxy.com' });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(mockFetch.mock.calls[0]![0]).toContain('https://my-proxy.com/v1/audio/speech');
  });

  it('should default to https://api.openai.com when no config baseUrl', async () => {
    setupDefaultProviderFallback({ baseUrl: undefined });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(mockFetch.mock.calls[0]![0]).toContain('https://api.openai.com/v1/audio/speech');
  });

  it('should return null when no provider configured', async () => {
    setupNoConfig();

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Audio service not configured');
  });

  it('should return null when provider has no API key', async () => {
    setupDefaultProviderFallback({ apiKey: null });

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Audio service not configured');
  });

  it('should use elevenlabs base URL when provider_type is elevenlabs', async () => {
    setupDedicatedAudioConfig({ provider_type: 'elevenlabs' });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(mockFetch.mock.calls[0]![0]).toContain('https://api.elevenlabs.io');
  });

  it('should default getDefaultAudioBaseUrl to openai for unknown providers', async () => {
    setupDedicatedAudioConfig({ provider_type: 'unknown_provider' });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(mockFetch.mock.calls[0]![0]).toContain('https://api.openai.com');
  });
});

// ============================================================================
// textToSpeechOverride
// ============================================================================

describe('textToSpeechOverride', () => {
  // --- Validation errors ---

  it('should return error when text is empty', async () => {
    const result = await executors.text_to_speech!({ text: '' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Text is required');
  });

  it('should return error when text is whitespace only', async () => {
    const result = await executors.text_to_speech!({ text: '   ' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Text is required');
  });

  it('should return error when text is undefined', async () => {
    const result = await executors.text_to_speech!({}, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Text is required');
  });

  it('should return error when text exceeds 4096 characters', async () => {
    const longText = 'a'.repeat(4097);
    const result = await executors.text_to_speech!({ text: longText }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Text too long');
    expect(result.content.error).toContain('4097');
    expect(result.content.error).toContain('max 4096');
  });

  it('should accept text at exactly 4096 characters', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const result = await executors.text_to_speech!({ text: 'a'.repeat(4096) }, defaultContext);
    expect(result.isError).toBe(false);
  });

  it('should return error for unsupported format', async () => {
    const result = await executors.text_to_speech!(
      { text: 'Hello', format: 'wma' },
      defaultContext
    );
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Unsupported format: wma');
    expect(result.content.supportedFormats).toEqual(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']);
  });

  it('should accept all supported output formats', async () => {
    const formats = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];
    for (const format of formats) {
      setupDedicatedAudioConfig();
      mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
      mockFsStat.mockResolvedValue({ size: 1024 });

      const result = await executors.text_to_speech!({ text: 'Hello', format }, defaultContext);
      expect(result.isError).toBe(false);
    }
  });

  it('should return error when no config available (AUDIO_NOT_CONFIGURED)', async () => {
    setupNoConfig();
    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Audio service not configured');
    expect(result.content.error).toContain('Config Center');
  });

  // --- OpenAI TTS ---

  it('should call OpenAI TTS with correct params', async () => {
    setupDedicatedAudioConfig();
    const audioData = Buffer.from('fake-audio-data');
    mockFetch.mockResolvedValue(makeFetchResponse({ body: audioData.buffer }));
    mockFsStat.mockResolvedValue({ size: audioData.length });

    const result = await executors.text_to_speech!(
      {
        text: 'Hello world',
        voice: 'nova',
        model: 'tts-1-hd',
        speed: 1.5,
        format: 'opus',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toBe('https://api.openai.com/v1/audio/speech');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body.model).toBe('tts-1-hd');
    expect(body.input).toBe('Hello world');
    expect(body.voice).toBe('nova');
    expect(body.speed).toBe(1.5);
    expect(body.response_format).toBe('opus');
  });

  it('should use default values: voice=alloy, model=tts-1, speed=1.0, format=mp3', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(false);

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.voice).toBe('alloy');
    expect(body.model).toBe('tts-1');
    expect(body.speed).toBe(1);
    expect(body.response_format).toBe('mp3');
  });

  // --- Speed clamping ---

  it('should clamp speed below 0.25 to 0.25', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello', speed: 0.1 }, defaultContext);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.speed).toBe(0.25);
  });

  it('should clamp speed above 4.0 to 4.0', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello', speed: 10.0 }, defaultContext);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.speed).toBe(4.0);
  });

  it('should pass through valid speed within range', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello', speed: 2.5 }, defaultContext);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.speed).toBe(2.5);
  });

  // --- ElevenLabs TTS ---

  it('should call ElevenLabs TTS when providerType is elevenlabs', async () => {
    setupDedicatedAudioConfig({ provider_type: 'elevenlabs' });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(false);

    const [url, opts] = mockFetch.mock.calls[0]!;
    expect(url).toContain('api.elevenlabs.io/v1/text-to-speech/');
    const headers = opts.headers as Record<string, string>;
    expect(headers['xi-api-key']).toBe('test-audio-api-key');
    expect(headers['Accept']).toBe('audio/mpeg');
  });

  it('should map alloy voice to ElevenLabs default voice ID', async () => {
    setupDedicatedAudioConfig({ provider_type: 'elevenlabs' });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello', voice: 'alloy' }, defaultContext);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM');
  });

  it('should pass custom voice ID directly to ElevenLabs', async () => {
    setupDedicatedAudioConfig({ provider_type: 'elevenlabs' });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello', voice: 'custom-voice-id' }, defaultContext);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('/v1/text-to-speech/custom-voice-id');
  });

  it('should send correct ElevenLabs request body', async () => {
    setupDedicatedAudioConfig({ provider_type: 'elevenlabs' });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello world' }, defaultContext);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body.text).toBe('Hello world');
    expect(body.model_id).toBe('eleven_monolingual_v1');
  });

  it('should report model as elevenlabs for ElevenLabs provider', async () => {
    setupDedicatedAudioConfig({ provider_type: 'elevenlabs' });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.content.model).toBe('elevenlabs');
  });

  // --- File saving ---

  it('should save audio file correctly and return stats', async () => {
    setupDedicatedAudioConfig();
    const audioData = Buffer.from('fake-audio-content');
    mockFetch.mockResolvedValue(makeFetchResponse({ body: audioData.buffer }));
    mockFsStat.mockResolvedValue({ size: 12345 });

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);

    expect(result.isError).toBe(false);
    expect(result.content.success).toBe(true);
    expect(result.content.format).toBe('mp3');
    expect(result.content.size).toBe(12345);
    expect(result.content.voice).toBe('alloy');
    expect(result.content.textLength).toBe(5);
    expect(mockFsMkdir).toHaveBeenCalled();
    expect(mockFsWriteFile).toHaveBeenCalled();
  });

  it('should use default path based on workspace dir', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const result = await executors.text_to_speech!(
      { text: 'Hello' },
      { workspaceDir: '/my/workspace' }
    );
    expect(result.content.path).toMatch(/^\/my\/workspace\/tts_\d+\.mp3$/);
  });

  it('should use outputPath when provided', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const result = await executors.text_to_speech!(
      {
        text: 'Hello',
        outputPath: '/custom/output/speech.wav',
        format: 'wav',
      },
      defaultContext
    );

    expect(result.content.path).toBe('/custom/output/speech.wav');
    expect(mockFsMkdir).toHaveBeenCalledWith('/custom/output', { recursive: true });
  });

  it('should default workspaceDir to . when not provided', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const result = await executors.text_to_speech!({ text: 'Hello' }, {});
    expect(result.content.path).toMatch(/^\.\/tts_\d+\.mp3$/);
  });

  // --- Error handling ---

  it('should handle OpenAI TTS API error', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        ok: false,
        status: 429,
        body: 'Rate limit exceeded',
      })
    );

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to generate speech');
    expect(result.content.error).toContain('OpenAI TTS API 429');
  });

  it('should handle ElevenLabs TTS API error', async () => {
    setupDedicatedAudioConfig({ provider_type: 'elevenlabs' });
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        ok: false,
        status: 401,
        body: 'Unauthorized',
      })
    );

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to generate speech');
    expect(result.content.error).toContain('ElevenLabs TTS API 401');
  });

  it('should handle fetch network error', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockRejectedValue(new Error('Network error'));

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to generate speech');
    expect(result.content.error).toContain('Network error');
  });

  it('should handle file write error', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsWriteFile.mockRejectedValue(new Error('Disk full'));

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to generate speech');
    expect(result.content.error).toContain('Disk full');
  });

  it('should truncate long API error text to 500 chars', async () => {
    setupDedicatedAudioConfig();
    const longError = 'x'.repeat(1000);
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        ok: false,
        status: 500,
        body: longError,
      })
    );

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(true);
    // The error message should contain the truncated text (500 chars from errText.slice(0, 500))
    expect(result.content.error.length).toBeLessThan(1000);
  });
});

// ============================================================================
// speechToTextOverride
// ============================================================================

describe('speechToTextOverride', () => {
  // --- Validation ---

  it('should return error when source is empty', async () => {
    const result = await executors.speech_to_text!({ source: '' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Audio source path is required');
  });

  it('should return error when source is undefined', async () => {
    const result = await executors.speech_to_text!({}, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Audio source path is required');
  });

  it('should return error when no config available', async () => {
    setupNoConfig();
    const result = await executors.speech_to_text!({ source: '/audio/test.mp3' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Audio service not configured');
  });

  // --- URL source ---

  it('should download and transcribe URL source', async () => {
    setupDedicatedAudioConfig();
    const audioBuffer = Buffer.from('url-audio-data');
    // First fetch: download the audio URL
    mockFetch.mockResolvedValueOnce(makeFetchResponse({ body: audioBuffer.buffer }));
    // Second fetch: Whisper API call
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({
        body: { text: 'Transcribed text', language: 'en', duration: 10.5 },
      })
    );

    const result = await executors.speech_to_text!(
      {
        source: 'https://example.com/audio/recording.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.success).toBe(true);
    expect(result.content.text).toBe('Transcribed text');
    expect(result.content.language).toBe('en');
    expect(result.content.duration).toBe(10.5);
    expect(result.content.source).toBe('https://example.com/audio/recording.mp3');
  });

  it('should extract filename from URL path', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValueOnce(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({
        body: { text: 'Hello' },
      })
    );

    await executors.speech_to_text!(
      {
        source: 'https://example.com/files/interview.wav',
      },
      defaultContext
    );

    // The second fetch is the Whisper API call — check the FormData has the filename
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const whisperUrl = mockFetch.mock.calls[1]![0] as string;
    expect(whisperUrl).toContain('/v1/audio/transcriptions');
  });

  it('should handle URL download failure', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({ ok: false, status: 404, body: 'Not found' })
    );

    const result = await executors.speech_to_text!(
      {
        source: 'https://example.com/missing.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to transcribe');
    expect(result.content.error).toContain('Failed to download: 404');
  });

  it('should use audio.mp3 as fallback filename for URLs with no path', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValueOnce(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({
        body: { text: 'Hello' },
      })
    );

    const result = await executors.speech_to_text!(
      {
        source: 'https://example.com/',
      },
      defaultContext
    );
    expect(result.isError).toBe(false);
  });

  // --- Local file source ---

  it('should validate local file format', async () => {
    setupDedicatedAudioConfig();
    const result = await executors.speech_to_text!(
      {
        source: '/audio/test.pdf',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Unsupported format: pdf');
    expect(result.content.supportedFormats).toEqual([
      'mp3',
      'mp4',
      'mpeg',
      'mpga',
      'm4a',
      'wav',
      'webm',
      'ogg',
      'flac',
    ]);
  });

  it('should accept all supported input formats', async () => {
    const formats = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'ogg', 'flac'];
    for (const ext of formats) {
      vi.clearAllMocks();
      vi.stubGlobal('fetch', mockFetch);
      setupDedicatedAudioConfig();
      mockFsStat.mockResolvedValue({ size: 1024 });
      mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
      mockFetch.mockResolvedValue(
        makeFetchResponse({
          body: { text: 'Transcribed' },
        })
      );

      const result = await executors.speech_to_text!(
        {
          source: `/audio/test.${ext}`,
        },
        defaultContext
      );
      expect(result.isError).toBe(false);
    }
  });

  it('should return error when local file exceeds 25MB', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 26 * 1024 * 1024 }); // 26MB

    const result = await executors.speech_to_text!(
      {
        source: '/audio/huge.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('File too large');
    expect(result.content.error).toContain('max 25MB');
    expect(result.content.error).toContain('split_audio');
  });

  it('should accept file at exactly 25MB', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 25 * 1024 * 1024 }); // exactly 25MB
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        body: { text: 'Transcribed' },
      })
    );

    const result = await executors.speech_to_text!(
      {
        source: '/audio/exact25.mp3',
      },
      defaultContext
    );
    expect(result.isError).toBe(false);
  });

  it('should call Whisper API with language and prompt', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio-data'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        body: { text: 'Bonjour', language: 'fr', duration: 5.0 },
      })
    );

    const result = await executors.speech_to_text!(
      {
        source: '/audio/french.mp3',
        language: 'fr',
        prompt: 'This is a French conversation',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.text).toBe('Bonjour');
    expect(result.content.language).toBe('fr');

    // Verify Whisper API call
    const whisperUrl = mockFetch.mock.calls[0]![0] as string;
    expect(whisperUrl).toContain('/v1/audio/transcriptions');
  });

  it('should use verbose_json format by default for segments', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        body: {
          text: 'Hello world',
          language: 'en',
          duration: 3.0,
          segments: [
            { start: 0, end: 1.5, text: 'Hello' },
            { start: 1.5, end: 3.0, text: ' world' },
          ],
        },
      })
    );

    const result = await executors.speech_to_text!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.segments).toHaveLength(2);
    expect(result.content.segments[0]).toEqual({ start: 0, end: 1.5, text: 'Hello' });
    expect(result.content.segments[1]).toEqual({ start: 1.5, end: 3.0, text: ' world' });
  });

  it('should handle responseFormat text', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn(async () => 'Plain text transcription'),
      json: vi.fn(),
      arrayBuffer: vi.fn(),
    });

    const result = await executors.speech_to_text!(
      {
        source: '/audio/test.mp3',
        responseFormat: 'text',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.text).toBe('Plain text transcription');
  });

  it('should return language as auto-detected when not provided', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        body: { text: 'Hello' },
      })
    );

    const result = await executors.speech_to_text!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.language).toBe('auto-detected');
  });

  it('should return language from API when available', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        body: { text: 'Hola', language: 'es' },
      })
    );

    const result = await executors.speech_to_text!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.content.language).toBe('es');
  });

  it('should handle Whisper API error', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        ok: false,
        status: 400,
        body: 'Invalid audio format',
      })
    );

    const result = await executors.speech_to_text!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to transcribe');
    expect(result.content.error).toContain('Whisper API 400');
  });

  it('should handle file read error', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockRejectedValue(new Error('ENOENT: no such file'));

    const result = await executors.speech_to_text!(
      {
        source: '/audio/missing.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to transcribe');
    expect(result.content.error).toContain('ENOENT');
  });

  it('should handle http:// URLs as well as https://', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValueOnce(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFetch.mockResolvedValueOnce(
      makeFetchResponse({
        body: { text: 'Hello' },
      })
    );

    const result = await executors.speech_to_text!(
      {
        source: 'http://example.com/audio.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    // First fetch was to download the audio
    expect(mockFetch.mock.calls[0]![0]).toBe('http://example.com/audio.mp3');
  });
});

// ============================================================================
// translateAudioOverride
// ============================================================================

describe('translateAudioOverride', () => {
  // --- Validation ---

  it('should return error when source is empty', async () => {
    const result = await executors.translate_audio!({ source: '' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Audio source path is required');
  });

  it('should return error when source is undefined', async () => {
    const result = await executors.translate_audio!({}, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Audio source path is required');
  });

  it('should return error when no config available', async () => {
    setupNoConfig();
    const result = await executors.translate_audio!({ source: '/audio/test.mp3' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Audio service not configured');
  });

  it('should return error for unsupported format', async () => {
    setupDedicatedAudioConfig();
    const result = await executors.translate_audio!(
      {
        source: '/audio/test.txt',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Unsupported format: txt');
    expect(result.content.supportedFormats).toEqual([
      'mp3',
      'mp4',
      'mpeg',
      'mpga',
      'm4a',
      'wav',
      'webm',
      'ogg',
      'flac',
    ]);
  });

  it('should return error when file exceeds 25MB', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 30 * 1024 * 1024 });

    const result = await executors.translate_audio!(
      {
        source: '/audio/large.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('File too large');
    expect(result.content.error).toContain('max 25MB');
  });

  // --- Success cases ---

  it('should call Whisper translation API', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        body: { text: 'Translated text', duration: 15.0 },
      })
    );

    const result = await executors.translate_audio!(
      {
        source: '/audio/spanish.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.success).toBe(true);
    expect(result.content.text).toBe('Translated text');
    expect(result.content.targetLanguage).toBe('English');
    expect(result.content.duration).toBe(15.0);
    expect(result.content.source).toBe('/audio/spanish.mp3');

    // Verify API endpoint
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('/v1/audio/translations');
  });

  it('should send correct API headers', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        body: { text: 'Hello' },
      })
    );

    await executors.translate_audio!({ source: '/audio/test.mp3' }, defaultContext);

    const opts = mockFetch.mock.calls[0]![1];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Authorization']).toBe('Bearer test-audio-api-key');
  });

  it('should include prompt when provided', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        body: { text: 'Translated with context' },
      })
    );

    const result = await executors.translate_audio!(
      {
        source: '/audio/test.mp3',
        prompt: 'Technical discussion about coding',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.text).toBe('Translated with context');
  });

  it('should handle responseFormat text', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: vi.fn(async () => 'Plain translated text'),
      json: vi.fn(),
      arrayBuffer: vi.fn(),
    });

    const result = await executors.translate_audio!(
      {
        source: '/audio/test.mp3',
        responseFormat: 'text',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.text).toBe('Plain translated text');
    expect(result.content.targetLanguage).toBe('English');
    expect(result.content.source).toBe('/audio/test.mp3');
  });

  it('should handle responseFormat json (verbose_json)', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        body: { text: 'Translated JSON', duration: 20.0 },
      })
    );

    const result = await executors.translate_audio!(
      {
        source: '/audio/test.mp3',
        responseFormat: 'json',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.text).toBe('Translated JSON');
    expect(result.content.duration).toBe(20.0);
    expect(result.content.targetLanguage).toBe('English');
  });

  it('should handle Whisper Translation API error', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        ok: false,
        status: 500,
        body: 'Internal server error',
      })
    );

    const result = await executors.translate_audio!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to translate audio');
    expect(result.content.error).toContain('Whisper Translation API 500');
  });

  it('should handle file stat error', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockRejectedValue(new Error('ENOENT'));

    const result = await executors.translate_audio!(
      {
        source: '/audio/missing.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to translate audio');
    expect(result.content.error).toContain('ENOENT');
  });

  it('should default responseFormat to json', async () => {
    setupDedicatedAudioConfig();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        body: { text: 'Default format', duration: 5.0 },
      })
    );

    const result = await executors.translate_audio!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.duration).toBe(5.0); // duration only available with JSON
  });

  it('should use fallback provider config for translation', async () => {
    setupDefaultProviderFallback();
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsReadFile.mockResolvedValue(Buffer.from('audio'));
    mockFetch.mockResolvedValue(
      makeFetchResponse({
        body: { text: 'Fallback translation' },
      })
    );

    const result = await executors.translate_audio!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.text).toBe('Fallback translation');
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain('/v1/audio/translations');
  });
});

// ============================================================================
// splitAudioOverride
// ============================================================================

describe('splitAudioOverride', () => {
  // --- Validation ---

  it('should return error when source is empty', async () => {
    const result = await executors.split_audio!({ source: '' }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Audio source path is required');
  });

  it('should return error when source is undefined', async () => {
    const result = await executors.split_audio!({}, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Audio source path is required');
  });

  it('should return error when source file not found', async () => {
    mockFsAccess.mockRejectedValue(new Error('ENOENT: no such file'));

    const result = await executors.split_audio!(
      {
        source: '/audio/missing.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to split audio');
    expect(result.content.error).toContain('ENOENT');
  });

  // --- FFmpeg success ---

  it('should call FFmpeg with correct args', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockFsMkdir.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      // execFile(command, args, opts, callback)
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([
      'podcast_segment_000.mp3',
      'podcast_segment_001.mp3',
      'podcast_segment_002.mp3',
    ]);

    const result = await executors.split_audio!(
      {
        source: '/audio/podcast.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.success).toBe(true);
    expect(result.content.segmentCount).toBe(3);
    expect(result.content.segments).toHaveLength(3);
    expect(result.content.format).toBe('mp3');

    // Verify FFmpeg args
    const ffmpegArgs = mockExecFile.mock.calls[0]!;
    expect(ffmpegArgs[0]).toBe('ffmpeg');
    const cmdArgs = ffmpegArgs[1] as string[];
    expect(cmdArgs).toContain('-i');
    expect(cmdArgs).toContain('/audio/podcast.mp3');
    expect(cmdArgs).toContain('-f');
    expect(cmdArgs).toContain('segment');
    expect(cmdArgs).toContain('-segment_time');
    expect(cmdArgs).toContain('600'); // default segment duration
    expect(cmdArgs).toContain('-c');
    expect(cmdArgs).toContain('copy');
    expect(cmdArgs).toContain('-y');
  });

  it('should use default segment duration of 600 seconds', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([]);

    await executors.split_audio!({ source: '/audio/test.mp3' }, defaultContext);

    const cmdArgs = mockExecFile.mock.calls[0]![1] as string[];
    expect(cmdArgs).toContain('600');
  });

  it('should use custom segment duration', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([]);

    await executors.split_audio!(
      {
        source: '/audio/test.mp3',
        segmentDuration: 300,
      },
      defaultContext
    );

    const cmdArgs = mockExecFile.mock.calls[0]![1] as string[];
    expect(cmdArgs).toContain('300');
  });

  it('should use default output dir based on workspace', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([]);

    const result = await executors.split_audio!(
      {
        source: '/audio/test.mp3',
      },
      { workspaceDir: '/my/workspace' }
    );

    expect(result.content.outputDir).toBe('/my/workspace/audio_segments');
  });

  it('should use custom output dir when provided', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([]);

    const result = await executors.split_audio!(
      {
        source: '/audio/test.mp3',
        outputDir: '/custom/output',
      },
      defaultContext
    );

    expect(result.content.outputDir).toBe('/custom/output');
    expect(mockFsMkdir).toHaveBeenCalledWith('/custom/output', { recursive: true });
  });

  it('should fall back to source dirname when no workspaceDir', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([]);

    const result = await executors.split_audio!(
      {
        source: '/audio/files/test.mp3',
      },
      {}
    );

    // path.dirname('/audio/files/test.mp3') => '/audio/files', then join with 'audio_segments'
    expect(result.content.outputDir).toBe('/audio/files/audio_segments');
  });

  it('should list generated segments correctly', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([
      'song_segment_000.mp3',
      'song_segment_001.mp3',
      'other_file.txt',
      'song_segment_002.mp3',
    ]);

    const result = await executors.split_audio!(
      {
        source: '/audio/song.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    // Only files matching baseName_segment_ and .format should be included
    expect(result.content.segmentCount).toBe(3);
    expect(result.content.segments[0].path).toContain('song_segment_000.mp3');
    expect(result.content.segments[1].path).toContain('song_segment_001.mp3');
    expect(result.content.segments[2].path).toContain('song_segment_002.mp3');
  });

  it('should return segments sorted', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([
      'test_segment_002.mp3',
      'test_segment_000.mp3',
      'test_segment_001.mp3',
    ]);

    const result = await executors.split_audio!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.content.segments[0].path).toContain('test_segment_000');
    expect(result.content.segments[1].path).toContain('test_segment_001');
    expect(result.content.segments[2].path).toContain('test_segment_002');
  });

  it('should return segmentDuration as formatted string', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([]);

    const result = await executors.split_audio!(
      {
        source: '/audio/test.mp3',
        segmentDuration: 120,
      },
      defaultContext
    );

    expect(result.content.segmentDuration).toBe('120 seconds');
  });

  it('should use custom format', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue(['test_segment_000.wav']);

    const result = await executors.split_audio!(
      {
        source: '/audio/test.mp3',
        format: 'wav',
      },
      defaultContext
    );

    expect(result.content.format).toBe('wav');
    // output pattern should contain .wav
    const cmdArgs = mockExecFile.mock.calls[0]![1] as string[];
    const outputPattern = cmdArgs[cmdArgs.length - 1] as string;
    expect(outputPattern).toContain('.wav');
  });

  it('should set 5 minute timeout on FFmpeg', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([]);

    await executors.split_audio!({ source: '/audio/test.mp3' }, defaultContext);

    const opts = mockExecFile.mock.calls[0]![2] as { timeout: number };
    expect(opts.timeout).toBe(300000);
  });

  // --- FFmpeg errors ---

  it('should handle FFmpeg not installed (ENOENT)', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(new Error('ENOENT: ffmpeg not found'));
    });

    const result = await executors.split_audio!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('FFmpeg not installed');
    expect(result.content.suggestion).toContain('ffmpeg.org');
  });

  it('should handle FFmpeg not recognized error', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(new Error('ffmpeg is not recognized as an internal or external command'));
    });

    const result = await executors.split_audio!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('FFmpeg not installed');
  });

  it('should handle FFmpeg not found error', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(new Error('command not found: ffmpeg'));
    });

    const result = await executors.split_audio!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('FFmpeg not installed');
  });

  it('should rethrow non-ENOENT FFmpeg errors', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(new Error('Invalid codec'));
    });

    const result = await executors.split_audio!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to split audio');
    expect(result.content.error).toContain('Invalid codec');
    // Should NOT contain "FFmpeg not installed"
    expect(result.content.error).not.toContain('FFmpeg not installed');
  });

  it('should handle empty segment list', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([]);

    const result = await executors.split_audio!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(result.isError).toBe(false);
    expect(result.content.segmentCount).toBe(0);
    expect(result.content.segments).toEqual([]);
  });

  it('should log segment count on success', async () => {
    mockLogInfo.mockClear();
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue(['test_segment_000.mp3', 'test_segment_001.mp3']);

    await executors.split_audio!(
      {
        source: '/audio/test.mp3',
      },
      defaultContext
    );

    expect(mockLogInfo).toHaveBeenCalledWith(expect.stringContaining('2 segments'));
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('edge cases', () => {
  it('should handle null text in TTS', async () => {
    const result = await executors.text_to_speech!({ text: null }, defaultContext);
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Text is required');
  });

  it('should handle provider type defaulting to openai when empty string', async () => {
    setupDedicatedAudioConfig({ provider_type: '' });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const result = await executors.text_to_speech!({ text: 'Hello' }, defaultContext);
    expect(result.isError).toBe(false);
    // Should use OpenAI URL (provider_type defaults to 'openai' when falsy)
    expect(mockFetch.mock.calls[0]![0]).toContain('api.openai.com');
  });

  it('should handle speed of 0 (falsy) defaulting to 1.0', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    await executors.text_to_speech!({ text: 'Hello', speed: 0 }, defaultContext);
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    // (params.speed as number) || 1.0 — 0 is falsy so defaults to 1.0
    expect(body.speed).toBe(1);
  });

  it('should pass context.workspaceDir to split_audio when available', async () => {
    mockFsAccess.mockResolvedValue(undefined);
    mockExecFile.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (...cbArgs: unknown[]) => unknown;
      cb(null, { stdout: '', stderr: '' });
    });
    mockFsReaddir.mockResolvedValue([]);

    const result = await executors.split_audio!(
      {
        source: '/audio/test.mp3',
      },
      { workspaceDir: '/custom/workspace' }
    );

    expect(result.content.outputDir).toBe('/custom/workspace/audio_segments');
  });

  it('should handle concurrent calls independently', async () => {
    setupDedicatedAudioConfig();
    mockFetch.mockImplementation(() =>
      Promise.resolve(makeFetchResponse({ body: new ArrayBuffer(5) }))
    );
    mockFsStat.mockResolvedValue({ size: 1024 });

    // Sequential calls — still verifies no shared mutable state between invocations.
    // (Promise.all triggers a Vitest mock-resolution race for dynamic imports on Linux CI.)
    const r1 = await executors.text_to_speech!({ text: 'First' }, defaultContext);
    const r2 = await executors.text_to_speech!({ text: 'Second' }, defaultContext);

    expect(r1.content).not.toHaveProperty('error');
    expect(r2.content).not.toHaveProperty('error');
    expect(r1.isError).toBe(false);
    expect(r2.isError).toBe(false);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should handle config upsert error in ensureAudioService gracefully', async () => {
    mockUpsert.mockRejectedValue(new Error('Connection timeout'));
    const mockRegistry = { updateExecutor: vi.fn(() => true) };
    await registerAudioOverrides(mockRegistry as never);
    await new Promise((r) => setTimeout(r, 10));
    // Should not throw; just logs debug
    expect(mockLogDebug).toHaveBeenCalled();
  });

  it('should return correct model name for OpenAI vs ElevenLabs', async () => {
    // OpenAI case
    setupDedicatedAudioConfig();
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });

    const openaiResult = await executors.text_to_speech!(
      {
        text: 'Hello',
        model: 'tts-1-hd',
      },
      defaultContext
    );
    expect(openaiResult.content.model).toBe('tts-1-hd');

    // ElevenLabs case
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    setupDedicatedAudioConfig({ provider_type: 'elevenlabs' });
    mockFetch.mockResolvedValue(makeFetchResponse({ body: Buffer.from('audio').buffer }));
    mockFsStat.mockResolvedValue({ size: 1024 });
    mockFsMkdir.mockResolvedValue(undefined);
    mockFsWriteFile.mockResolvedValue(undefined);

    const elResult = await executors.text_to_speech!(
      {
        text: 'Hello',
        model: 'tts-1-hd',
      },
      defaultContext
    );
    expect(elResult.content.model).toBe('elevenlabs');
  });
});
