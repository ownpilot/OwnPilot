/**
 * Edge Delegation Protocol — Types
 *
 * Types for IoT/edge device management. OwnPilot acts as the brain,
 * edge devices (ESP32, RPi, Arduino) act as the hands via MQTT.
 */

// =============================================================================
// Enums / Unions
// =============================================================================

export type EdgeDeviceType = 'raspberry-pi' | 'esp32' | 'arduino' | 'custom';
export type EdgeProtocol = 'mqtt' | 'websocket' | 'http-poll';
export type EdgeDeviceStatus = 'online' | 'offline' | 'error';

export type EdgeSensorType =
  | 'temperature'
  | 'humidity'
  | 'motion'
  | 'light'
  | 'pressure'
  | 'camera'
  | 'door'
  | 'custom';

export type EdgeActuatorType =
  | 'relay'
  | 'servo'
  | 'led'
  | 'buzzer'
  | 'display'
  | 'motor'
  | 'custom';

export type EdgeCommandStatus =
  | 'pending'
  | 'sent'
  | 'acknowledged'
  | 'completed'
  | 'failed'
  | 'timeout';

// =============================================================================
// Core Entities
// =============================================================================

export interface EdgeSensor {
  id: string;
  name: string;
  type: EdgeSensorType;
  unit?: string;
  lastValue?: number | string | boolean;
  lastUpdated?: Date;
}

export interface EdgeActuator {
  id: string;
  name: string;
  type: EdgeActuatorType;
  state?: unknown;
}

export interface EdgeDevice {
  id: string;
  userId: string;
  name: string;
  type: EdgeDeviceType;
  protocol: EdgeProtocol;
  sensors: EdgeSensor[];
  actuators: EdgeActuator[];
  status: EdgeDeviceStatus;
  lastSeen: Date | null;
  firmwareVersion?: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface EdgeCommand {
  id: string;
  deviceId: string;
  userId: string;
  commandType: string;
  payload: Record<string, unknown>;
  status: EdgeCommandStatus;
  result?: Record<string, unknown>;
  createdAt: Date;
  completedAt?: Date;
}

export interface EdgeTelemetry {
  id: string;
  deviceId: string;
  sensorId: string;
  value: unknown;
  recordedAt: Date;
}

// =============================================================================
// Input / Query Types
// =============================================================================

export interface RegisterDeviceInput {
  name: string;
  type: EdgeDeviceType;
  protocol?: EdgeProtocol;
  sensors?: Omit<EdgeSensor, 'lastValue' | 'lastUpdated'>[];
  actuators?: Omit<EdgeActuator, 'state'>[];
  firmwareVersion?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateDeviceInput {
  name?: string;
  type?: EdgeDeviceType;
  protocol?: EdgeProtocol;
  sensors?: Omit<EdgeSensor, 'lastValue' | 'lastUpdated'>[];
  actuators?: Omit<EdgeActuator, 'state'>[];
  firmwareVersion?: string;
  metadata?: Record<string, unknown>;
}

export interface EdgeDeviceQuery {
  status?: EdgeDeviceStatus;
  type?: EdgeDeviceType;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface EdgeCommandInput {
  commandType: string;
  payload?: Record<string, unknown>;
}
