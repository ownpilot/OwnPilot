/**
 * RegisterDeviceModal
 *
 * Modal form for registering a new edge/IoT device with
 * optional sensors and actuators configuration.
 */

import { useState } from 'react';
import { X, Plus, Trash2 } from './icons';
import { edgeApi } from '../api/endpoints/edge';
import type {
  EdgeDevice,
  EdgeDeviceType,
  EdgeProtocol,
  EdgeSensorType,
  EdgeActuatorType,
} from '../api/endpoints/edge';

// =============================================================================
// Types
// =============================================================================

interface SensorRow {
  id: string;
  name: string;
  type: EdgeSensorType;
  unit: string;
}

interface ActuatorRow {
  id: string;
  name: string;
  type: EdgeActuatorType;
}

interface Props {
  onClose: () => void;
  onCreated: (device: EdgeDevice) => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEVICE_TYPES: { value: EdgeDeviceType; label: string }[] = [
  { value: 'raspberry-pi', label: 'Raspberry Pi' },
  { value: 'esp32', label: 'ESP32' },
  { value: 'arduino', label: 'Arduino' },
  { value: 'custom', label: 'Custom' },
];

const PROTOCOLS: { value: EdgeProtocol; label: string }[] = [
  { value: 'mqtt', label: 'MQTT' },
  { value: 'websocket', label: 'WebSocket' },
  { value: 'http-poll', label: 'HTTP Poll' },
];

const SENSOR_TYPES: EdgeSensorType[] = [
  'temperature',
  'humidity',
  'motion',
  'light',
  'pressure',
  'camera',
  'door',
  'custom',
];

const ACTUATOR_TYPES: EdgeActuatorType[] = [
  'relay',
  'servo',
  'led',
  'buzzer',
  'display',
  'motor',
  'custom',
];

function newSensor(): SensorRow {
  return { id: '', name: '', type: 'custom', unit: '' };
}

function newActuator(): ActuatorRow {
  return { id: '', name: '', type: 'relay' };
}

// =============================================================================
// Component
// =============================================================================

export function RegisterDeviceModal({ onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [type, setType] = useState<EdgeDeviceType>('custom');
  const [protocol, setProtocol] = useState<EdgeProtocol>('mqtt');
  const [firmware, setFirmware] = useState('');
  const [sensors, setSensors] = useState<SensorRow[]>([]);
  const [actuators, setActuators] = useState<ActuatorRow[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Device name is required.');
      return;
    }

    // Validate sensor/actuator IDs are filled
    for (const s of sensors) {
      if (!s.id.trim() || !s.name.trim()) {
        setError('Each sensor must have an ID and a name.');
        return;
      }
    }
    for (const a of actuators) {
      if (!a.id.trim() || !a.name.trim()) {
        setError('Each actuator must have an ID and a name.');
        return;
      }
    }

    setError('');
    setIsSaving(true);
    try {
      const device = await edgeApi.register({
        name: name.trim(),
        type,
        protocol,
        firmwareVersion: firmware.trim() || undefined,
        sensors: sensors.map((s) => ({
          id: s.id.trim(),
          name: s.name.trim(),
          type: s.type,
          unit: s.unit.trim() || undefined,
        })),
        actuators: actuators.map((a) => ({
          id: a.id.trim(),
          name: a.name.trim(),
          type: a.type,
        })),
      });
      if (device) onCreated(device);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register device.');
    } finally {
      setIsSaving(false);
    }
  };

  const updateSensor = (i: number, patch: Partial<SensorRow>) => {
    setSensors((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  };

  const updateActuator = (i: number, patch: Partial<ActuatorRow>) => {
    setActuators((prev) => prev.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-dark-border">
          <h2 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
            Register Device
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && (
            <div className="text-xs text-red-500 bg-red-50 dark:bg-red-500/10 px-3 py-2 rounded-lg">
              {error}
            </div>
          )}

          {/* Name + Type */}
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Device Name *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Living Room Sensor"
                className="w-full px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as EdgeDeviceType)}
                className="w-full px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {DEVICE_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Protocol
              </label>
              <select
                value={protocol}
                onChange={(e) => setProtocol(e.target.value as EdgeProtocol)}
                className="w-full px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {PROTOCOLS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Firmware Version
              </label>
              <input
                type="text"
                value={firmware}
                onChange={(e) => setFirmware(e.target.value)}
                placeholder="e.g. 1.0.0"
                className="w-full px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Sensors */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
                Sensors
              </span>
              <button
                type="button"
                onClick={() => setSensors((prev) => [...prev, newSensor()])}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {sensors.length === 0 && (
              <p className="text-xs text-text-muted dark:text-dark-text-muted italic">
                No sensors — add one above.
              </p>
            )}
            {sensors.map((s, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_1fr_auto_auto_auto] gap-2 mb-2 items-center"
              >
                <input
                  type="text"
                  value={s.id}
                  onChange={(e) => updateSensor(i, { id: e.target.value })}
                  placeholder="ID"
                  className="px-2 py-1 text-xs border border-border dark:border-dark-border rounded bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <input
                  type="text"
                  value={s.name}
                  onChange={(e) => updateSensor(i, { name: e.target.value })}
                  placeholder="Name"
                  className="px-2 py-1 text-xs border border-border dark:border-dark-border rounded bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <select
                  value={s.type}
                  onChange={(e) => updateSensor(i, { type: e.target.value as EdgeSensorType })}
                  className="px-2 py-1 text-xs border border-border dark:border-dark-border rounded bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {SENSOR_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  value={s.unit}
                  onChange={(e) => updateSensor(i, { unit: e.target.value })}
                  placeholder="Unit"
                  className="w-14 px-2 py-1 text-xs border border-border dark:border-dark-border rounded bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={() => setSensors((prev) => prev.filter((_, idx) => idx !== i))}
                  className="p-1 text-text-muted hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          {/* Actuators */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
                Actuators
              </span>
              <button
                type="button"
                onClick={() => setActuators((prev) => [...prev, newActuator()])}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            {actuators.length === 0 && (
              <p className="text-xs text-text-muted dark:text-dark-text-muted italic">
                No actuators — add one above.
              </p>
            )}
            {actuators.map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 mb-2 items-center">
                <input
                  type="text"
                  value={a.id}
                  onChange={(e) => updateActuator(i, { id: e.target.value })}
                  placeholder="ID"
                  className="px-2 py-1 text-xs border border-border dark:border-dark-border rounded bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <input
                  type="text"
                  value={a.name}
                  onChange={(e) => updateActuator(i, { name: e.target.value })}
                  placeholder="Name"
                  className="px-2 py-1 text-xs border border-border dark:border-dark-border rounded bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <select
                  value={a.type}
                  onChange={(e) => updateActuator(i, { type: e.target.value as EdgeActuatorType })}
                  className="px-2 py-1 text-xs border border-border dark:border-dark-border rounded bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {ACTUATOR_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setActuators((prev) => prev.filter((_, idx) => idx !== i))}
                  className="p-1 text-text-muted hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </form>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border dark:border-dark-border flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSaving}
            className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isSaving ? 'Registering…' : 'Register Device'}
          </button>
        </div>
      </div>
    </div>
  );
}
