/**
 * Voice Routes
 *
 * REST API for voice operations (STT/TTS).
 *
 * Endpoints:
 *   GET  /config     — voice service availability + provider info
 *   POST /transcribe — upload audio → get text (multipart/form-data)
 *   POST /synthesize — send text → get audio binary
 */

import { Hono } from 'hono';
import { getVoiceService } from '../services/voice-service.js';
import { getUserId, apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';
import { validateBody, synthesizeVoiceSchema } from '../middleware/validation.js';

export const voiceRoutes = new Hono();

// =============================================================================
// GET /config
// =============================================================================

voiceRoutes.get('/config', async (c) => {
  try {
    const service = getVoiceService();
    const config = await service.getConfig();
    return apiResponse(c, config);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /transcribe
// =============================================================================

voiceRoutes.post('/transcribe', async (c) => {
  try {
    getUserId(c); // ensure authenticated

    const service = getVoiceService();
    if (!(await service.isAvailable())) {
      return apiError(
        c,
        { code: ERROR_CODES.INTERNAL_ERROR, message: 'Voice service not configured' },
        503
      );
    }

    // Parse multipart form
    const body = await c.req.parseBody();
    const file = body['file'];

    if (!file || typeof file === 'string') {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'Audio file is required (multipart field "file")',
        },
        400
      );
    }

    // file is a File/Blob from Hono's parseBody
    const arrayBuffer = await (file as File).arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    if (audioBuffer.length === 0) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Audio file is empty' },
        400
      );
    }

    if (audioBuffer.length > 25 * 1024 * 1024) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'Audio file exceeds 25MB limit' },
        400
      );
    }

    const filename = (file as File).name || 'audio.webm';
    const language = (body['language'] as string) || c.req.query('language') || undefined;

    const result = await service.transcribe(audioBuffer, filename, { language });
    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /synthesize
// =============================================================================

voiceRoutes.post('/synthesize', async (c) => {
  try {
    getUserId(c); // ensure authenticated

    const service = getVoiceService();
    if (!(await service.isAvailable())) {
      return apiError(
        c,
        { code: ERROR_CODES.INTERNAL_ERROR, message: 'Voice service not configured' },
        503
      );
    }

    const body = validateBody(synthesizeVoiceSchema, await c.req.json());

    const result = await service.synthesize(body.text, {
      voice: body.voice,
      speed: body.speed,
      format: body.format,
    });

    // Return raw audio binary
    return new Response(result.audio, {
      status: 200,
      headers: {
        'Content-Type': result.contentType,
        'Content-Length': String(result.audio.length),
        'X-Audio-Format': result.format,
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Validation failed:'))
      return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: err.message }, 400);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
