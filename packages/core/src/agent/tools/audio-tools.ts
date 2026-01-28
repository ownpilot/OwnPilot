/**
 * Audio Tools
 * Text-to-Speech (TTS) and Speech-to-Text (STT/Whisper)
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';

// Supported audio formats
const SUPPORTED_INPUT_FORMATS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'ogg', 'flac'];
const SUPPORTED_OUTPUT_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];

// Maximum file size for audio (25MB for Whisper API)
const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

// ============================================================================
// TEXT TO SPEECH TOOL
// ============================================================================

export const textToSpeechTool: ToolDefinition = {
  name: 'text_to_speech',
  description: 'Convert text to spoken audio using AI voices. Supports multiple languages and voice styles.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Text to convert to speech',
      },
      voice: {
        type: 'string',
        description: 'Voice to use for synthesis',
        enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
      },
      model: {
        type: 'string',
        description: 'TTS model',
        enum: ['tts-1', 'tts-1-hd'],
      },
      speed: {
        type: 'number',
        description: 'Speech speed (0.25 to 4.0, default: 1.0)',
      },
      format: {
        type: 'string',
        description: 'Output audio format',
        enum: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'],
      },
      outputPath: {
        type: 'string',
        description: 'Path to save the audio file',
      },
    },
    required: ['text'],
  },
};

export const textToSpeechExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const text = params.text as string;
  const voice = (params.voice as string) || 'alloy';
  const model = (params.model as string) || 'tts-1';
  const speed = Math.min(Math.max((params.speed as number) || 1.0, 0.25), 4.0);
  const format = (params.format as string) || 'mp3';
  const outputPath = params.outputPath as string | undefined;

  // Validate text
  if (!text || text.trim().length === 0) {
    return {
      content: { error: 'Text is required for speech synthesis' },
      isError: true,
    };
  }

  // Text length limit (4096 characters for OpenAI)
  if (text.length > 4096) {
    return {
      content: {
        error: `Text too long: ${text.length} characters (max 4096)`,
        suggestion: 'Split the text into smaller chunks',
      },
      isError: true,
    };
  }

  // Validate format
  if (!SUPPORTED_OUTPUT_FORMATS.includes(format)) {
    return {
      content: {
        error: `Unsupported format: ${format}`,
        supportedFormats: SUPPORTED_OUTPUT_FORMATS,
      },
      isError: true,
    };
  }

  // Return placeholder - actual TTS requires API integration
  return {
    content: {
      text: text.length > 100 ? text.substring(0, 100) + '...' : text,
      textLength: text.length,
      voice,
      model,
      speed,
      format,
      outputPath,
      estimatedDuration: estimateDuration(text, speed),
      requiresTTSAPI: true,
      note: 'Text-to-speech requires TTS API integration (OpenAI, ElevenLabs, etc.). Override this executor in gateway.',
    },
    isError: false,
  };
};

/**
 * Estimate audio duration based on text length and speed
 */
function estimateDuration(text: string, speed: number): string {
  // Average speaking rate: ~150 words per minute
  const words = text.split(/\s+/).length;
  const baseMinutes = words / 150;
  const adjustedMinutes = baseMinutes / speed;
  const seconds = Math.round(adjustedMinutes * 60);

  if (seconds < 60) {
    return `~${seconds} seconds`;
  }
  return `~${Math.round(adjustedMinutes)} minutes`;
}

// ============================================================================
// SPEECH TO TEXT TOOL
// ============================================================================

export const speechToTextTool: ToolDefinition = {
  name: 'speech_to_text',
  description: 'Transcribe audio to text using AI (Whisper). Supports multiple languages and audio formats.',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Path to audio file or URL',
      },
      language: {
        type: 'string',
        description: 'Language code (e.g., "en", "es", "tr") for better accuracy. Omit for auto-detection.',
      },
      prompt: {
        type: 'string',
        description: 'Optional context to guide transcription (e.g., technical terms, names)',
      },
      model: {
        type: 'string',
        description: 'Whisper model',
        enum: ['whisper-1'],
      },
      responseFormat: {
        type: 'string',
        description: 'Output format',
        enum: ['json', 'text', 'srt', 'vtt', 'verbose_json'],
      },
      timestamps: {
        type: 'boolean',
        description: 'Include word-level timestamps (verbose_json format)',
      },
    },
    required: ['source'],
  },
};

