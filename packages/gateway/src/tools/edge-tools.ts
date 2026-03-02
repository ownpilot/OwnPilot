/**
 * Edge Tools
 *
 * LLM tools for managing IoT/edge devices — register, query,
 * send commands, read sensors, and control actuators.
 */

import { type ToolDefinition, getErrorMessage } from '@ownpilot/core';
import { getEdgeService } from '../services/edge-service.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const listEdgeDevicesDef: ToolDefinition = {
  name: 'list_edge_devices',
  workflowUsable: true,
  description: `List all registered IoT/edge devices.
Returns device name, type (raspberry-pi, esp32, arduino, custom),
status (online/offline/error), sensor count, and actuator count.
Use this to see what devices are available before sending commands.`,
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['online', 'offline', 'error'],
        description: 'Filter by device status',
      },
      type: {
        type: 'string',
        enum: ['raspberry-pi', 'esp32', 'arduino', 'custom'],
        description: 'Filter by device type',
      },
      search: {
        type: 'string',
        description: 'Search by device name',
      },
    },
  },
  category: 'Edge Devices',
};

const getDeviceStatusDef: ToolDefinition = {
  name: 'get_device_status',
  workflowUsable: true,
  description: `Get detailed status of a specific edge device including
all sensor readings and actuator states. Includes last seen time
and firmware version.`,
  parameters: {
    type: 'object',
    properties: {
      device_id: {
        type: 'string',
        description: 'ID of the edge device',
      },
    },
    required: ['device_id'],
  },
  category: 'Edge Devices',
};

const readSensorDef: ToolDefinition = {
  name: 'read_sensor',
  workflowUsable: true,
  description: `Read the latest value from a specific sensor on an edge device.
Returns the current value, unit, and timestamp.
For historical data, use with the history parameter.`,
  parameters: {
    type: 'object',
    properties: {
      device_id: {
        type: 'string',
        description: 'ID of the edge device',
      },
      sensor_id: {
        type: 'string',
        description: 'ID of the sensor to read',
      },
      history_limit: {
        type: 'number',
        description: 'Number of historical readings to include (default: 1, max: 100)',
      },
    },
    required: ['device_id', 'sensor_id'],
  },
  category: 'Edge Devices',
};

const sendDeviceCommandDef: ToolDefinition = {
  name: 'send_device_command',
  workflowUsable: true,
  description: `Send a command to an edge device via MQTT.
Commands are published to the device's command topic.
Common command types: "reboot", "update_config", "calibrate", "reset".
The payload is a JSON object specific to the command type.`,
  parameters: {
    type: 'object',
    properties: {
      device_id: {
        type: 'string',
        description: 'ID of the target device',
      },
      command_type: {
        type: 'string',
        description: 'Type of command (e.g. "reboot", "update_config", "calibrate")',
      },
      payload: {
        type: 'object',
        description: 'Command-specific payload data',
      },
    },
    required: ['device_id', 'command_type'],
  },
  category: 'Edge Devices',
};

const controlActuatorDef: ToolDefinition = {
  name: 'control_actuator',
  workflowUsable: true,
  description: `Control a specific actuator on an edge device.
Sends a "set_actuator" command to the device.

Examples:
- Relay: { "state": true } or { "state": false }
- Servo: { "angle": 90 }
- LED: { "brightness": 255, "color": "#FF0000" }
- Motor: { "speed": 50, "direction": "forward" }
- Display: { "text": "Hello", "line": 1 }`,
  parameters: {
    type: 'object',
    properties: {
      device_id: {
        type: 'string',
        description: 'ID of the edge device',
      },
      actuator_id: {
        type: 'string',
        description: 'ID of the actuator to control',
      },
      state: {
        type: 'object',
        description: 'Desired state for the actuator',
      },
    },
    required: ['device_id', 'actuator_id', 'state'],
  },
  category: 'Edge Devices',
};

