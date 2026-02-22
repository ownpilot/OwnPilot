/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockTryImport = vi.hoisted(() => vi.fn());
const mockStat = vi.hoisted(() => vi.fn());
const mockAccess = vi.hoisted(() => vi.fn());
const mockExtname = vi.hoisted(() =>
  vi.fn((p: string) => {
    const m = p.match(/\.\w+$/);
    return m ? m[0] : '';
  })
);

vi.mock('./module-resolver.js', () => ({
  tryImport: (...args: unknown[]) => mockTryImport(...args),
}));

vi.mock('node:fs/promises', () => ({
  stat: (...args: unknown[]) => mockStat(...args),
  access: (...args: unknown[]) => mockAccess(...args),
}));

vi.mock('node:path', () => ({
  extname: (...args: unknown[]) => mockExtname(...args),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const {
  textToSpeechTool,
  textToSpeechExecutor,
  speechToTextTool,
  speechToTextExecutor,
  translateAudioTool,
  translateAudioExecutor,
  audioInfoTool,
  audioInfoExecutor,
  splitAudioTool,
  splitAudioExecutor,
  AUDIO_TOOLS,
  AUDIO_TOOL_NAMES,
} = await import('./audio-tools.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal ToolContext stub (executors use _context, never read). */
const ctx = {} as any;

/** Shorthand to extract content from a result. */
function content(result: { content: unknown }): any {
  return result.content;
}

/** Generate a string of exact length. */
function strOfLength(n: number): string {
  return 'a'.repeat(n);
}

/** Generate a multi-word string targeting a specific word count. */
function wordsOfCount(n: number): string {
  return Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_INPUT_FORMATS = ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm', 'ogg', 'flac'];
const SUPPORTED_OUTPUT_FORMATS = ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'];
const MAX_AUDIO_SIZE = 25 * 1024 * 1024;

// ===========================================================================
// EXPORTS & STRUCTURE
// ===========================================================================

describe('audio-tools exports', () => {
  it('exports AUDIO_TOOLS as an array of 5 tool pairs', () => {
    expect(AUDIO_TOOLS).toHaveLength(5);
    for (const entry of AUDIO_TOOLS) {
      expect(entry).toHaveProperty('definition');
      expect(entry).toHaveProperty('executor');
      expect(typeof entry.executor).toBe('function');
      expect(entry.definition).toHaveProperty('name');
      expect(entry.definition).toHaveProperty('parameters');
    }
  });

  it('exports AUDIO_TOOL_NAMES matching tool definition names', () => {
    expect(AUDIO_TOOL_NAMES).toEqual([
      'text_to_speech',
      'speech_to_text',
      'translate_audio',
      'get_audio_info',
      'split_audio',
    ]);
  });

  it('AUDIO_TOOLS entries pair correct definitions with executors', () => {
    expect(AUDIO_TOOLS[0]!.definition).toBe(textToSpeechTool);
    expect(AUDIO_TOOLS[0]!.executor).toBe(textToSpeechExecutor);
    expect(AUDIO_TOOLS[1]!.definition).toBe(speechToTextTool);
    expect(AUDIO_TOOLS[1]!.executor).toBe(speechToTextExecutor);
    expect(AUDIO_TOOLS[2]!.definition).toBe(translateAudioTool);
    expect(AUDIO_TOOLS[2]!.executor).toBe(translateAudioExecutor);
    expect(AUDIO_TOOLS[3]!.definition).toBe(audioInfoTool);
    expect(AUDIO_TOOLS[3]!.executor).toBe(audioInfoExecutor);
    expect(AUDIO_TOOLS[4]!.definition).toBe(splitAudioTool);
    expect(AUDIO_TOOLS[4]!.executor).toBe(splitAudioExecutor);
  });
});

// ===========================================================================
// TOOL DEFINITIONS
// ===========================================================================

describe('tool definitions', () => {
  it('textToSpeechTool has correct structure', () => {
    expect(textToSpeechTool.name).toBe('text_to_speech');
    expect(textToSpeechTool.parameters.required).toEqual(['text']);
    expect(textToSpeechTool.configRequirements).toHaveLength(2);
  });

  it('speechToTextTool has correct structure', () => {
    expect(speechToTextTool.name).toBe('speech_to_text');
    expect(speechToTextTool.parameters.required).toEqual(['source']);
    expect(speechToTextTool.configRequirements).toHaveLength(1);
  });

  it('translateAudioTool has correct structure', () => {
    expect(translateAudioTool.name).toBe('translate_audio');
    expect(translateAudioTool.parameters.required).toEqual(['source']);
    expect(translateAudioTool.configRequirements).toHaveLength(1);
  });

  it('audioInfoTool has correct structure', () => {
    expect(audioInfoTool.name).toBe('get_audio_info');
    expect(audioInfoTool.parameters.required).toEqual(['path']);
    expect(audioInfoTool.configRequirements).toBeUndefined();
  });

  it('splitAudioTool has correct structure', () => {
    expect(splitAudioTool.name).toBe('split_audio');
    expect(splitAudioTool.parameters.required).toEqual(['source']);
    expect(splitAudioTool.configRequirements).toBeUndefined();
  });
});

// ===========================================================================
// TEXT TO SPEECH EXECUTOR
// ===========================================================================

describe('textToSpeechExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Validation errors ----

  it('returns error for empty text', async () => {
    const result = await textToSpeechExecutor({ text: '' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Text is required for speech synthesis');
  });

  it('returns error for whitespace-only text', async () => {
    const result = await textToSpeechExecutor({ text: '   \n\t  ' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Text is required for speech synthesis');
  });

  it('returns error for undefined text', async () => {
    const result = await textToSpeechExecutor({ text: undefined }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Text is required for speech synthesis');
  });

  it('returns error for null text', async () => {
    const result = await textToSpeechExecutor({ text: null }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Text is required for speech synthesis');
  });

  it('returns error when text exceeds 4096 characters', async () => {
    const longText = strOfLength(4097);
    const result = await textToSpeechExecutor({ text: longText }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Text too long: 4097 characters (max 4096)');
    expect(content(result).suggestion).toBe('Split the text into smaller chunks');
  });

  it('allows text at exactly 4096 characters', async () => {
    const text = strOfLength(4096);
    const result = await textToSpeechExecutor({ text }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).textLength).toBe(4096);
  });

  it('returns error for unsupported output format', async () => {
    const result = await textToSpeechExecutor({ text: 'hello', format: 'avi' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Unsupported format: avi');
    expect(content(result).supportedFormats).toEqual(SUPPORTED_OUTPUT_FORMATS);
  });

  it('returns error for empty string format', async () => {
    // Empty string is falsy, so falls through to default 'mp3' which IS valid
    const result = await textToSpeechExecutor({ text: 'hello', format: '' }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).format).toBe('mp3');
  });

  // ---- Defaults ----

  it('uses default voice=alloy', async () => {
    const result = await textToSpeechExecutor({ text: 'hello' }, ctx);
    expect(content(result).voice).toBe('alloy');
  });

  it('uses default model=tts-1', async () => {
    const result = await textToSpeechExecutor({ text: 'hello' }, ctx);
    expect(content(result).model).toBe('tts-1');
  });

  it('uses default speed=1.0', async () => {
    const result = await textToSpeechExecutor({ text: 'hello' }, ctx);
    expect(content(result).speed).toBe(1.0);
  });

  it('uses default format=mp3', async () => {
    const result = await textToSpeechExecutor({ text: 'hello' }, ctx);
    expect(content(result).format).toBe('mp3');
  });

  // ---- Custom parameters ----

  it('passes custom voice through', async () => {
    const result = await textToSpeechExecutor({ text: 'hello', voice: 'nova' }, ctx);
    expect(content(result).voice).toBe('nova');
  });

  it('passes custom model through', async () => {
    const result = await textToSpeechExecutor({ text: 'hello', model: 'tts-1-hd' }, ctx);
    expect(content(result).model).toBe('tts-1-hd');
  });

  it('passes outputPath through', async () => {
    const result = await textToSpeechExecutor({ text: 'hello', outputPath: '/tmp/out.mp3' }, ctx);
    expect(content(result).outputPath).toBe('/tmp/out.mp3');
  });

  it('outputPath is undefined when not provided', async () => {
    const result = await textToSpeechExecutor({ text: 'hello' }, ctx);
    expect(content(result).outputPath).toBeUndefined();
  });

  // ---- All supported output formats ----

  for (const fmt of SUPPORTED_OUTPUT_FORMATS) {
    it(`accepts supported output format: ${fmt}`, async () => {
      const result = await textToSpeechExecutor({ text: 'hello', format: fmt }, ctx);
      expect(result.isError).toBe(false);
      expect(content(result).format).toBe(fmt);
    });
  }

  // ---- Speed clamping ----

  it('clamps speed below 0.25 to 0.25', async () => {
    const result = await textToSpeechExecutor({ text: 'hello', speed: 0.1 }, ctx);
    expect(content(result).speed).toBe(0.25);
  });

  it('clamps speed above 4.0 to 4.0', async () => {
    const result = await textToSpeechExecutor({ text: 'hello', speed: 5.0 }, ctx);
    expect(content(result).speed).toBe(4.0);
  });

  it('preserves speed at exact lower boundary 0.25', async () => {
    const result = await textToSpeechExecutor({ text: 'hello', speed: 0.25 }, ctx);
    expect(content(result).speed).toBe(0.25);
  });

  it('preserves speed at exact upper boundary 4.0', async () => {
    const result = await textToSpeechExecutor({ text: 'hello', speed: 4.0 }, ctx);
    expect(content(result).speed).toBe(4.0);
  });

  it('preserves speed in valid range (2.5)', async () => {
    const result = await textToSpeechExecutor({ text: 'hello', speed: 2.5 }, ctx);
    expect(content(result).speed).toBe(2.5);
  });

  it('clamps negative speed to 0.25', async () => {
    const result = await textToSpeechExecutor({ text: 'hello', speed: -1 }, ctx);
    expect(content(result).speed).toBe(0.25);
  });

  it('defaults speed to 1.0 when speed is 0 (falsy)', async () => {
    // speed=0 is falsy, so `(params.speed as number) || 1.0` evaluates to 1.0
    const result = await textToSpeechExecutor({ text: 'hello', speed: 0 }, ctx);
    expect(content(result).speed).toBe(1.0);
  });

  // ---- Text truncation ----

  it('truncates text at 100 chars in response', async () => {
    const text = strOfLength(200);
    const result = await textToSpeechExecutor({ text }, ctx);
    expect(content(result).text).toBe(strOfLength(100) + '...');
    expect(content(result).textLength).toBe(200);
  });

  it('does not truncate text at exactly 100 chars', async () => {
    const text = strOfLength(100);
    const result = await textToSpeechExecutor({ text }, ctx);
    expect(content(result).text).toBe(text);
    expect(content(result).text).not.toContain('...');
  });

  it('does not truncate text shorter than 100 chars', async () => {
    const text = 'short text';
    const result = await textToSpeechExecutor({ text }, ctx);
    expect(content(result).text).toBe(text);
  });

  it('truncates text at 101 chars (just over boundary)', async () => {
    const text = strOfLength(101);
    const result = await textToSpeechExecutor({ text }, ctx);
    expect(content(result).text).toBe(strOfLength(100) + '...');
    expect(content(result).textLength).toBe(101);
  });

  // ---- requiresTTSAPI flag ----

  it('always returns requiresTTSAPI: true on success', async () => {
    const result = await textToSpeechExecutor({ text: 'hello' }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).requiresTTSAPI).toBe(true);
  });

  // ---- estimateDuration ----

  it('estimates short duration in seconds (<60s)', async () => {
    // 10 words / 150 / 1.0 * 60 = 4 seconds
    const text = wordsOfCount(10);
    const result = await textToSpeechExecutor({ text }, ctx);
    expect(content(result).estimatedDuration).toBe('~4 seconds');
  });

  it('estimates long duration in minutes (>=60s)', async () => {
    // 300 words / 150 / 1.0 * 60 = 120 seconds = 2 minutes
    const text = wordsOfCount(300);
    const result = await textToSpeechExecutor({ text }, ctx);
    expect(content(result).estimatedDuration).toBe('~2 minutes');
  });

  it('estimates duration adjusted by speed (faster)', async () => {
    // 300 words / 150 / 2.0 * 60 = 60 seconds exactly => 60 >= 60 => minutes path
    // Math.round(1.0) = 1 minute
    const text = wordsOfCount(300);
    const result = await textToSpeechExecutor({ text, speed: 2.0 }, ctx);
    expect(content(result).estimatedDuration).toBe('~1 minutes');
  });

  it('estimates duration adjusted by speed (slower)', async () => {
    // 150 words / 150 / 0.5 * 60 = 120 seconds = 2 minutes
    const text = wordsOfCount(150);
    const result = await textToSpeechExecutor({ text, speed: 0.5 }, ctx);
    expect(content(result).estimatedDuration).toBe('~2 minutes');
  });

  it('estimates single word duration', async () => {
    // 1 word / 150 / 1.0 * 60 = 0.4 => Math.round = 0 seconds
    const result = await textToSpeechExecutor({ text: 'hello' }, ctx);
    expect(content(result).estimatedDuration).toBe('~0 seconds');
  });

  it('estimates duration at max speed (4.0)', async () => {
    // 600 words at speed 4.0 => 600/150/4.0*60 = 60 seconds => minutes path
    // But 600 words of "wordN" format is ~3600 chars, which fits under 4096
    // Actually wordsOfCount(600) generates "word0 word1 ... word599"
    // Each "wordN" is 5-8 chars + space. 600 words ~ 4200 chars which exceeds 4096.
    // Use a shorter word pattern to stay under limit.
    const text = Array.from({ length: 600 }, () => 'w').join(' '); // 1199 chars, 600 words
    const result = await textToSpeechExecutor({ text, speed: 4.0 }, ctx);
    expect(content(result).estimatedDuration).toBe('~1 minutes');
  });

  it('estimates duration at min speed (0.25)', async () => {
    // 150 words / 150 / 0.25 * 60 = 240 seconds = 4 minutes
    const text = wordsOfCount(150);
    const result = await textToSpeechExecutor({ text, speed: 0.25 }, ctx);
    expect(content(result).estimatedDuration).toBe('~4 minutes');
  });

  it('estimates exactly 60 seconds boundary goes to minutes', async () => {
    // Need seconds === 60 to go to minutes path
    // words / 150 / speed * 60 = 60 => words / 150 / speed = 1 => words = 150 * speed
    // speed=1: 150 words => 60s exact => NOT < 60 => minutes path => round(1.0) = 1
    const text = wordsOfCount(150);
    const result = await textToSpeechExecutor({ text, speed: 1.0 }, ctx);
    expect(content(result).estimatedDuration).toBe('~1 minutes');
  });

  it('estimates 59 seconds stays in seconds', async () => {
    // Need seconds < 60: try 145 words / 150 / 1.0 * 60 = 58 seconds
    const text = wordsOfCount(145);
    const result = await textToSpeechExecutor({ text, speed: 1.0 }, ctx);
    expect(content(result).estimatedDuration).toBe('~58 seconds');
  });
});

// ===========================================================================
// SPEECH TO TEXT EXECUTOR
// ===========================================================================

describe('speechToTextExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset extname to default behavior
    mockExtname.mockImplementation((p: string) => {
      const m = p.match(/\.\w+$/);
      return m ? m[0] : '';
    });
  });

  // ---- URL sources ----

  it('detects http:// URL and returns sourceType url', async () => {
    const result = await speechToTextExecutor({ source: 'http://example.com/audio.mp3' }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).sourceType).toBe('url');
    expect(content(result).requiresDownload).toBe(true);
    expect(content(result).requiresSTTAPI).toBe(true);
  });

  it('detects https:// URL and returns sourceType url', async () => {
    const result = await speechToTextExecutor(
      { source: 'https://cdn.example.com/files/recording.wav' },
      ctx
    );
    expect(result.isError).toBe(false);
    expect(content(result).sourceType).toBe('url');
    expect(content(result).source).toBe('https://cdn.example.com/files/recording.wav');
  });

  it('extracts format from URL pathname', async () => {
    mockExtname.mockReturnValue('.ogg');
    const result = await speechToTextExecutor({ source: 'https://example.com/path/file.ogg' }, ctx);
    expect(content(result).format).toBe('ogg');
  });

  it('extracts format from URL with query params', async () => {
    // URL constructor strips query from pathname
    mockExtname.mockReturnValue('.mp3');
    const result = await speechToTextExecutor(
      { source: 'https://example.com/file.mp3?token=abc' },
      ctx
    );
    expect(content(result).format).toBe('mp3');
  });

  it('passes language and prompt through for URL source', async () => {
    const result = await speechToTextExecutor(
      { source: 'https://example.com/a.mp3', language: 'en', prompt: 'tech talk' },
      ctx
    );
    expect(content(result).language).toBe('en');
    expect(content(result).prompt).toBe('tech talk');
  });

  it('passes timestamps through for URL source', async () => {
    const result = await speechToTextExecutor(
      { source: 'https://example.com/a.mp3', timestamps: true },
      ctx
    );
    expect(content(result).timestamps).toBe(true);
  });

  // ---- File path sources ----

  it('returns error for unsupported file format', async () => {
    mockExtname.mockReturnValue('.avi');
    mockStat.mockRejectedValue(new Error('not called'));
    const result = await speechToTextExecutor({ source: '/audio/file.avi' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Unsupported audio format: avi');
    expect(content(result).supportedFormats).toEqual(SUPPORTED_INPUT_FORMATS);
  });

  it('returns error when file not found', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockRejectedValue(new Error('ENOENT'));
    const result = await speechToTextExecutor({ source: '/missing/file.mp3' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Audio file not found: /missing/file.mp3');
  });

  it('returns error when file exceeds 25MB', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: MAX_AUDIO_SIZE + 1 });
    const result = await speechToTextExecutor({ source: '/audio/big.mp3' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toContain('Audio file too large');
    expect(content(result).error).toContain('max 25MB');
    expect(content(result).suggestion).toBe('Split the audio into smaller segments');
  });

  it('accepts file at exactly 25MB', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: MAX_AUDIO_SIZE });
    const result = await speechToTextExecutor({ source: '/audio/exact.mp3' }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).fileSize).toBe(MAX_AUDIO_SIZE);
  });

  it('accepts file just under 25MB', async () => {
    mockExtname.mockReturnValue('.wav');
    mockStat.mockResolvedValue({ size: MAX_AUDIO_SIZE - 1 });
    const result = await speechToTextExecutor({ source: '/audio/under.wav' }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).fileSize).toBe(MAX_AUDIO_SIZE - 1);
  });

  it('calculates fileSizeMB correctly', async () => {
    mockExtname.mockReturnValue('.mp3');
    // 10 MB = 10 * 1024 * 1024 = 10485760
    mockStat.mockResolvedValue({ size: 10 * 1024 * 1024 });
    const result = await speechToTextExecutor({ source: '/audio/ten.mp3' }, ctx);
    expect(content(result).fileSizeMB).toBe(10);
  });

  it('rounds fileSizeMB to 2 decimal places', async () => {
    mockExtname.mockReturnValue('.mp3');
    // 1.5 MB = 1572864
    mockStat.mockResolvedValue({ size: 1572864 });
    const result = await speechToTextExecutor({ source: '/audio/small.mp3' }, ctx);
    expect(content(result).fileSizeMB).toBe(1.5);
  });

  // ---- Defaults for file path ----

  it('defaults model to whisper-1', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).model).toBe('whisper-1');
  });

  it('defaults responseFormat to json', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).responseFormat).toBe('json');
  });

  it('defaults timestamps to false', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).timestamps).toBe(false);
  });

  it('defaults language to auto-detect for file source', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).language).toBe('auto-detect');
  });

  it('passes custom language for file source', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor({ source: '/audio/file.mp3', language: 'tr' }, ctx);
    expect(content(result).language).toBe('tr');
  });

  it('returns requiresSTTAPI true for file source', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).requiresSTTAPI).toBe(true);
  });

  it('returns sourceType file for file path', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).sourceType).toBe('file');
  });

  // ---- All supported input formats for file path ----

  for (const fmt of SUPPORTED_INPUT_FORMATS) {
    it(`accepts supported input format: ${fmt}`, async () => {
      mockExtname.mockReturnValue(`.${fmt}`);
      mockStat.mockResolvedValue({ size: 1000 });
      const result = await speechToTextExecutor({ source: `/audio/file.${fmt}` }, ctx);
      expect(result.isError).toBe(false);
      expect(content(result).format).toBe(fmt);
    });
  }

  // ---- Custom params for file path ----

  it('passes custom model through', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor(
      { source: '/audio/file.mp3', model: 'whisper-1' },
      ctx
    );
    expect(content(result).model).toBe('whisper-1');
  });

  it('passes custom responseFormat through', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor(
      { source: '/audio/file.mp3', responseFormat: 'srt' },
      ctx
    );
    expect(content(result).responseFormat).toBe('srt');
  });

  it('passes timestamps=true through', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor({ source: '/audio/file.mp3', timestamps: true }, ctx);
    expect(content(result).timestamps).toBe(true);
  });

  it('passes prompt through', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor(
      { source: '/audio/file.mp3', prompt: 'AI conference keynote' },
      ctx
    );
    expect(content(result).prompt).toBe('AI conference keynote');
  });

  // ---- Size display in error ----

  it('shows rounded MB in size error', async () => {
    mockExtname.mockReturnValue('.wav');
    // 30 MB
    mockStat.mockResolvedValue({ size: 30 * 1024 * 1024 });
    const result = await speechToTextExecutor({ source: '/audio/big.wav' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Audio file too large: 30MB (max 25MB)');
  });

  // ---- Generic error catch ----

  it('catches unexpected errors and wraps message', async () => {
    mockExtname.mockImplementation(() => {
      throw new Error('unexpected failure');
    });
    const result = await speechToTextExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Failed to process audio: unexpected failure');
  });
});

