/**
 * Image Overrides Tests
 *
 * Tests the image tool override executors (analyze_image, generate_image),
 * internal helper functions (getMimeType, getFormatFromUrl, buildAnalysisPrompt,
 * getStyleDescription, parseSizeToDimensions, getDefaultBaseUrl), the registration
 * function, and all provider-specific API callers (OpenAI, Stability, FAL, Replicate).
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
const mockNativeProviders = vi.hoisted(() => new Set(['openai', 'anthropic', 'google']));

const mockCreateProvider = vi.hoisted(() => vi.fn());

const mockFsStat = vi.hoisted(() => vi.fn());
const mockFsReadFile = vi.hoisted(() => vi.fn());
const mockFsWriteFile = vi.hoisted(() => vi.fn());
const mockFsMkdir = vi.hoisted(() => vi.fn());

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

vi.mock('../routes/settings.js', () => ({
  resolveProviderAndModel: (...args: unknown[]) => mockResolveProviderAndModel(...args),
}));

vi.mock('../routes/agent-cache.js', () => ({
  getProviderApiKey: (...args: unknown[]) => mockGetProviderApiKey(...args),
  loadProviderConfig: (...args: unknown[]) => mockLoadProviderConfig(...args),
  NATIVE_PROVIDERS: mockNativeProviders,
}));

vi.mock('@ownpilot/core', () => ({
  createProvider: (...args: unknown[]) => mockCreateProvider(...args),
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
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
}));

vi.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => mockFsStat(...args),
  readFile: (...args: unknown[]) => mockFsReadFile(...args),
  writeFile: (...args: unknown[]) => mockFsWriteFile(...args),
  mkdir: (...args: unknown[]) => mockFsMkdir(...args),
}));

vi.mock('node:path', () => ({
  join: (...parts: string[]) => parts.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/') || '.',
  basename: (p: string) => p.split('/').pop() ?? p,
  extname: (p: string) => {
    const base = p.split('/').pop() ?? '';
    const dotIdx = base.lastIndexOf('.');
    return dotIdx >= 0 ? base.slice(dotIdx) : '';
  },
  relative: (from: string, to: string) => {
    // Simplified relative: just strip workDir prefix
    if (to.startsWith(from)) return to.slice(from.length + 1);
    return to;
  },
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { registerImageOverrides } from './image-overrides.js';

// ---------------------------------------------------------------------------
// Types & helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = (params: Record<string, any>, context?: any) => Promise<any>;

/**
 * Capture analyze_image and generate_image executors via mock registry.
 */
async function captureExecutors(): Promise<Record<string, Executor>> {
  const captured: Record<string, Executor> = {};
  const mockRegistry = {
    updateExecutor: vi.fn((name: string, executor: Executor) => {
      captured[name] = executor;
      return true;
    }),
  };
  await registerImageOverrides(mockRegistry as never);
  return captured;
}

/**
 * Set up Config Center fields for image_generation service.
 * Use explicit `undefined` value or empty string for fields you want unset.
 */
function setupImageGenConfig(overrides: Record<string, string | undefined> = {}): void {
  const defaults: Record<string, string | undefined> = {
    provider_type: 'openai',
    api_key: 'sk-test-key',
    base_url: '',
    model: 'dall-e-3',
  };
  // Merge: overrides keys (even if undefined) take precedence over defaults
  const merged = { ...defaults, ...overrides };
  mockGetFieldValue.mockImplementation((_service: string, field: string) => {
    return merged[field];
  });
}

/**
 * Set up AI provider resolution mocks for analyze_image.
 */
function setupAnalysisProvider(provider = 'openai', model = 'gpt-4o', apiKey = 'sk-test-key'): void {
  mockResolveProviderAndModel.mockResolvedValue({ provider, model });
  mockGetProviderApiKey.mockResolvedValue(apiKey);
  mockLoadProviderConfig.mockReturnValue({ baseUrl: undefined });
}

/**
 * Create a mock provider with a complete() method.
 */
function createMockProviderInstance(content = 'Analysis result text') {
  const provider = {
    complete: vi.fn().mockResolvedValue({
      ok: true,
      value: { content },
    }),
  };
  mockCreateProvider.mockReturnValue(provider);
  return provider;
}