export const speechToTextExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const language = params.language as string | undefined;
  const prompt = params.prompt as string | undefined;
  const model = (params.model as string) || 'whisper-1';
  const responseFormat = (params.responseFormat as string) || 'json';
  const timestamps = params.timestamps === true;

  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    let audioPath: string;
    let audioFormat: string;
    let fileSize: number;

    // Check if URL or file path
    if (source.startsWith('http://') || source.startsWith('https://')) {
      // URL - would need to download first
      const urlPath = new URL(source).pathname;
      audioFormat = path.extname(urlPath).slice(1).toLowerCase();

      return {
        content: {
          source,
          sourceType: 'url',
          format: audioFormat,
          language,
          prompt,
          model,
          responseFormat,
          timestamps,
          requiresDownload: true,
          requiresSTTAPI: true,
          note: 'URL audio sources need to be downloaded first. Override this executor in gateway.',
        },
        isError: false,
      };
    }

    // File path
    audioPath = source;
    audioFormat = path.extname(source).slice(1).toLowerCase();

    // Validate format
    if (!SUPPORTED_INPUT_FORMATS.includes(audioFormat)) {
      return {
        content: {
          error: `Unsupported audio format: ${audioFormat}`,
          supportedFormats: SUPPORTED_INPUT_FORMATS,
        },
        isError: true,
      };
    }

    // Check file exists and size
    try {
      const stats = await fs.stat(audioPath);
      fileSize = stats.size;

      if (fileSize > MAX_AUDIO_SIZE) {
        return {
          content: {
            error: `Audio file too large: ${Math.round(fileSize / 1024 / 1024)}MB (max 25MB)`,
            suggestion: 'Split the audio into smaller segments',
          },
          isError: true,
        };
      }
    } catch {
      return {
        content: { error: `Audio file not found: ${audioPath}` },
        isError: true,
      };
    }

    return {
      content: {
        source: audioPath,
        sourceType: 'file',
        format: audioFormat,
        fileSize,
        fileSizeMB: Math.round(fileSize / 1024 / 1024 * 100) / 100,
        language: language || 'auto-detect',
        prompt,
        model,
        responseFormat,
        timestamps,
        requiresSTTAPI: true,
        note: 'Speech-to-text requires Whisper API integration. Override this executor in gateway.',
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error;
    return {
      content: { error: `Failed to process audio: ${err.message}` },
      isError: true,
    };
  }
};

// ============================================================================
// TRANSLATE AUDIO TOOL
// ============================================================================

export const translateAudioTool: ToolDefinition = {
  name: 'translate_audio',
  description: 'Translate audio from any language to English text',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Path to audio file',
      },
      prompt: {
        type: 'string',
        description: 'Optional context for better translation',
      },
      model: {
        type: 'string',
        description: 'Whisper model',
        enum: ['whisper-1'],
      },
      responseFormat: {
        type: 'string',
        description: 'Output format',
        enum: ['json', 'text', 'srt', 'vtt', 'verbose_json'],
      },
    },
    required: ['source'],
  },
};

export const translateAudioExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const prompt = params.prompt as string | undefined;
  const model = (params.model as string) || 'whisper-1';
  const responseFormat = (params.responseFormat as string) || 'json';

  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const audioFormat = path.extname(source).slice(1).toLowerCase();

    // Validate format
    if (!SUPPORTED_INPUT_FORMATS.includes(audioFormat)) {
      return {
        content: {
          error: `Unsupported audio format: ${audioFormat}`,
          supportedFormats: SUPPORTED_INPUT_FORMATS,
        },
        isError: true,
      };
    }

    // Check file exists
    try {
      await fs.access(source);
    } catch {
      return {
        content: { error: `Audio file not found: ${source}` },
        isError: true,
      };
    }

    return {
      content: {
        source,
        format: audioFormat,
        prompt,
        model,
        responseFormat,
        targetLanguage: 'English',
        requiresTranslationAPI: true,
        note: 'Audio translation requires Whisper translation API. Override this executor in gateway.',
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error;
    return {
      content: { error: `Failed to process audio: ${err.message}` },
      isError: true,
    };
  }
};