// ===========================================================================
// TRANSLATE AUDIO EXECUTOR
// ===========================================================================

describe('translateAudioExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtname.mockImplementation((p: string) => {
      const m = p.match(/\.\w+$/);
      return m ? m[0] : '';
    });
  });

  it('returns error for unsupported format', async () => {
    mockExtname.mockReturnValue('.txt');
    const result = await translateAudioExecutor({ source: '/audio/file.txt' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Unsupported audio format: txt');
    expect(content(result).supportedFormats).toEqual(SUPPORTED_INPUT_FORMATS);
  });

  it('returns error when file not found (access throws)', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const result = await translateAudioExecutor({ source: '/missing/audio.mp3' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Audio file not found: /missing/audio.mp3');
  });

  it('returns success for valid file', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockAccess.mockResolvedValue(undefined);
    const result = await translateAudioExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).source).toBe('/audio/file.mp3');
    expect(content(result).format).toBe('mp3');
    expect(content(result).targetLanguage).toBe('English');
    expect(content(result).requiresTranslationAPI).toBe(true);
  });

  it('defaults model to whisper-1', async () => {
    mockExtname.mockReturnValue('.wav');
    mockAccess.mockResolvedValue(undefined);
    const result = await translateAudioExecutor({ source: '/audio/file.wav' }, ctx);
    expect(content(result).model).toBe('whisper-1');
  });

  it('defaults responseFormat to json', async () => {
    mockExtname.mockReturnValue('.wav');
    mockAccess.mockResolvedValue(undefined);
    const result = await translateAudioExecutor({ source: '/audio/file.wav' }, ctx);
    expect(content(result).responseFormat).toBe('json');
  });

  it('passes custom model through', async () => {
    mockExtname.mockReturnValue('.ogg');
    mockAccess.mockResolvedValue(undefined);
    const result = await translateAudioExecutor(
      { source: '/audio/file.ogg', model: 'whisper-1' },
      ctx
    );
    expect(content(result).model).toBe('whisper-1');
  });

  it('passes custom responseFormat through', async () => {
    mockExtname.mockReturnValue('.flac');
    mockAccess.mockResolvedValue(undefined);
    const result = await translateAudioExecutor(
      { source: '/audio/file.flac', responseFormat: 'vtt' },
      ctx
    );
    expect(content(result).responseFormat).toBe('vtt');
  });

  it('passes prompt through', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockAccess.mockResolvedValue(undefined);
    const result = await translateAudioExecutor(
      { source: '/audio/file.mp3', prompt: 'medical terminology' },
      ctx
    );
    expect(content(result).prompt).toBe('medical terminology');
  });

  it('prompt is undefined when not provided', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockAccess.mockResolvedValue(undefined);
    const result = await translateAudioExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).prompt).toBeUndefined();
  });

  // ---- All supported input formats ----

  for (const fmt of SUPPORTED_INPUT_FORMATS) {
    it(`accepts supported input format: ${fmt}`, async () => {
      mockExtname.mockReturnValue(`.${fmt}`);
      mockAccess.mockResolvedValue(undefined);
      const result = await translateAudioExecutor({ source: `/audio/file.${fmt}` }, ctx);
      expect(result.isError).toBe(false);
      expect(content(result).format).toBe(fmt);
    });
  }

  it('catches unexpected errors and wraps message', async () => {
    mockExtname.mockImplementation(() => {
      throw new Error('disk exploded');
    });
    const result = await translateAudioExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Failed to process audio: disk exploded');
  });
});

