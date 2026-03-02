/**
 * Edge Service (Gateway Implementation)
 *
 * Implements IEdgeService using Edge repositories for CRUD,
 * EdgeMqttClient for device communication, and WS broadcasts on mutations.
 */

import { getLog } from '@ownpilot/core';
import type {
  IEdgeService,
  EdgeDevice,
  EdgeCommand,
  EdgeTelemetry,
  RegisterDeviceInput,
  UpdateDeviceInput,
  EdgeDeviceQuery,
  EdgeCommandInput,
  EdgeDeviceStatus,
} from '@ownpilot/core';
import {
  EdgeDevicesRepository,
  EdgeCommandsRepository,
  EdgeTelemetryRepository,
} from '../db/repositories/edge.js';
import {
  getEdgeMqttClient,
  commandTopic,
  telemetryWildcard,
  statusWildcard,
  parseTopicIds,
} from './edge-mqtt-client.js';
import { wsGateway } from '../ws/server.js';

const log = getLog('EdgeService');

// =============================================================================
// Service Implementation
// =============================================================================

class EdgeServiceImpl implements IEdgeService {
  private mqttInitialized = false;

  // -------------------------------------------------------------------------
  // MQTT Initialization
  // -------------------------------------------------------------------------

  /**
   * Initialize MQTT subscriptions for telemetry and status.
   * Called lazily on first use.
   */
  private async initMqtt(): Promise<void> {
    if (this.mqttInitialized) return;
    this.mqttInitialized = true;

    const mqtt = getEdgeMqttClient();
    const connected = await mqtt.connect();
    if (!connected) return;

    // Subscribe to all device telemetry
    mqtt.subscribe(telemetryWildcard(), (topic, payload) => {
      this.handleTelemetry(topic, payload).catch((err) =>
        log.warn(`Telemetry handler error: ${err instanceof Error ? err.message : String(err)}`)
      );
    });

    // Subscribe to all device status (LWT/online/offline)
    mqtt.subscribe(statusWildcard(), (topic, payload) => {
      this.handleStatus(topic, payload).catch((err) =>
        log.warn(`Status handler error: ${err instanceof Error ? err.message : String(err)}`)
      );
    });

    log.info('Edge MQTT subscriptions active');
  }

  private async handleTelemetry(topic: string, payload: unknown): Promise<void> {
    const ids = parseTopicIds(topic);
    if (!ids) return;

    const data = payload as Record<string, unknown>;
    const sensorId = String(data.sensorId ?? data.sensor_id ?? '');
    const value = data.value;

    if (!sensorId || value === undefined) {
      log.warn(`Invalid telemetry payload from ${ids.deviceId}: missing sensorId or value`);
      return;
    }

    // Store telemetry
    const telemetryRepo = new EdgeTelemetryRepository(ids.userId);
    await telemetryRepo.insert(ids.deviceId, sensorId, value);

    // Update sensor last value on the device
    const devicesRepo = new EdgeDevicesRepository(ids.userId);
    await devicesRepo.updateSensorValue(ids.deviceId, sensorId, value);

    this.broadcast('updated', ids.deviceId);
  }

  private async handleStatus(topic: string, payload: unknown): Promise<void> {
    const ids = parseTopicIds(topic);
    if (!ids) return;

    const data = payload as Record<string, unknown>;
    const status = String(data.status ?? 'offline') as EdgeDeviceStatus;

    const devicesRepo = new EdgeDevicesRepository(ids.userId);
    await devicesRepo.updateStatus(ids.deviceId, status, new Date());

    log.info(`Device ${ids.deviceId} status: ${status}`);
    this.broadcast('updated', ids.deviceId);
  }

  // -------------------------------------------------------------------------
  // Repository Helpers
  // -------------------------------------------------------------------------

  private getDevicesRepo(userId: string): EdgeDevicesRepository {
    return new EdgeDevicesRepository(userId);
  }

  private getCommandsRepo(userId: string): EdgeCommandsRepository {
    return new EdgeCommandsRepository(userId);
  }