const registerEdgeDeviceDef: ToolDefinition = {
  name: 'register_edge_device',
  workflowUsable: false,
  description: `Register a new edge device in the system.
The device must be configured to connect to the same MQTT broker
and publish to ownpilot/{userId}/devices/{deviceId}/telemetry.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Human-readable device name',
      },
      type: {
        type: 'string',
        enum: ['raspberry-pi', 'esp32', 'arduino', 'custom'],
        description: 'Device hardware type',
      },
      protocol: {
        type: 'string',
        enum: ['mqtt', 'websocket', 'http-poll'],
        description: 'Communication protocol (default: mqtt)',
      },
      sensors: {
        type: 'array',
        description: 'List of sensors on the device',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Sensor ID (unique on this device)' },
            name: { type: 'string', description: 'Sensor name' },
            type: {
              type: 'string',
              enum: [
                'temperature',
                'humidity',
                'motion',
                'light',
                'pressure',
                'camera',
                'door',
                'custom',
              ],
            },
            unit: { type: 'string', description: 'Measurement unit (e.g. °C, %, lux)' },
          },
          required: ['id', 'name', 'type'],
        },
      },
      actuators: {
        type: 'array',
        description: 'List of actuators on the device',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Actuator ID (unique on this device)' },
            name: { type: 'string', description: 'Actuator name' },
            type: {
              type: 'string',
              enum: ['relay', 'servo', 'led', 'buzzer', 'display', 'motor', 'custom'],
            },
          },
          required: ['id', 'name', 'type'],
        },
      },
      firmware_version: {
        type: 'string',
        description: 'Current firmware version',
      },
    },
    required: ['name', 'type'],
  },
  category: 'Edge Devices',
};

// =============================================================================
// Exports
// =============================================================================

export const EDGE_TOOLS: ToolDefinition[] = [
  listEdgeDevicesDef,
  getDeviceStatusDef,
  readSensorDef,
  sendDeviceCommandDef,
  controlActuatorDef,
  registerEdgeDeviceDef,
];

export const EDGE_TOOL_NAMES = EDGE_TOOLS.map((t) => t.name);

// =============================================================================
// Executor
// =============================================================================

export async function executeEdgeTool(
  toolName: string,
  args: Record<string, unknown>,
  userId?: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  if (!userId) return { success: false, error: 'userId is required for edge tools' };
  const service = getEdgeService();

  switch (toolName) {
    case 'list_edge_devices': {
      try {
        const { devices, total } = await service.listDevices(userId, {
          status: args.status as undefined,
          type: args.type as undefined,
          search: args.search as string | undefined,
          limit: 50,
        });

        return {
          success: true,
          result: {
            total,
            devices: devices.map((d) => ({
              id: d.id,
              name: d.name,
              type: d.type,
              protocol: d.protocol,
              status: d.status,
              sensorCount: d.sensors.length,
              actuatorCount: d.actuators.length,
              lastSeen: d.lastSeen?.toISOString() ?? null,
              firmwareVersion: d.firmwareVersion ?? null,
            })),
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'get_device_status': {
      try {
        const device = await service.getDevice(userId, args.device_id as string);
        if (!device) {
          return { success: false, error: `Device not found: ${args.device_id}` };
        }

        return {
          success: true,
          result: {
            id: device.id,
            name: device.name,
            type: device.type,
            protocol: device.protocol,
            status: device.status,
            lastSeen: device.lastSeen?.toISOString() ?? null,
            firmwareVersion: device.firmwareVersion ?? null,
            sensors: device.sensors.map((s) => ({
              id: s.id,
              name: s.name,
              type: s.type,
              unit: s.unit ?? null,
              lastValue: s.lastValue ?? null,
              lastUpdated: s.lastUpdated ? new Date(s.lastUpdated).toISOString() : null,
            })),
            actuators: device.actuators.map((a) => ({
              id: a.id,
              name: a.name,
              type: a.type,
              state: a.state ?? null,
            })),
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'read_sensor': {
      try {
        const deviceId = args.device_id as string;
        const sensorId = args.sensor_id as string;
        const historyLimit = (args.history_limit as number) ?? 1;

        // Get device to find sensor metadata
        const device = await service.getDevice(userId, deviceId);
        if (!device) {
          return { success: false, error: `Device not found: ${deviceId}` };
        }

        const sensor = device.sensors.find((s) => s.id === sensorId);
        if (!sensor) {
          return { success: false, error: `Sensor ${sensorId} not found on device ${deviceId}` };
        }

        if (historyLimit > 1) {
          const history = await service.getTelemetryHistory(
            userId,
            deviceId,
            sensorId,
            Math.min(historyLimit, 100)
          );
          return {
            success: true,
            result: {
              sensor: { id: sensor.id, name: sensor.name, type: sensor.type, unit: sensor.unit },
              currentValue: sensor.lastValue ?? null,
              history: history.map((t) => ({
                value: t.value,
                recordedAt: t.recordedAt.toISOString(),
              })),
            },
          };
        }

        return {
          success: true,
          result: {
            sensor: { id: sensor.id, name: sensor.name, type: sensor.type, unit: sensor.unit },
            value: sensor.lastValue ?? null,
            lastUpdated: sensor.lastUpdated ? new Date(sensor.lastUpdated).toISOString() : null,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'send_device_command': {
      try {
        const command = await service.sendCommand(userId, args.device_id as string, {
          commandType: args.command_type as string,
          payload: (args.payload as Record<string, unknown>) ?? {},
        });

        return {
          success: true,
          result: {
            commandId: command.id,
            status: command.status,
            message: `Command "${command.commandType}" sent to device ${command.deviceId}.`,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'control_actuator': {
      try {
        const deviceId = args.device_id as string;
        const actuatorId = args.actuator_id as string;
        const state = args.state as Record<string, unknown>;

        // Verify device and actuator exist
        const device = await service.getDevice(userId, deviceId);
        if (!device) {
          return { success: false, error: `Device not found: ${deviceId}` };
        }

        const actuator = device.actuators.find((a) => a.id === actuatorId);
        if (!actuator) {
          return {
            success: false,
            error: `Actuator ${actuatorId} not found on device ${deviceId}`,
          };
        }

        const command = await service.sendCommand(userId, deviceId, {
          commandType: 'set_actuator',
          payload: { actuatorId, state },
        });

        return {
          success: true,
          result: {
            commandId: command.id,
            actuator: { id: actuator.id, name: actuator.name, type: actuator.type },
            requestedState: state,
            message: `Set ${actuator.name} (${actuator.type}) on device ${device.name}.`,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'register_edge_device': {
      try {
        const device = await service.registerDevice(userId, {
          name: args.name as string,
          type: args.type as 'raspberry-pi' | 'esp32' | 'arduino' | 'custom',
          protocol: args.protocol as 'mqtt' | 'websocket' | 'http-poll' | undefined,
          sensors: args.sensors as undefined,
          actuators: args.actuators as undefined,
          firmwareVersion: args.firmware_version as string | undefined,
        });

        return {
          success: true,
          result: {
            id: device.id,
            name: device.name,
            type: device.type,
            protocol: device.protocol,
            sensorCount: device.sensors.length,
            actuatorCount: device.actuators.length,
            message: `Device "${device.name}" registered. Configure it to publish to MQTT topic: ownpilot/{userId}/devices/${device.id}/telemetry`,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    default:
      return { success: false, error: `Unknown edge tool: ${toolName}` };
  }
}