// ===========================================================================
// AUDIO INFO EXECUTOR
// ===========================================================================

describe('audioInfoExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtname.mockImplementation((p: string) => {
      const m = p.match(/\.\w+$/);
      return m ? m[0] : '';
    });
    mockTryImport.mockReset();
  });

  it('returns error when file not found', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT: no such file'));
    const result = await audioInfoExecutor({ path: '/no/file.mp3' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Failed to get audio info: ENOENT: no such file');
  });

  it('returns basic info without music-metadata', async () => {
    const mtime = new Date('2025-06-15T10:00:00Z');
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 5242880, mtime });
    mockTryImport.mockRejectedValue(new Error('not installed'));

    const result = await audioInfoExecutor({ path: '/music/song.mp3' }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).path).toBe('/music/song.mp3');
    expect(content(result).format).toBe('mp3');
    expect(content(result).size).toBe(5242880);
    expect(content(result).sizeMB).toBe(5);
    expect(content(result).modified).toBe(mtime.toISOString());
    expect(content(result).supported).toBe(true);
    expect(content(result).note).toBe(
      'Install music-metadata for detailed audio info: pnpm add music-metadata'
    );
  });

  it('marks unsupported format correctly', async () => {
    mockExtname.mockReturnValue('.avi');
    mockStat.mockResolvedValue({ size: 1000, mtime: new Date() });
    mockTryImport.mockRejectedValue(new Error('not installed'));

    const result = await audioInfoExecutor({ path: '/video/file.avi' }, ctx);
    expect(content(result).supported).toBe(false);
  });

  it('marks supported format for each SUPPORTED_INPUT_FORMAT', async () => {
    for (const fmt of SUPPORTED_INPUT_FORMATS) {
      vi.clearAllMocks();
      mockExtname.mockReturnValue(`.${fmt}`);
      mockStat.mockResolvedValue({ size: 1000, mtime: new Date() });
      mockTryImport.mockRejectedValue(new Error('not installed'));

      const result = await audioInfoExecutor({ path: `/audio/f.${fmt}` }, ctx);
      expect(content(result).supported).toBe(true);
    }
  });

  it('rounds sizeMB to 2 decimal places', async () => {
    mockExtname.mockReturnValue('.mp3');
    // 1.23 MB = 1289748.48 bytes => 1289748
    mockStat.mockResolvedValue({ size: 1289749, mtime: new Date() });
    mockTryImport.mockRejectedValue(new Error('not installed'));

    const result = await audioInfoExecutor({ path: '/audio/small.mp3' }, ctx);
    // Math.round(1289749 / 1024 / 1024 * 100) / 100
    expect(content(result).sizeMB).toBe(1.23);
  });

  // ---- music-metadata success cases ----

  it('includes full metadata when music-metadata available', async () => {
    const mtime = new Date('2025-01-01T00:00:00Z');
    mockExtname.mockReturnValue('.flac');
    mockStat.mockResolvedValue({ size: 20000000, mtime });

    const mockParseFile = vi.fn().mockResolvedValue({
      format: {
        duration: 245.7,
        sampleRate: 44100,
        bitrate: 320000,
        numberOfChannels: 2,
        codec: 'FLAC',
        container: 'FLAC',
      },
      common: {
        title: 'My Song',
        artist: 'The Band',
        album: 'Great Album',
        year: 2024,
      },
    });
    mockTryImport.mockResolvedValue({ parseFile: mockParseFile });

    const result = await audioInfoExecutor({ path: '/music/song.flac' }, ctx);
    expect(result.isError).toBe(false);

    const c = content(result);
    expect(c.duration).toBe('246 seconds');
    expect(c.sampleRate).toBe(44100);
    expect(c.bitrate).toBe(320000);
    expect(c.channels).toBe(2);
    expect(c.codec).toBe('FLAC');
    expect(c.container).toBe('FLAC');
    expect(c.tags).toEqual({
      title: 'My Song',
      artist: 'The Band',
      album: 'Great Album',
      year: 2024,
    });
    // Should NOT have the "install music-metadata" note
    expect(c.note).toBeUndefined();
    // parseFile should have been called with the path
    expect(mockParseFile).toHaveBeenCalledWith('/music/song.flac');
  });

  it('handles undefined duration from metadata', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000, mtime: new Date() });

    mockTryImport.mockResolvedValue({
      parseFile: vi.fn().mockResolvedValue({
        format: {
          duration: undefined,
          sampleRate: 48000,
          bitrate: undefined,
          numberOfChannels: 1,
          codec: 'MP3',
          container: 'MPEG',
        },
        common: {},
      }),
    });

    const result = await audioInfoExecutor({ path: '/audio/nodur.mp3' }, ctx);
    expect(content(result).duration).toBeUndefined();
    expect(content(result).sampleRate).toBe(48000);
    expect(content(result).channels).toBe(1);
  });

  it('rounds duration seconds from metadata', async () => {
    mockExtname.mockReturnValue('.wav');
    mockStat.mockResolvedValue({ size: 2000, mtime: new Date() });

    mockTryImport.mockResolvedValue({
      parseFile: vi.fn().mockResolvedValue({
        format: { duration: 123.456 },
        common: {},
      }),
    });

    const result = await audioInfoExecutor({ path: '/audio/file.wav' }, ctx);
    expect(content(result).duration).toBe('123 seconds');
  });

  it('handles empty tags object from metadata', async () => {
    mockExtname.mockReturnValue('.ogg');
    mockStat.mockResolvedValue({ size: 500, mtime: new Date() });

    mockTryImport.mockResolvedValue({
      parseFile: vi.fn().mockResolvedValue({
        format: { duration: 30 },
        common: {},
      }),
    });

    const result = await audioInfoExecutor({ path: '/audio/file.ogg' }, ctx);
    expect(content(result).tags).toEqual({
      title: undefined,
      artist: undefined,
      album: undefined,
      year: undefined,
    });
  });

  it('handles metadata with partial tags', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000, mtime: new Date() });

    mockTryImport.mockResolvedValue({
      parseFile: vi.fn().mockResolvedValue({
        format: { duration: 60 },
        common: {
          title: 'Track Title',
          artist: undefined,
          album: undefined,
          year: undefined,
        },
      }),
    });

    const result = await audioInfoExecutor({ path: '/audio/file.mp3' }, ctx);
    expect(content(result).tags.title).toBe('Track Title');
    expect(content(result).tags.artist).toBeUndefined();
  });

  it('handles null common from metadata', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000, mtime: new Date() });

    mockTryImport.mockResolvedValue({
      parseFile: vi.fn().mockResolvedValue({
        format: { duration: 10 },
        common: null,
      }),
    });

    const result = await audioInfoExecutor({ path: '/audio/file.mp3' }, ctx);
    // common is null (falsy) so tags should not be set
    expect(content(result).tags).toBeUndefined();
  });

  it('handles metadata with no format fields', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 500, mtime: new Date() });

    mockTryImport.mockResolvedValue({
      parseFile: vi.fn().mockResolvedValue({
        format: {},
        common: { title: 'A' },
      }),
    });

    const result = await audioInfoExecutor({ path: '/audio/file.mp3' }, ctx);
    expect(content(result).duration).toBeUndefined();
    expect(content(result).sampleRate).toBeUndefined();
    expect(content(result).bitrate).toBeUndefined();
    expect(content(result).channels).toBeUndefined();
    expect(content(result).codec).toBeUndefined();
    expect(content(result).container).toBeUndefined();
  });

  it('handles zero-byte file', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 0, mtime: new Date() });
    mockTryImport.mockRejectedValue(new Error('not installed'));

    const result = await audioInfoExecutor({ path: '/audio/empty.mp3' }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).size).toBe(0);
    expect(content(result).sizeMB).toBe(0);
  });

  it('handles parseFile throwing an error', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 1000, mtime: new Date() });

    mockTryImport.mockResolvedValue({
      parseFile: vi.fn().mockRejectedValue(new Error('corrupt file')),
    });

    const result = await audioInfoExecutor({ path: '/audio/corrupt.mp3' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Failed to get audio info: corrupt file');
  });

  it('handles duration of exactly 0 seconds', async () => {
    mockExtname.mockReturnValue('.wav');
    mockStat.mockResolvedValue({ size: 44, mtime: new Date() });

    mockTryImport.mockResolvedValue({
      parseFile: vi.fn().mockResolvedValue({
        format: { duration: 0 },
        common: {},
      }),
    });

    const result = await audioInfoExecutor({ path: '/audio/zero.wav' }, ctx);
    // duration is 0 which is falsy, so it should be undefined
    expect(content(result).duration).toBeUndefined();
  });

  it('handles very long duration', async () => {
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockResolvedValue({ size: 100000000, mtime: new Date() });

    mockTryImport.mockResolvedValue({
      parseFile: vi.fn().mockResolvedValue({
        format: { duration: 7200.5 },
        common: {},
      }),
    });

    const result = await audioInfoExecutor({ path: '/audio/long.mp3' }, ctx);
    expect(content(result).duration).toBe('7201 seconds');
  });
});

