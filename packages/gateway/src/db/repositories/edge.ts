/**
 * Edge Repositories (PostgreSQL)
 *
 * CRUD for edge devices, commands, and telemetry data.
 */

import { generateId } from '@ownpilot/core';
import type {
  EdgeDevice,
  EdgeCommand,
  EdgeTelemetry,
  EdgeSensor,
  EdgeActuator,
  EdgeDeviceType,
  EdgeProtocol,
  EdgeDeviceStatus,
  EdgeCommandStatus,
  RegisterDeviceInput,
  UpdateDeviceInput,
  EdgeDeviceQuery,
  EdgeCommandInput,
} from '@ownpilot/core';
import { BaseRepository, parseJsonField } from './base.js';
import { buildUpdateStatement } from './query-helpers.js';

// ============================================================================
// Row Types
// ============================================================================

interface EdgeDeviceRow {
  id: string;
  user_id: string;
  name: string;
  type: string;
  protocol: string;
  sensors: string;
  actuators: string;
  status: string;
  last_seen: string | null;
  firmware_version: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

interface EdgeCommandRow {
  id: string;
  device_id: string;
  user_id: string;
  command_type: string;
  payload: string;
  status: string;
  result: string | null;
  created_at: string;
  completed_at: string | null;
}

interface EdgeTelemetryRow {
  id: string;
  device_id: string;
  sensor_id: string;
  value: string;
  recorded_at: string;
}

// ============================================================================
// Row Mappers
// ============================================================================

function rowToDevice(row: EdgeDeviceRow): EdgeDevice {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    type: row.type as EdgeDeviceType,
    protocol: row.protocol as EdgeProtocol,
    sensors: parseJsonField<EdgeSensor[]>(row.sensors, []),
    actuators: parseJsonField<EdgeActuator[]>(row.actuators, []),
    status: row.status as EdgeDeviceStatus,
    lastSeen: row.last_seen ? new Date(row.last_seen) : null,
    firmwareVersion: row.firmware_version ?? undefined,
    metadata: parseJsonField<Record<string, unknown>>(row.metadata, {}),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function rowToCommand(row: EdgeCommandRow): EdgeCommand {
  return {
    id: row.id,
    deviceId: row.device_id,
    userId: row.user_id,
    commandType: row.command_type,
    payload: parseJsonField<Record<string, unknown>>(row.payload, {}),
    status: row.status as EdgeCommandStatus,
    result: row.result ? parseJsonField<Record<string, unknown>>(row.result, {}) : undefined,
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
  };
}

function rowToTelemetry(row: EdgeTelemetryRow): EdgeTelemetry {
  return {
    id: row.id,
    deviceId: row.device_id,
    sensorId: row.sensor_id,
    value: parseJsonField<unknown>(row.value, null),
    recordedAt: new Date(row.recorded_at),
  };
}

// ============================================================================
// EdgeDevicesRepository
// ============================================================================

export class EdgeDevicesRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async create(input: RegisterDeviceInput): Promise<EdgeDevice> {
    const id = generateId('edg');
    const now = new Date().toISOString();

    await this.query(
      `INSERT INTO edge_devices (
        id, user_id, name, type, protocol, sensors, actuators,
        firmware_version, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        this.userId,
        input.name,
        input.type,
        input.protocol ?? 'mqtt',
        JSON.stringify(input.sensors ?? []),
        JSON.stringify(input.actuators ?? []),
        input.firmwareVersion ?? null,
        JSON.stringify(input.metadata ?? {}),
        now,
        now,
      ]
    );

    return this.getById(id) as Promise<EdgeDevice>;
  }

  async getById(id: string): Promise<EdgeDevice | null> {
    const row = await this.queryOne<EdgeDeviceRow>(
      'SELECT * FROM edge_devices WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? rowToDevice(row) : null;
  }

  async update(id: string, input: UpdateDeviceInput): Promise<EdgeDevice | null> {
    const existing = await this.getById(id);
    if (!existing) return null;

    const fields = [
      { column: 'name', value: input.name },
      { column: 'type', value: input.type },
      { column: 'protocol', value: input.protocol },
      {
        column: 'sensors',
        value: input.sensors !== undefined ? JSON.stringify(input.sensors) : undefined,
      },
      {
        column: 'actuators',
        value: input.actuators !== undefined ? JSON.stringify(input.actuators) : undefined,
      },
      { column: 'firmware_version', value: input.firmwareVersion },
      {
        column: 'metadata',
        value: input.metadata !== undefined ? JSON.stringify(input.metadata) : undefined,
      },
    ];

    const stmt = buildUpdateStatement(
      'edge_devices',
      fields,
      [
        { column: 'id', value: id },
        { column: 'user_id', value: this.userId },
      ],
      1,
      [{ sql: 'updated_at = NOW()' }]
    );

    if (!stmt) return existing;
    await this.query(stmt.sql, stmt.params);

    return this.getById(id);
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.execute('DELETE FROM edge_devices WHERE id = $1 AND user_id = $2', [
      id,
      this.userId,
    ]);
    return result.changes > 0;
  }

  async list(query: EdgeDeviceQuery = {}): Promise<{ devices: EdgeDevice[]; total: number }> {
    let sql = 'SELECT * FROM edge_devices WHERE user_id = $1';
    let countSql = 'SELECT COUNT(*) as count FROM edge_devices WHERE user_id = $1';
    const params: unknown[] = [this.userId];
    let paramIndex = 2;

    if (query.status) {
      sql += ` AND status = $${paramIndex}`;
      countSql += ` AND status = $${paramIndex}`;
      params.push(query.status);
      paramIndex++;
    }

    if (query.type) {
      sql += ` AND type = $${paramIndex}`;
      countSql += ` AND type = $${paramIndex}`;
      params.push(query.type);
      paramIndex++;
    }

    if (query.search) {
      sql += ` AND (name ILIKE $${paramIndex})`;
      countSql += ` AND (name ILIKE $${paramIndex})`;
      params.push(`%${this.escapeLike(query.search)}%`);
      paramIndex++;
    }

    const countRows = await this.query<{ count: string }>(countSql, params);
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    sql += ' ORDER BY created_at DESC';
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    sql += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const rows = await this.query<EdgeDeviceRow>(sql, params);
    return { devices: rows.map(rowToDevice), total };
  }

  async updateStatus(id: string, status: EdgeDeviceStatus, lastSeen?: Date): Promise<void> {
    const fields = lastSeen
      ? 'status = $1, last_seen = $2, updated_at = NOW()'
      : 'status = $1, updated_at = NOW()';
    const params = lastSeen
      ? [status, lastSeen.toISOString(), id, this.userId]
      : [status, id, this.userId];
    const whereStart = lastSeen ? 3 : 2;
    await this.query(
      `UPDATE edge_devices SET ${fields} WHERE id = $${whereStart} AND user_id = $${whereStart + 1}`,
      params
    );
  }

  async updateSensorValue(deviceId: string, sensorId: string, value: unknown): Promise<void> {
    // Update the sensor's lastValue and lastUpdated within the JSONB sensors array
    await this.query(
      `UPDATE edge_devices
       SET sensors = (
         SELECT jsonb_agg(
           CASE
             WHEN elem->>'id' = $1
             THEN elem || jsonb_build_object('lastValue', to_jsonb($2::text), 'lastUpdated', to_jsonb(NOW()::text))
             ELSE elem
           END
         )
         FROM jsonb_array_elements(sensors) elem
       ),
       last_seen = NOW(),
       updated_at = NOW()
       WHERE id = $3 AND user_id = $4`,
      [sensorId, String(value), deviceId, this.userId]
    );
  }
}

// ============================================================================
// EdgeCommandsRepository
// ============================================================================

export class EdgeCommandsRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async create(deviceId: string, input: EdgeCommandInput): Promise<EdgeCommand> {
    const id = generateId('ecmd');
    const now = new Date().toISOString();

    await this.query(
      `INSERT INTO edge_commands (id, device_id, user_id, command_type, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, deviceId, this.userId, input.commandType, JSON.stringify(input.payload ?? {}), now]
    );

    return this.getById(id) as Promise<EdgeCommand>;
  }

  async getById(id: string): Promise<EdgeCommand | null> {
    const row = await this.queryOne<EdgeCommandRow>(
      'SELECT * FROM edge_commands WHERE id = $1 AND user_id = $2',
      [id, this.userId]
    );
    return row ? rowToCommand(row) : null;
  }

  async updateStatus(
    id: string,
    status: EdgeCommandStatus,
    result?: Record<string, unknown>
  ): Promise<void> {
    const completedAt = ['completed', 'failed', 'timeout'].includes(status)
      ? new Date().toISOString()
      : null;

    await this.query(
      `UPDATE edge_commands SET status = $1, result = $2, completed_at = $3 WHERE id = $4 AND user_id = $5`,
      [status, result ? JSON.stringify(result) : null, completedAt, id, this.userId]
    );
  }

  async listByDevice(deviceId: string, limit = 50): Promise<EdgeCommand[]> {
    const rows = await this.query<EdgeCommandRow>(
      'SELECT * FROM edge_commands WHERE device_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT $3',
      [deviceId, this.userId, limit]
    );
    return rows.map(rowToCommand);
  }
}

// ============================================================================
// EdgeTelemetryRepository
// ============================================================================

export class EdgeTelemetryRepository extends BaseRepository {
  private userId: string;

