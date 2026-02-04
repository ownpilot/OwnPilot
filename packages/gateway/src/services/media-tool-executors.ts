/**
 * Media Tool Executors
 *
 * Real implementations that override placeholder image and audio tools.
 * Uses MediaService for provider routing based on user settings.
 */

import type { ToolExecutor, ToolExecutionResult } from '@ownpilot/core';
import {
  MediaService,
  createMediaService,
  type MediaCapability,
  type MediaProviderConfig,
} from '@ownpilot/core';
import { mediaSettingsRepo, settingsRepo } from '../db/repositories/index.js';
import { validateWritePath } from '../workspace/file-workspace.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get configured MediaService instance
 */
async function getMediaService(): Promise<MediaService> {
  return createMediaService({
    getProviderConfig: async (capability: MediaCapability): Promise<MediaProviderConfig | null> => {
      const setting = await mediaSettingsRepo.getEffective('default', capability);
      if (!setting) return null;

      return {
        provider: setting.provider,
        model: setting.model || undefined,
        config: setting.config || undefined,
      };
    },
    getApiKey: async (keyName: string): Promise<string | undefined> => {
      return (await settingsRepo.get<string>(keyName)) ?? undefined;
    },
  });
}

/**
 * Format error response
 */
function errorResult(error: string, suggestion?: string): ToolExecutionResult {
  return {
    content: { error, suggestion },
    isError: true,
  };
}

/**
 * Check if a capability provider is configured
 */
async function isProviderConfigured(capability: MediaCapability): Promise<boolean> {
  const setting = await mediaSettingsRepo.getEffective('default', capability);
  if (!setting) return false;

  // Check if API key exists for the provider
  const keyMap: Record<string, string> = {
    openai: 'openai_api_key',
    anthropic: 'anthropic_api_key',
    google: 'google_ai_api_key',
    fireworks: 'fireworks_api_key',
    elevenlabs: 'elevenlabs_api_key',
    groq: 'groq_api_key',
    deepgram: 'deepgram_api_key',
  };

  const keyName = keyMap[setting.provider];
  if (!keyName) return false;

  const apiKey = await settingsRepo.get<string>(keyName);
  return !!apiKey;
}

// =============================================================================
// IMAGE GENERATION EXECUTOR
// =============================================================================

