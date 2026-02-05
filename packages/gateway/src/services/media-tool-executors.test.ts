/**
 * Media Tool Executors Tests
 *
 * Tests the media tool executors: generate_image, analyze_image,
 * text_to_speech, speech_to_text, translate_audio.
 * Focuses on validation, error paths, and response formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolContext } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// Test-only helper types for executor result content
// ---------------------------------------------------------------------------

/** Content shape returned on success from image/tts/stt executors */
interface SuccessContent {
  success: boolean;
  provider: string;
  model?: string;
  images?: { url?: string; revisedPrompt?: string }[];
  analysis?: string;
  task?: string;
  voice?: string;
  speed?: number;
  text?: string;
  language?: string;
  duration?: number;
}

/** Content shape returned on error from all executors */
interface ErrorContent {
  error: string;
  suggestion?: string;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMediaService = {
  generateImage: vi.fn(),
  analyzeImage: vi.fn(),
  textToSpeech: vi.fn(),
  speechToText: vi.fn(),
};

const noopLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

vi.mock('@ownpilot/core', () => ({
  MediaService: vi.fn(),
  createMediaService: vi.fn(() => mockMediaService),
  getLog: vi.fn(() => noopLogger),
}));

vi.mock('../workspace/file-workspace.js', () => ({
  validateWritePath: vi.fn(() => ({ valid: true })),
}));

const mockMediaSettingsRepo = {
  getEffective: vi.fn(),
};

const mockSettingsRepo = {
  get: vi.fn(),
};

vi.mock('../db/repositories/index.js', () => ({
  mediaSettingsRepo: {
    getEffective: (...args: unknown[]) => mockMediaSettingsRepo.getEffective(...args),
  },
  settingsRepo: {
    get: (...args: unknown[]) => mockSettingsRepo.get(...args),
  },
}));

import {
  mediaGenerateImageExecutor,
  mediaAnalyzeImageExecutor,
  mediaTTSExecutor,
  mediaSTTExecutor,
  MEDIA_TOOL_EXECUTORS,
  shouldUseMediaTools,
} from './media-tool-executors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupConfiguredProvider(_capability = 'image_generation') {
  mockMediaSettingsRepo.getEffective.mockResolvedValue({
    provider: 'openai',
    model: 'dall-e-3',
    config: {},
  });
  mockSettingsRepo.get.mockResolvedValue('sk-test-key');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Media Tool Executors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // MEDIA_TOOL_EXECUTORS registry
  // ========================================================================

  describe('MEDIA_TOOL_EXECUTORS', () => {
    it('exports 5 tool executors', () => {
      expect(Object.keys(MEDIA_TOOL_EXECUTORS)).toHaveLength(5);
    });

    it('contains expected tool names', () => {
      const names = Object.keys(MEDIA_TOOL_EXECUTORS);
      expect(names).toContain('generate_image');
      expect(names).toContain('analyze_image');
      expect(names).toContain('text_to_speech');
      expect(names).toContain('speech_to_text');
      expect(names).toContain('translate_audio');
    });
  });

  // ========================================================================
  // shouldUseMediaTools
  // ========================================================================

  describe('shouldUseMediaTools', () => {
    it('returns true when provider is configured with API key', async () => {
      setupConfiguredProvider();

      expect(await shouldUseMediaTools('image_generation')).toBe(true);
    });

    it('returns false when no settings exist', async () => {
      mockMediaSettingsRepo.getEffective.mockResolvedValue(null);

      expect(await shouldUseMediaTools('image_generation')).toBe(false);
    });

    it('returns false when API key not found', async () => {
      mockMediaSettingsRepo.getEffective.mockResolvedValue({
        provider: 'openai',
      });
      mockSettingsRepo.get.mockResolvedValue(null);

      expect(await shouldUseMediaTools('image_generation')).toBe(false);
    });

    it('returns false for unknown provider', async () => {
      mockMediaSettingsRepo.getEffective.mockResolvedValue({
        provider: 'unknown_provider',
      });

      expect(await shouldUseMediaTools('tts')).toBe(false);
    });
  });

