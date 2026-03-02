/**
 * Edge API endpoints
 */

import { apiClient } from '../client';

// =============================================================================
// Types
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

export interface EdgeSensor {
  id: string;
  name: string;
  type: EdgeSensorType;
  unit?: string;
  lastValue?: number | string | boolean;
  lastUpdated?: string;
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
  lastSeen: string | null;
  firmwareVersion?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface EdgeCommand {
  id: string;
  deviceId: string;
  userId: string;
  commandType: string;
  payload: Record<string, unknown>;
  status: EdgeCommandStatus;
  result?: Record<string, unknown>;
  createdAt: string;
  completedAt?: string;
}

export interface EdgeTelemetry {
  id: string;
  deviceId: string;
  sensorId: string;
  value: unknown;
  recordedAt: string;
}

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

export interface EdgeDeviceListQuery {
  status?: EdgeDeviceStatus;
  type?: EdgeDeviceType;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface MqttStatus {
  connected: boolean;
  brokerUrl: string | null;
}

// =============================================================================
// API
// =============================================================================

export const edgeApi = {
  list: (query?: EdgeDeviceListQuery) => {
    const params = new URLSearchParams();
    if (query?.status) params.set('status', query.status);
    if (query?.type) params.set('type', query.type);
    if (query?.search) params.set('search', query.search);
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.offset) params.set('offset', String(query.offset));
    const qs = params.toString();
    return apiClient.get<{ devices: EdgeDevice[]; total: number }>(`/edge${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) => apiClient.get<EdgeDevice>(`/edge/${id}`),

  register: (input: RegisterDeviceInput) => apiClient.post<EdgeDevice>('/edge', input),

  update: (id: string, input: UpdateDeviceInput) =>
    apiClient.patch<EdgeDevice>(`/edge/${id}`, input),

  remove: (id: string) => apiClient.delete(`/edge/${id}`),

  sendCommand: (id: string, cmd: { commandType: string; payload?: Record<string, unknown> }) =>
    apiClient.post<EdgeCommand>(`/edge/${id}/command`, cmd),

  getCommands: (id: string, limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return apiClient.get<{ commands: EdgeCommand[] }>(`/edge/${id}/commands${qs ? `?${qs}` : ''}`);
  },

  getTelemetry: (id: string) =>
    apiClient.get<{ telemetry: EdgeTelemetry[] }>(`/edge/${id}/telemetry`),

  getSensorHistory: (id: string, sensorId: string, limit?: number) => {
    const params = new URLSearchParams();
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return apiClient.get<{ telemetry: EdgeTelemetry[] }>(
      `/edge/${id}/telemetry/${sensorId}${qs ? `?${qs}` : ''}`
    );
  },

  getMqttStatus: () => apiClient.get<MqttStatus>('/edge/mqtt/status'),
};