  constructor(userId = 'default') {
    super();
    this.userId = userId;
  }

  async insert(deviceId: string, sensorId: string, value: unknown): Promise<EdgeTelemetry> {
    const id = generateId('etel');
    const now = new Date().toISOString();

    await this.query(
      `INSERT INTO edge_telemetry (id, device_id, sensor_id, value, recorded_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, deviceId, sensorId, JSON.stringify(value), now]
    );

    return {
      id,
      deviceId,
      sensorId,
      value,
      recordedAt: new Date(now),
    };
  }

  async insertBatch(
    entries: { deviceId: string; sensorId: string; value: unknown }[]
  ): Promise<void> {
    if (entries.length === 0) return;

    const values: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    for (const entry of entries) {
      const id = generateId('etel');
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, NOW())`);
      params.push(id, entry.deviceId, entry.sensorId, JSON.stringify(entry.value));
    }

    await this.query(
      `INSERT INTO edge_telemetry (id, device_id, sensor_id, value, recorded_at)
       VALUES ${values.join(', ')}`,
      params
    );
  }

  /**
   * Get latest telemetry per sensor for a device (one row per sensor).
   */
  async getLatest(deviceId: string): Promise<EdgeTelemetry[]> {
    const rows = await this.query<EdgeTelemetryRow>(
      `SELECT DISTINCT ON (sensor_id) *
       FROM edge_telemetry
       WHERE device_id = $1
       ORDER BY sensor_id, recorded_at DESC`,
      [deviceId]
    );
    return rows.map(rowToTelemetry);
  }

  /**
   * Get telemetry history for a specific sensor.
   */
  async getHistory(deviceId: string, sensorId: string, limit = 100): Promise<EdgeTelemetry[]> {
    const rows = await this.query<EdgeTelemetryRow>(
      `SELECT * FROM edge_telemetry
       WHERE device_id = $1 AND sensor_id = $2
       ORDER BY recorded_at DESC
       LIMIT $3`,
      [deviceId, sensorId, limit]
    );
    return rows.map(rowToTelemetry);
  }
}