  // ========================================================================
  // mediaGenerateImageExecutor
  // ========================================================================

  describe('mediaGenerateImageExecutor', () => {
    it('generates image successfully', async () => {
      setupConfiguredProvider();
      mockMediaService.generateImage.mockResolvedValue({
        provider: 'openai',
        model: 'dall-e-3',
        images: [{ url: 'https://img.test/1.png', revisedPrompt: 'A cat' }],
      });

      const result = await mediaGenerateImageExecutor({
        prompt: 'A cat in a hat',
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(false);
      const content = result.content as SuccessContent;
      expect(content.success).toBe(true);
      expect(content.provider).toBe('openai');
      expect(content.images).toHaveLength(1);
    });

    it('returns error for empty prompt', async () => {
      const result = await mediaGenerateImageExecutor({ prompt: '' }, {} as unknown as ToolContext);

      expect(result.isError).toBe(true);
      expect((result.content as ErrorContent).error).toContain('Prompt is required');
    });

    it('returns error for prompt exceeding 4000 chars', async () => {
      const result = await mediaGenerateImageExecutor({
        prompt: 'x'.repeat(4001),
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(true);
      expect((result.content as ErrorContent).error).toContain('too long');
    });

    it('returns error when no provider configured', async () => {
      mockMediaSettingsRepo.getEffective.mockResolvedValue(null);

      const result = await mediaGenerateImageExecutor({
        prompt: 'A cat',
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(true);
      expect((result.content as ErrorContent).error).toContain('No image generation provider');
    });

    it('enhances prompt with style description', async () => {
      setupConfiguredProvider();
      mockMediaService.generateImage.mockResolvedValue({
        provider: 'openai',
        model: 'dall-e-3',
        images: [],
      });

      await mediaGenerateImageExecutor({
        prompt: 'A cat',
        style: 'anime',
      }, {} as unknown as ToolContext);

      expect(mockMediaService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: expect.stringContaining('anime'),
        }),
      );
    });

    it('caps n to 4', async () => {
      setupConfiguredProvider();
      mockMediaService.generateImage.mockResolvedValue({
        provider: 'openai',
        model: 'dall-e-3',
        images: [],
      });

      await mediaGenerateImageExecutor({
        prompt: 'A cat',
        n: 10,
      }, {} as unknown as ToolContext);

      expect(mockMediaService.generateImage).toHaveBeenCalledWith(
        expect.objectContaining({ n: 4 }),
      );
    });

    it('handles API error gracefully', async () => {
      setupConfiguredProvider();
      mockMediaService.generateImage.mockRejectedValue(new Error('Quota exceeded'));

      const result = await mediaGenerateImageExecutor({
        prompt: 'A cat',
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(true);
      expect((result.content as ErrorContent).error).toContain('Quota exceeded');
    });
  });

  // ========================================================================
  // mediaAnalyzeImageExecutor
  // ========================================================================

  describe('mediaAnalyzeImageExecutor', () => {
    it('analyzes image from URL', async () => {
      setupConfiguredProvider();
      mockMediaService.analyzeImage.mockResolvedValue({
        provider: 'openai',
        model: 'gpt-4o',
        text: 'A photo of a cat.',
        usage: { promptTokens: 100, completionTokens: 20 },
      });

      const result = await mediaAnalyzeImageExecutor({
        source: 'https://example.com/cat.jpg',
        task: 'describe',
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(false);
      const content = result.content as SuccessContent;
      expect(content.analysis).toBe('A photo of a cat.');
      expect(content.task).toBe('describe');
    });

    it('returns error when no vision provider configured', async () => {
      mockMediaSettingsRepo.getEffective.mockResolvedValue(null);

      const result = await mediaAnalyzeImageExecutor({
        source: 'https://example.com/cat.jpg',
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(true);
      expect((result.content as ErrorContent).error).toContain('No vision provider');
    });

    it('returns error for custom task without question', async () => {
      setupConfiguredProvider();

      const result = await mediaAnalyzeImageExecutor({
        source: 'https://example.com/cat.jpg',
        task: 'custom',
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(true);
      expect((result.content as ErrorContent).error).toContain('Question is required');
    });
  });

  // ========================================================================
  // mediaTTSExecutor
  // ========================================================================

  describe('mediaTTSExecutor', () => {
    it('generates speech successfully', async () => {
      setupConfiguredProvider();
      mockMediaService.textToSpeech.mockResolvedValue({
        provider: 'openai',
        model: 'tts-1',
        format: 'mp3',
        audio: Buffer.from('fake-audio-data'),
      });

      // Mock fs to avoid actual file writes
      vi.doMock('node:fs/promises', () => ({
        writeFile: vi.fn(),
      }));
      vi.doMock('node:os', () => ({
        tmpdir: () => '/tmp',
      }));
      vi.doMock('node:path', () => ({
        join: (...args: string[]) => args.join('/'),
      }));

      const result = await mediaTTSExecutor({
        text: 'Hello world',
        voice: 'nova',
        speed: 1.2,
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(false);
      const content = result.content as SuccessContent;
      expect(content.success).toBe(true);
      expect(content.voice).toBe('nova');
      expect(content.speed).toBe(1.2);
    });

    it('returns error for empty text', async () => {
      const result = await mediaTTSExecutor({ text: '' }, {} as unknown as ToolContext);

      expect(result.isError).toBe(true);
      expect((result.content as ErrorContent).error).toContain('Text is required');
    });

    it('returns error for text exceeding 4096 chars', async () => {
      const result = await mediaTTSExecutor({
        text: 'x'.repeat(4097),
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(true);
      expect((result.content as ErrorContent).error).toContain('too long');
    });

    it('returns error when no TTS provider configured', async () => {
      mockMediaSettingsRepo.getEffective.mockResolvedValue(null);

      const result = await mediaTTSExecutor({ text: 'Hello' }, {} as unknown as ToolContext);

      expect(result.isError).toBe(true);
      expect((result.content as ErrorContent).error).toContain('No TTS provider');
    });

    it('clamps speed to valid range', async () => {
      setupConfiguredProvider();
      mockMediaService.textToSpeech.mockResolvedValue({
        provider: 'openai',
        model: 'tts-1',
        format: 'mp3',
        audio: Buffer.from('data'),
      });

      const result = await mediaTTSExecutor({
        text: 'Hello',
        speed: 10, // Should be clamped to 4.0
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(false);
      expect((result.content as SuccessContent).speed).toBe(4.0);
    });
  });

  // ========================================================================
  // mediaSTTExecutor
  // ========================================================================

  describe('mediaSTTExecutor', () => {
    it('returns error when no STT provider configured', async () => {
      mockMediaSettingsRepo.getEffective.mockResolvedValue(null);

      const result = await mediaSTTExecutor({
        source: 'https://example.com/audio.mp3',
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(true);
      expect((result.content as ErrorContent).error).toContain('No STT provider');
    });

    it('transcribes audio from URL', async () => {
      setupConfiguredProvider();
      // Mock fetch for URL-based audio
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
      }));

      mockMediaService.speechToText.mockResolvedValue({
        provider: 'openai',
        model: 'whisper-1',
        text: 'Hello world',
        language: 'en',
        duration: 5.2,
        segments: [],
      });

      const result = await mediaSTTExecutor({
        source: 'https://example.com/audio.mp3',
      }, {} as unknown as ToolContext);

      expect(result.isError).toBe(false);
      const content = result.content as SuccessContent;
      expect(content.text).toBe('Hello world');
      expect(content.language).toBe('en');

      vi.unstubAllGlobals();
    });
  });
});
