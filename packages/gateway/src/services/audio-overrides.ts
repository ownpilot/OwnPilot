/**
 * Audio Tool Overrides
 *
 * Replaces placeholder executors in core/audio-tools with real implementations:
 *   - text_to_speech:  OpenAI TTS API (or ElevenLabs)
 *   - speech_to_text:  OpenAI Whisper API
 *   - translate_audio: OpenAI Whisper translation API
 *   - split_audio:     FFmpeg-based splitting
 *
 * get_audio_info already works via music-metadata (not a stub).
 */

import type { ToolRegistry, ToolExecutor, ToolExecutionResult } from '@ownpilot/core';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { resolveProviderAndModel } from '../routes/settings.js';
import { getProviderApiKey, loadProviderConfig } from '../routes/agent-cache.js';
import { getLog } from './log.js';
import { getErrorMessage } from '../routes/helpers.js';

const log = getLog('AudioOverrides');

// ============================================================================
// Constants
// ============================================================================

const AUDIO_SERVICE = 'audio_service';
const SUPPORTED_OUTPUT_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];
const SUPPORTED_INPUT_FORMATS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'ogg', 'flac'];
const MAX_AUDIO_SIZE = 25 * 1024 * 1024; // 25MB (Whisper limit)

// ============================================================================
// Config Center Registration
// ============================================================================

async function ensureAudioService(): Promise<void> {
  try {
    await configServicesRepo.upsert({
      name: AUDIO_SERVICE,
      displayName: 'Audio Service',
      category: 'ai',
      description:
        'Audio service for text-to-speech and speech-to-text (OpenAI, ElevenLabs). Falls back to default AI provider if not configured.',
      configSchema: [
        {
          name: 'provider_type',
          label: 'Provider',
          type: 'string' as const,
          required: false,
          description: 'openai (default) or elevenlabs',
        },
        {
          name: 'api_key',
          label: 'API Key',
          type: 'secret' as const,
          required: false,
          description: 'Leave empty to use default AI provider key',
        },
        {
          name: 'base_url',
          label: 'Base URL',
          type: 'string' as const,
          required: false,
          description: 'Custom API endpoint',
        },
      ],
    });
  } catch (error) {
    log.debug('Config upsert for audio_service:', getErrorMessage(error));
  }
}

// ============================================================================
// API Key Resolution
// ============================================================================

interface AudioApiConfig {
  apiKey: string;
  baseUrl: string;
  providerType: string;
}

async function resolveAudioConfig(): Promise<AudioApiConfig | null> {
  // Check dedicated audio service first
  const audioKey = configServicesRepo.getFieldValue(AUDIO_SERVICE, 'api_key') as string | undefined;
  if (audioKey) {
    const providerType =
      (configServicesRepo.getFieldValue(AUDIO_SERVICE, 'provider_type') as string) || 'openai';
    const baseUrl =
      (configServicesRepo.getFieldValue(AUDIO_SERVICE, 'base_url') as string) ||
      getDefaultAudioBaseUrl(providerType);
    return { apiKey: audioKey, baseUrl, providerType };
  }

  // Fall back to default AI provider (if OpenAI-compatible)
  const { provider } = await resolveProviderAndModel('default', 'default');
  if (!provider) return null;

  const key = await getProviderApiKey(provider);
  if (!key) return null;

  const config = loadProviderConfig(provider);
  const baseUrl = config?.baseUrl || 'https://api.openai.com';

  return { apiKey: key, baseUrl, providerType: 'openai' };
}

function getDefaultAudioBaseUrl(providerType: string): string {
  switch (providerType) {
    case 'elevenlabs':
      return 'https://api.elevenlabs.io';
    default:
      return 'https://api.openai.com';
  }
}

const AUDIO_NOT_CONFIGURED =
  'Audio service not configured. Either configure an AI provider in Settings, or set up a dedicated Audio Service in Config Center.';

// ============================================================================
// text_to_speech Override
// ============================================================================

