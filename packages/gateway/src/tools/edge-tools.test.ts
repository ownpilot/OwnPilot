/**
 * Edge Tools Tests
 *
 * Tests the executeEdgeTool function and EDGE_TOOLS definitions.
 * Covers the status/type filter fixes and sensors/actuators passthrough fixes.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEdgeService = {
  listDevices: vi.fn(),
  getDevice: vi.fn(),
  registerDevice: vi.fn(),
  sendCommand: vi.fn(),
  getTelemetryHistory: vi.fn(),
};

vi.mock('../services/edge-service.js', () => ({
  getEdgeService: () => mockEdgeService,
}));

import { EDGE_TOOLS, EDGE_TOOL_NAMES, executeEdgeTool } from './edge-tools.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeDevice = (overrides: Record<string, unknown> = {}) => ({
  id: 'dev-1',
  name: 'Living Room Sensor',
  type: 'esp32' as const,
  protocol: 'mqtt' as const,
  status: 'online' as const,
  sensors: [],
  actuators: [],
  lastSeen: new Date('2025-03-01T10:00:00Z'),
  firmwareVersion: '1.0.0',
  ...overrides,
});

const makeSensor = (overrides: Record<string, unknown> = {}) => ({
  id: 'temp-1',
  name: 'Temperature',
  type: 'temperature' as const,
  unit: '°C',
  lastValue: 22.5,
  lastUpdated: new Date('2025-03-01T10:00:00Z'),
  ...overrides,
});

const makeActuator = (overrides: Record<string, unknown> = {}) => ({
  id: 'relay-1',
  name: 'Main Relay',
  type: 'relay' as const,
  state: { on: false },
  ...overrides,
});

const makeCommand = (overrides: Record<string, unknown> = {}) => ({
  id: 'cmd-1',
  deviceId: 'dev-1',
  commandType: 'reboot',
  payload: {},
  status: 'sent' as const,
  createdAt: new Date(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Edge Tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // EDGE_TOOLS definitions
  // ========================================================================

  describe('EDGE_TOOLS', () => {
    it('exports 6 tool definitions', () => {
      expect(EDGE_TOOLS).toHaveLength(6);
    });

    it('exports matching EDGE_TOOL_NAMES', () => {
      expect(EDGE_TOOL_NAMES).toEqual(EDGE_TOOLS.map((t) => t.name));
    });

    it('all tools have required fields', () => {
      for (const tool of EDGE_TOOLS) {
        expect(tool.name).toBeTruthy();
        expect(tool.description).toBeTruthy();
        expect(tool.parameters).toBeDefined();
        expect(tool.category).toBe('Edge Devices');
      }
    });

    it('contains expected tool names', () => {
      expect(EDGE_TOOL_NAMES).toContain('list_edge_devices');
      expect(EDGE_TOOL_NAMES).toContain('get_device_status');
      expect(EDGE_TOOL_NAMES).toContain('read_sensor');
      expect(EDGE_TOOL_NAMES).toContain('send_device_command');
      expect(EDGE_TOOL_NAMES).toContain('control_actuator');
      expect(EDGE_TOOL_NAMES).toContain('register_edge_device');
    });

    it('register_edge_device is workflowUsable: false', () => {
      const def = EDGE_TOOLS.find((t) => t.name === 'register_edge_device');
      expect(def?.workflowUsable).toBe(false);
    });

    it('read/control tools are workflowUsable: true', () => {
      const workflowTools = [
        'list_edge_devices',
        'get_device_status',
        'read_sensor',
        'send_device_command',
        'control_actuator',
      ];
      for (const name of workflowTools) {
        const def = EDGE_TOOLS.find((t) => t.name === name);
        expect(def?.workflowUsable, `${name} should be workflowUsable: true`).toBe(true);
      }
    });
  });

  // ========================================================================
  // No userId
  // ========================================================================

  it('returns error when userId is missing', async () => {
    const result = await executeEdgeTool('list_edge_devices', {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('userId is required');
  });

  // ========================================================================
  // list_edge_devices
  // ========================================================================

  describe('list_edge_devices', () => {
    it('returns list of devices', async () => {
      mockEdgeService.listDevices.mockResolvedValue({
        devices: [makeDevice()],
        total: 1,
      });

      const result = await executeEdgeTool('list_edge_devices', {}, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.total).toBe(1);
      expect((r.devices as unknown[]).length).toBe(1);
    });

    it('passes status filter to service (fixes "as undefined" bug)', async () => {
      mockEdgeService.listDevices.mockResolvedValue({ devices: [], total: 0 });

      await executeEdgeTool('list_edge_devices', { status: 'online' }, 'user-1');

      expect(mockEdgeService.listDevices).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ status: 'online' })
      );
    });

    it('passes type filter to service (fixes "as undefined" bug)', async () => {
      mockEdgeService.listDevices.mockResolvedValue({ devices: [], total: 0 });

      await executeEdgeTool('list_edge_devices', { type: 'esp32' }, 'user-1');

      expect(mockEdgeService.listDevices).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ type: 'esp32' })
      );
    });

    it('passes search filter to service', async () => {
      mockEdgeService.listDevices.mockResolvedValue({ devices: [], total: 0 });

      await executeEdgeTool('list_edge_devices', { search: 'living' }, 'user-1');

      expect(mockEdgeService.listDevices).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ search: 'living' })
      );
    });

    it('includes lastSeen as ISO string in result', async () => {
      mockEdgeService.listDevices.mockResolvedValue({
        devices: [makeDevice({ lastSeen: new Date('2025-03-01T10:00:00Z') })],
        total: 1,
      });

      const result = await executeEdgeTool('list_edge_devices', {}, 'user-1');

      const devices = (result.result as Record<string, unknown>).devices as Record<
        string,
        unknown
      >[];
      expect(devices[0].lastSeen).toBe('2025-03-01T10:00:00.000Z');
    });

    it('returns error on service failure', async () => {
      mockEdgeService.listDevices.mockRejectedValue(new Error('DB connection lost'));

      const result = await executeEdgeTool('list_edge_devices', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('DB connection lost');
    });
  });

  // ========================================================================
  // get_device_status
  // ========================================================================

  describe('get_device_status', () => {
    it('returns full device status with sensors and actuators', async () => {
      mockEdgeService.getDevice.mockResolvedValue(
        makeDevice({
          sensors: [makeSensor()],
          actuators: [makeActuator()],
        })
      );

      const result = await executeEdgeTool('get_device_status', { device_id: 'dev-1' }, 'user-1');

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect((r.sensors as unknown[]).length).toBe(1);
      expect((r.actuators as unknown[]).length).toBe(1);
    });

    it('returns error when device not found', async () => {
      mockEdgeService.getDevice.mockResolvedValue(null);

      const result = await executeEdgeTool('get_device_status', { device_id: 'unknown' }, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device not found: unknown');
    });

    it('formats sensor lastUpdated as ISO string', async () => {
      mockEdgeService.getDevice.mockResolvedValue(
        makeDevice({
          sensors: [makeSensor({ lastUpdated: new Date('2025-03-01T12:00:00Z') })],
        })
      );

      const result = await executeEdgeTool('get_device_status', { device_id: 'dev-1' }, 'user-1');

      const sensors = (result.result as Record<string, unknown>).sensors as Record<
        string,
        unknown
      >[];
      expect(sensors[0].lastUpdated).toBe('2025-03-01T12:00:00.000Z');
    });
  });

  // ========================================================================
  // read_sensor
  // ========================================================================

  describe('read_sensor', () => {
    it('returns current sensor value', async () => {
      mockEdgeService.getDevice.mockResolvedValue(makeDevice({ sensors: [makeSensor()] }));

      const result = await executeEdgeTool(
        'read_sensor',
        { device_id: 'dev-1', sensor_id: 'temp-1' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.value).toBe(22.5);
    });

    it('returns history when history_limit > 1', async () => {
      mockEdgeService.getDevice.mockResolvedValue(makeDevice({ sensors: [makeSensor()] }));
      mockEdgeService.getTelemetryHistory.mockResolvedValue([
        { value: 21.0, recordedAt: new Date('2025-03-01T09:00:00Z') },
        { value: 22.5, recordedAt: new Date('2025-03-01T10:00:00Z') },
      ]);

      const result = await executeEdgeTool(
        'read_sensor',
        { device_id: 'dev-1', sensor_id: 'temp-1', history_limit: 5 },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect((r.history as unknown[]).length).toBe(2);
      expect(mockEdgeService.getTelemetryHistory).toHaveBeenCalledWith(
        'user-1',
        'dev-1',
        'temp-1',
        5
      );
    });

    it('caps history_limit at 100', async () => {
      mockEdgeService.getDevice.mockResolvedValue(makeDevice({ sensors: [makeSensor()] }));
      mockEdgeService.getTelemetryHistory.mockResolvedValue([]);

      await executeEdgeTool(
        'read_sensor',
        { device_id: 'dev-1', sensor_id: 'temp-1', history_limit: 999 },
        'user-1'
      );

      expect(mockEdgeService.getTelemetryHistory).toHaveBeenCalledWith(
        'user-1',
        'dev-1',
        'temp-1',
        100
      );
    });

    it('returns error when device not found', async () => {
      mockEdgeService.getDevice.mockResolvedValue(null);

      const result = await executeEdgeTool(
        'read_sensor',
        { device_id: 'unknown', sensor_id: 'temp-1' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device not found: unknown');
    });

    it('returns error when sensor not found on device', async () => {
      mockEdgeService.getDevice.mockResolvedValue(makeDevice({ sensors: [] }));

      const result = await executeEdgeTool(
        'read_sensor',
        { device_id: 'dev-1', sensor_id: 'nonexistent' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Sensor nonexistent not found');
    });
  });

  // ========================================================================
  // send_device_command
  // ========================================================================

  describe('send_device_command', () => {
    it('sends a command and returns command id', async () => {
      mockEdgeService.sendCommand.mockResolvedValue(makeCommand({ commandType: 'reboot' }));

      const result = await executeEdgeTool(
        'send_device_command',
        { device_id: 'dev-1', command_type: 'reboot' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.commandId).toBe('cmd-1');
      expect(r.message).toContain('"reboot"');
    });

    it('sends command with payload', async () => {
      mockEdgeService.sendCommand.mockResolvedValue(makeCommand({ commandType: 'update_config' }));

      await executeEdgeTool(
        'send_device_command',
        { device_id: 'dev-1', command_type: 'update_config', payload: { interval: 30 } },
        'user-1'
      );

      expect(mockEdgeService.sendCommand).toHaveBeenCalledWith(
        'user-1',
        'dev-1',
        expect.objectContaining({ commandType: 'update_config', payload: { interval: 30 } })
      );
    });

    it('returns error on service failure', async () => {
      mockEdgeService.sendCommand.mockRejectedValue(new Error('Device offline'));

      const result = await executeEdgeTool(
        'send_device_command',
        { device_id: 'dev-1', command_type: 'reboot' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device offline');
    });
  });

  // ========================================================================
  // control_actuator
  // ========================================================================

  describe('control_actuator', () => {
    it('sends set_actuator command for a relay', async () => {
      mockEdgeService.getDevice.mockResolvedValue(makeDevice({ actuators: [makeActuator()] }));
      mockEdgeService.sendCommand.mockResolvedValue(makeCommand({ commandType: 'set_actuator' }));

      const result = await executeEdgeTool(
        'control_actuator',
        { device_id: 'dev-1', actuator_id: 'relay-1', state: { on: true } },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(mockEdgeService.sendCommand).toHaveBeenCalledWith(
        'user-1',
        'dev-1',
        expect.objectContaining({
          commandType: 'set_actuator',
          payload: { actuatorId: 'relay-1', state: { on: true } },
        })
      );
    });

    it('returns error when device not found', async () => {
      mockEdgeService.getDevice.mockResolvedValue(null);

      const result = await executeEdgeTool(
        'control_actuator',
        { device_id: 'unknown', actuator_id: 'relay-1', state: { on: true } },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Device not found: unknown');
    });

    it('returns error when actuator not found on device', async () => {
      mockEdgeService.getDevice.mockResolvedValue(makeDevice({ actuators: [] }));

      const result = await executeEdgeTool(
        'control_actuator',
        { device_id: 'dev-1', actuator_id: 'nonexistent', state: {} },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Actuator nonexistent not found');
    });
  });

  // ========================================================================
  // register_edge_device
  // ========================================================================

  describe('register_edge_device', () => {
    it('registers device without sensors/actuators', async () => {
      mockEdgeService.registerDevice.mockResolvedValue(makeDevice());

      const result = await executeEdgeTool(
        'register_edge_device',
        { name: 'Living Room Sensor', type: 'esp32' },
        'user-1'
      );

      expect(result.success).toBe(true);
      const r = result.result as Record<string, unknown>;
      expect(r.id).toBe('dev-1');
      expect(r.message).toContain('registered');
    });

    it('passes sensors array to service (fixes "as undefined" bug)', async () => {
      const sensors = [
        { id: 'temp-1', name: 'Temperature', type: 'temperature', unit: '°C' },
        { id: 'hum-1', name: 'Humidity', type: 'humidity', unit: '%' },
      ];
      mockEdgeService.registerDevice.mockResolvedValue(
        makeDevice({ sensors: sensors.map((s) => ({ ...s, lastValue: null, lastUpdated: null })) })
      );

      await executeEdgeTool(
        'register_edge_device',
        { name: 'My Device', type: 'raspberry-pi', sensors },
        'user-1'
      );

      expect(mockEdgeService.registerDevice).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ sensors })
      );
    });

    it('passes actuators array to service (fixes "as undefined" bug)', async () => {
      const actuators = [{ id: 'relay-1', name: 'Relay', type: 'relay' }];
      mockEdgeService.registerDevice.mockResolvedValue(
        makeDevice({ actuators: actuators.map((a) => ({ ...a, state: null })) })
      );

      await executeEdgeTool(
        'register_edge_device',
        { name: 'My Device', type: 'esp32', actuators },
        'user-1'
      );

      expect(mockEdgeService.registerDevice).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ actuators })
      );
    });

    it('passes protocol and firmware_version', async () => {
      mockEdgeService.registerDevice.mockResolvedValue(
        makeDevice({ protocol: 'websocket', firmwareVersion: '2.1.0' })
      );

      await executeEdgeTool(
        'register_edge_device',
        { name: 'Device', type: 'custom', protocol: 'websocket', firmware_version: '2.1.0' },
        'user-1'
      );

      expect(mockEdgeService.registerDevice).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ protocol: 'websocket', firmwareVersion: '2.1.0' })
      );
    });

    it('includes MQTT topic in message', async () => {
      mockEdgeService.registerDevice.mockResolvedValue(makeDevice({ id: 'dev-abc' }));

      const result = await executeEdgeTool(
        'register_edge_device',
        { name: 'Device', type: 'esp32' },
        'user-1'
      );

      expect((result.result as Record<string, unknown>).message).toContain('dev-abc');
    });

    it('returns error on service failure', async () => {
      mockEdgeService.registerDevice.mockRejectedValue(new Error('Name already taken'));

      const result = await executeEdgeTool(
        'register_edge_device',
        { name: 'Dup', type: 'esp32' },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Name already taken');
    });
  });

  // ========================================================================
  // Unknown tool
  // ========================================================================

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeEdgeTool('nonexistent_tool', {}, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown edge tool');
    });
  });
});
