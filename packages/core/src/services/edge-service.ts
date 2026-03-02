/**
 * Edge Service Interface
 *
 * Core interface for managing IoT/edge devices, commands, and telemetry.
 */

import type {
  EdgeDevice,
  EdgeCommand,
  EdgeTelemetry,
  RegisterDeviceInput,
  UpdateDeviceInput,
  EdgeDeviceQuery,
  EdgeCommandInput,
} from '../edge/types.js';

export interface IEdgeService {
  /** Register a new edge device. */
  registerDevice(userId: string, input: RegisterDeviceInput): Promise<EdgeDevice>;

  /** Get a device by ID. */
  getDevice(userId: string, id: string): Promise<EdgeDevice | null>;

  /** Update device configuration. */
  updateDevice(userId: string, id: string, input: UpdateDeviceInput): Promise<EdgeDevice | null>;

  /** Remove a device and its associated data. */
  removeDevice(userId: string, id: string): Promise<boolean>;

  /** List devices with optional filters. */
  listDevices(
    userId: string,
    query?: EdgeDeviceQuery
  ): Promise<{ devices: EdgeDevice[]; total: number }>;

  /** Send a command to a device. */
  sendCommand(userId: string, deviceId: string, command: EdgeCommandInput): Promise<EdgeCommand>;

  /** Get command history for a device. */
  getCommandHistory(userId: string, deviceId: string, limit?: number): Promise<EdgeCommand[]>;

  /** Get the latest telemetry reading per sensor for a device. */
  getLatestTelemetry(userId: string, deviceId: string): Promise<EdgeTelemetry[]>;

  /** Get telemetry history for a specific sensor. */
  getTelemetryHistory(
    userId: string,
    deviceId: string,
    sensorId: string,
    limit?: number
  ): Promise<EdgeTelemetry[]>;
}

// Re-export types for convenience
export type {
  EdgeDevice,
  EdgeCommand,
  EdgeTelemetry,
  RegisterDeviceInput,
  UpdateDeviceInput,
  EdgeDeviceQuery,
  EdgeCommandInput,
} from '../edge/types.js';
