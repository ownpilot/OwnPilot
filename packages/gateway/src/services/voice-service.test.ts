/**
 * Voice Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockResolveAudioConfig,
  mockCallWhisperTranscribe,
  mockCallOpenAITTS,
  mockCallElevenLabsTTS,
} = vi.hoisted(() => ({
  mockResolveAudioConfig: vi.fn(),
  mockCallWhisperTranscribe: vi.fn(),
  mockCallOpenAITTS: vi.fn(),
  mockCallElevenLabsTTS: vi.fn(),
}));

vi.mock('./audio-overrides.js', () => ({
  resolveAudioConfig: mockResolveAudioConfig,
  callWhisperTranscribe: mockCallWhisperTranscribe,
  callOpenAITTS: mockCallOpenAITTS,
  callElevenLabsTTS: mockCallElevenLabsTTS,
}));

vi.mock('./log.js', () => ({
  getLog: vi.fn(() => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() })),
}));

import { VoiceService, getVoiceService } from './voice-service.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const openaiConfig = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com',
  providerType: 'openai',
};

const elevenLabsConfig = {
  apiKey: 'el-key',
  baseUrl: 'https://api.elevenlabs.io',
  providerType: 'elevenlabs',
};

const whisperResult = {
  text: 'Hello world',
  language: 'en',
  duration: 2.5,
  segments: [{ start: 0, end: 2.5, text: 'Hello world' }],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VoiceService', () => {
  let service: VoiceService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new VoiceService();
  });

  // ---- transcribe ----

  describe('transcribe', () => {
    it('throws when audio config is not configured', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(null);
      await expect(service.transcribe(Buffer.from('audio'), 'test.wav')).rejects.toThrow(
        'Voice service not configured'
      );
    });

    it('transcribes audio using Whisper with OpenAI config', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(openaiConfig);
      mockCallWhisperTranscribe.mockResolvedValueOnce(whisperResult);

      const result = await service.transcribe(Buffer.from('audio'), 'test.wav');
      expect(result).toBe(whisperResult);
      expect(mockCallWhisperTranscribe).toHaveBeenCalledWith(
        'sk-test',
        'https://api.openai.com',
        expect.any(Buffer),
        'test.wav',
        expect.objectContaining({ responseFormat: 'verbose_json' })
      );
    });

    it('uses https://api.openai.com as baseUrl for ElevenLabs (STT fallback)', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(elevenLabsConfig);
      mockCallWhisperTranscribe.mockResolvedValueOnce(whisperResult);

      await service.transcribe(Buffer.from('audio'), 'test.mp3');
      expect(mockCallWhisperTranscribe).toHaveBeenCalledWith(
        'el-key',
        'https://api.openai.com', // ElevenLabs falls back to OpenAI for STT
        expect.any(Buffer),
        'test.mp3',
        expect.any(Object)
      );
    });

    it('passes language and prompt options', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(openaiConfig);
      mockCallWhisperTranscribe.mockResolvedValueOnce(whisperResult);

      await service.transcribe(Buffer.from('audio'), 'test.wav', {
        language: 'fr',
        prompt: 'French speech',
      });

      expect(mockCallWhisperTranscribe).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ language: 'fr', prompt: 'French speech' })
      );
    });
  });

  // ---- synthesize ----

  describe('synthesize', () => {
    it('throws when audio config is not configured', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(null);
      await expect(service.synthesize('Hello world')).rejects.toThrow(
        'Voice service not configured'
      );
    });

    it('synthesizes using OpenAI TTS by default', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(openaiConfig);
      const audioBuffer = Buffer.from('mp3-data');
      mockCallOpenAITTS.mockResolvedValueOnce(audioBuffer);

      const result = await service.synthesize('Hello world');
      expect(result.audio).toBe(audioBuffer);
      expect(result.format).toBe('mp3');
      expect(result.contentType).toBe('audio/mpeg');
      expect(mockCallOpenAITTS).toHaveBeenCalledWith(
        'sk-test',
        'https://api.openai.com',
        'Hello world',
        'alloy', // default voice
        'tts-1', // default model
        1.0, // default speed
        'mp3' // default format
      );
    });

    it('synthesizes using ElevenLabs when providerType is elevenlabs', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(elevenLabsConfig);
      const audioBuffer = Buffer.from('el-audio');
      mockCallElevenLabsTTS.mockResolvedValueOnce(audioBuffer);

      const result = await service.synthesize('Hello ElevenLabs');
      expect(result.audio).toBe(audioBuffer);
      expect(mockCallElevenLabsTTS).toHaveBeenCalledWith(
        'el-key',
        'https://api.elevenlabs.io',
        'Hello ElevenLabs',
        'alloy' // default voice
      );
      expect(mockCallOpenAITTS).not.toHaveBeenCalled();
    });

    it('uses provided voice, model, speed, and format options', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(openaiConfig);
      mockCallOpenAITTS.mockResolvedValueOnce(Buffer.from('audio'));

      await service.synthesize('test', {
        voice: 'nova',
        model: 'tts-1-hd',
        speed: 1.5,
        format: 'opus',
      });

      expect(mockCallOpenAITTS).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'test',
        'nova',
        'tts-1-hd',
        1.5,
        'opus'
      );
    });

    it('clamps speed to min 0.25', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(openaiConfig);
      mockCallOpenAITTS.mockResolvedValueOnce(Buffer.from('audio'));

      await service.synthesize('test', { speed: 0.1 });
      expect(mockCallOpenAITTS).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        0.25,
        expect.anything()
      );
    });

    it('clamps speed to max 4.0', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(openaiConfig);
      mockCallOpenAITTS.mockResolvedValueOnce(Buffer.from('audio'));

      await service.synthesize('test', { speed: 10 });
      expect(mockCallOpenAITTS).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        4.0,
        expect.anything()
      );
    });

    it('uses audio/mpeg for unknown format', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(openaiConfig);
      mockCallOpenAITTS.mockResolvedValueOnce(Buffer.from('audio'));

      const result = await service.synthesize('test', { format: 'unknown-format' });
      expect(result.contentType).toBe('audio/mpeg');
    });

    it('returns correct contentType for opus format', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(openaiConfig);
      mockCallOpenAITTS.mockResolvedValueOnce(Buffer.from('audio'));

      const result = await service.synthesize('test', { format: 'opus' });
      expect(result.contentType).toBe('audio/opus');
    });

    it('returns correct contentType for wav format', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(openaiConfig);
      mockCallOpenAITTS.mockResolvedValueOnce(Buffer.from('audio'));

      const result = await service.synthesize('test', { format: 'wav' });
      expect(result.contentType).toBe('audio/wav');
    });
  });

  // ---- isAvailable ----

  describe('isAvailable', () => {
    it('returns true when config is available', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(openaiConfig);
      expect(await service.isAvailable()).toBe(true);
    });

    it('returns false when config is null', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(null);
      expect(await service.isAvailable()).toBe(false);
    });
  });

  // ---- getConfig ----

  describe('getConfig', () => {
    it('returns unavailable config when not configured', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(null);
      const config = await service.getConfig();
      expect(config).toEqual({
        available: false,
        provider: null,
        sttSupported: false,
        ttsSupported: false,
        voices: [],
      });
    });

    it('returns openai config with voices', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(openaiConfig);
      const config = await service.getConfig();
      expect(config.available).toBe(true);
      expect(config.provider).toBe('openai');
      expect(config.sttSupported).toBe(true);
      expect(config.ttsSupported).toBe(true);
      expect(config.voices.length).toBeGreaterThan(0);
      expect(config.voices[0]).toHaveProperty('id');
      expect(config.voices[0]).toHaveProperty('name');
    });

    it('returns elevenlabs config without voices and sttSupported=false', async () => {
      mockResolveAudioConfig.mockResolvedValueOnce(elevenLabsConfig);
      const config = await service.getConfig();
      expect(config.available).toBe(true);
      expect(config.provider).toBe('elevenlabs');
      expect(config.sttSupported).toBe(false); // ElevenLabs is TTS-only
      expect(config.ttsSupported).toBe(true);
      expect(config.voices).toEqual([]);
    });
  });
});

// ---- Singleton ----

describe('getVoiceService', () => {
  it('returns a VoiceService instance', () => {
    const svc = getVoiceService();
    expect(svc).toBeInstanceOf(VoiceService);
  });
});