export const mediaGenerateImageExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const prompt = params.prompt as string;
  const style = (params.style as string) || 'realistic';
  const size = (params.size as string) || '1024x1024';
  const quality = (params.quality as string) || 'standard';
  const outputPath = params.outputPath as string | undefined;
  const n = Math.min(Math.max((params.n as number) || 1, 1), 4);

  // Validate prompt
  if (!prompt || prompt.trim().length === 0) {
    return errorResult('Prompt is required for image generation');
  }

  if (prompt.length > 4000) {
    return errorResult('Prompt too long. Maximum 4000 characters.');
  }

  // Check if provider is configured
  if (!(await isProviderConfigured('image_generation'))) {
    return errorResult(
      'No image generation provider configured',
      'Configure an image generation provider in Settings → Media Settings'
    );
  }

  // Get style description for prompt enhancement
  const styleDescriptions: Record<string, string> = {
    artistic: 'artistic painting style, oil painting texture',
    cartoon: 'cartoon style, animated, vibrant colors',
    sketch: 'pencil sketch, hand-drawn, black and white',
    'digital-art': 'digital art, clean lines, modern illustration',
    '3d-render': '3D rendered, realistic lighting, CGI quality',
    anime: 'anime style, Japanese animation, cel-shaded',
    photography: 'professional photography, high resolution, detailed',
  };

  const enhancedPrompt = style !== 'realistic' && styleDescriptions[style]
    ? `${prompt}, ${styleDescriptions[style]}`
    : prompt;

  try {
    const mediaService = await getMediaService();

    const result = await mediaService.generateImage({
      prompt: enhancedPrompt,
      size: size as '1024x1024' | '1024x1792' | '1792x1024' | '512x512' | '256x256',
      quality: quality as 'standard' | 'hd',
      n,
    });

    // Save to file if outputPath provided
    if (outputPath && result.images.length > 0) {
      // Validate output path is within workspace
      const pathCheck = validateWritePath(outputPath);
      if (!pathCheck.valid) {
        return errorResult(
          pathCheck.error ?? 'Cannot write to path outside workspace',
          pathCheck.suggestedPath ? `Suggested path: ${pathCheck.suggestedPath}` : undefined,
        );
      }

      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      for (let i = 0; i < result.images.length; i++) {
        const img = result.images[i];
        if (!img) continue;

        let filePath = outputPath;

        if (result.images.length > 1) {
          const ext = path.extname(outputPath);
          const base = path.basename(outputPath, ext);
          const dir = path.dirname(outputPath);
          filePath = path.join(dir, `${base}_${i + 1}${ext}`);
        }

        if (img.base64) {
          await fs.writeFile(filePath, Buffer.from(img.base64, 'base64'));
        } else if (img.url) {
          const response = await fetch(img.url);
          const buffer = Buffer.from(await response.arrayBuffer());
          await fs.writeFile(filePath, buffer);
        }

        result.images[i] = { ...img, savedTo: filePath } as typeof img & { savedTo: string };
      }
    }

    return {
      content: {
        success: true,
        provider: result.provider,
        model: result.model,
        images: result.images.map((img: { url?: string; base64?: string; revisedPrompt?: string; savedTo?: string }, i: number) => ({
          index: i + 1,
          url: img.url,
          hasBase64: !!img.base64,
          revisedPrompt: img.revisedPrompt,
          savedTo: img.savedTo,
        })),
        prompt: enhancedPrompt,
        originalPrompt: prompt,
        style,
        size,
        quality,
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate image';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// IMAGE ANALYSIS (VISION) EXECUTOR
// =============================================================================

export const mediaAnalyzeImageExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const task = (params.task as string) || 'describe';
  const question = params.question as string | undefined;
  const detailLevel = (params.detailLevel as string) || 'medium';
  const maxTokens = params.maxTokens as number | undefined;

  // Check if provider is configured
  if (!(await isProviderConfigured('vision'))) {
    return errorResult(
      'No vision provider configured',
      'Configure a vision provider in Settings → Media Settings'
    );
  }

  try {
    let imageData: string;

    // Process image source
    if (source.startsWith('http://') || source.startsWith('https://')) {
      imageData = source;
    } else if (source.startsWith('data:image/')) {
      imageData = source;
    } else {
      // File path - read and convert to base64
      const fs = await import('node:fs/promises');
      const path = await import('node:path');

      const buffer = await fs.readFile(source);
      const ext = path.extname(source).slice(1).toLowerCase();
      const mimeTypes: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
      };
      const mimeType = mimeTypes[ext] || 'image/jpeg';
      imageData = `data:${mimeType};base64,${buffer.toString('base64')}`;
    }

    // Build analysis prompt based on task
    let prompt: string;
    switch (task) {
      case 'describe':
        prompt = detailLevel === 'high'
          ? 'Provide a very detailed description of this image, including all visible elements, their positions, colors, textures, and any notable details.'
          : detailLevel === 'low'
            ? 'Briefly describe the main subject of this image in one or two sentences.'
            : 'Describe this image in detail, including the main subjects, setting, colors, and overall composition.';
        break;
      case 'ocr':
        prompt = 'Extract and transcribe all text visible in this image. Format it clearly, preserving the original structure where possible.';
        break;
      case 'objects':
        prompt = 'List all distinct objects visible in this image. For each object, provide its name, approximate position, and any notable characteristics.';
        break;
      case 'faces':
        prompt = 'Describe any faces visible in this image, including expressions, approximate age range, and any distinguishing features. Do not attempt to identify specific individuals.';
        break;
      case 'colors':
        prompt = 'Analyze the color palette of this image. List the dominant colors, their approximate percentages, and describe the overall color mood/tone.';
        break;
      case 'custom':
        if (!question) {
          return errorResult('Question is required for custom analysis task');
        }
        prompt = question;
        break;
      default:
        prompt = 'Describe this image.';
    }

    const mediaService = await getMediaService();

    const result = await mediaService.analyzeImage({
      image: imageData,
      prompt,
      maxTokens: maxTokens || 1024,
      detail: detailLevel === 'high' ? 'high' : detailLevel === 'low' ? 'low' : 'auto',
    });

    return {
      content: {
        success: true,
        provider: result.provider,
        model: result.model,
        task,
        analysis: result.text,
        usage: result.usage,
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to analyze image';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// TEXT TO SPEECH EXECUTOR
// =============================================================================

export const mediaTTSExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const text = params.text as string;
  const voice = (params.voice as string) || 'alloy';
  const _model = params.model as string | undefined;
  const speed = Math.min(Math.max((params.speed as number) || 1.0, 0.25), 4.0);
  const format = (params.format as string) || 'mp3';
  const outputPath = params.outputPath as string | undefined;

  // Validate text
  if (!text || text.trim().length === 0) {
    return errorResult('Text is required for speech synthesis');
  }

  if (text.length > 4096) {
    return errorResult(
      `Text too long: ${text.length} characters (max 4096)`,
      'Split the text into smaller chunks'
    );
  }

  // Check if provider is configured
  if (!(await isProviderConfigured('tts'))) {
    return errorResult(
      'No TTS provider configured',
      'Configure a TTS provider in Settings → Media Settings'
    );
  }

  try {
    const mediaService = await getMediaService();

    const result = await mediaService.textToSpeech({
      text,
      voice,
      speed,
      format: format as 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm',
    });

    // Save to file
    let savedPath: string | undefined;
    if (outputPath) {
      // Validate output path is within workspace
      const pathCheck = validateWritePath(outputPath);
      if (!pathCheck.valid) {
        return errorResult(
          pathCheck.error ?? 'Cannot write to path outside workspace',
          pathCheck.suggestedPath ? `Suggested path: ${pathCheck.suggestedPath}` : undefined,
        );
      }

      const fs = await import('node:fs/promises');
      await fs.writeFile(outputPath, result.audio);
      savedPath = outputPath;
    } else {
      // Save to temp file
      const fs = await import('node:fs/promises');
      const os = await import('node:os');
      const path = await import('node:path');
      const tempDir = os.tmpdir();
      savedPath = path.join(tempDir, `tts_${Date.now()}.${result.format}`);
      await fs.writeFile(savedPath, result.audio);
    }

    return {
      content: {
        success: true,
        provider: result.provider,
        model: result.model,
        format: result.format,
        audioSize: result.audio.length,
        savedTo: savedPath,
        textLength: text.length,
        voice,
        speed,
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to generate speech';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// SPEECH TO TEXT EXECUTOR
// =============================================================================

export const mediaSTTExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const language = params.language as string | undefined;
  const prompt = params.prompt as string | undefined;
  const responseFormat = (params.responseFormat as string) || 'json';
  const timestamps = params.timestamps === true;

  // Check if provider is configured
  if (!(await isProviderConfigured('stt'))) {
    return errorResult(
      'No STT provider configured',
      'Configure an STT provider in Settings → Media Settings'
    );
  }

  try {
    let audioSource: Buffer | string;

    // Handle URL vs file path
    if (source.startsWith('http://') || source.startsWith('https://')) {
      const response = await fetch(source);
      audioSource = Buffer.from(await response.arrayBuffer());
    } else {
      // File path - verify exists
      const fs = await import('node:fs/promises');
      await fs.access(source);
      audioSource = source;
    }

    const mediaService = await getMediaService();

    const result = await mediaService.speechToText({
      audio: audioSource,
      language,
      prompt,
      format: responseFormat as 'json' | 'text' | 'srt' | 'vtt' | 'verbose_json',
      timestamps,
    });

    return {
      content: {
        success: true,
        provider: result.provider,
        model: result.model,
        text: result.text,
        language: result.language,
        duration: result.duration,
        segments: result.segments,
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to transcribe audio';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// AUDIO TRANSLATION EXECUTOR
// =============================================================================

export const mediaTranslateAudioExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const prompt = params.prompt as string | undefined;
  const responseFormat = (params.responseFormat as string) || 'json';

  // Check if provider is configured
  if (!(await isProviderConfigured('stt'))) {
    return errorResult(
      'No STT provider configured (translation uses same provider)',
      'Configure an STT provider in Settings → Media Settings'
    );
  }

  // Note: Translation to English is typically a Whisper-specific feature
  // We'll use the same STT provider but with translation endpoint

  try {
    const fs = await import('node:fs/promises');

    // Verify file exists
    await fs.access(source);

    // For translation, we need OpenAI's translation endpoint
    const apiKey = await settingsRepo.get<string>('openai_api_key');
    if (!apiKey) {
      return errorResult(
        'Audio translation requires OpenAI API key',
        'Add your OpenAI API key in Settings → API Keys'
      );
    }

    // Use OpenAI translation endpoint
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const OpenAI = (await import(/* webpackIgnore: true */ 'openai' as string)).default as any;
    const openai = new OpenAI({ apiKey });

    const fileBuffer = await fs.readFile(source);
    const path = await import('node:path');
    const fileName = path.basename(source);
    const audioFile = new File([fileBuffer], fileName, { type: 'audio/mpeg' });

    const response = await openai.audio.translations.create({
      model: 'whisper-1',
      file: audioFile,
      prompt,
      response_format: responseFormat as 'json' | 'text' | 'srt' | 'vtt' | 'verbose_json',
    });

    const text = typeof response === 'string' ? response : response.text;

    return {
      content: {
        success: true,
        provider: 'openai',
        model: 'whisper-1',
        text,
        targetLanguage: 'English',
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to translate audio';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// EXPORT ALL MEDIA EXECUTORS
// =============================================================================

export const MEDIA_TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  // Image tools
  generate_image: mediaGenerateImageExecutor,
  analyze_image: mediaAnalyzeImageExecutor,
  // Audio tools
  text_to_speech: mediaTTSExecutor,
  speech_to_text: mediaSTTExecutor,
  translate_audio: mediaTranslateAudioExecutor,
};

/**
 * Check if media tools should use real implementations
 */
export async function shouldUseMediaTools(capability: MediaCapability): Promise<boolean> {
  return await isProviderConfigured(capability);
}
