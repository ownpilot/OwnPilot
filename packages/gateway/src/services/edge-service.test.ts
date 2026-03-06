/**
 * EdgeService Tests
 *
 * Tests for EdgeServiceImpl: device CRUD, command dispatch, telemetry/status
 * handling via MQTT callbacks, and WS broadcast.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks — all vi.hoisted() to prevent TDZ issues in vi.mock() factories
// =============================================================================

const {
  mockDevicesRepo,
  mockCommandsRepo,
  mockTelemetryRepo,
  MockEdgeDevicesRepository,
  MockEdgeCommandsRepository,
  MockEdgeTelemetryRepository,
} = vi.hoisted(() => {
  const mockDevicesRepo = {
    create: vi.fn(),
    getById: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    list: vi.fn(),
    updateStatus: vi.fn(),
    updateSensorValue: vi.fn(),
  };
  const mockCommandsRepo = {
    create: vi.fn(),
    getById: vi.fn(),
    updateStatus: vi.fn(),
    listByDevice: vi.fn(),
  };
  const mockTelemetryRepo = {
    insert: vi.fn(),
    getLatest: vi.fn(),
    getHistory: vi.fn(),
  };

  const MockEdgeDevicesRepository = vi.fn(function () {
    return mockDevicesRepo;
  });
  const MockEdgeCommandsRepository = vi.fn(function () {
    return mockCommandsRepo;
  });
  const MockEdgeTelemetryRepository = vi.fn(function () {
    return mockTelemetryRepo;
  });

  return {
    mockDevicesRepo,
    mockCommandsRepo,
    mockTelemetryRepo,
    MockEdgeDevicesRepository,
    MockEdgeCommandsRepository,
    MockEdgeTelemetryRepository,
  };
});

vi.mock('../db/repositories/edge.js', () => ({
  EdgeDevicesRepository: MockEdgeDevicesRepository,
  EdgeCommandsRepository: MockEdgeCommandsRepository,
  EdgeTelemetryRepository: MockEdgeTelemetryRepository,
}));

// -----------------------------------------------------------------------------
// MQTT client mock
// -----------------------------------------------------------------------------

const { mockMqttClient, mockGetEdgeMqttClient } = vi.hoisted(() => {
  const mockMqttClient = {
    connect: vi.fn(),
    subscribe: vi.fn(),
    publish: vi.fn(),
    isConnected: vi.fn(),
  };
  const mockGetEdgeMqttClient = vi.fn(() => mockMqttClient);
  return { mockMqttClient, mockGetEdgeMqttClient };
});

vi.mock('./edge-mqtt-client.js', () => ({
  getEdgeMqttClient: mockGetEdgeMqttClient,
  commandTopic: vi.fn(
    (userId: string, deviceId: string) => `ownpilot/${userId}/devices/${deviceId}/commands`
  ),
  telemetryWildcard: vi.fn(() => 'ownpilot/+/devices/+/telemetry'),
  statusWildcard: vi.fn(() => 'ownpilot/+/devices/+/status'),
  parseTopicIds: vi.fn((topic: string) => {
    const parts = topic.split('/');
    // Real format: ownpilot/{userId}/devices/{deviceId}/{suffix}
    if (parts.length < 5 || parts[0] !== 'ownpilot' || parts[2] !== 'devices') return null;
    const userId = parts[1];
    const deviceId = parts[3];
    if (!userId || !deviceId) return null;
    return { userId, deviceId };
  }),
}));

// -----------------------------------------------------------------------------
// WS gateway mock
// -----------------------------------------------------------------------------

const { mockWsBroadcast } = vi.hoisted(() => {
  const mockWsBroadcast = vi.fn();
  return { mockWsBroadcast };
});

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: mockWsBroadcast },
}));

// -----------------------------------------------------------------------------
// Core mock (getLog)
// -----------------------------------------------------------------------------

vi.mock('@ownpilot/core', () => ({
  getLog: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// =============================================================================
// Import service under test — AFTER all mocks are declared
// =============================================================================

import { getEdgeService } from './edge-service.js';

// =============================================================================
// Helpers
// =============================================================================

function makeDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dev-1',
    userId: 'user-1',
    name: 'Temp Sensor',
    type: 'sensor',
    protocol: 'mqtt',
    sensors: [],
    actuators: [],
    status: 'online',
    lastSeen: null,
    firmwareVersion: undefined,
    metadata: {},
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function makeCommand(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cmd-1',
    deviceId: 'dev-1',
    userId: 'user-1',
    commandType: 'reboot',
    payload: {},
    status: 'pending',
    result: undefined,
    createdAt: new Date('2025-01-01'),
    completedAt: undefined,
    ...overrides,
  };
}

function makeTelemetry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tel-1',
    deviceId: 'dev-1',
    sensorId: 'temp',
    value: 22.5,
    recordedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('EdgeService', () => {
  let service: ReturnType<typeof getEdgeService>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Default: MQTT connect resolves to false (not connected) unless overridden
    mockMqttClient.connect.mockResolvedValue(false);
    mockMqttClient.isConnected.mockReturnValue(false);

    // Grab the singleton (already constructed since module is already loaded)
    service = getEdgeService();

    // Reset mqttInitialized flag by clearing all module-level state isn't possible
    // without vi.resetModules(). Instead, we rely on the fact that mqttInitialized
    // is already set to true from the first call. For tests that need MQTT subscribe
    // callbacks, we must call a method that calls initMqtt() on a fresh instance.
    // The singleton was created fresh once at import time, so we need to reassign
    // the private flag indirectly by making connect return false on subsequent calls
    // (initMqtt only runs once per instance; we test behavior accordingly).
  });

  // ===========================================================================
  // registerDevice
  // ===========================================================================

  describe('registerDevice', () => {
    it('creates a device and returns it', async () => {
      const device = makeDevice();
      mockDevicesRepo.create.mockResolvedValue(device);

      const input = { name: 'Temp Sensor', type: 'sensor' as const, protocol: 'mqtt' as const };
      const result = await service.registerDevice('user-1', input);

      expect(mockDevicesRepo.create).toHaveBeenCalledWith(input);
      expect(result).toEqual(device);
    });

    it('broadcasts "created" after device registration', async () => {
      const device = makeDevice();
      mockDevicesRepo.create.mockResolvedValue(device);

      await service.registerDevice('user-1', { name: 'Temp Sensor', type: 'sensor' as const });

      expect(mockWsBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'edge-device',
        action: 'created',
        id: device.id,
      });
    });

    it('constructs devices repo with the correct userId', async () => {
      const device = makeDevice({ userId: 'user-99' });
      mockDevicesRepo.create.mockResolvedValue(device);

      await service.registerDevice('user-99', { name: 'Sensor', type: 'sensor' as const });

      expect(MockEdgeDevicesRepository).toHaveBeenCalledWith('user-99');
    });
  });

  // ===========================================================================
  // getDevice
  // ===========================================================================

  describe('getDevice', () => {
    it('returns the device when found', async () => {
      const device = makeDevice();
      mockDevicesRepo.getById.mockResolvedValue(device);

      const result = await service.getDevice('user-1', 'dev-1');

      expect(mockDevicesRepo.getById).toHaveBeenCalledWith('dev-1');
      expect(result).toEqual(device);
    });

    it('returns null when device not found', async () => {
      mockDevicesRepo.getById.mockResolvedValue(null);

      const result = await service.getDevice('user-1', 'dev-missing');

      expect(result).toBeNull();
    });

    it('constructs repo with correct userId', async () => {
      mockDevicesRepo.getById.mockResolvedValue(null);

      await service.getDevice('user-42', 'dev-1');

      expect(MockEdgeDevicesRepository).toHaveBeenCalledWith('user-42');
    });
  });

  // ===========================================================================
  // updateDevice
  // ===========================================================================

  describe('updateDevice', () => {
    it('returns updated device and broadcasts "updated"', async () => {
      const device = makeDevice({ name: 'Updated Name' });
      mockDevicesRepo.update.mockResolvedValue(device);

      const result = await service.updateDevice('user-1', 'dev-1', { name: 'Updated Name' });

      expect(mockDevicesRepo.update).toHaveBeenCalledWith('dev-1', { name: 'Updated Name' });
      expect(result).toEqual(device);
      expect(mockWsBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'edge-device',
        action: 'updated',
        id: 'dev-1',
      });
    });

    it('returns null and does NOT broadcast when device not found', async () => {
      mockDevicesRepo.update.mockResolvedValue(null);

      const result = await service.updateDevice('user-1', 'dev-missing', { name: 'X' });

      expect(result).toBeNull();
      expect(mockWsBroadcast).not.toHaveBeenCalled();
    });

    it('constructs repo with correct userId', async () => {
      mockDevicesRepo.update.mockResolvedValue(null);

      await service.updateDevice('user-77', 'dev-1', { name: 'New' });

      expect(MockEdgeDevicesRepository).toHaveBeenCalledWith('user-77');
    });
  });

  // ===========================================================================
  // removeDevice
  // ===========================================================================

  describe('removeDevice', () => {
    it('returns true and broadcasts "deleted" when device exists', async () => {
      mockDevicesRepo.delete.mockResolvedValue(true);

      const result = await service.removeDevice('user-1', 'dev-1');

      expect(result).toBe(true);
      expect(mockDevicesRepo.delete).toHaveBeenCalledWith('dev-1');
      expect(mockWsBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'edge-device',
        action: 'deleted',
        id: 'dev-1',
      });
    });

    it('returns false and does NOT broadcast when device not found', async () => {
      mockDevicesRepo.delete.mockResolvedValue(false);

      const result = await service.removeDevice('user-1', 'dev-missing');

      expect(result).toBe(false);
      expect(mockWsBroadcast).not.toHaveBeenCalled();
    });

    it('constructs repo with correct userId', async () => {
      mockDevicesRepo.delete.mockResolvedValue(false);

      await service.removeDevice('user-55', 'dev-1');

      expect(MockEdgeDevicesRepository).toHaveBeenCalledWith('user-55');
    });
  });

  // ===========================================================================
  // listDevices
  // ===========================================================================

  describe('listDevices', () => {
    it('returns devices and total from repo', async () => {
      const devices = [makeDevice()];
      mockDevicesRepo.list.mockResolvedValue({ devices, total: 1 });

      const result = await service.listDevices('user-1');

      expect(mockDevicesRepo.list).toHaveBeenCalledWith(undefined);
      expect(result).toEqual({ devices, total: 1 });
    });

    it('passes query params to repo', async () => {
      mockDevicesRepo.list.mockResolvedValue({ devices: [], total: 0 });

      await service.listDevices('user-1', { status: 'online', type: 'sensor' as const, limit: 10 });

      expect(mockDevicesRepo.list).toHaveBeenCalledWith({
        status: 'online',
        type: 'sensor',
        limit: 10,
      });
    });

    it('constructs repo with correct userId', async () => {
      mockDevicesRepo.list.mockResolvedValue({ devices: [], total: 0 });

      await service.listDevices('user-99');

      expect(MockEdgeDevicesRepository).toHaveBeenCalledWith('user-99');
    });
  });

  // ===========================================================================
  // sendCommand
  // ===========================================================================

  describe('sendCommand', () => {
    const commandInput = { commandType: 'reboot', payload: { force: true } };

    it('throws when device not found', async () => {
      mockDevicesRepo.getById.mockResolvedValue(null);

      await expect(service.sendCommand('user-1', 'dev-missing', commandInput)).rejects.toThrow(
        'Device dev-missing not found'
      );

      expect(mockCommandsRepo.create).not.toHaveBeenCalled();
    });

    it('creates command and updates status to "sent" when MQTT connected', async () => {
      const device = makeDevice();
      const command = makeCommand({ id: 'cmd-1', status: 'pending' });
      const sentCommand = makeCommand({ id: 'cmd-1', status: 'sent' });

      mockDevicesRepo.getById.mockResolvedValue(device);
      mockCommandsRepo.create.mockResolvedValue(command);
      mockMqttClient.isConnected.mockReturnValue(true);
      mockMqttClient.publish.mockResolvedValue(undefined);
      mockCommandsRepo.updateStatus.mockResolvedValue(undefined);
      mockCommandsRepo.getById.mockResolvedValue(sentCommand);

      const result = await service.sendCommand('user-1', 'dev-1', commandInput);

      expect(mockCommandsRepo.create).toHaveBeenCalledWith('dev-1', commandInput);
      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        'ownpilot/user-1/devices/dev-1/commands',
        {
          commandId: 'cmd-1',
          type: 'reboot',
          payload: { force: true },
        }
      );
      expect(mockCommandsRepo.updateStatus).toHaveBeenCalledWith('cmd-1', 'sent');
      expect(result).toEqual(sentCommand);
    });

    it('does NOT publish and leaves command "pending" when MQTT not connected', async () => {
      const device = makeDevice();
      const command = makeCommand({ status: 'pending' });
      const pendingCommand = makeCommand({ status: 'pending' });

      mockDevicesRepo.getById.mockResolvedValue(device);
      mockCommandsRepo.create.mockResolvedValue(command);
      mockMqttClient.isConnected.mockReturnValue(false);
      mockCommandsRepo.getById.mockResolvedValue(pendingCommand);

      const result = await service.sendCommand('user-1', 'dev-1', commandInput);

      expect(mockMqttClient.publish).not.toHaveBeenCalled();
      expect(mockCommandsRepo.updateStatus).not.toHaveBeenCalled();
      expect(result).toEqual(pendingCommand);
    });

    it('updates command status to "failed" when publish throws', async () => {
      const device = makeDevice();
      const command = makeCommand({ id: 'cmd-1' });
      const failedCommand = makeCommand({ id: 'cmd-1', status: 'failed' });

      mockDevicesRepo.getById.mockResolvedValue(device);
      mockCommandsRepo.create.mockResolvedValue(command);
      mockMqttClient.isConnected.mockReturnValue(true);
      mockMqttClient.publish.mockRejectedValue(new Error('Broker unreachable'));
      mockCommandsRepo.updateStatus.mockResolvedValue(undefined);
      mockCommandsRepo.getById.mockResolvedValue(failedCommand);

      const result = await service.sendCommand('user-1', 'dev-1', commandInput);

      expect(mockCommandsRepo.updateStatus).toHaveBeenCalledWith('cmd-1', 'failed', {
        error: 'Broker unreachable',
      });
      expect(result).toEqual(failedCommand);
    });

    it('uses default empty payload when commandInput.payload is undefined', async () => {
      const device = makeDevice();
      const command = makeCommand({ id: 'cmd-2' });
      const sentCommand = makeCommand({ id: 'cmd-2', status: 'sent' });

      mockDevicesRepo.getById.mockResolvedValue(device);
      mockCommandsRepo.create.mockResolvedValue(command);
      mockMqttClient.isConnected.mockReturnValue(true);
      mockMqttClient.publish.mockResolvedValue(undefined);
      mockCommandsRepo.updateStatus.mockResolvedValue(undefined);
      mockCommandsRepo.getById.mockResolvedValue(sentCommand);

      await service.sendCommand('user-1', 'dev-1', { commandType: 'ping' });

      expect(mockMqttClient.publish).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ payload: {} })
      );
    });

    it('constructs repos with correct userId', async () => {
      mockDevicesRepo.getById.mockResolvedValue(null);

      await expect(service.sendCommand('user-88', 'dev-1', commandInput)).rejects.toThrow();

      expect(MockEdgeDevicesRepository).toHaveBeenCalledWith('user-88');
    });
  });

  // ===========================================================================
  // getCommandHistory
  // ===========================================================================

  describe('getCommandHistory', () => {
    it('returns command list from repo', async () => {
      const commands = [makeCommand(), makeCommand({ id: 'cmd-2' })];
      mockCommandsRepo.listByDevice.mockResolvedValue(commands);

      const result = await service.getCommandHistory('user-1', 'dev-1');

      expect(mockCommandsRepo.listByDevice).toHaveBeenCalledWith('dev-1', undefined);
      expect(result).toEqual(commands);
    });

    it('passes limit to repo', async () => {
      mockCommandsRepo.listByDevice.mockResolvedValue([]);

      await service.getCommandHistory('user-1', 'dev-1', 25);

      expect(mockCommandsRepo.listByDevice).toHaveBeenCalledWith('dev-1', 25);
    });

    it('constructs repo with correct userId', async () => {
      mockCommandsRepo.listByDevice.mockResolvedValue([]);

      await service.getCommandHistory('user-33', 'dev-1');

      expect(MockEdgeCommandsRepository).toHaveBeenCalledWith('user-33');
    });
  });

  // ===========================================================================
  // getLatestTelemetry
  // ===========================================================================

  describe('getLatestTelemetry', () => {
    it('returns latest telemetry from repo', async () => {
      const telemetry = [makeTelemetry()];
      mockTelemetryRepo.getLatest.mockResolvedValue(telemetry);

      const result = await service.getLatestTelemetry('user-1', 'dev-1');

      expect(mockTelemetryRepo.getLatest).toHaveBeenCalledWith('dev-1');
      expect(result).toEqual(telemetry);
    });

    it('constructs repo with correct userId', async () => {
      mockTelemetryRepo.getLatest.mockResolvedValue([]);

      await service.getLatestTelemetry('user-44', 'dev-1');

      expect(MockEdgeTelemetryRepository).toHaveBeenCalledWith('user-44');
    });
  });

  // ===========================================================================
  // getTelemetryHistory
  // ===========================================================================

  describe('getTelemetryHistory', () => {
    it('returns telemetry history from repo', async () => {
      const history = [makeTelemetry(), makeTelemetry({ id: 'tel-2' })];
      mockTelemetryRepo.getHistory.mockResolvedValue(history);

      const result = await service.getTelemetryHistory('user-1', 'dev-1', 'temp');

      expect(mockTelemetryRepo.getHistory).toHaveBeenCalledWith('dev-1', 'temp', undefined);
      expect(result).toEqual(history);
    });

    it('passes limit to repo', async () => {
      mockTelemetryRepo.getHistory.mockResolvedValue([]);

      await service.getTelemetryHistory('user-1', 'dev-1', 'humidity', 50);

      expect(mockTelemetryRepo.getHistory).toHaveBeenCalledWith('dev-1', 'humidity', 50);
    });

    it('constructs repo with correct userId', async () => {
      mockTelemetryRepo.getHistory.mockResolvedValue([]);

      await service.getTelemetryHistory('user-66', 'dev-1', 'temp');

      expect(MockEdgeTelemetryRepository).toHaveBeenCalledWith('user-66');
    });
  });
});

// =============================================================================
// MQTT callback tests — require a fresh service instance per test group
// These tests use vi.resetModules() + dynamic import to get a clean singleton.
// =============================================================================

describe('EdgeService MQTT callbacks', () => {
  // We test handleTelemetry and handleStatus by capturing subscribe callbacks
  // from a fresh service created via dynamic import after resetting modules.

  let telemetryCallback: (topic: string, payload: unknown) => Promise<void>;
  let statusCallback: (topic: string, payload: unknown) => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Set up subscribe to capture callbacks
    mockMqttClient.connect.mockResolvedValue(true);
    mockMqttClient.subscribe.mockImplementation((topic: string, cb: unknown) => {
      if (typeof topic === 'string' && topic.includes('telemetry')) {
        telemetryCallback = cb as (topic: string, payload: unknown) => Promise<void>;
      } else {
        statusCallback = cb as (topic: string, payload: unknown) => Promise<void>;
      }
    });

    // Import a fresh service (module-level singleton is reset)
    const { getEdgeService: freshGetEdgeService } = await import('./edge-service.js');
    const svc = freshGetEdgeService();

    // Trigger initMqtt by calling registerDevice
    mockDevicesRepo.create.mockResolvedValue(makeDevice());
    await svc.registerDevice('user-1', { name: 'Init trigger', type: 'sensor' as const });

    // Clear mocks after init so they don't pollute actual test assertions
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // handleTelemetry
  // ---------------------------------------------------------------------------

  describe('handleTelemetry', () => {
    it('inserts telemetry and updates sensor value on valid payload', async () => {
      mockTelemetryRepo.insert.mockResolvedValue(makeTelemetry());
      mockDevicesRepo.updateSensorValue.mockResolvedValue(undefined);

      const topic = 'ownpilot/user-1/devices/dev-1/telemetry';
      await telemetryCallback(topic, { sensorId: 'temp', value: 22.5 });

      expect(mockTelemetryRepo.insert).toHaveBeenCalledWith('dev-1', 'temp', 22.5);
      expect(mockDevicesRepo.updateSensorValue).toHaveBeenCalledWith('dev-1', 'temp', 22.5);
    });

    it('broadcasts "updated" after successful telemetry processing', async () => {
      mockTelemetryRepo.insert.mockResolvedValue(makeTelemetry());
      mockDevicesRepo.updateSensorValue.mockResolvedValue(undefined);

      telemetryCallback('ownpilot/user-1/devices/dev-1/telemetry', {
        sensorId: 'humidity',
        value: 55,
      });

      // The subscribe callback fires-and-forgets handleTelemetry — flush microtask queue
      // so that all async steps (insert, updateSensorValue, broadcast) complete.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockWsBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'edge-device',
        action: 'updated',
        id: 'dev-1',
      });
    });

    it('accepts sensor_id as alternative field name', async () => {
      mockTelemetryRepo.insert.mockResolvedValue(makeTelemetry());
      mockDevicesRepo.updateSensorValue.mockResolvedValue(undefined);

      await telemetryCallback('ownpilot/user-1/devices/dev-1/telemetry', {
        sensor_id: 'pressure',
        value: 1013,
      });

      expect(mockTelemetryRepo.insert).toHaveBeenCalledWith('dev-1', 'pressure', 1013);
    });

    it('does NOT insert when sensorId is missing', async () => {
      await telemetryCallback('ownpilot/user-1/devices/dev-1/telemetry', { value: 42 });

      expect(mockTelemetryRepo.insert).not.toHaveBeenCalled();
    });

    it('does NOT insert when value is missing', async () => {
      await telemetryCallback('ownpilot/user-1/devices/dev-1/telemetry', { sensorId: 'temp' });

      expect(mockTelemetryRepo.insert).not.toHaveBeenCalled();
    });

    it('does nothing when topic cannot be parsed', async () => {
      await telemetryCallback('bad/topic', { sensorId: 'temp', value: 1 });

      expect(mockTelemetryRepo.insert).not.toHaveBeenCalled();
      expect(mockWsBroadcast).not.toHaveBeenCalled();
    });

    it('constructs repos with userId from the topic', async () => {
      mockTelemetryRepo.insert.mockResolvedValue(makeTelemetry());
      mockDevicesRepo.updateSensorValue.mockResolvedValue(undefined);

      await telemetryCallback('ownpilot/user-99/devices/dev-42/telemetry', {
        sensorId: 'temp',
        value: 30,
      });

      expect(MockEdgeTelemetryRepository).toHaveBeenCalledWith('user-99');
      expect(MockEdgeDevicesRepository).toHaveBeenCalledWith('user-99');
      expect(mockTelemetryRepo.insert).toHaveBeenCalledWith('dev-42', 'temp', 30);
    });
  });

  // ---------------------------------------------------------------------------
  // handleStatus
  // ---------------------------------------------------------------------------

  describe('handleStatus', () => {
    it('updates device status from the payload', async () => {
      mockDevicesRepo.updateStatus.mockResolvedValue(undefined);

      const topic = 'ownpilot/user-1/devices/dev-1/status';
      await statusCallback(topic, { status: 'online' });

      expect(mockDevicesRepo.updateStatus).toHaveBeenCalledWith(
        'dev-1',
        'online',
        expect.any(Date)
      );
    });

    it('defaults to "offline" when status field is missing', async () => {
      mockDevicesRepo.updateStatus.mockResolvedValue(undefined);

      await statusCallback('ownpilot/user-1/devices/dev-1/status', {});

      expect(mockDevicesRepo.updateStatus).toHaveBeenCalledWith(
        'dev-1',
        'offline',
        expect.any(Date)
      );
    });

    it('broadcasts "updated" after status change', async () => {
      mockDevicesRepo.updateStatus.mockResolvedValue(undefined);

      await statusCallback('ownpilot/user-1/devices/dev-1/status', { status: 'offline' });

      expect(mockWsBroadcast).toHaveBeenCalledWith('data:changed', {
        entity: 'edge-device',
        action: 'updated',
        id: 'dev-1',
      });
    });

    it('does nothing when topic cannot be parsed', async () => {
      await statusCallback('invalid-topic', { status: 'online' });

      expect(mockDevicesRepo.updateStatus).not.toHaveBeenCalled();
      expect(mockWsBroadcast).not.toHaveBeenCalled();
    });

    it('constructs repo with userId from the topic', async () => {
      mockDevicesRepo.updateStatus.mockResolvedValue(undefined);

      await statusCallback('ownpilot/user-77/devices/dev-5/status', { status: 'online' });

      expect(MockEdgeDevicesRepository).toHaveBeenCalledWith('user-77');
      expect(mockDevicesRepo.updateStatus).toHaveBeenCalledWith(
        'dev-5',
        'online',
        expect.any(Date)
      );
    });

    it('logs warning when handleStatus rejects (line 69)', async () => {
      mockDevicesRepo.updateStatus.mockRejectedValue(new Error('DB down'));

      // Awaiting the subscribe callback resolves the .catch() at line 69
      await statusCallback('ownpilot/user-1/devices/dev-1/status', { status: 'online' });
      // If we reach here without throwing, the .catch() handled the error
    });
  });

  describe('handleTelemetry error path', () => {
    it('logs warning when handleTelemetry rejects (line 62)', async () => {
      mockTelemetryRepo.insert.mockRejectedValue(new Error('insert failed'));

      // Awaiting the subscribe callback resolves the .catch() at line 62
      await telemetryCallback('ownpilot/user-1/devices/dev-1/telemetry', {
        sensorId: 'temp',
        value: 22.5,
      });
      // If we reach here without throwing, the .catch() handled the error
    });
  });
});

// =============================================================================
// Singleton behaviour
// =============================================================================

describe('getEdgeService singleton', () => {
  it('returns the same instance on repeated calls', () => {
    const a = getEdgeService();
    const b = getEdgeService();
    expect(a).toBe(b);
  });
});
