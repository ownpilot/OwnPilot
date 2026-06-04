/**
 * Extensions Scanner Routes
 *
 * POST /scan
 */

import { LOCAL_OWNER_ID } from '../../config/defaults.js';
import { Hono } from 'hono';
import { getExtensionService } from '@ownpilot/core';
import { type ExtensionService } from '../../services/extension/service.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage, parseJsonBody } from '../helpers.js';

export const scannerRoutes = new Hono();

/** Get ExtensionService from registry (cast needed for ExtensionError-specific methods). */
const getExtService = () => getExtensionService() as unknown as ExtensionService;

/**
 * POST /scan - Scan directory for packages
 */
scannerRoutes.post('/scan', async (c) => {
  const userId = LOCAL_OWNER_ID;
  const body = ((await parseJsonBody(c)) ?? {}) as { directory?: string };

  try {
    const service = getExtService();
    const result = await service.scanDirectory(body.directory, userId);
    return apiResponse(c, result);
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.EXECUTION_ERROR,
        message: getErrorMessage(error, 'Failed to scan directory'),
      },
      500
    );
  }
});