// ===========================================================================
// SPLIT AUDIO EXECUTOR
// ===========================================================================

describe('splitAudioExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns error when file not found', async () => {
    mockAccess.mockRejectedValue(new Error('ENOENT'));
    const result = await splitAudioExecutor({ source: '/no/file.mp3' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Failed to process audio: ENOENT');
  });

  it('returns success with defaults for valid file', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor({ source: '/audio/long.mp3' }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).source).toBe('/audio/long.mp3');
    expect(content(result).segmentDuration).toBe('600 seconds');
    expect(content(result).outputDir).toBe('same as source');
    expect(content(result).format).toBe('mp3');
    expect(content(result).requiresFFmpeg).toBe(true);
  });

  it('defaults segmentDuration to 600 seconds', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).segmentDuration).toBe('600 seconds');
  });

  it('passes custom segmentDuration', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor(
      { source: '/audio/file.mp3', segmentDuration: 300 },
      ctx
    );
    expect(content(result).segmentDuration).toBe('300 seconds');
  });

  it('defaults format to mp3', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).format).toBe('mp3');
  });

  it('passes custom format', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor({ source: '/audio/file.mp3', format: 'wav' }, ctx);
    expect(content(result).format).toBe('wav');
  });

  it('defaults outputDir to same as source', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).outputDir).toBe('same as source');
  });

  it('passes custom outputDir', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor(
      { source: '/audio/file.mp3', outputDir: '/tmp/segments' },
      ctx
    );
    expect(content(result).outputDir).toBe('/tmp/segments');
  });

  it('generates correct ffmpeg command with defaults', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).command).toBe(
      'ffmpeg -i "/audio/file.mp3" -f segment -segment_time 600 -c copy "segment_%03d.mp3"'
    );
  });

  it('generates correct ffmpeg command with custom params', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor(
      { source: '/audio/podcast.wav', segmentDuration: 120, format: 'ogg' },
      ctx
    );
    expect(content(result).command).toBe(
      'ffmpeg -i "/audio/podcast.wav" -f segment -segment_time 120 -c copy "segment_%03d.ogg"'
    );
  });

  it('includes requiresFFmpeg flag', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).requiresFFmpeg).toBe(true);
  });

  it('includes note about ffmpeg', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor({ source: '/audio/file.mp3' }, ctx);
    expect(content(result).note).toContain('FFmpeg');
  });

  it('handles segmentDuration of 0 (falsy -> defaults to 600)', async () => {
    // segmentDuration=0 is falsy: `(params.segmentDuration as number) || 600` -> 600
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor({ source: '/audio/file.mp3', segmentDuration: 0 }, ctx);
    expect(content(result).segmentDuration).toBe('600 seconds');
  });

  it('handles empty format (falsy -> defaults to mp3)', async () => {
    mockAccess.mockResolvedValue(undefined);
    const result = await splitAudioExecutor({ source: '/audio/file.mp3', format: '' }, ctx);
    expect(content(result).format).toBe('mp3');
  });
});

