/**
 * Edge Repositories Tests
 *
 * Unit tests for EdgeDevicesRepository, EdgeCommandsRepository, and
 * EdgeTelemetryRepository — CRUD, row mapping, filters, and error cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DatabaseAdapter } from '../adapters/types.js';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter: {
  [K in keyof DatabaseAdapter]: ReturnType<typeof vi.fn>;
} = {
  type: 'postgres' as unknown as ReturnType<typeof vi.fn>,
  isConnected: vi.fn().mockReturnValue(true),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ changes: 1 }),
  exec: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  now: vi.fn().mockReturnValue('NOW()'),
  date: vi.fn(),
  dateSubtract: vi.fn(),
  placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
  boolean: vi.fn().mockImplementation((v: boolean) => v),
  parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue(mockAdapter),
  getAdapterSync: vi.fn().mockReturnValue(mockAdapter),
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    generateId: vi.fn().mockReturnValue('generated-id'),
  };
});

const { EdgeDevicesRepository, EdgeCommandsRepository, EdgeTelemetryRepository } =
  await import('./edge.js');

// ---------------------------------------------------------------------------
// Sample data helpers
// ---------------------------------------------------------------------------

const NOW = '2025-06-01T10:00:00.000Z';
const NOW2 = '2025-06-02T10:00:00.000Z';

function makeDeviceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'edg-1',
    user_id: 'user-1',
    name: 'Sensor Hub',
    type: 'sensor',
    protocol: 'mqtt',
    sensors: JSON.stringify([{ id: 'temp', name: 'Temperature', unit: 'C' }]),
    actuators: JSON.stringify([]),
    status: 'online',
    last_seen: NOW,
    firmware_version: '1.0.0',
    metadata: JSON.stringify({ location: 'kitchen' }),
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeCommandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ecmd-1',
    device_id: 'edg-1',
    user_id: 'user-1',
    command_type: 'reboot',
    payload: JSON.stringify({ force: true }),
    status: 'pending',
    result: null,
    created_at: NOW,
    completed_at: null,
    ...overrides,
  };
}

function makeTelemetryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'etel-1',
    device_id: 'edg-1',
    sensor_id: 'temp',
    value: JSON.stringify(23.5),
    recorded_at: NOW,
    ...overrides,
  };
}

// ===========================================================================
// EdgeDevicesRepository
// ===========================================================================

describe('EdgeDevicesRepository', () => {
  let repo: InstanceType<typeof EdgeDevicesRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EdgeDevicesRepository('user-1');
  });

  // ---- create ----

  describe('create', () => {
    it('inserts device and returns it via getById', async () => {
      mockAdapter.query.mockResolvedValueOnce([]); // INSERT
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow()); // getById

      const result = await repo.create({
        name: 'Sensor Hub',
        type: 'sensor',
        protocol: 'mqtt',
        sensors: [{ id: 'temp', name: 'Temperature', unit: 'C' }],
        actuators: [],
        metadata: { location: 'kitchen' },
      });

      expect(mockAdapter.query).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO edge_devices');
      expect(params[0]).toBe('generated-id'); // id from generateId
      expect(params[1]).toBe('user-1'); // user_id
      expect(params[2]).toBe('Sensor Hub'); // name

      expect(result.id).toBe('edg-1');
      expect(result.name).toBe('Sensor Hub');
      expect(result.type).toBe('sensor');
      expect(result.protocol).toBe('mqtt');
    });

    it('defaults protocol to mqtt when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow());

      await repo.create({ name: 'Device', type: 'gateway' });

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBe('mqtt'); // protocol defaults
    });

    it('defaults sensors and actuators to empty arrays when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow({ sensors: '[]', actuators: '[]' }));

      await repo.create({ name: 'Device', type: 'actuator' });

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[5]).toBe('[]'); // sensors
      expect(params[6]).toBe('[]'); // actuators
    });

    it('stores firmwareVersion when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow({ firmware_version: '2.1.0' }));

      const result = await repo.create({
        name: 'Device',
        type: 'sensor',
        firmwareVersion: '2.1.0',
      });

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[7]).toBe('2.1.0');
      expect(result.firmwareVersion).toBe('2.1.0');
    });

    it('stores null firmwareVersion when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow({ firmware_version: null }));

      await repo.create({ name: 'Device', type: 'sensor' });

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[7]).toBeNull();
    });

    it('maps row to EdgeDevice with parsed JSON fields', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeDeviceRow({
          sensors: JSON.stringify([{ id: 's1', name: 'Humidity', unit: '%' }]),
          metadata: JSON.stringify({ floor: 2 }),
        })
      );

      const result = await repo.create({ name: 'Device', type: 'sensor' });

      expect(result.sensors).toEqual([{ id: 's1', name: 'Humidity', unit: '%' }]);
      expect(result.metadata).toEqual({ floor: 2 });
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });
  });

  // ---- getById ----

  describe('getById', () => {
    it('returns device when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow());

      const result = await repo.getById('edg-1');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM edge_devices WHERE id = $1 AND user_id = $2'),
        ['edg-1', 'user-1']
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe('edg-1');
    });

    it('returns null when device not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('nonexistent');

      expect(result).toBeNull();
    });

    it('maps last_seen to Date when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow({ last_seen: NOW }));

      const result = await repo.getById('edg-1');

      expect(result!.lastSeen).toBeInstanceOf(Date);
      expect(result!.lastSeen!.toISOString()).toBe(NOW);
    });

    it('maps last_seen to null when absent', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow({ last_seen: null }));

      const result = await repo.getById('edg-1');

      expect(result!.lastSeen).toBeNull();
    });
  });

  // ---- update ----

  describe('update', () => {
    it('returns null when device does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null); // getById inside update

      const result = await repo.update('nonexistent', { name: 'New Name' });

      expect(result).toBeNull();
      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('still runs UPDATE even with empty input due to updated_at = NOW() raw clause', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow()); // first getById
      mockAdapter.query.mockResolvedValueOnce([]); // UPDATE (raw clause keeps stmt non-null)
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow()); // second getById

      const result = await repo.update('edg-1', {});

      expect(mockAdapter.query).toHaveBeenCalledOnce();
      expect(result).not.toBeNull();
      expect(result!.id).toBe('edg-1');
    });

    it('runs UPDATE and returns refreshed device', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow()); // first getById
      mockAdapter.query.mockResolvedValueOnce([]); // UPDATE
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow({ name: 'Updated' })); // second getById

      const result = await repo.update('edg-1', { name: 'Updated' });

      expect(mockAdapter.query).toHaveBeenCalledOnce();
      const [sql] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE edge_devices');
      expect(result!.name).toBe('Updated');
    });

    it('serializes sensors array to JSON in update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow());
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeDeviceRow());

      await repo.update('edg-1', {
        sensors: [{ id: 'humidity', name: 'Humidity', unit: '%' }],
      });

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      // sensors should appear serialized somewhere in the params
      const serialized = params.find((p) => typeof p === 'string' && p.includes('humidity'));
      expect(serialized).toBeDefined();
    });
  });

  // ---- delete ----

  describe('delete', () => {
    it('returns true when a row was deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      const result = await repo.delete('edg-1');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'DELETE FROM edge_devices WHERE id = $1 AND user_id = $2',
        ['edg-1', 'user-1']
      );
      expect(result).toBe(true);
    });

    it('returns false when no row was deleted', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      const result = await repo.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  // ---- list ----

  describe('list', () => {
    it('returns devices and total with no filters', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '2' }]); // COUNT
      mockAdapter.query.mockResolvedValueOnce([makeDeviceRow(), makeDeviceRow({ id: 'edg-2' })]); // SELECT

      const result = await repo.list();

      expect(result.total).toBe(2);
      expect(result.devices).toHaveLength(2);
    });

    it('applies status filter', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '1' }]);
      mockAdapter.query.mockResolvedValueOnce([makeDeviceRow()]);

      await repo.list({ status: 'online' });

      const countCall = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(countCall[0]).toContain('AND status =');
      expect(countCall[1]).toContain('online');
    });

    it('applies type filter', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '1' }]);
      mockAdapter.query.mockResolvedValueOnce([makeDeviceRow()]);

      await repo.list({ type: 'sensor' });

      const countCall = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(countCall[0]).toContain('AND type =');
      expect(countCall[1]).toContain('sensor');
    });

    it('applies search filter with ILIKE', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '1' }]);
      mockAdapter.query.mockResolvedValueOnce([makeDeviceRow()]);

      await repo.list({ search: 'hub' });

      const countCall = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(countCall[0]).toContain('ILIKE');
      expect(countCall[1]).toContain('%hub%');
    });

    it('applies custom limit and offset', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '20' }]);
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 5, offset: 10 });

      const dataCall = mockAdapter.query.mock.calls[1] as [string, unknown[]];
      expect(dataCall[1]).toContain(5); // limit
      expect(dataCall[1]).toContain(10); // offset
    });

    it('returns empty devices and total 0 when no rows', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ count: '0' }]);
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list();

      expect(result.total).toBe(0);
      expect(result.devices).toHaveLength(0);
    });

    it('handles missing count row gracefully', async () => {
      mockAdapter.query.mockResolvedValueOnce([]); // count returns empty
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.list();

      expect(result.total).toBe(0);
    });
  });

  // ---- updateStatus ----

  describe('updateStatus', () => {
    it('updates status without lastSeen', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateStatus('edg-1', 'offline');

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE edge_devices');
      expect(sql).toContain('status = $1');
      expect(params[0]).toBe('offline');
      expect(params[1]).toBe('edg-1');
      expect(params[2]).toBe('user-1');
    });

    it('updates status with lastSeen when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      const lastSeen = new Date(NOW);

      await repo.updateStatus('edg-1', 'online', lastSeen);

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('last_seen = $2');
      expect(params[0]).toBe('online');
      expect(params[1]).toBe(lastSeen.toISOString());
      expect(params[2]).toBe('edg-1');
      expect(params[3]).toBe('user-1');
    });
  });

  // ---- updateSensorValue ----

  describe('updateSensorValue', () => {
    it('runs UPDATE with sensorId, value, deviceId, and userId', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateSensorValue('edg-1', 'temp', 22.3);

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE edge_devices');
      expect(params[0]).toBe('temp');
      expect(params[1]).toBe('22.3');
      expect(params[2]).toBe('edg-1');
      expect(params[3]).toBe('user-1');
    });
  });

  // ---- constructor default userId ----

  describe('constructor', () => {
    it('uses "default" as userId when no arg provided', async () => {
      const defaultRepo = new EdgeDevicesRepository();
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await defaultRepo.delete('edg-x');

      expect(mockAdapter.execute).toHaveBeenCalledWith(
        'DELETE FROM edge_devices WHERE id = $1 AND user_id = $2',
        ['edg-x', 'default']
      );
    });
  });
});

// ===========================================================================
// EdgeCommandsRepository
// ===========================================================================

describe('EdgeCommandsRepository', () => {
  let repo: InstanceType<typeof EdgeCommandsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EdgeCommandsRepository('user-1');
  });

  // ---- create ----

  describe('create', () => {
    it('inserts command and returns it via getById', async () => {
      mockAdapter.query.mockResolvedValueOnce([]); // INSERT
      mockAdapter.queryOne.mockResolvedValueOnce(makeCommandRow()); // getById

      const result = await repo.create('edg-1', {
        commandType: 'reboot',
        payload: { force: true },
      });

      expect(mockAdapter.query).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO edge_commands');
      expect(params[0]).toBe('generated-id');
      expect(params[1]).toBe('edg-1');
      expect(params[2]).toBe('user-1');
      expect(params[3]).toBe('reboot');
      expect(params[4]).toBe(JSON.stringify({ force: true }));

      expect(result.id).toBe('ecmd-1');
      expect(result.commandType).toBe('reboot');
      expect(result.payload).toEqual({ force: true });
    });

    it('defaults payload to {} when not provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeCommandRow({ payload: '{}' }));

      await repo.create('edg-1', { commandType: 'ping' });

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[4]).toBe('{}');
    });

    it('maps row to EdgeCommand with parsed JSON payload', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);
      mockAdapter.queryOne.mockResolvedValueOnce(makeCommandRow());

      const result = await repo.create('edg-1', {
        commandType: 'reboot',
        payload: { force: true },
      });

      expect(result.payload).toEqual({ force: true });
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.completedAt).toBeUndefined();
    });
  });

  // ---- getById ----

  describe('getById', () => {
    it('returns command when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCommandRow());

      const result = await repo.getById('ecmd-1');

      expect(mockAdapter.queryOne).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM edge_commands WHERE id = $1 AND user_id = $2'),
        ['ecmd-1', 'user-1']
      );
      expect(result).not.toBeNull();
      expect(result!.id).toBe('ecmd-1');
    });

    it('returns null when command not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      const result = await repo.getById('nonexistent');

      expect(result).toBeNull();
    });

    it('maps completedAt to Date when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeCommandRow({ completed_at: NOW2 }));

      const result = await repo.getById('ecmd-1');

      expect(result!.completedAt).toBeInstanceOf(Date);
      expect(result!.completedAt!.toISOString()).toBe(NOW2);
    });

    it('maps result JSON field when present', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeCommandRow({ result: JSON.stringify({ exitCode: 0 }) })
      );

      const result = await repo.getById('ecmd-1');

      expect(result!.result).toEqual({ exitCode: 0 });
    });
  });

  // ---- updateStatus ----

  describe('updateStatus', () => {
    it('updates status without result', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateStatus('ecmd-1', 'sent');

      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('UPDATE edge_commands SET status = $1');
      expect(params[0]).toBe('sent');
      expect(params[1]).toBeNull(); // result is null
      expect(params[3]).toBe('ecmd-1');
      expect(params[4]).toBe('user-1');
    });

    it('updates status with result serialized to JSON', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateStatus('ecmd-1', 'completed', { success: true });

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[1]).toBe(JSON.stringify({ success: true }));
    });

    it('sets completedAt for terminal statuses', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateStatus('ecmd-1', 'completed');

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[2]).not.toBeNull(); // completed_at is set
    });

    it('sets completedAt for failed status', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateStatus('ecmd-1', 'failed');

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[2]).not.toBeNull();
    });

    it('sets completedAt to null for non-terminal statuses', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.updateStatus('ecmd-1', 'sent');

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[2]).toBeNull();
    });
  });

  // ---- listByDevice ----

  describe('listByDevice', () => {
    it('returns commands for device ordered by created_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeCommandRow({ id: 'ecmd-2' }),
        makeCommandRow({ id: 'ecmd-1' }),
      ]);

      const result = await repo.listByDevice('edg-1');

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY created_at DESC'),
        ['edg-1', 'user-1', 50]
      );
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe('ecmd-2');
    });

    it('uses custom limit when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.listByDevice('edg-1', 10);

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[2]).toBe(10);
    });

    it('returns empty array when no commands exist', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.listByDevice('edg-1');

      expect(result).toEqual([]);
    });
  });
});

// ===========================================================================
// EdgeTelemetryRepository
// ===========================================================================

describe('EdgeTelemetryRepository', () => {
  let repo: InstanceType<typeof EdgeTelemetryRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new EdgeTelemetryRepository('user-1');
  });

  // ---- insert ----

  describe('insert', () => {
    it('inserts telemetry and returns constructed EdgeTelemetry', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.insert('edg-1', 'temp', 23.5);

      expect(mockAdapter.query).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO edge_telemetry');
      expect(params[0]).toBe('generated-id');
      expect(params[1]).toBe('edg-1');
      expect(params[2]).toBe('temp');
      expect(params[3]).toBe(JSON.stringify(23.5));

      expect(result.id).toBe('generated-id');
      expect(result.deviceId).toBe('edg-1');
      expect(result.sensorId).toBe('temp');
      expect(result.value).toBe(23.5);
      expect(result.recordedAt).toBeInstanceOf(Date);
    });

    it('serializes object value to JSON', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.insert('edg-1', 'gps', { lat: 51.5, lng: -0.1 });

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[3]).toBe(JSON.stringify({ lat: 51.5, lng: -0.1 }));
      expect(result.value).toEqual({ lat: 51.5, lng: -0.1 });
    });

    it('serializes null value to JSON', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.insert('edg-1', 'sensor-x', null);

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[3]).toBe('null');
    });
  });

  // ---- insertBatch ----

  describe('insertBatch', () => {
    it('does nothing when entries array is empty', async () => {
      await repo.insertBatch([]);

      expect(mockAdapter.query).not.toHaveBeenCalled();
    });

    it('inserts multiple entries in a single query', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.insertBatch([
        { deviceId: 'edg-1', sensorId: 'temp', value: 22 },
        { deviceId: 'edg-1', sensorId: 'humidity', value: 60 },
      ]);

      expect(mockAdapter.query).toHaveBeenCalledOnce();
      const [sql, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('INSERT INTO edge_telemetry');
      // 2 entries x 4 params each = 8 total params
      expect(params).toHaveLength(8);
    });

    it('serializes each value to JSON in batch', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.insertBatch([{ deviceId: 'edg-1', sensorId: 'temp', value: { celsius: 25 } }]);

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[3]).toBe(JSON.stringify({ celsius: 25 }));
    });
  });

  // ---- getLatest ----

  describe('getLatest', () => {
    it('returns latest telemetry per sensor', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeTelemetryRow({ sensor_id: 'temp', value: JSON.stringify(23.5) }),
        makeTelemetryRow({ id: 'etel-2', sensor_id: 'humidity', value: JSON.stringify(60) }),
      ]);

      const result = await repo.getLatest('edg-1');

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('DISTINCT ON (sensor_id)'),
        ['edg-1']
      );
      expect(result).toHaveLength(2);
      expect(result[0]!.sensorId).toBe('temp');
      expect(result[0]!.value).toBe(23.5);
    });

    it('returns empty array when no telemetry exists', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getLatest('edg-1');

      expect(result).toEqual([]);
    });

    it('maps telemetry row fields correctly', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeTelemetryRow()]);

      const result = await repo.getLatest('edg-1');

      const entry = result[0]!;
      expect(entry.id).toBe('etel-1');
      expect(entry.deviceId).toBe('edg-1');
      expect(entry.sensorId).toBe('temp');
      expect(entry.recordedAt).toBeInstanceOf(Date);
    });
  });

  // ---- getHistory ----

  describe('getHistory', () => {
    it('returns history ordered by recorded_at DESC with default limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeTelemetryRow(),
        makeTelemetryRow({ id: 'etel-2' }),
      ]);

      const result = await repo.getHistory('edg-1', 'temp');

      expect(mockAdapter.query).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY recorded_at DESC'),
        ['edg-1', 'temp', 100]
      );
      expect(result).toHaveLength(2);
    });

    it('uses custom limit when provided', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getHistory('edg-1', 'temp', 25);

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[2]).toBe(25);
    });

    it('filters by both deviceId and sensorId', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getHistory('edg-1', 'humidity');

      const [, params] = mockAdapter.query.mock.calls[0] as [string, unknown[]];
      expect(params[0]).toBe('edg-1');
      expect(params[1]).toBe('humidity');
    });

    it('returns empty array when no history exists', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getHistory('edg-1', 'unknown-sensor');

      expect(result).toEqual([]);
    });

    it('parses complex JSON value from telemetry row', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeTelemetryRow({ value: JSON.stringify({ x: 1, y: 2, z: 3 }) }),
      ]);

      const result = await repo.getHistory('edg-1', 'accel');

      expect(result[0]!.value).toEqual({ x: 1, y: 2, z: 3 });
    });
  });
});
