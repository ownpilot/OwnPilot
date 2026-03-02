/**
 * DeviceCard
 *
 * Card component for displaying an edge device with sensors,
 * actuators, status, and quick actions.
 */

import { useState } from 'react';
import { Cpu, Trash2, Activity } from './icons';
import { edgeApi } from '../api/endpoints/edge';
import type { EdgeDevice } from '../api/endpoints/edge';
import { useDialog } from './ConfirmDialog';

// =============================================================================
// Status helpers
// =============================================================================

const STATUS_COLORS: Record<string, string> = {
  online: 'bg-green-500',
  offline: 'bg-gray-400',
  error: 'bg-red-500',
};

const TYPE_LABELS: Record<string, string> = {
  'raspberry-pi': 'RPi',
  esp32: 'ESP32',
  arduino: 'Arduino',
  custom: 'Custom',
};

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Date.now() - new Date(dateStr).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// =============================================================================
// Props
// =============================================================================

interface DeviceCardProps {
  device: EdgeDevice;
  onDelete: (id: string) => void;
  onUpdate: (device: EdgeDevice) => void;
}

// =============================================================================
// Component
// =============================================================================

export function DeviceCard({ device, onDelete, onUpdate: _onUpdate }: DeviceCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const { confirm } = useDialog();

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: `Remove "${device.name}"?`,
      message:
        'This will delete the device and all its telemetry history. This action cannot be undone.',
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsDeleting(true);
    try {
      await edgeApi.remove(device.id);
      onDelete(device.id);
    } catch {
      // API client handles error
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl p-4 hover:shadow-sm transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary flex items-center justify-center">
            <Cpu className="w-4 h-4 text-text-muted" />
          </div>
          <div>
            <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary leading-tight">
              {device.name}
            </h3>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[device.status] ?? 'bg-gray-400'}`}
              />
              <span className="text-[10px] text-text-muted dark:text-dark-text-muted capitalize">
                {device.status}
              </span>
              <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
                {TYPE_LABELS[device.type] ?? device.type}
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={handleDelete}
          disabled={isDeleting}
          className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors"
          title="Remove device"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Sensors */}
      {device.sensors.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wide mb-1.5">
            Sensors ({device.sensors.length})
          </p>
          <div className="space-y-1">
            {device.sensors.slice(0, 4).map((sensor) => (
              <div key={sensor.id} className="flex items-center justify-between text-xs">
                <span className="text-text-secondary dark:text-dark-text-secondary truncate">
                  {sensor.name}
                </span>
                <span className="text-text-primary dark:text-dark-text-primary font-mono">
                  {sensor.lastValue != null
                    ? `${sensor.lastValue}${sensor.unit ? ` ${sensor.unit}` : ''}`
                    : '—'}
                </span>
              </div>
            ))}
            {device.sensors.length > 4 && (
              <p className="text-[10px] text-text-muted">+{device.sensors.length - 4} more</p>
            )}
          </div>
        </div>
      )}

      {/* Actuators */}
      {device.actuators.length > 0 && (
        <div className="mb-3">
          <p className="text-[10px] font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wide mb-1.5">
            Actuators ({device.actuators.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {device.actuators.map((actuator) => (
              <span
                key={actuator.id}
                className="px-2 py-0.5 text-[10px] rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary"
              >
                {actuator.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-border dark:border-dark-border">
        <div className="flex items-center gap-1 text-[10px] text-text-muted dark:text-dark-text-muted">
          <Activity className="w-3 h-3" />
          <span>Last seen: {timeAgo(device.lastSeen)}</span>
        </div>
        {device.firmwareVersion && (
          <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
            v{device.firmwareVersion}
          </span>
        )}
      </div>
    </div>
  );
}
