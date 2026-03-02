/**
 * Voice Service
 *
 * Lightweight gateway-only service wrapping the existing audio-overrides
 * (OpenAI Whisper STT, OpenAI/ElevenLabs TTS) for programmatic use by
 * REST routes and channel normalizers.
 *
 * No core ServiceToken — the existing audio tools handle LLM-callable
 * operations. This service provides a clean API for non-tool consumers.
 */

import {
  resolveAudioConfig,
  callWhisperTranscribe,
  callOpenAITTS,
  callElevenLabsTTS,
  type WhisperResult,
} from './audio-overrides.js';
import { getLog } from './log.js';

const log = getLog('VoiceService');

// =============================================================================
// Types
// =============================================================================

export interface TranscribeOptions {
  language?: string;
  prompt?: string;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  duration?: number;
  segments?: Array<{ start: number; end: number; text: string }>;
}

export interface SynthesizeOptions {
  voice?: string;
  model?: string;
  speed?: number;
  format?: string;
}

export interface SynthesizeResult {
  audio: Buffer;
  format: string;
  contentType: string;
}

export interface VoiceConfigInfo {
  available: boolean;
  provider: string | null;
  sttSupported: boolean;
  ttsSupported: boolean;
  voices: Array<{ id: string; name: string }>;
}

const OPENAI_VOICES = [
  { id: 'alloy', name: 'Alloy' },
  { id: 'echo', name: 'Echo' },
  { id: 'fable', name: 'Fable' },
  { id: 'onyx', name: 'Onyx' },
  { id: 'nova', name: 'Nova' },
  { id: 'shimmer', name: 'Shimmer' },
];

const FORMAT_CONTENT_TYPE: Record<string, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/opus',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
  pcm: 'audio/pcm',
};

// =============================================================================
// Service
// =============================================================================

export class VoiceService {
  /**
   * Transcribe audio to text using Whisper.
   */
  async transcribe(
    audioBuffer: Buffer,
    filename: string,
    opts?: TranscribeOptions
  ): Promise<TranscribeResult> {
    const config = await resolveAudioConfig();
    if (!config) {
      throw new Error('Voice service not configured. Set up an AI provider or Audio Service in Config Center.');
    }

    const result: WhisperResult = await callWhisperTranscribe(
      config.apiKey,
      config.providerType === 'elevenlabs' ? 'https://api.openai.com' : config.baseUrl,
      audioBuffer,
      filename,
      {
        language: opts?.language,
        prompt: opts?.prompt,
        responseFormat: 'verbose_json',
      }
    );

    log.info(`Transcribed ${filename}: ${result.text.length} chars`);
    return result;
  }

  /**
   * Synthesize text to audio using TTS.
   */
  async synthesize(text: string, opts?: SynthesizeOptions): Promise<SynthesizeResult> {
    const config = await resolveAudioConfig();
    if (!config) {
      throw new Error('Voice service not configured. Set up an AI provider or Audio Service in Config Center.');
    }

    const voice = opts?.voice || 'alloy';
    const model = opts?.model || 'tts-1';
    const speed = Math.min(Math.max(opts?.speed || 1.0, 0.25), 4.0);
    const format = opts?.format || 'mp3';

    let audio: Buffer;

    if (config.providerType === 'elevenlabs') {
      audio = await callElevenLabsTTS(config.apiKey, config.baseUrl, text, voice);
    } else {
      audio = await callOpenAITTS(config.apiKey, config.baseUrl, text, voice, model, speed, format);
    }

    const contentType = FORMAT_CONTENT_TYPE[format] || 'audio/mpeg';
    log.info(`Synthesized ${text.length} chars -> ${Math.round(audio.length / 1024)}KB ${format}`);

    return { audio, format, contentType };
  }

  /**
   * Check if voice services are available.
   */
  async isAvailable(): Promise<boolean> {
    const config = await resolveAudioConfig();
    return config !== null;
  }

  /**
   * Get voice configuration info.
   */
  async getConfig(): Promise<VoiceConfigInfo> {
    const config = await resolveAudioConfig();
    if (!config) {
      return {
        available: false,
        provider: null,
        sttSupported: false,
        ttsSupported: false,
        voices: [],
      };
    }

    return {
      available: true,
      provider: config.providerType,
      sttSupported: config.providerType !== 'elevenlabs', // ElevenLabs is TTS-only
      ttsSupported: true,
      voices: config.providerType === 'elevenlabs' ? [] : OPENAI_VOICES,
    };
  }
}

// =============================================================================
// Singleton
// =============================================================================

let instance: VoiceService | null = null;

export function getVoiceService(): VoiceService {
  if (!instance) {
    instance = new VoiceService();
  }
  return instance;
}