// ============================================================================
// AUDIO INFO TOOL
// ============================================================================

export const audioInfoTool: ToolDefinition = {
  name: 'audio_info',
  description: 'Get information about an audio file (duration, format, sample rate)',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Path to the audio file',
      },
    },
    required: ['path'],
  },
};

export const audioInfoExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const audioPath = params.path as string;

  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // Check file exists
    const stats = await fs.stat(audioPath);
    const format = path.extname(audioPath).slice(1).toLowerCase();

    // Basic info without external libraries
    const info: Record<string, unknown> = {
      path: audioPath,
      format,
      size: stats.size,
      sizeMB: Math.round(stats.size / 1024 / 1024 * 100) / 100,
      modified: stats.mtime.toISOString(),
      supported: SUPPORTED_INPUT_FORMATS.includes(format),
    };

    // Try to use music-metadata if available for detailed info
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let musicMetadata: any;
    try {
      musicMetadata = await import(/* webpackIgnore: true */ 'music-metadata' as string);
    } catch {
      // music-metadata not installed
    }

    if (musicMetadata) {
      const metadata = await musicMetadata.parseFile(audioPath);

      info.duration = metadata.format.duration
        ? `${Math.round(metadata.format.duration)} seconds`
        : undefined;
      info.sampleRate = metadata.format.sampleRate;
      info.bitrate = metadata.format.bitrate;
      info.channels = metadata.format.numberOfChannels;
      info.codec = metadata.format.codec;
      info.container = metadata.format.container;

      // Include tags if available
      if (metadata.common) {
        info.tags = {
          title: metadata.common.title,
          artist: metadata.common.artist,
          album: metadata.common.album,
          year: metadata.common.year,
        };
      }
    } else {
      info.note = 'Install music-metadata for detailed audio info: pnpm add music-metadata';
    }

    return { content: info, isError: false };
  } catch (error: unknown) {
    const err = error as Error;
    return {
      content: { error: `Failed to get audio info: ${err.message}` },
      isError: true,
    };
  }
};

// ============================================================================
// SPLIT AUDIO TOOL
// ============================================================================

export const splitAudioTool: ToolDefinition = {
  name: 'split_audio',
  description: 'Split an audio file into smaller segments (useful for transcription of long files)',
  parameters: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Path to the audio file',
      },
      segmentDuration: {
        type: 'number',
        description: 'Duration of each segment in seconds (default: 600 = 10 minutes)',
      },
      outputDir: {
        type: 'string',
        description: 'Directory to save segments',
      },
      format: {
        type: 'string',
        description: 'Output format for segments',
        enum: ['mp3', 'wav', 'ogg'],
      },
    },
    required: ['source'],
  },
};

export const splitAudioExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const segmentDuration = (params.segmentDuration as number) || 600;
  const outputDir = params.outputDir as string | undefined;
  const format = (params.format as string) || 'mp3';

  try {
    const fs = await import('node:fs/promises');

    // Check source exists
    await fs.access(source);

    return {
      content: {
        source,
        segmentDuration: `${segmentDuration} seconds`,
        outputDir: outputDir || 'same as source',
        format,
        requiresFFmpeg: true,
        note: 'Audio splitting requires FFmpeg. Ensure ffmpeg is installed and in PATH.',
        command: `ffmpeg -i "${source}" -f segment -segment_time ${segmentDuration} -c copy "segment_%03d.${format}"`,
      },
      isError: false,
    };
  } catch (error: unknown) {
    const err = error as Error;
    return {
      content: { error: `Failed to process audio: ${err.message}` },
      isError: true,
    };
  }
};

// ============================================================================
// EXPORT ALL AUDIO TOOLS
// ============================================================================

export const AUDIO_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: textToSpeechTool, executor: textToSpeechExecutor },
  { definition: speechToTextTool, executor: speechToTextExecutor },
  { definition: translateAudioTool, executor: translateAudioExecutor },
  { definition: audioInfoTool, executor: audioInfoExecutor },
  { definition: splitAudioTool, executor: splitAudioExecutor },
];

export const AUDIO_TOOL_NAMES = AUDIO_TOOLS.map((t) => t.definition.name);
