/**
 * Tests for Telegram File Handler
 *
 * Tests downloadTelegramAttachments which processes photos, documents,
 * audio, voice, and video attachments from Telegram messages.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (hoisted)
// ---------------------------------------------------------------------------

const mockLogWarn = vi.hoisted(() => vi.fn());
const mockLogDebug = vi.hoisted(() => vi.fn());

vi.mock('../../../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), debug: mockLogDebug, warn: mockLogWarn, error: vi.fn() }),
}));

const mockFetch = vi.hoisted(() => vi.fn());
vi.stubGlobal('fetch', mockFetch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

function createMockBot(
  fileResult: { file_path?: string; file_size?: number } = {
    file_path: 'photos/test.jpg',
    file_size: 1024,
  }
) {
  return {
    api: { getFile: vi.fn().mockResolvedValue(fileResult) },
    token: 'test-token-123',
  };
}

function createFetchResponse(buffer: Buffer, ok = true, status = 200) {
  return {
    ok,
    status,
    arrayBuffer: vi
      .fn()
      .mockResolvedValue(
        buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
      ),
  };
}

function makeMessage(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    message_id: 1,
    date: Date.now(),
    chat: { id: 1, type: 'private' },
    ...overrides,
  };
}

function makePhoto(fileId = 'photo-abc', fileSize = 1024, width = 800, height = 600) {
  return { file_id: fileId, file_unique_id: `u_${fileId}`, width, height, file_size: fileSize };
}

function makeDocument(overrides: Record<string, unknown> = {}) {
  return {
    file_id: 'doc-abc',
    file_unique_id: 'u_doc-abc',
    file_size: 2048,
    mime_type: 'application/pdf',
    file_name: 'report.pdf',
    ...overrides,
  };
}

function makeAudio(overrides: Record<string, unknown> = {}) {
  return {
    file_id: 'audio-abc',
    file_unique_id: 'u_audio-abc',
    file_size: 4096,
    mime_type: 'audio/mpeg',
    file_name: 'song.mp3',
    duration: 180,
    ...overrides,
  };
}

function makeVoice(overrides: Record<string, unknown> = {}) {
  return {
    file_id: 'voice-abc',
    file_unique_id: 'u_voice-abc',
    file_size: 8192,
    mime_type: 'audio/ogg',
    duration: 10,
    ...overrides,
  };
}

function makeVideo(overrides: Record<string, unknown> = {}) {
  return {
    file_id: 'video-abc',
    file_unique_id: 'u_video-abc',
    file_size: 10240,
    mime_type: 'video/mp4',
    file_name: 'clip.mp4',
    width: 1920,
    height: 1080,
    duration: 30,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Telegram File Handler', () => {
  let downloadTelegramAttachments: (typeof import('./file-handler.js'))['downloadTelegramAttachments'];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockReset();
    const mod = await import('./file-handler.js');
    downloadTelegramAttachments = mod.downloadTelegramAttachments;
  });

  // ==========================================================================
  // downloadTelegramFile (tested indirectly via downloadTelegramAttachments)
  // ==========================================================================

  describe('downloadTelegramFile (internal)', () => {
    it('should call bot.api.getFile with correct fileId', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('imagedata');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ photo: [makePhoto('photo-xyz')] });
      await downloadTelegramAttachments(bot as never, msg as never);

      expect(bot.api.getFile).toHaveBeenCalledWith('photo-xyz');
    });

    it('should construct correct download URL using bot token', async () => {
      const bot = createMockBot({ file_path: 'documents/test.pdf', file_size: 512 });
      const buf = Buffer.from('pdfdata');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ photo: [makePhoto()] });
      await downloadTelegramAttachments(bot as never, msg as never);

      const fetchUrl = mockFetch.mock.calls[0]![0] as string;
      expect(fetchUrl).toBe('https://api.telegram.org/file/bottest-token-123/documents/test.pdf');
    });

    it('should return buffer data on successful download', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('imagedata');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.data).toEqual(buf);
    });

    it('should return no attachment when getFile has no file_path', async () => {
      const bot = createMockBot({ file_path: undefined, file_size: 1024 });

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
    });

    it('should log warning when getFile has no file_path', async () => {
      const bot = createMockBot({ file_path: undefined, file_size: 1024 });

      const msg = makeMessage({ photo: [makePhoto('nofp-id')] });
      await downloadTelegramAttachments(bot as never, msg as never);

      expect(mockLogWarn).toHaveBeenCalledWith(
        'Telegram getFile returned no file_path',
        expect.objectContaining({ fileId: 'nofp-id' })
      );
    });

    it('should return no attachment when pre-download file_size exceeds MAX_FILE_SIZE', async () => {
      const oversized = MAX_FILE_SIZE + 1;
      const bot = createMockBot({ file_path: 'photos/big.jpg', file_size: oversized });

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should log warning for pre-download size exceeding limit', async () => {
      const oversized = MAX_FILE_SIZE + 1;
      const bot = createMockBot({ file_path: 'photos/big.jpg', file_size: oversized });

      const msg = makeMessage({ photo: [makePhoto()] });
      await downloadTelegramAttachments(bot as never, msg as never);

      expect(mockLogWarn).toHaveBeenCalledWith(
        'File exceeds size limit (pre-download)',
        expect.objectContaining({ size: oversized, max: MAX_FILE_SIZE })
      );
    });

    it('should return no attachment when fetch response is not ok', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.alloc(0), false, 404));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
    });

    it('should log warning when fetch fails', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.alloc(0), false, 500));

      const msg = makeMessage({ photo: [makePhoto('fetch-fail-id')] });
      await downloadTelegramAttachments(bot as never, msg as never);

      expect(mockLogWarn).toHaveBeenCalledWith(
        'Telegram file download failed',
        expect.objectContaining({ status: 500, fileId: 'fetch-fail-id' })
      );
    });

    it('should return no attachment when post-download buffer exceeds MAX_FILE_SIZE', async () => {
      const bot = createMockBot({ file_path: 'photos/test.jpg', file_size: undefined });
      const bigBuf = Buffer.alloc(MAX_FILE_SIZE + 1);
      mockFetch.mockResolvedValueOnce(createFetchResponse(bigBuf));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
    });

    it('should log warning for post-download buffer exceeding limit', async () => {
      const bot = createMockBot({ file_path: 'photos/test.jpg', file_size: undefined });
      const bigBuf = Buffer.alloc(MAX_FILE_SIZE + 1);
      mockFetch.mockResolvedValueOnce(createFetchResponse(bigBuf));

      const msg = makeMessage({ photo: [makePhoto()] });
      await downloadTelegramAttachments(bot as never, msg as never);

      expect(mockLogWarn).toHaveBeenCalledWith(
        'File exceeds size limit',
        expect.objectContaining({ size: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE })
      );
    });

    it('should return no attachment when getFile throws an error', async () => {
      const bot = createMockBot();
      bot.api.getFile.mockRejectedValueOnce(new Error('API error'));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
    });

    it('should log warning when getFile throws', async () => {
      const bot = createMockBot();
      const err = new Error('API error');
      bot.api.getFile.mockRejectedValueOnce(err);

      const msg = makeMessage({ photo: [makePhoto('throw-id')] });
      await downloadTelegramAttachments(bot as never, msg as never);

      expect(mockLogWarn).toHaveBeenCalledWith(
        'Failed to download file from Telegram',
        expect.objectContaining({ fileId: 'throw-id', error: err })
      );
    });

    it('should return no attachment when fetch throws an error', async () => {
      const bot = createMockBot();
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
    });

    it('should log warning when fetch throws', async () => {
      const bot = createMockBot();
      const err = new Error('Network error');
      mockFetch.mockRejectedValueOnce(err);

      const msg = makeMessage({ photo: [makePhoto('net-err-id')] });
      await downloadTelegramAttachments(bot as never, msg as never);

      expect(mockLogWarn).toHaveBeenCalledWith(
        'Failed to download file from Telegram',
        expect.objectContaining({ fileId: 'net-err-id', error: err })
      );
    });

    it('should proceed with download when getFile returns no file_size', async () => {
      const bot = createMockBot({ file_path: 'photos/test.jpg', file_size: undefined });
      const buf = Buffer.from('imagedata');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should pass the correct file_path in the URL', async () => {
      const bot = createMockBot({ file_path: 'voice/file_42.oga', file_size: 100 });
      const buf = Buffer.from('voicedata');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ voice: makeVoice() });
      await downloadTelegramAttachments(bot as never, msg as never);

      const fetchUrl = mockFetch.mock.calls[0]![0] as string;
      expect(fetchUrl).toContain('voice/file_42.oga');
    });

    it('should use the exact bot token in the URL', async () => {
      const bot = createMockBot();
      bot.token = '999:SECRET_TOKEN';
      const buf = Buffer.from('data');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ photo: [makePhoto()] });
      await downloadTelegramAttachments(bot as never, msg as never);

      const fetchUrl = mockFetch.mock.calls[0]![0] as string;
      expect(fetchUrl).toContain('bot999:SECRET_TOKEN/');
    });

    it('should return buffer with correct length for size field', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('exactlythis');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.size).toBe(buf.length);
    });

    it('should include filePath in download result (verified via successful attachment)', async () => {
      const bot = createMockBot({ file_path: 'photos/nice.jpg', file_size: 100 });
      const buf = Buffer.from('nice-photo');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      // filePath is used internally; a successful attachment means it was returned
      expect(result).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Photos
  // ==========================================================================

  describe('Photos', () => {
    it('should pick the largest photo (last in array)', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('largest-photo');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const photos = [
        makePhoto('small', 100, 160, 120),
        makePhoto('medium', 500, 640, 480),
        makePhoto('large', 1024, 1280, 960),
      ];
      const msg = makeMessage({ photo: photos });
      await downloadTelegramAttachments(bot as never, msg as never);

      expect(bot.api.getFile).toHaveBeenCalledWith('large');
      expect(bot.api.getFile).toHaveBeenCalledTimes(1);
    });

    it('should download photo under size limit', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('photo-content');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ photo: [makePhoto('pic-1', 5000)] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.data).toEqual(buf);
    });

    it('should set type to image', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.type).toBe('image');
    });

    it('should set mimeType to image/jpeg', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.mimeType).toBe('image/jpeg');
    });

    it('should set filename to photo_{file_id}.jpg', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ photo: [makePhoto('my-photo-id')] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.filename).toBe('photo_my-photo-id.jpg');
    });

    it('should set size from buffer length', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('twelve chars');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.size).toBe(buf.length);
    });

    it('should include data field as Buffer', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('buffer-data');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(Buffer.isBuffer(result[0]!.data)).toBe(true);
    });

    it('should skip photo when largest exceeds MAX_FILE_SIZE', async () => {
      const bot = createMockBot();
      const msg = makeMessage({ photo: [makePhoto('big', MAX_FILE_SIZE + 1)] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
      expect(bot.api.getFile).not.toHaveBeenCalled();
    });

    it('should allow photo when file_size is exactly MAX_FILE_SIZE', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('at-limit');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ photo: [makePhoto('exact', MAX_FILE_SIZE)] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
    });

    it('should handle single photo in array', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ photo: [makePhoto('only-one')] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(bot.api.getFile).toHaveBeenCalledWith('only-one');
    });

    it('should handle photo with undefined file_size (proceeds to download)', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('no-size-photo');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const photo = makePhoto('nosize');
      delete (photo as Record<string, unknown>).file_size;
      const msg = makeMessage({ photo: [photo] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
    });

    it('should return no photo attachment when download fails', async () => {
      const bot = createMockBot();
      bot.api.getFile.mockRejectedValueOnce(new Error('getFile error'));

      const msg = makeMessage({ photo: [makePhoto()] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
    });

    it('should not process empty photo array', async () => {
      const bot = createMockBot();
      const msg = makeMessage({ photo: [] });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
      expect(bot.api.getFile).not.toHaveBeenCalled();
    });

    it('should use last photo from multiple options (3 sizes)', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('last')));

      const photos = [
        makePhoto('thumb', 100, 90, 90),
        makePhoto('mid', 500, 320, 320),
        makePhoto('full', 2000, 1280, 1280),
      ];
      const msg = makeMessage({ photo: photos });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.filename).toBe('photo_full.jpg');
    });
  });

  // ==========================================================================
  // Documents
  // ==========================================================================

  describe('Documents', () => {
    it('should download analyzable document (application/pdf)', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('pdf-content');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ document: makeDocument() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.data).toEqual(buf);
    });

    it('should download analyzable document (image/jpeg)', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('jpeg-content');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({
        document: makeDocument({ mime_type: 'image/jpeg', file_name: 'photo.jpg' }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.mimeType).toBe('image/jpeg');
    });

    it('should download analyzable document (audio/ogg)', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('ogg-content');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({
        document: makeDocument({ mime_type: 'audio/ogg', file_name: 'audio.ogg' }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.mimeType).toBe('audio/ogg');
    });

    it('should set type to image for image/* MIME types', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({
        document: makeDocument({ mime_type: 'image/png', file_name: 'pic.png' }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.type).toBe('image');
    });

    it('should set type to file for non-image MIME types (PDF)', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ document: makeDocument() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.type).toBe('file');
    });

    it('should set type to file for audio MIME documents', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({
        document: makeDocument({ mime_type: 'audio/mpeg', file_name: 'music.mp3' }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.type).toBe('file');
    });

    it('should use document.file_name when available', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({
        document: makeDocument({ file_name: 'my-report.pdf' }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.filename).toBe('my-report.pdf');
    });

    it('should use fallback filename doc_{file_id} when file_name is missing', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({
        document: makeDocument({ file_name: undefined, file_id: 'doc-xyz' }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.filename).toBe('doc_doc-xyz');
    });

    it('should return metadata only for non-analyzable MIME type', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        document: makeDocument({
          mime_type: 'application/zip',
          file_name: 'archive.zip',
          file_size: 5000,
        }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('file');
      expect(result[0]!.mimeType).toBe('application/zip');
      expect(result[0]!.filename).toBe('archive.zip');
      expect(result[0]!.size).toBe(5000);
      expect(result[0]!.data).toBeUndefined();
      expect(bot.api.getFile).not.toHaveBeenCalled();
    });

    it('should not download analyzable document when file_size exceeds limit', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        document: makeDocument({ file_size: MAX_FILE_SIZE + 1 }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
      expect(bot.api.getFile).not.toHaveBeenCalled();
    });

    it('should return no attachment when analyzable document download fails', async () => {
      const bot = createMockBot();
      bot.api.getFile.mockRejectedValueOnce(new Error('download error'));

      const msg = makeMessage({ document: makeDocument() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
    });

    it('should default MIME type to application/octet-stream when mime_type is missing', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        document: makeDocument({ mime_type: undefined, file_name: 'unknown.bin', file_size: 100 }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      // application/octet-stream is not analyzable, so metadata only
      expect(result).toHaveLength(1);
      expect(result[0]!.mimeType).toBe('application/octet-stream');
      expect(result[0]!.data).toBeUndefined();
    });

    it('should proceed with download when document file_size is undefined', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('no-size-doc');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({
        document: makeDocument({ file_size: undefined }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.data).toEqual(buf);
    });

    it('should set size from buffer length for downloaded documents', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('sized-document');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ document: makeDocument() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.size).toBe(buf.length);
    });

    it('should set size from file_size for non-analyzable documents', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        document: makeDocument({ mime_type: 'text/html', file_size: 9999 }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.size).toBe(9999);
    });

    it('should use fallback filename for non-analyzable documents without file_name', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        document: makeDocument({
          mime_type: 'application/x-tar',
          file_name: undefined,
          file_id: 'noname-id',
          file_size: 123,
        }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.filename).toBe('doc_noname-id');
    });
  });

  // ==========================================================================
  // Audio
  // ==========================================================================

  describe('Audio', () => {
    it('should download audio file', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('audio-content');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ audio: makeAudio() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.data).toEqual(buf);
    });

    it('should set type to audio', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ audio: makeAudio() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.type).toBe('audio');
    });

    it('should use audio.file_name when available', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ audio: makeAudio({ file_name: 'track.mp3' }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.filename).toBe('track.mp3');
    });

    it('should use fallback filename audio_{file_id} when file_name is missing', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ audio: makeAudio({ file_name: undefined, file_id: 'aud-99' }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.filename).toBe('audio_aud-99');
    });

    it('should use audio.mime_type when available', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ audio: makeAudio({ mime_type: 'audio/wav' }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.mimeType).toBe('audio/wav');
    });

    it('should default MIME type to audio/mpeg when mime_type is missing', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ audio: makeAudio({ mime_type: undefined }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.mimeType).toBe('audio/mpeg');
    });

    it('should skip audio when file_size exceeds limit', async () => {
      const bot = createMockBot();

      const msg = makeMessage({ audio: makeAudio({ file_size: MAX_FILE_SIZE + 1 }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
      expect(bot.api.getFile).not.toHaveBeenCalled();
    });

    it('should proceed with download when audio file_size is undefined', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ audio: makeAudio({ file_size: undefined }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
    });

    it('should return no attachment when audio download fails', async () => {
      const bot = createMockBot();
      bot.api.getFile.mockRejectedValueOnce(new Error('audio download error'));

      const msg = makeMessage({ audio: makeAudio() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
    });

    it('should set size from buffer length', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('audio-bytes');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ audio: makeAudio() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.size).toBe(buf.length);
    });
  });

  // ==========================================================================
  // Voice
  // ==========================================================================

  describe('Voice', () => {
    it('should download voice message', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('voice-content');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ voice: makeVoice() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.data).toEqual(buf);
    });

    it('should set type to audio', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ voice: makeVoice() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.type).toBe('audio');
    });

    it('should set filename to voice_{file_id}.ogg', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ voice: makeVoice({ file_id: 'v-123' }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.filename).toBe('voice_v-123.ogg');
    });

    it('should use voice.mime_type when available', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ voice: makeVoice({ mime_type: 'audio/opus' }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.mimeType).toBe('audio/opus');
    });

    it('should default MIME type to audio/ogg when mime_type is missing', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ voice: makeVoice({ mime_type: undefined }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.mimeType).toBe('audio/ogg');
    });

    it('should skip voice when file_size exceeds limit', async () => {
      const bot = createMockBot();

      const msg = makeMessage({ voice: makeVoice({ file_size: MAX_FILE_SIZE + 1 }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
      expect(bot.api.getFile).not.toHaveBeenCalled();
    });

    it('should proceed with download when voice file_size is undefined', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ voice: makeVoice({ file_size: undefined }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
    });

    it('should return no attachment when voice download fails', async () => {
      const bot = createMockBot();
      bot.api.getFile.mockRejectedValueOnce(new Error('voice fail'));

      const msg = makeMessage({ voice: makeVoice() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
    });

    it('should set size from buffer length', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('voice-bytes');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ voice: makeVoice() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.size).toBe(buf.length);
    });

    it('should allow voice with file_size exactly at MAX_FILE_SIZE', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ voice: makeVoice({ file_size: MAX_FILE_SIZE }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Video
  // ==========================================================================

  describe('Video', () => {
    it('should download video under size limit', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('video-content');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ video: makeVideo() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.data).toEqual(buf);
    });

    it('should set type to video', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ video: makeVideo() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.type).toBe('video');
    });

    it('should include data field when under limit', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('video-data');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ video: makeVideo() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.data).toBeDefined();
      expect(Buffer.isBuffer(result[0]!.data)).toBe(true);
    });

    it('should use video.file_name when available', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ video: makeVideo({ file_name: 'holiday.mp4' }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.filename).toBe('holiday.mp4');
    });

    it('should use fallback filename video_{file_id} when file_name is missing', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ video: makeVideo({ file_name: undefined, file_id: 'vid-42' }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.filename).toBe('video_vid-42');
    });

    it('should use video.mime_type when available', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ video: makeVideo({ mime_type: 'video/webm' }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.mimeType).toBe('video/webm');
    });

    it('should default MIME type to video/mp4 when mime_type is missing', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ video: makeVideo({ mime_type: undefined }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.mimeType).toBe('video/mp4');
    });

    it('should return metadata only when video exceeds size limit', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        video: makeVideo({ file_size: MAX_FILE_SIZE + 1, file_name: 'bigvid.mp4' }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('video');
      expect(result[0]!.mimeType).toBe('video/mp4');
      expect(result[0]!.filename).toBe('bigvid.mp4');
      expect(result[0]!.size).toBe(MAX_FILE_SIZE + 1);
      expect(result[0]!.data).toBeUndefined();
      expect(bot.api.getFile).not.toHaveBeenCalled();
    });

    it('should return metadata only when video has no file_size (undefined)', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        video: makeVideo({ file_size: undefined, file_name: 'nosize.mp4' }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      // code checks: message.video.file_size && ... — falsy → else branch → metadata only
      expect(result).toHaveLength(1);
      expect(result[0]!.data).toBeUndefined();
      expect(result[0]!.size).toBeUndefined();
      expect(bot.api.getFile).not.toHaveBeenCalled();
    });

    it('should return no attachment when video download fails', async () => {
      const bot = createMockBot();
      bot.api.getFile.mockRejectedValueOnce(new Error('video download error'));

      const msg = makeMessage({ video: makeVideo() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(0);
    });

    it('should set size from buffer length when downloaded', async () => {
      const bot = createMockBot();
      const buf = Buffer.from('video-bytes-here');
      mockFetch.mockResolvedValueOnce(createFetchResponse(buf));

      const msg = makeMessage({ video: makeVideo() });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.size).toBe(buf.length);
    });

    it('should use fallback filename for oversized video without file_name', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        video: makeVideo({
          file_size: MAX_FILE_SIZE + 1,
          file_name: undefined,
          file_id: 'bigvid-id',
        }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result[0]!.filename).toBe('video_bigvid-id');
    });

    it('should download video with file_size exactly at MAX_FILE_SIZE', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({ video: makeVideo({ file_size: MAX_FILE_SIZE }) });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.data).toBeDefined();
    });
  });

  // ==========================================================================
  // Multiple attachments
  // ==========================================================================

  describe('Multiple attachments', () => {
    it('should process photo and document together', async () => {
      const bot = createMockBot();
      const photoBuf = Buffer.from('photo-data');
      const docBuf = Buffer.from('doc-data');
      mockFetch
        .mockResolvedValueOnce(createFetchResponse(photoBuf))
        .mockResolvedValueOnce(createFetchResponse(docBuf));

      const msg = makeMessage({
        photo: [makePhoto('p1')],
        document: makeDocument(),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(2);
      expect(result[0]!.type).toBe('image');
      expect(result[0]!.mimeType).toBe('image/jpeg');
      expect(result[1]!.type).toBe('file');
      expect(result[1]!.mimeType).toBe('application/pdf');
    });

    it('should return empty array for message with no attachments', async () => {
      const bot = createMockBot();
      const msg = makeMessage({ text: 'hello' });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toEqual([]);
      expect(bot.api.getFile).not.toHaveBeenCalled();
    });

    it('should process all attachment types in order', async () => {
      const bot = createMockBot();
      const bufs = ['photo', 'doc', 'audio', 'voice', 'video'].map((s) => Buffer.from(s));
      for (const buf of bufs) {
        mockFetch.mockResolvedValueOnce(createFetchResponse(buf));
      }

      const msg = makeMessage({
        photo: [makePhoto('p1')],
        document: makeDocument({ mime_type: 'image/png', file_name: 'img.png' }),
        audio: makeAudio(),
        voice: makeVoice(),
        video: makeVideo(),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(5);
      // Verify order: photo, document, audio, voice, video
      expect(result[0]!.filename).toBe('photo_p1.jpg');
      expect(result[1]!.filename).toBe('img.png');
      expect(result[2]!.filename).toBe('song.mp3');
      expect(result[3]!.filename).toBe('voice_voice-abc.ogg');
      expect(result[4]!.filename).toBe('clip.mp4');
    });

    it('should return metadata-only attachment for non-analyzable document', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        document: makeDocument({
          mime_type: 'application/x-rar',
          file_name: 'archive.rar',
          file_size: 4096,
        }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('file');
      expect(result[0]!.data).toBeUndefined();
      expect(result[0]!.filename).toBe('archive.rar');
      expect(result[0]!.size).toBe(4096);
    });

    it('should handle mixed downloadable and metadata-only attachments', async () => {
      const bot = createMockBot();
      const photoBuf = Buffer.from('photo-data');
      mockFetch.mockResolvedValueOnce(createFetchResponse(photoBuf));

      const msg = makeMessage({
        photo: [makePhoto('p1')],
        video: makeVideo({ file_size: MAX_FILE_SIZE + 1, file_name: 'big.mp4' }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(result).toHaveLength(2);
      // Photo is downloaded
      expect(result[0]!.type).toBe('image');
      expect(result[0]!.data).toBeDefined();
      // Video is metadata only
      expect(result[1]!.type).toBe('video');
      expect(result[1]!.data).toBeUndefined();
    });
  });

  // ==========================================================================
  // ANALYZABLE_MIME_TYPES
  // ==========================================================================

  describe('ANALYZABLE_MIME_TYPES', () => {
    // Test analyzable types by sending a document with each MIME type.
    // If analyzable, download is attempted (getFile called).
    // If not analyzable, metadata-only is returned (no getFile).

    it.each(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])(
      'should treat %s as analyzable (image types)',
      async (mime) => {
        const bot = createMockBot();
        mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

        const msg = makeMessage({
          document: makeDocument({ mime_type: mime, file_size: 100 }),
        });
        const result = await downloadTelegramAttachments(bot as never, msg as never);

        expect(bot.api.getFile).toHaveBeenCalled();
        expect(result).toHaveLength(1);
        expect(result[0]!.data).toBeDefined();
      }
    );

    it('should treat application/pdf as analyzable', async () => {
      const bot = createMockBot();
      mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

      const msg = makeMessage({
        document: makeDocument({ mime_type: 'application/pdf', file_size: 100 }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(bot.api.getFile).toHaveBeenCalled();
      expect(result[0]!.data).toBeDefined();
    });

    it.each(['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm'])(
      'should treat %s as analyzable (audio types)',
      async (mime) => {
        const bot = createMockBot();
        mockFetch.mockResolvedValueOnce(createFetchResponse(Buffer.from('x')));

        const msg = makeMessage({
          document: makeDocument({ mime_type: mime, file_size: 100 }),
        });
        const result = await downloadTelegramAttachments(bot as never, msg as never);

        expect(bot.api.getFile).toHaveBeenCalled();
        expect(result[0]!.data).toBeDefined();
      }
    );

    it('should NOT treat text/plain as analyzable', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        document: makeDocument({ mime_type: 'text/plain', file_size: 100 }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(bot.api.getFile).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]!.data).toBeUndefined();
    });

    it('should NOT treat application/json as analyzable', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        document: makeDocument({ mime_type: 'application/json', file_size: 100 }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(bot.api.getFile).not.toHaveBeenCalled();
      expect(result).toHaveLength(1);
      expect(result[0]!.data).toBeUndefined();
    });

    it('should NOT treat application/zip as analyzable', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        document: makeDocument({ mime_type: 'application/zip', file_size: 100 }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(bot.api.getFile).not.toHaveBeenCalled();
      expect(result[0]!.data).toBeUndefined();
    });

    it('should NOT treat video/mp4 as analyzable for documents', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        document: makeDocument({ mime_type: 'video/mp4', file_size: 100 }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      // video/mp4 is not in ANALYZABLE_MIME_TYPES — metadata only
      expect(bot.api.getFile).not.toHaveBeenCalled();
      expect(result[0]!.data).toBeUndefined();
    });

    it('should NOT treat text/html as analyzable', async () => {
      const bot = createMockBot();

      const msg = makeMessage({
        document: makeDocument({ mime_type: 'text/html', file_size: 100 }),
      });
      const result = await downloadTelegramAttachments(bot as never, msg as never);

      expect(bot.api.getFile).not.toHaveBeenCalled();
      expect(result[0]!.data).toBeUndefined();
    });
  });
});