const textToSpeechOverride: ToolExecutor = async (
  params,
  context
): Promise<ToolExecutionResult> => {
  const text = params.text as string;
  const voice = (params.voice as string) || 'alloy';
  const model = (params.model as string) || 'tts-1';
  const speed = Math.min(Math.max((params.speed as number) || 1.0, 0.25), 4.0);
  const format = (params.format as string) || 'mp3';
  const outputPath = params.outputPath as string | undefined;

  if (!text?.trim()) {
    return { content: { error: 'Text is required for speech synthesis' }, isError: true };
  }
  if (text.length > 4096) {
    return {
      content: { error: `Text too long: ${text.length} characters (max 4096)` },
      isError: true,
    };
  }
  if (!SUPPORTED_OUTPUT_FORMATS.includes(format)) {
    return {
      content: {
        error: `Unsupported format: ${format}`,
        supportedFormats: SUPPORTED_OUTPUT_FORMATS,
      },
      isError: true,
    };
  }

  const config = await resolveAudioConfig();
  if (!config) {
    return { content: { error: AUDIO_NOT_CONFIGURED }, isError: true };
  }

  try {
    let audioBuffer: Buffer;

    if (config.providerType === 'elevenlabs') {
      audioBuffer = await callElevenLabsTTS(config.apiKey, config.baseUrl, text, voice);
    } else {
      audioBuffer = await callOpenAITTS(
        config.apiKey,
        config.baseUrl,
        text,
        voice,
        model,
        speed,
        format
      );
    }

    // Save to file
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const workDir = context.workspaceDir || '.';

    const filePath = outputPath || path.join(workDir, `tts_${Date.now()}.${format}`);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, audioBuffer);

    const stats = await fs.stat(filePath);
    log.info(`TTS generated: ${filePath} (${Math.round(stats.size / 1024)}KB)`);

    return {
      content: {
        success: true,
        path: filePath,
        format,
        size: stats.size,
        voice,
        model: config.providerType === 'elevenlabs' ? 'elevenlabs' : model,
        textLength: text.length,
      },
      isError: false,
    };
  } catch (error) {
    return {
      content: { error: `Failed to generate speech: ${getErrorMessage(error)}` },
      isError: true,
    };
  }
};

async function callOpenAITTS(
  apiKey: string,
  baseUrl: string,
  text: string,
  voice: string,
  model: string,
  speed: number,
  format: string
): Promise<Buffer> {
  const url = `${baseUrl}/v1/audio/speech`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text, voice, speed, response_format: format }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI TTS API ${response.status}: ${errText.slice(0, 500)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function callElevenLabsTTS(
  apiKey: string,
  baseUrl: string,
  text: string,
  voiceId: string
): Promise<Buffer> {
  // ElevenLabs uses voice IDs, default to a well-known voice
  const id = voiceId === 'alloy' ? '21m00Tcm4TlvDq8ikWAM' : voiceId;
  const url = `${baseUrl}/v1/text-to-speech/${id}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: 'eleven_monolingual_v1' }),
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`ElevenLabs TTS API ${response.status}: ${errText.slice(0, 500)}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

// ============================================================================
// speech_to_text Override (Whisper)
// ============================================================================

const speechToTextOverride: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const language = params.language as string | undefined;
  const prompt = params.prompt as string | undefined;
  const responseFormat = (params.responseFormat as string) || 'json';

  if (!source) {
    return { content: { error: 'Audio source path is required' }, isError: true };
  }

  const config = await resolveAudioConfig();
  if (!config) {
    return { content: { error: AUDIO_NOT_CONFIGURED }, isError: true };
  }

  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    let audioBuffer: Buffer;
    let filename: string;

    if (source.startsWith('http://') || source.startsWith('https://')) {
      // Download URL
      const resp = await fetch(source);
      if (!resp.ok) throw new Error(`Failed to download: ${resp.status}`);
      audioBuffer = Buffer.from(await resp.arrayBuffer());
      filename = path.basename(new URL(source).pathname) || 'audio.mp3';
    } else {
      // Local file
      const ext = path.extname(source).slice(1).toLowerCase();
      if (!SUPPORTED_INPUT_FORMATS.includes(ext)) {
        return {
          content: {
            error: `Unsupported format: ${ext}`,
            supportedFormats: SUPPORTED_INPUT_FORMATS,
          },
          isError: true,
        };
      }

      const stats = await fs.stat(source);
      if (stats.size > MAX_AUDIO_SIZE) {
        return {
          content: {
            error: `File too large: ${Math.round(stats.size / 1024 / 1024)}MB (max 25MB). Use split_audio to split it first.`,
          },
          isError: true,
        };
      }

      audioBuffer = await fs.readFile(source);
      filename = path.basename(source);
    }

    // Call Whisper API
    const result = await callWhisperTranscribe(
      config.apiKey,
      config.baseUrl,
      audioBuffer,
      filename,
      {
        language,
        prompt,
        responseFormat,
      }
    );

    return {
      content: {
        success: true,
        text: result.text,
        language: result.language ?? language ?? 'auto-detected',
        duration: result.duration,
        segments: result.segments,
        source,
      },
      isError: false,
    };
  } catch (error) {
    return { content: { error: `Failed to transcribe: ${getErrorMessage(error)}` }, isError: true };
  }
};

