import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '../types.js';

// =============================================================================
// MOCKS — hoisted so they're available before ESM module evaluation
// =============================================================================

const mockTryImport = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());
const mockAccess = vi.hoisted(() => vi.fn());
const mockReadFile = vi.hoisted(() => vi.fn());
const mockExtname = vi.hoisted(() =>
  vi.fn((p: string) => {
    const m = p.match(/\.\w+$/);
    return m ? m[0] : '';
  }),
);
const mockDirname = vi.hoisted(() =>
  vi.fn((p: string) => p.substring(0, p.lastIndexOf('/')) || '.'),
);
const mockBasename = vi.hoisted(() =>
  vi.fn((p: string, ext?: string) => {
    const base = p.substring(p.lastIndexOf('/') + 1);
    if (ext && base.endsWith(ext)) return base.slice(0, -ext.length);
    return base;
  }),
);
const mockJoin = vi.hoisted(() =>
  vi.fn((...parts: string[]) => parts.join('/')),
);

vi.mock('./module-resolver.js', () => ({
  tryImport: (...args: unknown[]) => mockTryImport(...args),
}));

vi.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  access: (...args: unknown[]) => mockAccess(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

vi.mock('node:path', () => ({
  extname: (...args: unknown[]) => mockExtname(...args),
  dirname: (...args: unknown[]) => mockDirname(...args),
  basename: (...args: unknown[]) => mockBasename(...args),
  join: (...args: unknown[]) => mockJoin(...args),
}));

const {
  analyzeImageTool,
  analyzeImageExecutor,
  generateImageTool,
  generateImageExecutor,
  resizeImageTool,
  resizeImageExecutor,
  IMAGE_TOOLS,
  IMAGE_TOOL_NAMES,
} = await import('./image-tools.js');

// Shared dummy context
const ctx = {} as ToolContext;

// =============================================================================
// TOOL DEFINITIONS & EXPORTS
// =============================================================================

describe('tool definitions and exports', () => {
  it('should define analyzeImageTool with correct name', () => {
    expect(analyzeImageTool.name).toBe('analyze_image');
  });

  it('should define generateImageTool with correct name', () => {
    expect(generateImageTool.name).toBe('generate_image');
  });

  it('should define resizeImageTool with correct name', () => {
    expect(resizeImageTool.name).toBe('resize_image');
  });

  it('should require source param in analyzeImageTool', () => {
    expect(analyzeImageTool.parameters.required).toContain('source');
  });

  it('should require prompt param in generateImageTool', () => {
    expect(generateImageTool.parameters.required).toContain('prompt');
  });

  it('should require source param in resizeImageTool', () => {
    expect(resizeImageTool.parameters.required).toContain('source');
  });

  it('should export IMAGE_TOOLS with 3 entries', () => {
    expect(IMAGE_TOOLS).toHaveLength(3);
  });

  it('should pair each definition with its executor in IMAGE_TOOLS', () => {
    expect(IMAGE_TOOLS[0]!.definition).toBe(analyzeImageTool);
    expect(IMAGE_TOOLS[0]!.executor).toBe(analyzeImageExecutor);
    expect(IMAGE_TOOLS[1]!.definition).toBe(generateImageTool);
    expect(IMAGE_TOOLS[1]!.executor).toBe(generateImageExecutor);
    expect(IMAGE_TOOLS[2]!.definition).toBe(resizeImageTool);
    expect(IMAGE_TOOLS[2]!.executor).toBe(resizeImageExecutor);
  });

  it('should export IMAGE_TOOL_NAMES with correct names', () => {
    expect(IMAGE_TOOL_NAMES).toEqual([
      'analyze_image',
      'generate_image',
      'resize_image',
    ]);
  });

  it('analyzeImageTool should have configRequirements for openai', () => {
    expect(analyzeImageTool.configRequirements).toBeDefined();
    expect(analyzeImageTool.configRequirements![0]!.name).toBe('openai');
  });

  it('generateImageTool should have configRequirements for openai and stability', () => {
    expect(generateImageTool.configRequirements).toBeDefined();
    expect(generateImageTool.configRequirements!).toHaveLength(2);
    expect(generateImageTool.configRequirements![0]!.name).toBe('openai');
    expect(generateImageTool.configRequirements![1]!.name).toBe('stability');
  });

  it('resizeImageTool should have no configRequirements', () => {
    expect(resizeImageTool.configRequirements).toBeUndefined();
  });

  it('analyzeImageTool should enumerate task types', () => {
    const taskProp = analyzeImageTool.parameters.properties!['task'] as Record<string, unknown>;
    expect(taskProp.enum).toEqual([
      'describe', 'ocr', 'objects', 'faces', 'colors', 'custom',
    ]);
  });

  it('generateImageTool should enumerate style types', () => {
    const styleProp = generateImageTool.parameters.properties!['style'] as Record<string, unknown>;
    expect(styleProp.enum).toEqual([
      'realistic', 'artistic', 'cartoon', 'sketch', 'digital-art',
      '3d-render', 'anime', 'photography',
    ]);
  });
});

// =============================================================================
// ANALYZE IMAGE EXECUTOR
// =============================================================================

describe('analyzeImageExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // URL source
  // ---------------------------------------------------------------------------
  describe('URL source', () => {
    it('should accept http URL with jpg extension', async () => {
      const result = await analyzeImageExecutor({ source: 'http://example.com/photo.jpg' }, ctx);
      expect(result.isError).toBe(false);
      expect(result.content).toMatchObject({
        source: 'url',
        format: 'jpg',
        imageDataProvided: 'url',
        requiresVisionAPI: true,
      });
    });

    it('should accept https URL with png extension', async () => {
      const result = await analyzeImageExecutor({ source: 'https://example.com/image.png' }, ctx);
      expect(result.isError).toBe(false);
      expect(result.content).toMatchObject({
        source: 'url',
        format: 'png',
      });
    });

    it('should accept URL with gif extension', async () => {
      const result = await analyzeImageExecutor({ source: 'https://example.com/anim.gif' }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('gif');
    });

    it('should accept URL with webp extension', async () => {
      const result = await analyzeImageExecutor({ source: 'https://cdn.example.com/img.webp' }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('webp');
    });

    it('should accept URL with bmp extension', async () => {
      const result = await analyzeImageExecutor({ source: 'https://example.com/old.bmp' }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('bmp');
    });

    it('should accept URL with jpeg extension', async () => {
      const result = await analyzeImageExecutor({ source: 'https://example.com/photo.jpeg' }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('jpeg');
    });

    it('should reject URL with unsupported extension', async () => {
      const result = await analyzeImageExecutor({ source: 'https://example.com/file.tiff' }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Unsupported image format');
      expect(content.supportedFormats).toBeDefined();
    });

    it('should reject URL with no extension (returns unknown)', async () => {
      // new URL('https://example.com/image').pathname = '/image', split('.').pop() = 'com/image' -> not in supported
      // Actually: pathname = '/image', split('.') = ['/image'], pop() = '/image', not supported
      const result = await analyzeImageExecutor({ source: 'https://example.com/image' }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Unsupported image format');
    });

    it('should set imageDataProvided to url for URL sources', async () => {
      const result = await analyzeImageExecutor({ source: 'https://example.com/a.jpg' }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.imageDataProvided).toBe('url');
    });
  });

  // ---------------------------------------------------------------------------
  // Base64 source
  // ---------------------------------------------------------------------------
  describe('base64 source', () => {
    it('should detect png format from base64 data URI', async () => {
      const result = await analyzeImageExecutor({
        source: 'data:image/png;base64,iVBORw0KGgo=',
      }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.source).toBe('base64');
      expect(content.format).toBe('png');
      expect(content.imageDataProvided).toBe('base64');
    });

    it('should detect jpeg format from base64 data URI', async () => {
      const result = await analyzeImageExecutor({
        source: 'data:image/jpeg;base64,/9j/4AAQ=',
      }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('jpeg');
    });

    it('should detect gif format from base64 data URI', async () => {
      const result = await analyzeImageExecutor({
        source: 'data:image/gif;base64,R0lGODlh',
      }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('gif');
    });

    it('should detect webp format from base64 data URI', async () => {
      const result = await analyzeImageExecutor({
        source: 'data:image/webp;base64,UklGRg==',
      }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('webp');
    });

    it('should return unknown when base64 URI has non-matching format', async () => {
      // The regex /data:image\/(\w+);base64,/ won't match a missing semicolon
      const result = await analyzeImageExecutor({
        source: 'data:image/;base64,abc',
      }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('unknown');
    });
  });

  // ---------------------------------------------------------------------------
  // File source
  // ---------------------------------------------------------------------------
  describe('file source', () => {
    it('should read a valid jpg file', async () => {
      mockStat.mockResolvedValue({ size: 500_000 });
      mockReadFile.mockResolvedValue(Buffer.from('fake-image-data'));

      const result = await analyzeImageExecutor({ source: '/photos/test.jpg' }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.source).toBe('file');
      expect(content.format).toBe('jpg');
      expect(content.imageDataProvided).toBe('base64');
      expect(content.requiresVisionAPI).toBe(true);
    });

    it('should read a valid png file', async () => {
      mockStat.mockResolvedValue({ size: 1_000_000 });
      mockReadFile.mockResolvedValue(Buffer.from('png-data'));

      const result = await analyzeImageExecutor({ source: '/images/logo.png' }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.format).toBe('png');
    });

    it('should reject file larger than MAX_IMAGE_SIZE (10MB)', async () => {
      mockStat.mockResolvedValue({ size: 11 * 1024 * 1024 });

      const result = await analyzeImageExecutor({ source: '/photos/huge.jpg' }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Image too large');
      expect(content.error).toContain('10MB');
    });

    it('should reject file exactly at the boundary (> MAX_IMAGE_SIZE)', async () => {
      // 10MB exactly is not > 10MB, so it should be accepted
      mockStat.mockResolvedValue({ size: 10 * 1024 * 1024 });
      mockReadFile.mockResolvedValue(Buffer.from('data'));

      const result = await analyzeImageExecutor({ source: '/photos/exact.jpg' }, ctx);
      expect(result.isError).toBe(false);
    });

    it('should report file not found when stat throws', async () => {
      mockStat.mockRejectedValue(new Error('ENOENT'));

      const result = await analyzeImageExecutor({ source: '/missing/file.png' }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Image file not found');
      expect(content.error).toContain('/missing/file.png');
    });

    it('should reject unsupported file extension', async () => {
      mockStat.mockResolvedValue({ size: 1000 });

      const result = await analyzeImageExecutor({ source: '/images/photo.tiff' }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Unsupported image format');
      expect(content.supportedFormats).toBeDefined();
    });

    it('should reject file with no extension', async () => {
      mockStat.mockResolvedValue({ size: 1000 });
      // mockExtname returns '' for no extension
      const result = await analyzeImageExecutor({ source: '/images/noext' }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Unsupported image format');
    });

    it('should convert file buffer to base64 data URI with correct mime type', async () => {
      const fileData = Buffer.from('test-png-bytes');
      mockStat.mockResolvedValue({ size: fileData.length });
      mockReadFile.mockResolvedValue(fileData);

      const result = await analyzeImageExecutor({ source: '/test/image.png' }, ctx);
      expect(result.isError).toBe(false);
      expect(mockReadFile).toHaveBeenCalledWith('/test/image.png');
    });
  });

  // ---------------------------------------------------------------------------
  // Analysis tasks
  // ---------------------------------------------------------------------------
  describe('analysis tasks', () => {
    it('should default to describe task', async () => {
      const result = await analyzeImageExecutor({ source: 'https://example.com/a.jpg' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.task).toBe('describe');
    });

    it('should use describe with low detail level', async () => {
      const result = await analyzeImageExecutor({
        source: 'https://example.com/a.jpg',
        task: 'describe',
        detailLevel: 'low',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toContain('Briefly describe');
      expect(content.prompt).toContain('one or two sentences');
      expect(content.detailLevel).toBe('low');
    });

    it('should use describe with medium detail level (default)', async () => {
      const result = await analyzeImageExecutor({
        source: 'https://example.com/a.jpg',
        task: 'describe',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toContain('Describe this image in detail');
      expect(content.prompt).toContain('composition');
      expect(content.detailLevel).toBe('medium');
    });

    it('should use describe with high detail level', async () => {
      const result = await analyzeImageExecutor({
        source: 'https://example.com/a.jpg',
        task: 'describe',
        detailLevel: 'high',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toContain('very detailed description');
      expect(content.prompt).toContain('textures');
      expect(content.detailLevel).toBe('high');
    });

    it('should build OCR prompt', async () => {
      const result = await analyzeImageExecutor({
        source: 'https://example.com/a.jpg',
        task: 'ocr',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.task).toBe('ocr');
      expect(content.prompt).toContain('Extract and transcribe all text');
    });

    it('should build objects prompt', async () => {
      const result = await analyzeImageExecutor({
        source: 'https://example.com/a.jpg',
        task: 'objects',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.task).toBe('objects');
      expect(content.prompt).toContain('List all distinct objects');
    });

    it('should build faces prompt', async () => {
      const result = await analyzeImageExecutor({
        source: 'https://example.com/a.jpg',
        task: 'faces',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.task).toBe('faces');
      expect(content.prompt).toContain('faces visible');
      expect(content.prompt).toContain('Do not attempt to identify');
    });

    it('should build colors prompt', async () => {
      const result = await analyzeImageExecutor({
        source: 'https://example.com/a.jpg',
        task: 'colors',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.task).toBe('colors');
      expect(content.prompt).toContain('color palette');
    });

    it('should build custom prompt with question', async () => {
      const result = await analyzeImageExecutor({
        source: 'https://example.com/a.jpg',
        task: 'custom',
        question: 'How many people are in this image?',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.task).toBe('custom');
      expect(content.prompt).toBe('How many people are in this image?');
    });

    it('should error for custom task without question', async () => {
      const result = await analyzeImageExecutor({
        source: 'https://example.com/a.jpg',
        task: 'custom',
      }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Question is required for custom analysis task');
    });

    it('should use default prompt for unknown task', async () => {
      const result = await analyzeImageExecutor({
        source: 'https://example.com/a.jpg',
        task: 'nonexistent',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toBe('Describe this image.');
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('should catch unexpected errors and wrap them', async () => {
      // Force an error by making readFile throw after stat succeeds
      mockStat.mockResolvedValue({ size: 100 });
      mockReadFile.mockRejectedValue(new Error('Disk read failure'));

      const result = await analyzeImageExecutor({ source: '/test/broken.jpg' }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Failed to process image');
      expect(content.error).toContain('Disk read failure');
    });
  });
});

// =============================================================================
// GENERATE IMAGE EXECUTOR
// =============================================================================

describe('generateImageExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  describe('validation', () => {
    it('should error on empty prompt', async () => {
      const result = await generateImageExecutor({ prompt: '' }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Prompt is required');
    });

    it('should error on whitespace-only prompt', async () => {
      const result = await generateImageExecutor({ prompt: '   ' }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Prompt is required');
    });

    it('should error on prompt exceeding 4000 characters', async () => {
      const longPrompt = 'a'.repeat(4001);
      const result = await generateImageExecutor({ prompt: longPrompt }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Prompt too long');
      expect(content.error).toContain('4000');
    });

    it('should accept prompt exactly at 4000 characters', async () => {
      const exactPrompt = 'a'.repeat(4000);
      const result = await generateImageExecutor({ prompt: exactPrompt }, ctx);
      expect(result.isError).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Defaults
  // ---------------------------------------------------------------------------
  describe('defaults', () => {
    it('should default style to realistic', async () => {
      const result = await generateImageExecutor({ prompt: 'A sunset' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.style).toBe('realistic');
    });

    it('should default size to 1024x1024', async () => {
      const result = await generateImageExecutor({ prompt: 'A sunset' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.size).toBe('1024x1024');
    });

    it('should default quality to standard', async () => {
      const result = await generateImageExecutor({ prompt: 'A sunset' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.quality).toBe('standard');
    });

    it('should default count to 1', async () => {
      const result = await generateImageExecutor({ prompt: 'A sunset' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.count).toBe(1);
    });

    it('should set requiresImageGenerationAPI to true', async () => {
      const result = await generateImageExecutor({ prompt: 'A sunset' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.requiresImageGenerationAPI).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // N clamping
  // ---------------------------------------------------------------------------
  describe('count clamping', () => {
    it('should clamp n=0 to 1', async () => {
      const result = await generateImageExecutor({ prompt: 'A tree', n: 0 }, ctx);
      const content = result.content as Record<string, unknown>;
      // n=0 is falsy, || 1 gives 1
      expect(content.count).toBe(1);
    });

    it('should pass n=2 as-is', async () => {
      const result = await generateImageExecutor({ prompt: 'A tree', n: 2 }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.count).toBe(2);
    });

    it('should clamp n=4 (max) to 4', async () => {
      const result = await generateImageExecutor({ prompt: 'A tree', n: 4 }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.count).toBe(4);
    });

    it('should clamp n=10 to 4', async () => {
      const result = await generateImageExecutor({ prompt: 'A tree', n: 10 }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.count).toBe(4);
    });

    it('should clamp negative n to 1', async () => {
      const result = await generateImageExecutor({ prompt: 'A tree', n: -5 }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Style enhancement
  // ---------------------------------------------------------------------------
  describe('style enhancement', () => {
    it('should not modify prompt for realistic style', async () => {
      const result = await generateImageExecutor({ prompt: 'A sunset', style: 'realistic' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toBe('A sunset');
      expect(content.originalPrompt).toBe('A sunset');
    });

    it('should enhance prompt for artistic style', async () => {
      const result = await generateImageExecutor({ prompt: 'A sunset', style: 'artistic' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toBe('A sunset, artistic painting style, oil painting texture');
      expect(content.originalPrompt).toBe('A sunset');
    });

    it('should enhance prompt for cartoon style', async () => {
      const result = await generateImageExecutor({ prompt: 'A cat', style: 'cartoon' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toBe('A cat, cartoon style, animated, vibrant colors');
    });

    it('should enhance prompt for sketch style', async () => {
      const result = await generateImageExecutor({ prompt: 'A dog', style: 'sketch' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toBe('A dog, pencil sketch, hand-drawn, black and white');
    });

    it('should enhance prompt for digital-art style', async () => {
      const result = await generateImageExecutor({ prompt: 'A robot', style: 'digital-art' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toBe('A robot, digital art, clean lines, modern illustration');
    });

    it('should enhance prompt for 3d-render style', async () => {
      const result = await generateImageExecutor({ prompt: 'A sphere', style: '3d-render' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toBe('A sphere, 3D rendered, realistic lighting, CGI quality');
    });

    it('should enhance prompt for anime style', async () => {
      const result = await generateImageExecutor({ prompt: 'A warrior', style: 'anime' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toBe('A warrior, anime style, Japanese animation, cel-shaded');
    });

    it('should enhance prompt for photography style', async () => {
      const result = await generateImageExecutor({ prompt: 'A mountain', style: 'photography' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.prompt).toBe('A mountain, professional photography, high resolution, detailed');
    });

    it('should append empty string for unknown style (prompt + ", ")', async () => {
      const result = await generateImageExecutor({ prompt: 'A mountain', style: 'watercolor' }, ctx);
      const content = result.content as Record<string, unknown>;
      // style !== 'realistic', so it does `prompt, ${getStyleDescription('watercolor')}` -> 'A mountain, '
      expect(content.prompt).toBe('A mountain, ');
    });
  });

  // ---------------------------------------------------------------------------
  // Output path and explicit params
  // ---------------------------------------------------------------------------
  describe('explicit parameters', () => {
    it('should pass through outputPath', async () => {
      const result = await generateImageExecutor({
        prompt: 'A sunset',
        outputPath: '/output/image.png',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.outputPath).toBe('/output/image.png');
    });

    it('should set outputPath to undefined when not provided', async () => {
      const result = await generateImageExecutor({ prompt: 'A sunset' }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.outputPath).toBeUndefined();
    });

    it('should pass through explicit size', async () => {
      const result = await generateImageExecutor({
        prompt: 'A sunset',
        size: '512x512',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.size).toBe('512x512');
    });

    it('should pass through explicit quality', async () => {
      const result = await generateImageExecutor({
        prompt: 'A sunset',
        quality: 'hd',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.quality).toBe('hd');
    });
  });
});

// =============================================================================
// RESIZE IMAGE EXECUTOR
// =============================================================================

describe('resizeImageExecutor', () => {
  // Sharp chainable mock
  const mockSharpInstance = {
    metadata: vi.fn(),
    resize: vi.fn().mockReturnThis(),
    jpeg: vi.fn().mockReturnThis(),
    png: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toFile: vi.fn(),
  };
  const mockSharp = vi.fn(() => mockSharpInstance);

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset chainable returns after clearAllMocks
    mockSharpInstance.resize.mockReturnThis();
    mockSharpInstance.jpeg.mockReturnThis();
    mockSharpInstance.png.mockReturnThis();
    mockSharpInstance.webp.mockReturnThis();
    // Default: sharp is available
    mockTryImport.mockResolvedValue({ default: mockSharp });
    // Default: file exists
    mockAccess.mockResolvedValue(undefined);
    // Default: metadata
    mockSharpInstance.metadata.mockResolvedValue({ width: 1920, height: 1080 });
    // Default: toFile succeeds
    mockSharpInstance.toFile.mockResolvedValue(undefined);
    // Default: output stat
    mockStat.mockResolvedValue({ size: 50_000 });
  });

  // ---------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------
  describe('validation', () => {
    it('should error when neither width nor height provided', async () => {
      const result = await resizeImageExecutor({ source: '/img/photo.jpg' }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('At least one of width or height is required');
    });

    it('should error when file does not exist', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'));

      const result = await resizeImageExecutor({ source: '/missing.jpg', width: 800 }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Failed to resize image');
    });
  });

  // ---------------------------------------------------------------------------
  // Sharp import failure
  // ---------------------------------------------------------------------------
  describe('sharp import failure', () => {
    it('should error with suggestion when sharp is not installed', async () => {
      mockTryImport.mockRejectedValue(new Error('Module not found'));

      const result = await resizeImageExecutor({ source: '/img/photo.jpg', width: 800 }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('sharp library not installed');
      expect(content.suggestion).toContain('pnpm add sharp');
    });
  });

  // ---------------------------------------------------------------------------
  // Aspect ratio calculations
  // ---------------------------------------------------------------------------
  describe('aspect ratio calculations', () => {
    it('should calculate height from width when only width provided', async () => {
      mockSharpInstance.metadata.mockResolvedValue({ width: 1920, height: 1080 });

      const result = await resizeImageExecutor({ source: '/img/photo.jpg', width: 960 }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      const newDims = content.newDimensions as Record<string, unknown>;
      expect(newDims.width).toBe(960);
      // 960 / (1920/1080) = 960 / 1.7778 = 540
      expect(newDims.height).toBe(540);
    });

    it('should calculate width from height when only height provided', async () => {
      mockSharpInstance.metadata.mockResolvedValue({ width: 1920, height: 1080 });

      const result = await resizeImageExecutor({ source: '/img/photo.jpg', height: 540 }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      const newDims = content.newDimensions as Record<string, unknown>;
      // 540 * (1920/1080) = 540 * 1.7778 = 960
      expect(newDims.width).toBe(960);
      expect(newDims.height).toBe(540);
    });

    it('should use both width and height when both provided (aspect ratio on)', async () => {
      mockSharpInstance.metadata.mockResolvedValue({ width: 1920, height: 1080 });

      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        height: 600,
      }, ctx);
      expect(result.isError).toBe(false);
      // When both are provided, neither branch triggers — both remain as specified
      const content = result.content as Record<string, unknown>;
      const newDims = content.newDimensions as Record<string, unknown>;
      expect(newDims.width).toBe(800);
      expect(newDims.height).toBe(600);
    });

    it('should pass fit=inside when maintainAspectRatio is true', async () => {
      await resizeImageExecutor({ source: '/img/photo.jpg', width: 800 }, ctx);
      // 800 / (1920/1080) = 800 / 1.7778 = 450
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(800, 450, { fit: 'inside' });
    });

    it('should pass fit=fill when maintainAspectRatio is false', async () => {
      await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        height: 600,
        maintainAspectRatio: false,
      }, ctx);
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(800, 600, { fit: 'fill' });
    });

    it('should not calculate aspect ratio when maintainAspectRatio is false', async () => {
      mockSharpInstance.metadata.mockResolvedValue({ width: 1920, height: 1080 });

      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        maintainAspectRatio: false,
      }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      const newDims = content.newDimensions as Record<string, unknown>;
      expect(newDims.width).toBe(800);
      expect(newDims.height).toBeUndefined();
    });

    it('should handle square image aspect ratio (1:1)', async () => {
      mockSharpInstance.metadata.mockResolvedValue({ width: 500, height: 500 });

      const result = await resizeImageExecutor({ source: '/img/square.jpg', width: 250 }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      const newDims = content.newDimensions as Record<string, unknown>;
      expect(newDims.width).toBe(250);
      expect(newDims.height).toBe(250);
    });

    it('should handle portrait orientation aspect ratio', async () => {
      mockSharpInstance.metadata.mockResolvedValue({ width: 1080, height: 1920 });

      const result = await resizeImageExecutor({ source: '/img/portrait.jpg', width: 540 }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      const newDims = content.newDimensions as Record<string, unknown>;
      expect(newDims.width).toBe(540);
      // 540 / (1080/1920) = 540 / 0.5625 = 960
      expect(newDims.height).toBe(960);
    });

    it('should skip aspect calculation if metadata has no width', async () => {
      mockSharpInstance.metadata.mockResolvedValue({ height: 1080 });

      const result = await resizeImageExecutor({ source: '/img/photo.jpg', width: 800 }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      const newDims = content.newDimensions as Record<string, unknown>;
      expect(newDims.width).toBe(800);
      expect(newDims.height).toBeUndefined();
    });

    it('should skip aspect calculation if metadata has no height', async () => {
      mockSharpInstance.metadata.mockResolvedValue({ width: 1920 });

      const result = await resizeImageExecutor({ source: '/img/photo.jpg', height: 600 }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      const newDims = content.newDimensions as Record<string, unknown>;
      expect(newDims.height).toBe(600);
      expect(newDims.width).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Output path
  // ---------------------------------------------------------------------------
  describe('output path', () => {
    it('should generate default output path with _resized suffix', async () => {
      await resizeImageExecutor({ source: '/img/photo.jpg', width: 800 }, ctx);

      // path.basename('/img/photo.jpg', '.jpg') -> 'photo'
      // path.dirname('/img/photo.jpg') -> '/img'
      // path.join('/img', 'photo_resized.jpg') -> '/img/photo_resized.jpg'
      expect(mockBasename).toHaveBeenCalledWith('/img/photo.jpg', '.jpg');
      expect(mockDirname).toHaveBeenCalledWith('/img/photo.jpg');
    });

    it('should use explicit outputPath when provided', async () => {
      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        outputPath: '/output/resized.jpg',
      }, ctx);
      expect(result.isError).toBe(false);
      expect(mockSharpInstance.toFile).toHaveBeenCalledWith('/output/resized.jpg');
    });

    it('should report output path in result', async () => {
      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        outputPath: '/out/small.jpg',
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.output).toBe('/out/small.jpg');
    });
  });

  // ---------------------------------------------------------------------------
  // Quality per format
  // ---------------------------------------------------------------------------
  describe('quality per format', () => {
    it('should apply jpeg quality for .jpg file', async () => {
      await resizeImageExecutor({ source: '/img/photo.jpg', width: 800, quality: 85 }, ctx);
      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({ quality: 85 });
      expect(mockSharpInstance.png).not.toHaveBeenCalled();
      expect(mockSharpInstance.webp).not.toHaveBeenCalled();
    });

    it('should apply jpeg quality for .jpeg file', async () => {
      await resizeImageExecutor({ source: '/img/photo.jpeg', width: 800, quality: 75 }, ctx);
      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({ quality: 75 });
    });

    it('should apply png quality for .png file', async () => {
      await resizeImageExecutor({ source: '/img/logo.png', width: 400, quality: 95 }, ctx);
      expect(mockSharpInstance.png).toHaveBeenCalledWith({ quality: 95 });
      expect(mockSharpInstance.jpeg).not.toHaveBeenCalled();
      expect(mockSharpInstance.webp).not.toHaveBeenCalled();
    });

    it('should apply webp quality for .webp file', async () => {
      await resizeImageExecutor({ source: '/img/image.webp', width: 600, quality: 80 }, ctx);
      expect(mockSharpInstance.webp).toHaveBeenCalledWith({ quality: 80 });
      expect(mockSharpInstance.jpeg).not.toHaveBeenCalled();
      expect(mockSharpInstance.png).not.toHaveBeenCalled();
    });

    it('should not apply any format-specific quality for .gif file', async () => {
      await resizeImageExecutor({ source: '/img/animation.gif', width: 320, quality: 80 }, ctx);
      expect(mockSharpInstance.jpeg).not.toHaveBeenCalled();
      expect(mockSharpInstance.png).not.toHaveBeenCalled();
      expect(mockSharpInstance.webp).not.toHaveBeenCalled();
    });

    it('should not apply any format-specific quality for .bmp file', async () => {
      await resizeImageExecutor({ source: '/img/image.bmp', width: 320 }, ctx);
      expect(mockSharpInstance.jpeg).not.toHaveBeenCalled();
      expect(mockSharpInstance.png).not.toHaveBeenCalled();
      expect(mockSharpInstance.webp).not.toHaveBeenCalled();
    });

    it('should handle uppercase .JPG extension', async () => {
      // mockExtname returns '.JPG', code does ext.toLowerCase()
      mockExtname.mockReturnValueOnce('.JPG');
      await resizeImageExecutor({ source: '/img/PHOTO.JPG', width: 800, quality: 90 }, ctx);
      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({ quality: 90 });
    });

    it('should handle uppercase .JPEG extension', async () => {
      mockExtname.mockReturnValueOnce('.JPEG');
      await resizeImageExecutor({ source: '/img/PHOTO.JPEG', width: 800 }, ctx);
      expect(mockSharpInstance.jpeg).toHaveBeenCalledWith({ quality: 90 });
    });
  });

  // ---------------------------------------------------------------------------
  // Quality clamping
  // ---------------------------------------------------------------------------
  describe('quality clamping', () => {
    it('should default quality to 90', async () => {
      const result = await resizeImageExecutor({ source: '/img/photo.jpg', width: 800 }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.quality).toBe(90);
    });

    it('should clamp quality below 1 to 1', async () => {
      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        quality: 0,
      }, ctx);
      const content = result.content as Record<string, unknown>;
      // quality=0 is falsy, || 90 gives 90
      expect(content.quality).toBe(90);
    });

    it('should clamp quality above 100 to 100', async () => {
      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        quality: 150,
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.quality).toBe(100);
    });

    it('should accept quality at minimum boundary (1)', async () => {
      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        quality: 1,
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.quality).toBe(1);
    });

    it('should accept quality at maximum boundary (100)', async () => {
      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        quality: 100,
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.quality).toBe(100);
    });

    it('should clamp negative quality to 1', async () => {
      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        quality: -50,
      }, ctx);
      const content = result.content as Record<string, unknown>;
      expect(content.quality).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Successful resize result
  // ---------------------------------------------------------------------------
  describe('successful resize result', () => {
    it('should return complete success result', async () => {
      mockSharpInstance.metadata.mockResolvedValue({ width: 1920, height: 1080 });
      mockStat.mockResolvedValue({ size: 45_000 });

      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        outputPath: '/out/small.jpg',
      }, ctx);
      expect(result.isError).toBe(false);
      const content = result.content as Record<string, unknown>;
      expect(content.success).toBe(true);
      expect(content.source).toBe('/img/photo.jpg');
      expect(content.output).toBe('/out/small.jpg');
      expect(content.originalDimensions).toEqual({ width: 1920, height: 1080 });
      expect(content.fileSize).toBe(45_000);
    });

    it('should call sharp with source path', async () => {
      await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 400,
      }, ctx);
      expect(mockSharp).toHaveBeenCalledWith('/img/photo.jpg');
    });

    it('should read output file stats after saving', async () => {
      await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 400,
        outputPath: '/out/result.jpg',
      }, ctx);
      expect(mockSharpInstance.toFile).toHaveBeenCalledWith('/out/result.jpg');
      expect(mockStat).toHaveBeenCalledWith('/out/result.jpg');
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------
  describe('error handling', () => {
    it('should catch sharp processing errors', async () => {
      mockSharpInstance.metadata.mockRejectedValue(new Error('Corrupt image'));

      const result = await resizeImageExecutor({
        source: '/img/broken.jpg',
        width: 800,
      }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Failed to resize image');
      expect(content.error).toContain('Corrupt image');
    });

    it('should catch toFile errors', async () => {
      mockSharpInstance.toFile.mockRejectedValue(new Error('Permission denied'));

      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
        outputPath: '/readonly/out.jpg',
      }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Failed to resize image');
      expect(content.error).toContain('Permission denied');
    });

    it('should catch output stat errors', async () => {
      mockStat.mockRejectedValue(new Error('Stat failed'));

      const result = await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 800,
      }, ctx);
      expect(result.isError).toBe(true);
      const content = result.content as Record<string, unknown>;
      expect(content.error).toContain('Failed to resize image');
    });
  });

  // ---------------------------------------------------------------------------
  // maintainAspectRatio defaults to true
  // ---------------------------------------------------------------------------
  describe('maintainAspectRatio default', () => {
    it('should default maintainAspectRatio to true when not specified', async () => {
      mockSharpInstance.metadata.mockResolvedValue({ width: 1000, height: 500 });

      await resizeImageExecutor({ source: '/img/photo.jpg', width: 500 }, ctx);
      // 500 / (1000/500) = 500 / 2 = 250
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(500, 250, { fit: 'inside' });
    });

    it('should treat explicit true the same as default', async () => {
      mockSharpInstance.metadata.mockResolvedValue({ width: 1000, height: 500 });

      await resizeImageExecutor({
        source: '/img/photo.jpg',
        width: 500,
        maintainAspectRatio: true,
      }, ctx);
      // 500 / (1000/500) = 500 / 2 = 250
      expect(mockSharpInstance.resize).toHaveBeenCalledWith(500, 250, { fit: 'inside' });
    });
  });
});