const defaultContext = { workspaceDir: '/workspace', conversationId: 'conv-1', callId: 'call-1' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('image-overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    mockFsMkdir.mockResolvedValue(undefined);
    mockFsWriteFile.mockResolvedValue(undefined);
    mockUpsert.mockResolvedValue(undefined);
  });

  // ==========================================================================
  // Registration
  // ==========================================================================

  describe('registerImageOverrides', () => {
    it('registers both analyze_image and generate_image executors', async () => {
      const captured: Record<string, Executor> = {};
      const mockRegistry = {
        updateExecutor: vi.fn((name: string, executor: Executor) => {
          captured[name] = executor;
          return true;
        }),
      };
      await registerImageOverrides(mockRegistry as never);

      expect(mockRegistry.updateExecutor).toHaveBeenCalledWith('analyze_image', expect.any(Function));
      expect(mockRegistry.updateExecutor).toHaveBeenCalledWith('generate_image', expect.any(Function));
      expect(captured['analyze_image']).toBeDefined();
      expect(captured['generate_image']).toBeDefined();
    });

    it('falls back to core.name prefix when first updateExecutor returns false', async () => {
      const mockRegistry = {
        updateExecutor: vi.fn().mockReturnValue(false),
      };
      await registerImageOverrides(mockRegistry as never);

      // For analyze_image: first try bare name, then core.analyze_image
      expect(mockRegistry.updateExecutor).toHaveBeenCalledWith('analyze_image', expect.any(Function));
      expect(mockRegistry.updateExecutor).toHaveBeenCalledWith('core.analyze_image', expect.any(Function));
      // For generate_image: same pattern
      expect(mockRegistry.updateExecutor).toHaveBeenCalledWith('generate_image', expect.any(Function));
      expect(mockRegistry.updateExecutor).toHaveBeenCalledWith('core.generate_image', expect.any(Function));
    });

    it('does not fall back if first updateExecutor succeeds', async () => {
      const mockRegistry = {
        updateExecutor: vi.fn().mockReturnValue(true),
      };
      await registerImageOverrides(mockRegistry as never);

      expect(mockRegistry.updateExecutor).toHaveBeenCalledTimes(2);
      expect(mockRegistry.updateExecutor).toHaveBeenCalledWith('analyze_image', expect.any(Function));
      expect(mockRegistry.updateExecutor).toHaveBeenCalledWith('generate_image', expect.any(Function));
    });

    it('calls ensureImageGenService (upserts config entry)', async () => {
      const mockRegistry = { updateExecutor: vi.fn().mockReturnValue(true) };
      await registerImageOverrides(mockRegistry as never);

      // Give the async ensureImageGenService time to resolve
      await new Promise(r => setTimeout(r, 10));

      expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
        name: 'image_generation',
        displayName: 'Image Generation',
        category: 'ai',
      }));
    });

    it('logs debug if ensureImageGenService upsert fails', async () => {
      mockUpsert.mockRejectedValue(new Error('DB down'));
      const mockRegistry = { updateExecutor: vi.fn().mockReturnValue(true) };
      await registerImageOverrides(mockRegistry as never);

      await new Promise(r => setTimeout(r, 10));

      expect(mockLogDebug).toHaveBeenCalledWith(
        expect.stringContaining('Config upsert for image_generation'),
        expect.stringContaining('DB down'),
      );
    });
  });

  // ==========================================================================
  // Helper functions (tested indirectly via executors)
  // ==========================================================================

  describe('getMimeType (via analyze_image)', () => {
    let analyze: Executor;

    beforeEach(async () => {
      const executors = await captureExecutors();
      analyze = executors['analyze_image']!;
      setupAnalysisProvider();
      createMockProviderInstance();
    });

    it('maps jpg to image/jpeg', async () => {
      const _result = await analyze({ source: 'https://example.com/photo.jpg' }, defaultContext);
      const provider = mockCreateProvider.mock.results[0]!.value;
      const message = provider.complete.mock.calls[0]![0].messages[0];
      expect(message.content[1].mediaType).toBe('image/jpeg');
    });

    it('maps jpeg to image/jpeg', async () => {
      const _result = await analyze({ source: 'https://example.com/photo.jpeg' }, defaultContext);
      const provider = mockCreateProvider.mock.results[0]!.value;
      const message = provider.complete.mock.calls[0]![0].messages[0];
      expect(message.content[1].mediaType).toBe('image/jpeg');
    });

    it('maps png to image/png', async () => {
      await analyze({ source: 'https://example.com/photo.png' }, defaultContext);
      const provider = mockCreateProvider.mock.results[0]!.value;
      const message = provider.complete.mock.calls[0]![0].messages[0];
      expect(message.content[1].mediaType).toBe('image/png');
    });

    it('maps gif to image/gif', async () => {
      await analyze({ source: 'https://example.com/photo.gif' }, defaultContext);
      const provider = mockCreateProvider.mock.results[0]!.value;
      const message = provider.complete.mock.calls[0]![0].messages[0];
      expect(message.content[1].mediaType).toBe('image/gif');
    });

    it('maps webp to image/webp', async () => {
      await analyze({ source: 'https://example.com/photo.webp' }, defaultContext);
      const provider = mockCreateProvider.mock.results[0]!.value;
      const message = provider.complete.mock.calls[0]![0].messages[0];
      expect(message.content[1].mediaType).toBe('image/webp');
    });

    it('returns error for unrecognized extension from URL', async () => {
      // URL with no dot in pathname produces a non-SUPPORTED_FORMATS string
      const result = await analyze({ source: 'https://example.com/image' }, defaultContext);
      expect(result.isError).toBe(true);
      expect(result.content.error).toContain('Unsupported image format');
    });

    it('defaults to image/jpeg when format is truly unknown (invalid URL path)', async () => {
      // A URL with a file that has no extension but format is in SUPPORTED_FORMATS
      // E.g., https://example.com/photo.jpeg?v=2 -> jpeg
      await analyze({ source: 'https://example.com/photo.jpeg?v=2' }, defaultContext);
      const provider = mockCreateProvider.mock.results[0]!.value;
      const message = provider.complete.mock.calls[0]![0].messages[0];
      // The "extension" extracted includes the query param portion after last dot
      // pathname is /photo.jpeg, split('.') gives ['/photo', 'jpeg'], pop() = 'jpeg'
      expect(message.content[1].mediaType).toBe('image/jpeg');
    });
  });

  describe('getFormatFromUrl (via analyze_image)', () => {
    let analyze: Executor;

    beforeEach(async () => {
      const executors = await captureExecutors();
      analyze = executors['analyze_image']!;
      setupAnalysisProvider();
      createMockProviderInstance();
    });

    it('extracts extension from normal URL', async () => {
      await analyze({ source: 'https://example.com/photos/landscape.png' }, defaultContext);
      const provider = mockCreateProvider.mock.results[0]!.value;
      const message = provider.complete.mock.calls[0]![0].messages[0];
      expect(message.content[1].mediaType).toBe('image/png');
    });

    it('extracts extension from URL with query params', async () => {
      await analyze({ source: 'https://example.com/img.webp?w=300&h=200' }, defaultContext);
      const provider = mockCreateProvider.mock.results[0]!.value;
      // webp is in the pathname, query params are separate
      expect(provider.complete).toHaveBeenCalled();
    });

    it('returns error for URL with unrecognized extension-like path', async () => {
      // /api/image -> format is '/api/image' via split('.').pop(), not supported
      const result = await analyze({ source: 'https://example.com/api/image' }, defaultContext);
      expect(result.isError).toBe(true);
      expect(result.content.error).toContain('Unsupported image format');
    });
  });

  describe('buildAnalysisPrompt (via analyze_image)', () => {
    let analyze: Executor;

    beforeEach(async () => {
      const executors = await captureExecutors();
      analyze = executors['analyze_image']!;
      setupAnalysisProvider();
    });

    it('describe + high detail includes "very detailed"', async () => {
      const provider = createMockProviderInstance();
      await analyze({ source: 'https://example.com/img.jpg', task: 'describe', detailLevel: 'high' }, defaultContext);
      const prompt = provider.complete.mock.calls[0]![0].messages[0].content[0].text;
      expect(prompt).toContain('very detailed');
    });

    it('describe + low detail includes "Briefly describe"', async () => {
      const provider = createMockProviderInstance();
      await analyze({ source: 'https://example.com/img.jpg', task: 'describe', detailLevel: 'low' }, defaultContext);
      const prompt = provider.complete.mock.calls[0]![0].messages[0].content[0].text;
      expect(prompt).toContain('Briefly describe');
    });

    it('describe + medium (default) detail includes "composition"', async () => {
      const provider = createMockProviderInstance();
      await analyze({ source: 'https://example.com/img.jpg', task: 'describe', detailLevel: 'medium' }, defaultContext);
      const prompt = provider.complete.mock.calls[0]![0].messages[0].content[0].text;
      expect(prompt).toContain('composition');
    });

    it('describe with no detailLevel defaults to medium', async () => {
      const provider = createMockProviderInstance();
      await analyze({ source: 'https://example.com/img.jpg', task: 'describe' }, defaultContext);
      const prompt = provider.complete.mock.calls[0]![0].messages[0].content[0].text;
      expect(prompt).toContain('composition');
    });

    it('ocr task includes "Extract and transcribe"', async () => {
      const provider = createMockProviderInstance();
      await analyze({ source: 'https://example.com/img.jpg', task: 'ocr' }, defaultContext);
      const prompt = provider.complete.mock.calls[0]![0].messages[0].content[0].text;
      expect(prompt).toContain('Extract and transcribe');
    });

    it('objects task includes "List all distinct objects"', async () => {
      const provider = createMockProviderInstance();
      await analyze({ source: 'https://example.com/img.jpg', task: 'objects' }, defaultContext);
      const prompt = provider.complete.mock.calls[0]![0].messages[0].content[0].text;
      expect(prompt).toContain('List all distinct objects');
    });

    it('faces task includes "Describe any faces"', async () => {
      const provider = createMockProviderInstance();
      await analyze({ source: 'https://example.com/img.jpg', task: 'faces' }, defaultContext);
      const prompt = provider.complete.mock.calls[0]![0].messages[0].content[0].text;
      expect(prompt).toContain('Describe any faces');
    });

    it('colors task includes "color palette"', async () => {
      const provider = createMockProviderInstance();
      await analyze({ source: 'https://example.com/img.jpg', task: 'colors' }, defaultContext);
      const prompt = provider.complete.mock.calls[0]![0].messages[0].content[0].text;
      expect(prompt).toContain('color palette');
    });

    it('custom task with question uses the question as prompt', async () => {
      const provider = createMockProviderInstance();
      await analyze({ source: 'https://example.com/img.jpg', task: 'custom', question: 'How many cats?' }, defaultContext);
      const prompt = provider.complete.mock.calls[0]![0].messages[0].content[0].text;
      expect(prompt).toBe('How many cats?');
    });

    it('custom task without question defaults to "Describe this image."', async () => {
      const provider = createMockProviderInstance();
      await analyze({ source: 'https://example.com/img.jpg', task: 'custom' }, defaultContext);
      const prompt = provider.complete.mock.calls[0]![0].messages[0].content[0].text;
      expect(prompt).toBe('Describe this image.');
    });

    it('unknown task defaults to "Describe this image."', async () => {
      const provider = createMockProviderInstance();
      await analyze({ source: 'https://example.com/img.jpg', task: 'something_else' }, defaultContext);
      const prompt = provider.complete.mock.calls[0]![0].messages[0].content[0].text;
      expect(prompt).toBe('Describe this image.');
    });
  });

  describe('getStyleDescription (via generate_image)', () => {
    let generate: Executor;

    beforeEach(async () => {
      const executors = await captureExecutors();
      generate = executors['generate_image']!;
      setupImageGenConfig();
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh', revised_prompt: 'enhanced' }] }),
        text: async () => '',
      });
      mockFsStat.mockResolvedValue({ size: 1024 });
    });

    it('artistic style appends description', async () => {
      const result = await generate({ prompt: 'A castle', style: 'artistic' }, defaultContext);
      expect(result.content.prompt).toContain('artistic painting style');
    });

    it('cartoon style appends description', async () => {
      const result = await generate({ prompt: 'A castle', style: 'cartoon' }, defaultContext);
      expect(result.content.prompt).toContain('cartoon style');
    });

    it('sketch style appends description', async () => {
      const result = await generate({ prompt: 'A castle', style: 'sketch' }, defaultContext);
      expect(result.content.prompt).toContain('pencil sketch');
    });

    it('digital-art style appends description', async () => {
      const result = await generate({ prompt: 'A castle', style: 'digital-art' }, defaultContext);
      expect(result.content.prompt).toContain('digital art');
    });

    it('3d-render style appends description', async () => {
      const result = await generate({ prompt: 'A castle', style: '3d-render' }, defaultContext);
      expect(result.content.prompt).toContain('3D rendered');
    });

    it('anime style appends description', async () => {
      const result = await generate({ prompt: 'A castle', style: 'anime' }, defaultContext);
      expect(result.content.prompt).toContain('anime style');
    });

    it('photography style appends description', async () => {
      const result = await generate({ prompt: 'A castle', style: 'photography' }, defaultContext);
      expect(result.content.prompt).toContain('professional photography');
    });

    it('realistic style does not enhance prompt', async () => {
      const result = await generate({ prompt: 'A castle', style: 'realistic' }, defaultContext);
      expect(result.content.prompt).toBe('A castle');
      expect(result.content.originalPrompt).toBe('A castle');
    });

    it('unknown style appends empty string (comma only)', async () => {
      const result = await generate({ prompt: 'A castle', style: 'vaporwave' }, defaultContext);
      expect(result.content.prompt).toBe('A castle, ');
    });
  });

  describe('parseSizeToDimensions (via generate_image stability provider)', () => {
    let generate: Executor;

    beforeEach(async () => {
      const executors = await captureExecutors();
      generate = executors['generate_image']!;
      mockFsStat.mockResolvedValue({ size: 1024 });
    });

    it('parses "1024x1024" correctly', async () => {
      setupImageGenConfig({ provider_type: 'stability' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ artifacts: [{ base64: 'aW1hZ2VkYXRh' }] }),
      });

      await generate({ prompt: 'test', size: '1024x1024' }, defaultContext);
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.width).toBe(1024);
      expect(body.height).toBe(1024);
    });

    it('parses "512x768" correctly', async () => {
      setupImageGenConfig({ provider_type: 'stability' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ artifacts: [{ base64: 'aW1hZ2VkYXRh' }] }),
      });

      await generate({ prompt: 'test', size: '512x768' }, defaultContext);
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.width).toBe(512);
      expect(body.height).toBe(768);
    });

    it('defaults to 1024x1024 for invalid size format', async () => {
      setupImageGenConfig({ provider_type: 'stability' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ artifacts: [{ base64: 'aW1hZ2VkYXRh' }] }),
      });

      await generate({ prompt: 'test', size: 'large' }, defaultContext);
      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.width).toBe(1024);
      expect(body.height).toBe(1024);
    });
  });

  describe('getDefaultBaseUrl (via generate_image)', () => {
    let generate: Executor;

    beforeEach(async () => {
      const executors = await captureExecutors();
      generate = executors['generate_image']!;
      mockFsStat.mockResolvedValue({ size: 1024 });
    });

    it('openai provider uses api.openai.com', async () => {
      setupImageGenConfig({ provider_type: 'openai', base_url: '' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
      });

      await generate({ prompt: 'test' }, defaultContext);
      expect(mockFetch.mock.calls[0]![0]).toContain('api.openai.com');
    });

    it('stability provider uses api.stability.ai', async () => {
      setupImageGenConfig({ provider_type: 'stability', base_url: '' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ artifacts: [{ base64: 'aW1hZ2VkYXRh' }] }),
      });

      await generate({ prompt: 'test' }, defaultContext);
      expect(mockFetch.mock.calls[0]![0]).toContain('api.stability.ai');
    });

    it('fal provider uses fal.run', async () => {
      setupImageGenConfig({ provider_type: 'fal', base_url: '' });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ images: [{ url: 'https://fal.run/output/img.png' }] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(8),
        });

      await generate({ prompt: 'test' }, defaultContext);
      expect(mockFetch.mock.calls[0]![0]).toContain('fal.run');
    });

    it('replicate provider uses api.replicate.com', async () => {
      setupImageGenConfig({ provider_type: 'replicate', base_url: '' });
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ output: ['https://replicate.delivery/img.png'] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => new ArrayBuffer(8),
        });

      await generate({ prompt: 'test' }, defaultContext);
      expect(mockFetch.mock.calls[0]![0]).toContain('api.replicate.com');
    });

    it('unknown provider defaults to api.openai.com', async () => {
      setupImageGenConfig({ provider_type: 'custom-provider', base_url: '' });
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
      });

      await generate({ prompt: 'test' }, defaultContext);
      expect(mockFetch.mock.calls[0]![0]).toContain('api.openai.com');
    });
  });

  // ==========================================================================
  // analyzeImageOverride
  // ==========================================================================

  describe('analyzeImageOverride', () => {
    let analyze: Executor;

    beforeEach(async () => {
      const executors = await captureExecutors();
      analyze = executors['analyze_image']!;
    });

    // --- URL source ---

    describe('URL source', () => {
      it('passes URL as imageBase64 with isUrl=true', async () => {
        setupAnalysisProvider();
        const provider = createMockProviderInstance();

        await analyze({ source: 'https://example.com/photo.jpg' }, defaultContext);

        const message = provider.complete.mock.calls[0]![0].messages[0];
        expect(message.content[1].data).toBe('https://example.com/photo.jpg');
        expect(message.content[1].isUrl).toBe(true);
      });

      it('returns error for URL with unrecognized format', async () => {
        setupAnalysisProvider();

        const result = await analyze({ source: 'https://example.com/image' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Unsupported image format');
      });

      it('returns error for unsupported URL format (e.g. bmp)', async () => {
        setupAnalysisProvider();

        const result = await analyze({ source: 'https://example.com/photo.bmp' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Unsupported image format: bmp');
        expect(result.content.supportedFormats).toEqual(['jpg', 'jpeg', 'png', 'gif', 'webp']);
      });

      it('handles http:// URLs (not just https://)', async () => {
        setupAnalysisProvider();
        const provider = createMockProviderInstance();

        const result = await analyze({ source: 'http://example.com/photo.png' }, defaultContext);
        expect(result.isError).toBeFalsy();
        expect(provider.complete).toHaveBeenCalled();
      });
    });

    // --- Base64 source ---

    describe('base64 data URI source', () => {
      it('parses valid data URI correctly', async () => {
        setupAnalysisProvider();
        const provider = createMockProviderInstance();

        const result = await analyze({
          source: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
        }, defaultContext);

        expect(result.isError).toBeFalsy();
        const message = provider.complete.mock.calls[0]![0].messages[0];
        expect(message.content[1].data).toBe('iVBORw0KGgoAAAANSUhEUg==');
        expect(message.content[1].mediaType).toBe('image/png');
        expect(message.content[1].isUrl).toBe(false);
      });

      it('returns error for invalid data URI', async () => {
        const result = await analyze({ source: 'data:image/invalid-format' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toBe('Invalid base64 image data');
      });

      it('handles jpeg data URI', async () => {
        setupAnalysisProvider();
        const provider = createMockProviderInstance();

        await analyze({ source: 'data:image/jpeg;base64,/9j/4AAQ==' }, defaultContext);
        const message = provider.complete.mock.calls[0]![0].messages[0];
        expect(message.content[1].mediaType).toBe('image/jpeg');
      });
    });

    // --- File source ---

    describe('file source', () => {
      it('reads file and encodes as base64', async () => {
        setupAnalysisProvider();
        const provider = createMockProviderInstance();
        mockFsStat.mockResolvedValue({ size: 5000 });
        mockFsReadFile.mockResolvedValue(Buffer.from('fake-image-data'));

        const result = await analyze({ source: '/workspace/photo.png' }, defaultContext);

        expect(result.isError).toBeFalsy();
        expect(mockFsStat).toHaveBeenCalledWith('/workspace/photo.png');
        expect(mockFsReadFile).toHaveBeenCalledWith('/workspace/photo.png');
        const message = provider.complete.mock.calls[0]![0].messages[0];
        expect(message.content[1].data).toBe(Buffer.from('fake-image-data').toString('base64'));
        expect(message.content[1].mediaType).toBe('image/png');
      });

      it('returns error when file not found', async () => {
        mockFsStat.mockRejectedValue(new Error('ENOENT'));

        const result = await analyze({ source: '/workspace/missing.jpg' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Image file not found');
      });

      it('returns error when file is too large (>10MB)', async () => {
        mockFsStat.mockResolvedValue({ size: 11 * 1024 * 1024 });

        const result = await analyze({ source: '/workspace/huge.jpg' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Image too large');
        expect(result.content.error).toContain('10MB');
      });

      it('returns error for unsupported file extension', async () => {
        mockFsStat.mockResolvedValue({ size: 5000 });

        const result = await analyze({ source: '/workspace/image.tiff' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Unsupported image format: tiff');
      });

      it('accepts file with .jpg extension', async () => {
        setupAnalysisProvider();
        createMockProviderInstance();
        mockFsStat.mockResolvedValue({ size: 5000 });
        mockFsReadFile.mockResolvedValue(Buffer.from('jpg-data'));

        const result = await analyze({ source: '/workspace/photo.jpg' }, defaultContext);
        expect(result.isError).toBeFalsy();
      });

      it('accepts file with .webp extension', async () => {
        setupAnalysisProvider();
        createMockProviderInstance();
        mockFsStat.mockResolvedValue({ size: 5000 });
        mockFsReadFile.mockResolvedValue(Buffer.from('webp-data'));

        const result = await analyze({ source: '/workspace/photo.webp' }, defaultContext);
        expect(result.isError).toBeFalsy();
      });
    });

    // --- Provider resolution ---

    describe('provider resolution', () => {
      it('returns error when no provider configured', async () => {
        mockResolveProviderAndModel.mockResolvedValue({ provider: null, model: null });

        const result = await analyze({ source: 'https://example.com/img.jpg' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('No AI provider configured');
      });

      it('returns error when no API key configured', async () => {
        mockResolveProviderAndModel.mockResolvedValue({ provider: 'openai', model: 'gpt-4o' });
        mockGetProviderApiKey.mockResolvedValue(null);

        const result = await analyze({ source: 'https://example.com/img.jpg' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('API key not configured');
        expect(result.content.error).toContain('openai');
      });

      it('uses native provider type for NATIVE_PROVIDERS', async () => {
        setupAnalysisProvider('anthropic', 'claude-3.5-sonnet');
        createMockProviderInstance();

        await analyze({ source: 'https://example.com/img.jpg' }, defaultContext);

        expect(mockCreateProvider).toHaveBeenCalledWith(expect.objectContaining({
          provider: 'anthropic',
        }));
      });

      it('falls back to openai for non-native providers', async () => {
        setupAnalysisProvider('custom-llm', 'custom-model');
        createMockProviderInstance();

        await analyze({ source: 'https://example.com/img.jpg' }, defaultContext);

        expect(mockCreateProvider).toHaveBeenCalledWith(expect.objectContaining({
          provider: 'openai',
        }));
      });

      it('passes baseUrl from loadProviderConfig', async () => {
        mockResolveProviderAndModel.mockResolvedValue({ provider: 'openai', model: 'gpt-4o' });
        mockGetProviderApiKey.mockResolvedValue('sk-key');
        mockLoadProviderConfig.mockReturnValue({ baseUrl: 'https://custom.api.com' });
        createMockProviderInstance();

        await analyze({ source: 'https://example.com/img.jpg' }, defaultContext);

        expect(mockCreateProvider).toHaveBeenCalledWith(expect.objectContaining({
          baseUrl: 'https://custom.api.com',
        }));
      });
    });

    // --- Vision API call ---

    describe('vision API call', () => {
      it('calls provider.complete with correct message structure', async () => {
        setupAnalysisProvider('openai', 'gpt-4o');
        const provider = createMockProviderInstance();

        await analyze({
          source: 'https://example.com/img.jpg',
          task: 'describe',
          detailLevel: 'high',
          maxTokens: 4096,
        }, defaultContext);

        expect(provider.complete).toHaveBeenCalledWith({
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: expect.stringContaining('very detailed') },
              { type: 'image', data: 'https://example.com/img.jpg', mediaType: 'image/jpeg', isUrl: true },
            ],
          }],
          model: {
            model: 'gpt-4o',
            maxTokens: 4096,
            temperature: 0.3,
          },
        });
      });

      it('defaults model to gpt-4o when resolvedModel is null', async () => {
        mockResolveProviderAndModel.mockResolvedValue({ provider: 'openai', model: null });
        mockGetProviderApiKey.mockResolvedValue('sk-key');
        mockLoadProviderConfig.mockReturnValue({});
        const provider = createMockProviderInstance();

        await analyze({ source: 'https://example.com/img.jpg' }, defaultContext);

        expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
          model: expect.objectContaining({ model: 'gpt-4o' }),
        }));
      });

      it('returns error when vision API fails', async () => {
        setupAnalysisProvider();
        const provider = {
          complete: vi.fn().mockResolvedValue({
            ok: false,
            error: { message: 'Rate limit exceeded' },
          }),
        };
        mockCreateProvider.mockReturnValue(provider);

        const result = await analyze({ source: 'https://example.com/img.jpg' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Vision API error');
        expect(result.content.error).toContain('Rate limit exceeded');
      });

      it('returns success result with expected fields', async () => {
        setupAnalysisProvider('openai', 'gpt-4o');
        createMockProviderInstance('A beautiful landscape with mountains');

        const result = await analyze({
          source: 'https://example.com/img.jpg',
          task: 'describe',
          detailLevel: 'medium',
        }, defaultContext);

        expect(result.isError).toBe(false);
        expect(result.content).toEqual({
          success: true,
          analysis: 'A beautiful landscape with mountains',
          task: 'describe',
          detailLevel: 'medium',
          provider: 'openai',
          model: 'gpt-4o',
        });
      });

      it('defaults task to "describe" and detailLevel to "medium"', async () => {
        setupAnalysisProvider();
        createMockProviderInstance('Some analysis');

        const result = await analyze({ source: 'https://example.com/img.jpg' }, defaultContext);

        expect(result.isError).toBe(false);
        expect(result.content.task).toBe('describe');
        expect(result.content.detailLevel).toBe('medium');
      });

      it('defaults maxTokens to 2048', async () => {
        setupAnalysisProvider();
        const provider = createMockProviderInstance();

        await analyze({ source: 'https://example.com/img.jpg' }, defaultContext);

        expect(provider.complete).toHaveBeenCalledWith(expect.objectContaining({
          model: expect.objectContaining({ maxTokens: 2048 }),
        }));
      });
    });

    // --- Error handling ---

    describe('error handling', () => {
      it('catches thrown errors and returns error result', async () => {
        setupAnalysisProvider();
        mockCreateProvider.mockImplementation(() => {
          throw new Error('Provider creation failed');
        });

        const result = await analyze({ source: 'https://example.com/img.jpg' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Failed to analyze image');
        expect(result.content.error).toContain('Provider creation failed');
      });

      it('catches async errors from provider.complete', async () => {
        setupAnalysisProvider();
        const provider = {
          complete: vi.fn().mockRejectedValue(new Error('Network timeout')),
        };
        mockCreateProvider.mockReturnValue(provider);

        const result = await analyze({ source: 'https://example.com/img.jpg' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Failed to analyze image');
        expect(result.content.error).toContain('Network timeout');
      });
    });
  });

  // ==========================================================================
  // generateImageOverride
  // ==========================================================================

  describe('generateImageOverride', () => {
    let generate: Executor;

    beforeEach(async () => {
      const executors = await captureExecutors();
      generate = executors['generate_image']!;
    });

    // --- Prompt validation ---

    describe('prompt validation', () => {
      it('returns error for empty prompt', async () => {
        const result = await generate({ prompt: '' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Prompt is required');
      });

      it('returns error for whitespace-only prompt', async () => {
        const result = await generate({ prompt: '   ' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Prompt is required');
      });

      it('returns error for undefined prompt', async () => {
        const result = await generate({ prompt: undefined }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Prompt is required');
      });

      it('returns error for prompt > 4000 chars', async () => {
        const longPrompt = 'a'.repeat(4001);
        const result = await generate({ prompt: longPrompt }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Prompt too long');
        expect(result.content.error).toContain('4000');
      });

      it('accepts prompt at exactly 4000 chars', async () => {
        setupImageGenConfig();
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });
        mockFsStat.mockResolvedValue({ size: 1024 });

        const result = await generate({ prompt: 'a'.repeat(4000) }, defaultContext);
        expect(result.isError).toBeFalsy();
      });
    });

    // --- Config Center ---

    describe('config center', () => {
      it('returns error when no provider_type configured', async () => {
        mockGetFieldValue.mockReturnValue(undefined);

        const result = await generate({ prompt: 'A castle' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Image generation not configured');
        expect(result.content.error).toContain('Config Center');
      });

      it('returns error when no api_key configured', async () => {
        setupImageGenConfig({ api_key: undefined });

        const result = await generate({ prompt: 'A castle' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Image generation not configured');
      });

      it('returns error when provider_type is empty string', async () => {
        setupImageGenConfig({ provider_type: '' });

        const result = await generate({ prompt: 'A castle' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Image generation not configured');
      });

      it('uses custom base_url when provided', async () => {
        setupImageGenConfig({ base_url: 'https://my-custom-api.com' });
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });
        mockFsStat.mockResolvedValue({ size: 1024 });

        await generate({ prompt: 'test' }, defaultContext);
        expect(mockFetch.mock.calls[0]![0]).toContain('my-custom-api.com');
      });
    });

    // --- OpenAI provider ---

    describe('OpenAI provider', () => {
      beforeEach(() => {
        setupImageGenConfig({ provider_type: 'openai' });
        mockFsStat.mockResolvedValue({ size: 1024 });
      });

      it('calls correct API endpoint', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'A castle' }, defaultContext);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/v1/images/generations'),
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Authorization': 'Bearer sk-test-key',
              'Content-Type': 'application/json',
            }),
          }),
        );
      });

      it('passes correct body parameters', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'A castle', size: '512x512', quality: 'hd', n: 2 }, defaultContext);

        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.prompt).toBe('A castle');
        expect(body.model).toBe('dall-e-3');
        expect(body.size).toBe('512x512');
        expect(body.quality).toBe('hd');
        expect(body.n).toBe(2);
        expect(body.response_format).toBe('b64_json');
      });

      it('saves base64 result to file', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh', revised_prompt: 'enhanced castle' }] }),
        });

        const result = await generate({ prompt: 'A castle' }, defaultContext);

        expect(result.isError).toBeFalsy();
        expect(result.content.success).toBe(true);
        expect(mockFsWriteFile).toHaveBeenCalled();
        expect(result.content.images).toHaveLength(1);
        expect(result.content.images[0].revisedPrompt).toBe('enhanced castle');
      });

      it('throws on API error', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 429,
          text: async () => 'Rate limit exceeded',
        });

        const result = await generate({ prompt: 'A castle' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('OpenAI Image API 429');
      });
    });

    // --- openai-compatible provider ---

    describe('openai-compatible provider', () => {
      it('uses same code path as openai', async () => {
        setupImageGenConfig({ provider_type: 'openai-compatible', base_url: 'https://custom.api.com' });
        mockFsStat.mockResolvedValue({ size: 1024 });
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        const result = await generate({ prompt: 'A castle' }, defaultContext);
        expect(result.isError).toBeFalsy();
        expect(mockFetch.mock.calls[0]![0]).toContain('custom.api.com/v1/images/generations');
      });
    });

    // --- Stability provider ---

    describe('Stability provider', () => {
      beforeEach(() => {
        setupImageGenConfig({ provider_type: 'stability' });
        mockFsStat.mockResolvedValue({ size: 1024 });
      });

      it('calls correct API endpoint with engine ID', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ artifacts: [{ base64: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'A castle' }, defaultContext);

        expect(mockFetch.mock.calls[0]![0]).toContain('/v1/generation/dall-e-3/text-to-image');
      });

      it('uses default engine when model not configured', async () => {
        setupImageGenConfig({ provider_type: 'stability', model: '' });
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ artifacts: [{ base64: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'A castle' }, defaultContext);

        expect(mockFetch.mock.calls[0]![0]).toContain('stable-diffusion-xl-1024-v1-0');
      });

      it('passes width, height and text_prompts in body', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ artifacts: [{ base64: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'A castle', size: '768x512' }, defaultContext);

        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.text_prompts).toEqual([{ text: 'A castle', weight: 1 }]);
        expect(body.width).toBe(768);
        expect(body.height).toBe(512);
        expect(body.cfg_scale).toBe(7);
        expect(body.steps).toBe(30);
      });

      it('includes Accept: application/json header', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ artifacts: [{ base64: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'test' }, defaultContext);
        expect(mockFetch.mock.calls[0]![1].headers['Accept']).toBe('application/json');
      });

      it('throws on API error', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 500,
          text: async () => 'Internal error',
        });

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Stability API 500');
      });
    });

    // --- FAL provider ---

    describe('FAL provider', () => {
      beforeEach(() => {
        setupImageGenConfig({ provider_type: 'fal' });
        mockFsStat.mockResolvedValue({ size: 1024 });
      });

      it('calls correct API endpoint with model', async () => {
        setupImageGenConfig({ provider_type: 'fal', model: 'fal-ai/flux-pro' });
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ images: [{ url: 'https://fal.run/out/img.png' }] }),
          })
          .mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(8),
          });

        await generate({ prompt: 'test' }, defaultContext);

        expect(mockFetch.mock.calls[0]![0]).toContain('fal-ai/flux-pro');
      });

      it('uses Key authorization header', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ images: [{ url: 'https://fal.run/out/img.png' }] }),
          })
          .mockResolvedValueOnce({
            ok: true,
            arrayBuffer: async () => new ArrayBuffer(8),
          });

        await generate({ prompt: 'test' }, defaultContext);

        expect(mockFetch.mock.calls[0]![1].headers['Authorization']).toBe('Key sk-test-key');
      });

      it('downloads URL images to base64', async () => {
        const imageBuffer = new ArrayBuffer(16);
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ images: [{ url: 'https://fal.run/out/img1.png' }, { url: 'https://fal.run/out/img2.png' }] }),
          })
          .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => imageBuffer })
          .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => imageBuffer });

        const result = await generate({ prompt: 'test', n: 2 }, defaultContext);
        expect(result.isError).toBeFalsy();
        // First call is the generation API, next 2 are image downloads
        expect(mockFetch).toHaveBeenCalledTimes(3);
        expect(mockFetch).toHaveBeenCalledWith('https://fal.run/out/img1.png');
        expect(mockFetch).toHaveBeenCalledWith('https://fal.run/out/img2.png');
      });

      it('passes image_size and num_images in body', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ images: [{ url: 'https://fal.run/out/img.png' }] }),
          })
          .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

        await generate({ prompt: 'test', size: '1024x768', n: 3 }, defaultContext);

        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.image_size).toBe('1024x768');
        expect(body.num_images).toBe(3);
      });

      it('uses default model fal-ai/flux-pro when model not set', async () => {
        setupImageGenConfig({ provider_type: 'fal', model: '' });
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ images: [{ url: 'https://fal.run/out/img.png' }] }),
          })
          .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

        await generate({ prompt: 'test' }, defaultContext);
        expect(mockFetch.mock.calls[0]![0]).toContain('fal-ai/flux-pro');
      });

      it('throws on API error', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 403,
          text: async () => 'Forbidden',
        });

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('FAL API 403');
      });
    });

    // --- Replicate provider ---

    describe('Replicate provider', () => {
      beforeEach(() => {
        setupImageGenConfig({ provider_type: 'replicate' });
        mockFsStat.mockResolvedValue({ size: 1024 });
      });

      it('calls /v1/predictions endpoint', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ output: ['https://replicate.delivery/img.png'] }),
          })
          .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

        await generate({ prompt: 'test' }, defaultContext);

        expect(mockFetch.mock.calls[0]![0]).toContain('/v1/predictions');
      });

      it('includes Prefer: wait header', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ output: ['https://replicate.delivery/img.png'] }),
          })
          .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

        await generate({ prompt: 'test' }, defaultContext);

        expect(mockFetch.mock.calls[0]![1].headers['Prefer']).toBe('wait');
      });

      it('passes model, width, height and num_outputs in body', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ output: ['https://replicate.delivery/img.png'] }),
          })
          .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

        await generate({ prompt: 'test', size: '768x512', n: 2 }, defaultContext);

        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.model).toBe('dall-e-3');
        expect(body.input.prompt).toBe('test');
        expect(body.input.width).toBe(768);
        expect(body.input.height).toBe(512);
        expect(body.input.num_outputs).toBe(2);
      });

      it('uses default model when not configured', async () => {
        setupImageGenConfig({ provider_type: 'replicate', model: '' });
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ output: ['https://replicate.delivery/img.png'] }),
          })
          .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

        await generate({ prompt: 'test' }, defaultContext);

        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.model).toBe('black-forest-labs/flux-schnell');
      });

      it('downloads output URLs to base64', async () => {
        mockFetch
          .mockResolvedValueOnce({
            ok: true,
            json: async () => ({ output: ['https://replicate.delivery/img1.png', 'https://replicate.delivery/img2.png'] }),
          })
          .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })
          .mockResolvedValueOnce({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) });

        const result = await generate({ prompt: 'test', n: 2 }, defaultContext);
        expect(result.isError).toBeFalsy();
        expect(mockFetch).toHaveBeenCalledWith('https://replicate.delivery/img1.png');
        expect(mockFetch).toHaveBeenCalledWith('https://replicate.delivery/img2.png');
      });

      it('handles null output gracefully', async () => {
        mockFetch.mockResolvedValueOnce({
          ok: true,
          json: async () => ({ output: null }),
        });

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('No images generated');
      });

      it('throws on API error', async () => {
        mockFetch.mockResolvedValue({
          ok: false,
          status: 401,
          text: async () => 'Unauthorized',
        });

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Replicate API 401');
      });
    });

    // --- Default/unknown provider ---

    describe('default/unknown provider', () => {
      it('uses OpenAI-compatible API for unknown provider_type', async () => {
        setupImageGenConfig({ provider_type: 'some-other-provider' });
        mockFsStat.mockResolvedValue({ size: 1024 });
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.isError).toBeFalsy();
        expect(mockFetch.mock.calls[0]![0]).toContain('/v1/images/generations');
      });
    });

    // --- n clamping ---

    describe('n parameter clamping', () => {
      beforeEach(() => {
        setupImageGenConfig();
        mockFsStat.mockResolvedValue({ size: 1024 });
      });

      it('clamps n below 1 to 1', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'test', n: 0 }, defaultContext);
        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.n).toBe(1);
      });

      it('clamps negative n to 1', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'test', n: -5 }, defaultContext);
        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.n).toBe(1);
      });

      it('clamps n above 4 to 4', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              { b64_json: 'aW1hZ2VkYXRh' },
              { b64_json: 'aW1hZ2VkYXRh' },
              { b64_json: 'aW1hZ2VkYXRh' },
              { b64_json: 'aW1hZ2VkYXRh' },
            ],
          }),
        });

        await generate({ prompt: 'test', n: 10 }, defaultContext);
        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.n).toBe(4);
      });

      it('keeps valid n as-is', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              { b64_json: 'aW1hZ2VkYXRh' },
              { b64_json: 'aW1hZ2VkYXRh' },
              { b64_json: 'aW1hZ2VkYXRh' },
            ],
          }),
        });

        await generate({ prompt: 'test', n: 3 }, defaultContext);
        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.n).toBe(3);
      });

      it('defaults undefined n to 1', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'test' }, defaultContext);
        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.n).toBe(1);
      });
    });

    // --- File saving ---

    describe('file saving', () => {
      beforeEach(() => {
        setupImageGenConfig();
        mockFsStat.mockResolvedValue({ size: 1024 });
      });

      it('creates generated_images directory under workspace', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'test' }, defaultContext);

        expect(mockFsMkdir).toHaveBeenCalledWith('/workspace/generated_images', { recursive: true });
      });

      it('uses outputPath for single image when provided', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'test', outputPath: '/workspace/my-image.png' }, defaultContext);

        // writeFile should be called with the custom output path
        expect(mockFsWriteFile).toHaveBeenCalledWith(
          '/workspace/my-image.png',
          expect.any(Buffer),
        );
      });

      it('ignores outputPath for multiple images (n>1)', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({
            data: [
              { b64_json: 'aW1hZ2VkYXRh' },
              { b64_json: 'aW1hZ2VkYXRh' },
            ],
          }),
        });

        await generate({ prompt: 'test', n: 2, outputPath: '/workspace/single.png' }, defaultContext);

        // With n=2, outputPath is ignored, auto-generated names used
        const calls = mockFsWriteFile.mock.calls;
        expect(calls).toHaveLength(2);
        expect(calls[0]![0]).toContain('generated_images/image_');
        expect(calls[1]![0]).toContain('generated_images/image_');
      });

      it('creates directory for outputPath parent', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'test', outputPath: '/workspace/subdir/img.png' }, defaultContext);

        // mkdir should be called for the dirname of outputPath
        expect(mockFsMkdir).toHaveBeenCalledWith('/workspace/subdir', { recursive: true });
      });

      it('generates markdown with relative paths', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.content.markdown).toContain('![Generated image]');
        expect(result.content.markdown).toContain('generated_images/image_');
      });

      it('uses "." as workDir when workspaceDir not in context', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        await generate({ prompt: 'test' }, {});

        expect(mockFsMkdir).toHaveBeenCalledWith('./generated_images', { recursive: true });
      });
    });

    // --- Return value ---

    describe('return value', () => {
      beforeEach(() => {
        setupImageGenConfig();
        mockFsStat.mockResolvedValue({ size: 2048 });
      });

      it('returns success with all expected fields', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh', revised_prompt: 'better castle' }] }),
        });

        const result = await generate({ prompt: 'A castle', style: 'artistic', size: '512x512' }, defaultContext);

        expect(result.isError).toBe(false);
        expect(result.content.success).toBe(true);
        expect(result.content.originalPrompt).toBe('A castle');
        expect(result.content.prompt).toContain('artistic painting');
        expect(result.content.style).toBe('artistic');
        expect(result.content.size).toBe('512x512');
        expect(result.content.provider).toBe('openai');
        expect(result.content.model).toBe('dall-e-3');
        expect(result.content.markdown).toBeDefined();
        expect(result.content.images).toHaveLength(1);
        expect(result.content.images[0].path).toBeDefined();
        expect(result.content.images[0].size).toBe(2048);
        expect(result.content.images[0].revisedPrompt).toBe('better castle');
      });

      it('returns "default" model when model not configured', async () => {
        // Override getFieldValue to return undefined for model specifically
        mockGetFieldValue.mockImplementation((_service: string, field: string) => {
          const vals: Record<string, string | undefined> = {
            provider_type: 'openai',
            api_key: 'sk-test-key',
            base_url: '',
            model: undefined,
          };
          return vals[field];
        });
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.content.model).toBe('default');
      });

      it('returns error when no images returned', async () => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [] }),
        });

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('No images generated');
      });
    });

    // --- Style enhancement ---

    describe('style enhancement', () => {
      beforeEach(() => {
        setupImageGenConfig();
        mockFsStat.mockResolvedValue({ size: 1024 });
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });
      });

      it('does not modify prompt for realistic style', async () => {
        const result = await generate({ prompt: 'A mountain', style: 'realistic' }, defaultContext);
        expect(result.content.prompt).toBe('A mountain');
      });

      it('appends style description for non-realistic style', async () => {
        const result = await generate({ prompt: 'A mountain', style: 'anime' }, defaultContext);
        expect(result.content.prompt).toBe('A mountain, anime style, Japanese animation, cel-shaded');
      });

      it('defaults to realistic style when not provided', async () => {
        const result = await generate({ prompt: 'A mountain' }, defaultContext);
        expect(result.content.prompt).toBe('A mountain');
      });
    });

    // --- Error handling ---

    describe('error handling', () => {
      it('catches fetch throws and returns error result', async () => {
        setupImageGenConfig();
        mockFetch.mockRejectedValue(new Error('Network failure'));

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Failed to generate image');
        expect(result.content.error).toContain('Network failure');
      });

      it('catches fs operation errors and returns error result', async () => {
        setupImageGenConfig();
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });
        mockFsMkdir.mockRejectedValue(new Error('Permission denied'));

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Failed to generate image');
        expect(result.content.error).toContain('Permission denied');
      });

      it('catches writeFile error and returns error result', async () => {
        setupImageGenConfig();
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });
        mockFsWriteFile.mockRejectedValue(new Error('Disk full'));

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Failed to generate image');
        expect(result.content.error).toContain('Disk full');
      });

      it('handles configServicesRepo.getFieldValue throwing', async () => {
        mockGetFieldValue.mockImplementation(() => { throw new Error('DB connection lost'); });

        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.isError).toBe(true);
        expect(result.content.error).toContain('Failed to generate image');
        expect(result.content.error).toContain('DB connection lost');
      });
    });

    // --- Default values ---

    describe('default values', () => {
      beforeEach(() => {
        setupImageGenConfig();
        mockFsStat.mockResolvedValue({ size: 1024 });
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => ({ data: [{ b64_json: 'aW1hZ2VkYXRh' }] }),
        });
      });

      it('defaults style to realistic', async () => {
        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.content.style).toBe('realistic');
      });

      it('defaults size to 1024x1024', async () => {
        const result = await generate({ prompt: 'test' }, defaultContext);
        expect(result.content.size).toBe('1024x1024');
      });

      it('defaults quality to standard', async () => {
        await generate({ prompt: 'test' }, defaultContext);
        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.quality).toBe('standard');
      });

      it('defaults n to 1', async () => {
        await generate({ prompt: 'test' }, defaultContext);
        const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
        expect(body.n).toBe(1);
      });
    });
  });
});
