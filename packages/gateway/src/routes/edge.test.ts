/**
 * Edge Routes Tests
 *
 * Comprehensive tests for IoT/edge device management endpoints:
 * MQTT status, device CRUD, commands, and telemetry.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// =============================================================================
// Hoisted mocks
// =============================================================================

const { mockEdgeService, mockMqttClient } = vi.hoisted(() => {
  const mockEdgeService = {
    listDevices: vi.fn(),
    registerDevice: vi.fn(),
    getDevice: vi.fn(),
    updateDevice: vi.fn(),
    removeDevice: vi.fn(),
    sendCommand: vi.fn(),
    getCommandHistory: vi.fn(),
    getLatestTelemetry: vi.fn(),
    getTelemetryHistory: vi.fn(),
  };
  const mockMqttClient = {
    isConnected: vi.fn(() => true),
    getBrokerUrl: vi.fn(() => 'mqtt://localhost:1883'),
  };
  return { mockEdgeService, mockMqttClient };
});

// =============================================================================
// Module mocks
// =============================================================================

vi.mock('../services/edge-service.js', () => ({
  getEdgeService: () => mockEdgeService,
}));

vi.mock('../services/edge-mqtt-client.js', () => ({
  getEdgeMqttClient: () => mockMqttClient,
}));

// =============================================================================
// Import after mocks
// =============================================================================

import { edgeRoutes } from './edge.js';
import { errorHandler } from '../middleware/error-handler.js';

// =============================================================================
// Sample data
// =============================================================================

const sampleDevice = {
  id: 'dev-1',
  userId: 'user-1',
  name: 'My Pi',
  type: 'raspberry-pi',
  status: 'online',
  createdAt: '2026-01-01T00:00:00Z',
};

const sampleCommand = {
  id: 'cmd-1',
  deviceId: 'dev-1',
  commandType: 'reboot',
  payload: {},
  status: 'pending',
  createdAt: '2026-01-01T00:00:00Z',
};

const sampleTelemetry = [
  { sensorId: 'temp', value: 42.5, unit: 'C', recordedAt: '2026-01-01T00:00:00Z' },
];

// =============================================================================
// App factory
// =============================================================================

function buildApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'user-1');
    await next();
  });
  app.route('/edge', edgeRoutes);
  app.onError(errorHandler);
  return app;
}

// =============================================================================
// Tests
// =============================================================================

describe('Edge Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default MQTT mock implementations after clearAllMocks
    mockMqttClient.isConnected.mockReturnValue(true);
    mockMqttClient.getBrokerUrl.mockReturnValue('mqtt://localhost:1883');
    app = buildApp();
  });

  // ==========================================================================
  // GET /edge/mqtt/status
  // ==========================================================================

  describe('GET /edge/mqtt/status', () => {
    it('returns connected status and broker URL when MQTT is connected', async () => {
      const res = await app.request('/edge/mqtt/status');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.connected).toBe(true);
      expect(json.data.brokerUrl).toBe('mqtt://localhost:1883');
    });

    it('returns connected: false when MQTT is disconnected', async () => {
      mockMqttClient.isConnected.mockReturnValue(false);
      mockMqttClient.getBrokerUrl.mockReturnValue('mqtt://remote:1883');

      const res = await app.request('/edge/mqtt/status');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.connected).toBe(false);
      expect(json.data.brokerUrl).toBe('mqtt://remote:1883');
    });
  });

  // ==========================================================================
  // GET /edge
  // ==========================================================================

  describe('GET /edge', () => {
    it('lists devices with default pagination', async () => {
      mockEdgeService.listDevices.mockResolvedValue({
        devices: [sampleDevice],
        total: 1,
      });

      const res = await app.request('/edge');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.devices).toHaveLength(1);
      expect(json.data.devices[0].id).toBe('dev-1');
    });

    it('passes type filter to service', async () => {
      mockEdgeService.listDevices.mockResolvedValue({ devices: [], total: 0 });

      await app.request('/edge?type=esp32');

      expect(mockEdgeService.listDevices).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'esp32' })
      );
    });

    it('passes status filter to service', async () => {
      mockEdgeService.listDevices.mockResolvedValue({ devices: [], total: 0 });

      await app.request('/edge?status=offline');

      expect(mockEdgeService.listDevices).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ status: 'offline' })
      );
    });

    it('passes search filter to service', async () => {
      mockEdgeService.listDevices.mockResolvedValue({ devices: [], total: 0 });

      await app.request('/edge?search=Pi');

      expect(mockEdgeService.listDevices).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ search: 'Pi' })
      );
    });

    it('ignores invalid type values (passes undefined)', async () => {
      mockEdgeService.listDevices.mockResolvedValue({ devices: [], total: 0 });

      await app.request('/edge?type=invalid-type');

      expect(mockEdgeService.listDevices).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: undefined })
      );
    });

    it('ignores invalid status values (passes undefined)', async () => {
      mockEdgeService.listDevices.mockResolvedValue({ devices: [], total: 0 });

      await app.request('/edge?status=broken');

      expect(mockEdgeService.listDevices).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ status: undefined })
      );
    });

    it('returns 500 when service throws', async () => {
      mockEdgeService.listDevices.mockRejectedValue(new Error('DB connection lost'));

      const res = await app.request('/edge');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('DB connection lost');
    });
  });

  // ==========================================================================
  // POST /edge
  // ==========================================================================

  describe('POST /edge', () => {
    it('registers a new device and returns 201', async () => {
      mockEdgeService.registerDevice.mockResolvedValue(sampleDevice);

      const res = await app.request('/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Pi', type: 'raspberry-pi' }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('dev-1');
      expect(json.data.name).toBe('My Pi');
    });

    it('passes all optional fields to service', async () => {
      mockEdgeService.registerDevice.mockResolvedValue(sampleDevice);

      await app.request('/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Arduino',
          type: 'arduino',
          metadata: { location: 'lab' },
        }),
      });

      expect(mockEdgeService.registerDevice).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({
          name: 'Arduino',
          type: 'arduino',
          metadata: { location: 'lab' },
        })
      );
    });

    it('returns 400 when name is missing', async () => {
      const res = await app.request('/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'raspberry-pi' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Validation failed');
    });

    it('returns 400 when type is missing', async () => {
      const res = await app.request('/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Pi' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Validation failed');
    });

    it('returns 400 when both name and type are missing', async () => {
      const res = await app.request('/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('returns 500 when service throws', async () => {
      mockEdgeService.registerDevice.mockRejectedValue(new Error('Duplicate device ID'));

      const res = await app.request('/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Pi', type: 'raspberry-pi' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Duplicate device ID');
    });

    it('ignores extra fields not in the schema', async () => {
      mockEdgeService.registerDevice.mockResolvedValue(sampleDevice);

      await app.request('/edge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'My Pi', type: 'raspberry-pi', firmware_version: '2.0.0' }),
      });

      // Zod strips unknown fields; only name, type, and metadata are passed through
      expect(mockEdgeService.registerDevice).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ name: 'My Pi', type: 'raspberry-pi' })
      );
    });
  });

  // ==========================================================================
  // GET /edge/:id
  // ==========================================================================

  describe('GET /edge/:id', () => {
    it('returns a device by ID', async () => {
      mockEdgeService.getDevice.mockResolvedValue(sampleDevice);

      const res = await app.request('/edge/dev-1');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('dev-1');
      expect(json.data.name).toBe('My Pi');
    });

    it('returns 404 when device is not found', async () => {
      mockEdgeService.getDevice.mockResolvedValue(null);

      const res = await app.request('/edge/dev-999');

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('not found');
    });

    it('returns 500 when service throws', async () => {
      mockEdgeService.getDevice.mockRejectedValue(new Error('Query timeout'));

      const res = await app.request('/edge/dev-1');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Query timeout');
    });
  });

  // ==========================================================================
  // PATCH /edge/:id
  // ==========================================================================

  describe('PATCH /edge/:id', () => {
    it('updates a device and returns updated data', async () => {
      const updated = { ...sampleDevice, name: 'Pi Renamed' };
      mockEdgeService.updateDevice.mockResolvedValue(updated);

      const res = await app.request('/edge/dev-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Pi Renamed' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.name).toBe('Pi Renamed');
    });

    it('passes all update fields to service', async () => {
      mockEdgeService.updateDevice.mockResolvedValue(sampleDevice);

      await app.request('/edge/dev-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Updated',
          type: 'esp32',
          protocol: 'http',
          sensors: ['humidity'],
          actuators: [],
          firmwareVersion: '3.0.0',
          metadata: { region: 'EU' },
        }),
      });

      expect(mockEdgeService.updateDevice).toHaveBeenCalledWith(
        'user-1',
        'dev-1',
        expect.objectContaining({
          name: 'Updated',
          type: 'esp32',
          firmwareVersion: '3.0.0',
        })
      );
    });

    it('returns 404 when device is not found', async () => {
      mockEdgeService.updateDevice.mockResolvedValue(null);

      const res = await app.request('/edge/dev-999', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Ghost' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('not found');
    });

    it('returns 500 when service throws', async () => {
      mockEdgeService.updateDevice.mockRejectedValue(new Error('Write conflict'));

      const res = await app.request('/edge/dev-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Pi' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Write conflict');
    });
  });

  // ==========================================================================
  // DELETE /edge/:id
  // ==========================================================================

  describe('DELETE /edge/:id', () => {
    it('deletes a device and returns success', async () => {
      mockEdgeService.removeDevice.mockResolvedValue(true);

      const res = await app.request('/edge/dev-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.success).toBe(true);
    });

    it('returns 404 when device is not found', async () => {
      mockEdgeService.removeDevice.mockResolvedValue(false);

      const res = await app.request('/edge/dev-999', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('not found');
    });

    it('returns 500 when service throws', async () => {
      mockEdgeService.removeDevice.mockRejectedValue(new Error('Foreign key violation'));

      const res = await app.request('/edge/dev-1', { method: 'DELETE' });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Foreign key violation');
    });
  });

  // ==========================================================================
  // POST /edge/:id/command
  // ==========================================================================

  describe('POST /edge/:id/command', () => {
    it('sends a command and returns 201', async () => {
      mockEdgeService.sendCommand.mockResolvedValue(sampleCommand);

      const res = await app.request('/edge/dev-1/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandType: 'reboot', payload: {} }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.id).toBe('cmd-1');
      expect(json.data.commandType).toBe('reboot');
    });

    it('rejects command_type snake_case (only commandType accepted)', async () => {
      const res = await app.request('/edge/dev-1/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command_type: 'reboot' }),
      });

      // Zod schema requires commandType (camelCase); snake_case is not recognized
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Validation failed');
    });

    it('returns 400 when commandType is missing', async () => {
      const res = await app.request('/edge/dev-1/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { data: 'value' } }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Validation failed');
    });

    it('returns 404 when service throws a "not found" error', async () => {
      mockEdgeService.sendCommand.mockRejectedValue(new Error('Device not found'));

      const res = await app.request('/edge/dev-999/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandType: 'ping' }),
      });

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('not found');
    });

    it('returns 500 when service throws a non-not-found error', async () => {
      mockEdgeService.sendCommand.mockRejectedValue(new Error('MQTT publish failed'));

      const res = await app.request('/edge/dev-1/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandType: 'reboot' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('MQTT publish failed');
    });

    it('passes payload to service', async () => {
      mockEdgeService.sendCommand.mockResolvedValue(sampleCommand);
      const payload = { brightness: 100, color: 'red' };

      await app.request('/edge/dev-1/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandType: 'set-led', payload }),
      });

      expect(mockEdgeService.sendCommand).toHaveBeenCalledWith(
        'user-1',
        'dev-1',
        expect.objectContaining({ payload })
      );
    });
  });

  // ==========================================================================
  // GET /edge/:id/commands
  // ==========================================================================

  describe('GET /edge/:id/commands', () => {
    it('returns command history with default limit', async () => {
      const commands = [sampleCommand, { ...sampleCommand, id: 'cmd-2' }];
      mockEdgeService.getCommandHistory.mockResolvedValue(commands);

      const res = await app.request('/edge/dev-1/commands');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.commands).toHaveLength(2);
      expect(json.data.commands[0].id).toBe('cmd-1');
    });

    it('passes custom limit to service', async () => {
      mockEdgeService.getCommandHistory.mockResolvedValue([]);

      await app.request('/edge/dev-1/commands?limit=10');

      expect(mockEdgeService.getCommandHistory).toHaveBeenCalledWith('user-1', 'dev-1', 10);
    });

    it('uses default limit of 50 when not specified', async () => {
      mockEdgeService.getCommandHistory.mockResolvedValue([]);

      await app.request('/edge/dev-1/commands');

      expect(mockEdgeService.getCommandHistory).toHaveBeenCalledWith('user-1', 'dev-1', 50);
    });

    it('returns 500 when service throws', async () => {
      mockEdgeService.getCommandHistory.mockRejectedValue(new Error('Command history unavailable'));

      const res = await app.request('/edge/dev-1/commands');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Command history unavailable');
    });
  });

  // ==========================================================================
  // GET /edge/:id/telemetry
  // ==========================================================================

  describe('GET /edge/:id/telemetry', () => {
    it('returns latest telemetry per sensor', async () => {
      mockEdgeService.getLatestTelemetry.mockResolvedValue(sampleTelemetry);

      const res = await app.request('/edge/dev-1/telemetry');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.telemetry).toEqual(sampleTelemetry);
    });

    it('calls service with correct userId and deviceId', async () => {
      mockEdgeService.getLatestTelemetry.mockResolvedValue([]);

      await app.request('/edge/dev-1/telemetry');

      expect(mockEdgeService.getLatestTelemetry).toHaveBeenCalledWith('user-1', 'dev-1');
    });

    it('returns empty telemetry array when no data', async () => {
      mockEdgeService.getLatestTelemetry.mockResolvedValue([]);

      const res = await app.request('/edge/dev-1/telemetry');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.telemetry).toEqual([]);
    });

    it('returns 500 when service throws', async () => {
      mockEdgeService.getLatestTelemetry.mockRejectedValue(new Error('Telemetry store offline'));

      const res = await app.request('/edge/dev-1/telemetry');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Telemetry store offline');
    });
  });

  // ==========================================================================
  // GET /edge/:id/telemetry/:sensorId
  // ==========================================================================

  describe('GET /edge/:id/telemetry/:sensorId', () => {
    it('returns sensor history with default limit', async () => {
      mockEdgeService.getTelemetryHistory.mockResolvedValue(sampleTelemetry);

      const res = await app.request('/edge/dev-1/telemetry/temp');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.telemetry).toEqual(sampleTelemetry);
    });

    it('passes sensorId and default limit of 100 to service', async () => {
      mockEdgeService.getTelemetryHistory.mockResolvedValue([]);

      await app.request('/edge/dev-1/telemetry/humidity');

      expect(mockEdgeService.getTelemetryHistory).toHaveBeenCalledWith(
        'user-1',
        'dev-1',
        'humidity',
        100
      );
    });

    it('passes custom limit query param to service', async () => {
      mockEdgeService.getTelemetryHistory.mockResolvedValue([]);

      await app.request('/edge/dev-1/telemetry/temp?limit=25');

      expect(mockEdgeService.getTelemetryHistory).toHaveBeenCalledWith(
        'user-1',
        'dev-1',
        'temp',
        25
      );
    });

    it('returns multiple telemetry entries', async () => {
      const history = [
        { sensorId: 'temp', value: 40.0, unit: 'C', recordedAt: '2026-01-01T00:00:00Z' },
        { sensorId: 'temp', value: 41.5, unit: 'C', recordedAt: '2026-01-01T00:01:00Z' },
        { sensorId: 'temp', value: 42.5, unit: 'C', recordedAt: '2026-01-01T00:02:00Z' },
      ];
      mockEdgeService.getTelemetryHistory.mockResolvedValue(history);

      const res = await app.request('/edge/dev-1/telemetry/temp?limit=3');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.telemetry).toHaveLength(3);
    });

    it('returns 500 when service throws', async () => {
      mockEdgeService.getTelemetryHistory.mockRejectedValue(new Error('Sensor data corrupted'));

      const res = await app.request('/edge/dev-1/telemetry/temp');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Sensor data corrupted');
    });
  });
});