  private getTelemetryRepo(userId: string): EdgeTelemetryRepository {
    return new EdgeTelemetryRepository(userId);
  }

  // -------------------------------------------------------------------------
  // IEdgeService
  // -------------------------------------------------------------------------

  async registerDevice(userId: string, input: RegisterDeviceInput): Promise<EdgeDevice> {
    await this.initMqtt();
    const device = await this.getDevicesRepo(userId).create(input);
    log.info(`Registered device ${device.id} (${device.type}) for user ${userId}`);
    this.broadcast('created', device.id);
    return device;
  }

  async getDevice(userId: string, id: string): Promise<EdgeDevice | null> {
    return this.getDevicesRepo(userId).getById(id);
  }

  async updateDevice(
    userId: string,
    id: string,
    input: UpdateDeviceInput
  ): Promise<EdgeDevice | null> {
    const device = await this.getDevicesRepo(userId).update(id, input);
    if (device) {
      log.info(`Updated device ${id}`);
      this.broadcast('updated', id);
    }
    return device;
  }

  async removeDevice(userId: string, id: string): Promise<boolean> {
    const deleted = await this.getDevicesRepo(userId).delete(id);
    if (deleted) {
      log.info(`Removed device ${id}`);
      this.broadcast('deleted', id);
    }
    return deleted;
  }

  async listDevices(
    userId: string,
    query?: EdgeDeviceQuery
  ): Promise<{ devices: EdgeDevice[]; total: number }> {
    return this.getDevicesRepo(userId).list(query);
  }

  async sendCommand(
    userId: string,
    deviceId: string,
    input: EdgeCommandInput
  ): Promise<EdgeCommand> {
    await this.initMqtt();

    // Verify device exists
    const device = await this.getDevicesRepo(userId).getById(deviceId);
    if (!device) throw new Error(`Device ${deviceId} not found`);

    // Create command record
    const command = await this.getCommandsRepo(userId).create(deviceId, input);

    // Publish to MQTT
    const mqtt = getEdgeMqttClient();
    if (mqtt.isConnected()) {
      try {
        await mqtt.publish(commandTopic(userId, deviceId), {
          commandId: command.id,
          type: input.commandType,
          payload: input.payload ?? {},
        });
        await this.getCommandsRepo(userId).updateStatus(command.id, 'sent');
        log.info(`Sent command ${command.id} to device ${deviceId}`);
      } catch (err) {
        await this.getCommandsRepo(userId).updateStatus(command.id, 'failed', {
          error: err instanceof Error ? err.message : String(err),
        });
        log.warn(
          `Failed to send command ${command.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    } else {
      log.warn(`MQTT not connected — command ${command.id} stays pending`);
    }

    return this.getCommandsRepo(userId).getById(command.id) as Promise<EdgeCommand>;
  }

  async getCommandHistory(
    userId: string,
    deviceId: string,
    limit?: number
  ): Promise<EdgeCommand[]> {
    return this.getCommandsRepo(userId).listByDevice(deviceId, limit);
  }

  async getLatestTelemetry(userId: string, deviceId: string): Promise<EdgeTelemetry[]> {
    return this.getTelemetryRepo(userId).getLatest(deviceId);
  }

  async getTelemetryHistory(
    userId: string,
    deviceId: string,
    sensorId: string,
    limit?: number
  ): Promise<EdgeTelemetry[]> {
    return this.getTelemetryRepo(userId).getHistory(deviceId, sensorId, limit);
  }

  // -------------------------------------------------------------------------
  // WS Broadcast
  // -------------------------------------------------------------------------

  private broadcast(action: 'created' | 'updated' | 'deleted', id: string): void {
    try {
      wsGateway.broadcast('data:changed', { entity: 'edge-device', action, id });
    } catch {
      // WS not initialized yet (e.g. during tests)
    }
  }
}

// =============================================================================
// Singleton
// =============================================================================

let _service: EdgeServiceImpl | null = null;

export function getEdgeService(): EdgeServiceImpl {
  if (!_service) {
    _service = new EdgeServiceImpl();
  }
  return _service;
}