interface WhisperResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
}

async function callWhisperTranscribe(
  apiKey: string,
  baseUrl: string,
  audioBuffer: Buffer,
  filename: string,
  opts: { language?: string; prompt?: string; responseFormat?: string }
): Promise<WhisperResult> {
  const url = `${baseUrl}/v1/audio/transcriptions`;

  const formData = new FormData();
  formData.append('file', new Blob([new Uint8Array(audioBuffer)]), filename);
  formData.append('model', 'whisper-1');
  if (opts.language) formData.append('language', opts.language);
  if (opts.prompt) formData.append('prompt', opts.prompt);

  // Use verbose_json to get segments/timestamps
  const format = opts.responseFormat === 'text' ? 'text' : 'verbose_json';
  formData.append('response_format', format);

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Whisper API ${response.status}: ${errText.slice(0, 500)}`);
  }

  if (format === 'text') {
    return { text: await response.text() };
  }

  const data = (await response.json()) as {
    text: string;
    language?: string;
    duration?: number;
    segments?: Array<{ start: number; end: number; text: string }>;
  };

  return {
    text: data.text,
    language: data.language,
    duration: data.duration,
    segments: data.segments?.map((s) => ({ start: s.start, end: s.end, text: s.text })),
  };
}

// ============================================================================
// translate_audio Override
// ============================================================================

const translateAudioOverride: ToolExecutor = async (
  params,
  _context
): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const prompt = params.prompt as string | undefined;
  const responseFormat = (params.responseFormat as string) || 'json';

  if (!source) {
    return { content: { error: 'Audio source path is required' }, isError: true };
  }

  const config = await resolveAudioConfig();
  if (!config) {
    return { content: { error: AUDIO_NOT_CONFIGURED }, isError: true };
  }

  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const ext = path.extname(source).slice(1).toLowerCase();
    if (!SUPPORTED_INPUT_FORMATS.includes(ext)) {
      return {
        content: { error: `Unsupported format: ${ext}`, supportedFormats: SUPPORTED_INPUT_FORMATS },
        isError: true,
      };
    }

    const stats = await fs.stat(source);
    if (stats.size > MAX_AUDIO_SIZE) {
      return {
        content: { error: `File too large: ${Math.round(stats.size / 1024 / 1024)}MB (max 25MB)` },
        isError: true,
      };
    }

    const audioBuffer = await fs.readFile(source);
    const filename = path.basename(source);

    // Call Whisper Translation API
    const url = `${config.baseUrl}/v1/audio/translations`;

    const formData = new FormData();
    formData.append('file', new Blob([new Uint8Array(audioBuffer)]), filename);
    formData.append('model', 'whisper-1');
    if (prompt) formData.append('prompt', prompt);

    const format = responseFormat === 'text' ? 'text' : 'verbose_json';
    formData.append('response_format', format);

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Whisper Translation API ${response.status}: ${errText.slice(0, 500)}`);
    }

    if (format === 'text') {
      return {
        content: { success: true, text: await response.text(), targetLanguage: 'English', source },
        isError: false,
      };
    }

    const data = (await response.json()) as { text: string; duration?: number };
    return {
      content: {
        success: true,
        text: data.text,
        targetLanguage: 'English',
        duration: data.duration,
        source,
      },
      isError: false,
    };
  } catch (error) {
    return {
      content: { error: `Failed to translate audio: ${getErrorMessage(error)}` },
      isError: true,
    };
  }
};

