/**
 * Voice Routes Tests
 *
 * Integration tests for the voice API endpoints.
 * Mocks getVoiceService() from the voice-service module.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { requestId } from '../middleware/request-id.js';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockService = {
  getConfig: vi.fn(),
  isAvailable: vi.fn(),
  transcribe: vi.fn(),
  synthesize: vi.fn(),
};

vi.mock('../services/voice-service.js', () => ({
  getVoiceService: vi.fn(() => mockService),
}));

// Import after mocks
const { voiceRoutes } = await import('./voice.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.use('*', requestId);
  app.route('/voice', voiceRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFormData(fileContent: Uint8Array, filename: string, language?: string): FormData {
  const fd = new FormData();
  fd.append('file', new File([fileContent], filename, { type: 'audio/webm' }));
  if (language) fd.append('language', language);
  return fd;
}

// ---------------------------------------------------------------------------
// GET /voice/config
// ---------------------------------------------------------------------------

describe('GET /voice/config', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it('returns voice config when service is available', async () => {
    mockService.getConfig.mockResolvedValueOnce({
      available: true,
      provider: 'openai',
      sttSupported: true,
      ttsSupported: true,
      voices: [{ id: 'alloy', name: 'Alloy' }],
    });

    const res = await app.request('/voice/config');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.available).toBe(true);
    expect(json.data.provider).toBe('openai');
    expect(json.data.voices).toHaveLength(1);
  });

  it('returns not-available config when service is not configured', async () => {
    mockService.getConfig.mockResolvedValueOnce({
      available: false,
      provider: null,
      sttSupported: false,
      ttsSupported: false,
      voices: [],
    });

    const res = await app.request('/voice/config');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.available).toBe(false);
    expect(json.data.provider).toBeNull();
  });

  it('returns 500 when getConfig throws', async () => {
    mockService.getConfig.mockRejectedValueOnce(new Error('Config read failure'));

    const res = await app.request('/voice/config');

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.message).toContain('Config read failure');
  });
});

// ---------------------------------------------------------------------------
// POST /voice/transcribe
// ---------------------------------------------------------------------------

describe('POST /voice/transcribe', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService.isAvailable.mockResolvedValue(true);
    mockService.transcribe.mockResolvedValue({
      text: 'Hello world',
      language: 'en',
      duration: 2.5,
    });
    app = createApp();
  });

  it('transcribes audio file and returns text', async () => {
    const audio = new Uint8Array([1, 2, 3, 4, 5]);
    const fd = makeFormData(audio, 'recording.webm');

    const res = await app.request('/voice/transcribe', {
      method: 'POST',
      body: fd,
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.text).toBe('Hello world');
    expect(mockService.transcribe).toHaveBeenCalledWith(expect.any(Buffer), 'recording.webm', {
      language: undefined,
    });
  });

  it('passes language parameter from form field', async () => {
    const audio = new Uint8Array([1, 2, 3]);
    const fd = makeFormData(audio, 'audio.webm', 'fr');

    const res = await app.request('/voice/transcribe', {
      method: 'POST',
      body: fd,
    });

    expect(res.status).toBe(200);
    expect(mockService.transcribe).toHaveBeenCalledWith(expect.any(Buffer), 'audio.webm', {
      language: 'fr',
    });
  });

  it('returns 503 when voice service is not available', async () => {
    mockService.isAvailable.mockResolvedValueOnce(false);
    const audio = new Uint8Array([1, 2, 3]);
    const fd = makeFormData(audio, 'audio.webm');

    const res = await app.request('/voice/transcribe', {
      method: 'POST',
      body: fd,
    });

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.message).toContain('not configured');
  });

  it('returns 400 when no file is provided', async () => {
    const fd = new FormData();
    // No file field appended

    const res = await app.request('/voice/transcribe', {
      method: 'POST',
      body: fd,
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('"file"');
  });

  it('returns 400 when file field is a plain string', async () => {
    const fd = new FormData();
    fd.append('file', 'not-a-file');

    const res = await app.request('/voice/transcribe', {
      method: 'POST',
      body: fd,
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('"file"');
  });

  it('returns 400 when audio file is empty', async () => {
    const fd = makeFormData(new Uint8Array(0), 'empty.webm');

    const res = await app.request('/voice/transcribe', {
      method: 'POST',
      body: fd,
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('empty');
  });

  it('returns 400 when audio file exceeds 25MB limit', async () => {
    // 25MB + 1 byte
    const large = new Uint8Array(25 * 1024 * 1024 + 1);
    const fd = makeFormData(large, 'large.webm');

    const res = await app.request('/voice/transcribe', {
      method: 'POST',
      body: fd,
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('25MB');
  });

  it('returns 500 when transcribe throws', async () => {
    mockService.transcribe.mockRejectedValueOnce(new Error('Whisper API error'));
    const fd = makeFormData(new Uint8Array([1, 2, 3]), 'audio.webm');

    const res = await app.request('/voice/transcribe', {
      method: 'POST',
      body: fd,
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.message).toContain('Whisper API error');
  });
});

// ---------------------------------------------------------------------------
// POST /voice/synthesize
// ---------------------------------------------------------------------------

describe('POST /voice/synthesize', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService.isAvailable.mockResolvedValue(true);
    mockService.synthesize.mockResolvedValue({
      audio: Buffer.from([0xff, 0xfb, 0x90, 0x00]),
      format: 'mp3',
      contentType: 'audio/mpeg',
    });
    app = createApp();
  });

  it('synthesizes text and returns audio binary', async () => {
    const res = await app.request('/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello world' }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('audio/mpeg');
    expect(res.headers.get('X-Audio-Format')).toBe('mp3');
    expect(mockService.synthesize).toHaveBeenCalledWith('Hello world', {
      voice: undefined,
      speed: undefined,
      format: undefined,
    });
  });

  it('passes optional voice, speed and format options', async () => {
    const res = await app.request('/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Test',
        voice: 'nova',
        speed: 1.5,
        format: 'wav',
      }),
    });

    expect(res.status).toBe(200);
    expect(mockService.synthesize).toHaveBeenCalledWith('Test', {
      voice: 'nova',
      speed: 1.5,
      format: 'wav',
    });
  });

  it('returns 503 when voice service is not available', async () => {
    mockService.isAvailable.mockResolvedValueOnce(false);

    const res = await app.request('/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    });

    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.message).toContain('not configured');
  });

  it('returns 400 when text is missing', async () => {
    const res = await app.request('/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('Validation failed');
    expect(json.error.message).toContain('text');
  });

  it('returns 400 when text is empty string', async () => {
    const res = await app.request('/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('Validation failed');
  });

  it('returns 400 when text exceeds 4096 characters', async () => {
    const res = await app.request('/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'a'.repeat(4097) }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('Validation failed');
  });

  it('returns 500 when synthesize throws', async () => {
    mockService.synthesize.mockRejectedValueOnce(new Error('TTS provider error'));

    const res = await app.request('/voice/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Hello' }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.message).toContain('TTS provider error');
  });
});
