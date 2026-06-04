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

import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { Hono } from 'hono';
import { getVoiceService } from '../services/voice-service.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';
import { validateBody, synthesizeVoiceSchema } from '../middleware/validation.js';
import { createLoginThrottle } from '../utils/login-throttle.js';
import { getClientIp } from '../utils/client-ip.js';
import { MS_PER_MINUTE } from '../config/defaults.js';

export const voiceRoutes = new Hono();

// RATE-001: Per-endpoint throttle for voice transcription. The global
// rate limit (500 req/min) is generous because most API calls are cheap;
// transcribe hits a paid Whisper API and processes up to 25MB of audio
// per call. A small per-IP throttle (30/min, 5-min lockout) prevents
// run-away cost and CPU usage on the audio buffer parse path without
// hindering normal use. Same applies to synthesize (TTS, similar cost
// profile).
const voiceThrottle = createLoginThrottle({
  maxAttempts: 30,
  windowMs: MS_PER_MINUTE,
  lockoutMs: 5 * MS_PER_MINUTE,
});

const voiceThrottleCleanup = setInterval(() => voiceThrottle.cleanup(), 2 * MS_PER_MINUTE);
if (typeof voiceThrottleCleanup === 'object' && 'unref' in voiceThrottleCleanup) {
  voiceThrottleCleanup.unref();
}

// =============================================================================
// GET /config
// =============================================================================

voiceRoutes.get('/config', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const service = getVoiceService();
    const config = await service.getConfig();
    return apiResponse(c, config);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

voiceRoutes.get('/status', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const service = getVoiceService();
    const config = await service.getConfig();
    return apiResponse(c, config);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

voiceRoutes.get('/voices', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const service = getVoiceService();
    const config = await service.getConfig();
    return apiResponse(c, {
      available: config.available,
      provider: config.provider,
      voices: config.voices,
    });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

voiceRoutes.get('/diagnostics', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }
    const service = getVoiceService();
    const diagnostics = await service.getDiagnostics();
    return apiResponse(c, diagnostics);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /transcribe
// =============================================================================

voiceRoutes.post('/transcribe', async (c) => {
  try {
    const userId = LOCAL_OWNER_ID;
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }

    // Per-endpoint throttle — see voiceThrottle declaration above.
    // Skip in test env so sequential tests don't collide.
    if (process.env.NODE_ENV !== 'test') {
      const ip = getClientIp(c.req);
      const throttleResult = voiceThrottle.check(ip);
      if (!throttleResult.allowed) {
        c.header('Retry-After', String(Math.ceil(throttleResult.retryAfterMs / 1000)));
        return apiError(
          c,
          {
            code: ERROR_CODES.ACCESS_DENIED,
            message: 'Voice transcription rate limit exceeded. Please retry later.',
          },
          429
        );
      }
    }

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
    const userId = LOCAL_OWNER_ID;
    // IDOR-017: Reject unauthenticated requests
    if (userId === 'default' && !c.get('sessionAuthenticated')) {
      return apiError(
        c,
        { code: ERROR_CODES.UNAUTHORIZED, message: 'Authentication required' },
        401
      );
    }

    if (process.env.NODE_ENV !== 'test') {
      const ip = getClientIp(c.req);
      const throttleResult = voiceThrottle.check(ip);
      if (!throttleResult.allowed) {
        c.header('Retry-After', String(Math.ceil(throttleResult.retryAfterMs / 1000)));
        return apiError(
          c,
          {
            code: ERROR_CODES.ACCESS_DENIED,
            message: 'Voice synthesis rate limit exceeded. Please retry later.',
          },
          429
        );
      }
    }

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