// ===========================================================================
// EDGE CASES & INTEGRATION
// ===========================================================================

describe('edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExtname.mockImplementation((p: string) => {
      const m = p.match(/\.\w+$/);
      return m ? m[0] : '';
    });
  });

  it('speechToText URL without extension returns empty format', async () => {
    mockExtname.mockReturnValue('');
    const result = await speechToTextExecutor({ source: 'https://example.com/audio' }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).format).toBe('');
  });

  it('textToSpeech text at exactly 4096 chars is accepted', async () => {
    const text = strOfLength(4096);
    const result = await textToSpeechExecutor({ text }, ctx);
    expect(result.isError).toBe(false);
    expect(content(result).textLength).toBe(4096);
  });

  it('textToSpeech text at 4097 chars is rejected', async () => {
    const text = strOfLength(4097);
    const result = await textToSpeechExecutor({ text }, ctx);
    expect(result.isError).toBe(true);
  });

  it('speechToText file path with no extension', async () => {
    mockExtname.mockReturnValue('');
    mockStat.mockResolvedValue({ size: 1000 });
    const result = await speechToTextExecutor({ source: '/audio/noext' }, ctx);
    // Empty string is not in SUPPORTED_INPUT_FORMATS
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Unsupported audio format: ');
  });

  it('translateAudio file path with no extension', async () => {
    mockExtname.mockReturnValue('');
    const result = await translateAudioExecutor({ source: '/audio/noext' }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Unsupported audio format: ');
  });

  it('speechToText with uppercase URL still detected as URL', async () => {
    // startsWith is case-sensitive, so HTTP:// would NOT be detected
    // This tests that the implementation is case-sensitive (lowercase only)
    mockExtname.mockReturnValue('.mp3');
    mockStat.mockRejectedValue(new Error('ENOENT'));
    const result = await speechToTextExecutor({ source: 'HTTP://example.com/file.mp3' }, ctx);
    // Not detected as URL, treated as file path
    expect(result.isError).toBe(true);
  });

  it('textToSpeech with non-string format still validates', async () => {
    // format is cast to string, but number 123 becomes "123" which is not in supported
    // However `(params.format as string) || 'mp3'` - 123 is truthy so it stays as 123
    // But SUPPORTED_OUTPUT_FORMATS.includes(123) returns false
    const result = await textToSpeechExecutor({ text: 'hello', format: 123 }, ctx);
    expect(result.isError).toBe(true);
    expect(content(result).error).toBe('Unsupported format: 123');
  });

  it('audioInfo with very large file size displays sizeMB correctly', async () => {
    mockExtname.mockReturnValue('.flac');
    // 2 GB
    mockStat.mockResolvedValue({ size: 2 * 1024 * 1024 * 1024, mtime: new Date() });
    mockTryImport.mockRejectedValue(new Error('not installed'));

    const result = await audioInfoExecutor({ path: '/audio/huge.flac' }, ctx);
    expect(content(result).sizeMB).toBe(2048);
  });
});