// ============================================================================
// split_audio Override (FFmpeg)
// ============================================================================

const splitAudioOverride: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const source = params.source as string;
  const segmentDuration = (params.segmentDuration as number) || 600;
  const outputDir = params.outputDir as string | undefined;
  const format = (params.format as string) || 'mp3';

  if (!source) {
    return { content: { error: 'Audio source path is required' }, isError: true };
  }

  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    // Check source exists
    await fs.access(source);

    // Determine output directory
    const outDir =
      outputDir || path.join(context.workspaceDir || path.dirname(source), 'audio_segments');
    await fs.mkdir(outDir, { recursive: true });

    const baseName = path.basename(source, path.extname(source));
    const outputPattern = path.join(outDir, `${baseName}_segment_%03d.${format}`);

    // Run ffmpeg
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-i',
          source,
          '-f',
          'segment',
          '-segment_time',
          segmentDuration.toString(),
          '-c',
          'copy',
          '-y',
          outputPattern,
        ],
        { timeout: 300000 }
      ); // 5 min timeout
    } catch (ffmpegError) {
      const msg = getErrorMessage(ffmpegError);
      if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not recognized')) {
        return {
          content: {
            error: 'FFmpeg not installed. Install FFmpeg to split audio files.',
            suggestion: 'Download from https://ffmpeg.org or install via package manager',
          },
          isError: true,
        };
      }
      throw ffmpegError;
    }

    // List generated segments
    const files = await fs.readdir(outDir);
    const segments = files
      .filter((f) => f.startsWith(`${baseName}_segment_`) && f.endsWith(`.${format}`))
      .sort()
      .map((f) => path.join(outDir, f));

    log.info(`Audio split: ${segments.length} segments from ${source}`);

    return {
      content: {
        success: true,
        segments: segments.map((s) => ({ path: s })),
        segmentCount: segments.length,
        segmentDuration: `${segmentDuration} seconds`,
        format,
        outputDir: outDir,
      },
      isError: false,
    };
  } catch (error) {
    return {
      content: { error: `Failed to split audio: ${getErrorMessage(error)}` },
      isError: true,
    };
  }
};

// ============================================================================
// Registration
// ============================================================================

function tryUpdateExecutor(registry: ToolRegistry, name: string, executor: ToolExecutor): void {
  if (registry.updateExecutor(name, executor)) {
    log.info(`Overrode ${name}`);
  } else if (registry.updateExecutor(`core.${name}`, executor)) {
    log.info(`Overrode core.${name}`);
  }
}

export async function registerAudioOverrides(registry: ToolRegistry): Promise<void> {
  tryUpdateExecutor(registry, 'text_to_speech', textToSpeechOverride);
  tryUpdateExecutor(registry, 'speech_to_text', speechToTextOverride);
  tryUpdateExecutor(registry, 'translate_audio', translateAudioOverride);
  tryUpdateExecutor(registry, 'split_audio', splitAudioOverride);

  // Register Config Center service (async, non-blocking)
  ensureAudioService().catch((err) => log.debug('ensureAudioService:', getErrorMessage(err)));
}
