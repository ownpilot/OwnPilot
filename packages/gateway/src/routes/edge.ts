/**
 * Edge Routes
 *
 * REST API for managing IoT/edge devices, commands, and telemetry.
 */

import { Hono } from 'hono';
import type { EdgeDeviceType, EdgeDeviceStatus } from '@ownpilot/core';
import { getEdgeService } from '../services/edge-service.js';
import { getEdgeMqttClient } from '../services/edge-mqtt-client.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  getErrorMessage,
  getIntParam,
  getPaginationParams,
  notFoundError,
  sanitizeId,
  validateQueryEnum,
} from './helpers.js';

export const edgeRoutes = new Hono();

const VALID_TYPES = ['raspberry-pi', 'esp32', 'arduino', 'custom'] as const;
const VALID_STATUSES = ['online', 'offline', 'error'] as const;

// =============================================================================
// GET /mqtt/status - MQTT connection status (must be before /:id)
// =============================================================================

edgeRoutes.get('/mqtt/status', (c) => {
  const mqtt = getEdgeMqttClient();
  return apiResponse(c, {
    connected: mqtt.isConnected(),
    brokerUrl: mqtt.getBrokerUrl(),
  });
});

// =============================================================================
// GET / - List devices with filters
// =============================================================================

edgeRoutes.get('/', async (c) => {
  try {
    const userId = getUserId(c);
    const { limit, offset } = getPaginationParams(c);
    const type = validateQueryEnum(c.req.query('type'), VALID_TYPES) as EdgeDeviceType | undefined;
    const status = validateQueryEnum(c.req.query('status'), VALID_STATUSES) as
      | EdgeDeviceStatus
      | undefined;
    const search = c.req.query('search');

    const service = getEdgeService();
    const result = await service.listDevices(userId, {
      type,
      status,
      search: search || undefined,
      limit,
      offset,
    });

    return apiResponse(c, result);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST / - Register a new device
// =============================================================================

edgeRoutes.post('/', async (c) => {
  try {
    const userId = getUserId(c);
    const body = await c.req.json();

    if (!body.name || !body.type) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'name and type are required' },
        400
      );
    }

    const service = getEdgeService();
    const device = await service.registerDevice(userId, {
      name: body.name,
      type: body.type,
      protocol: body.protocol,
      sensors: body.sensors,
      actuators: body.actuators,
      firmwareVersion: body.firmwareVersion ?? body.firmware_version,
      metadata: body.metadata,
    });

    return apiResponse(c, device, 201);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /:id - Get device by ID
// =============================================================================

edgeRoutes.get('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));

    const service = getEdgeService();
    const device = await service.getDevice(userId, id);
    if (!device) return notFoundError(c, 'Device', id);

    return apiResponse(c, device);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// PATCH /:id - Update device
// =============================================================================

edgeRoutes.patch('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));
    const body = await c.req.json();

    const service = getEdgeService();
    const device = await service.updateDevice(userId, id, {
      name: body.name,
      type: body.type,
      protocol: body.protocol,
      sensors: body.sensors,
      actuators: body.actuators,
      firmwareVersion: body.firmwareVersion ?? body.firmware_version,
      metadata: body.metadata,
    });

    if (!device) return notFoundError(c, 'Device', id);
    return apiResponse(c, device);
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// DELETE /:id - Remove device
// =============================================================================

edgeRoutes.delete('/:id', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));

    const service = getEdgeService();
    const deleted = await service.removeDevice(userId, id);
    if (!deleted) return notFoundError(c, 'Device', id);

    return apiResponse(c, { success: true });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// POST /:id/command - Send command to device
// =============================================================================

edgeRoutes.post('/:id/command', async (c) => {
  const id = sanitizeId(c.req.param('id'));
  try {
    const userId = getUserId(c);
    const body = await c.req.json();

    if (!body.commandType && !body.command_type) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'commandType is required' },
        400
      );
    }

    const service = getEdgeService();
    const command = await service.sendCommand(userId, id, {
      commandType: body.commandType ?? body.command_type,
      payload: body.payload,
    });

    return apiResponse(c, command, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return notFoundError(c, 'Device', id);
    }
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /:id/commands - Command history
// =============================================================================

edgeRoutes.get('/:id/commands', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));
    const limit = getIntParam(c, 'limit', 50, 1, 200);

    const service = getEdgeService();
    const commands = await service.getCommandHistory(userId, id, limit);

    return apiResponse(c, { commands });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /:id/telemetry - Latest telemetry per sensor
// =============================================================================

edgeRoutes.get('/:id/telemetry', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));

    const service = getEdgeService();
    const telemetry = await service.getLatestTelemetry(userId, id);

    return apiResponse(c, { telemetry });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// =============================================================================
// GET /:id/telemetry/:sensorId - Sensor history
// =============================================================================

edgeRoutes.get('/:id/telemetry/:sensorId', async (c) => {
  try {
    const userId = getUserId(c);
    const id = sanitizeId(c.req.param('id'));
    const sensorId = sanitizeId(c.req.param('sensorId'));
    const limit = getIntParam(c, 'limit', 100, 1, 500);

    const service = getEdgeService();
    const telemetry = await service.getTelemetryHistory(userId, id, sensorId, limit);

    return apiResponse(c, { telemetry });
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
