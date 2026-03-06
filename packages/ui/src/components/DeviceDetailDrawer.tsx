/**
 * DeviceDetailDrawer
 *
 * Right-side drawer for an edge device showing:
 *   - Sensors tab: latest telemetry + history per sensor
 *   - Commands tab: send command + command history
 *   - Info tab: edit name/firmware, MQTT topic details
 */

import { useState, useEffect, useCallback } from 'react';
import { X, RefreshCw, Send, ChevronDown, ChevronRight } from './icons';
import { edgeApi } from '../api/endpoints/edge';
import type { EdgeDevice, EdgeTelemetry, EdgeCommand } from '../api/endpoints/edge';

// =============================================================================
// Helpers
// =============================================================================

function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const CMD_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400',
  acknowledged: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400',
  completed: 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
  timeout: 'bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-400',
};

// =============================================================================
// Sub-components
// =============================================================================

function SensorsTab({ device }: { device: EdgeDevice }) {
  const [telemetry, setTelemetry] = useState<EdgeTelemetry[]>([]);
  const [history, setHistory] = useState<Record<string, EdgeTelemetry[]>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await edgeApi.getTelemetry(device.id);
      setTelemetry(data?.telemetry ?? []);
    } finally {
      setIsLoading(false);
    }
  }, [device.id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const loadHistory = async (sensorId: string) => {
    if (expanded === sensorId) {
      setExpanded(null);
      return;
    }
    setExpanded(sensorId);
    if (history[sensorId]) return;
    try {
      const data = await edgeApi.getSensorHistory(device.id, sensorId, 20);
      setHistory((prev) => ({ ...prev, [sensorId]: data?.telemetry ?? [] }));
    } catch {
      // silently ignore
    }
  };

  const latestById = Object.fromEntries(telemetry.map((t) => [t.sensorId, t]));

  if (device.sensors.length === 0) {
    return (
      <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
        No sensors configured.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <button
          onClick={refresh}
          disabled={isLoading}
          className="flex items-center gap-1 text-xs text-text-muted hover:text-primary transition-colors"
        >
          <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>
      {device.sensors.map((sensor) => {
        const latest = latestById[sensor.id];
        const isOpen = expanded === sensor.id;
        const hist = history[sensor.id] ?? [];

        return (
          <div
            key={sensor.id}
            className="border border-border dark:border-dark-border rounded-lg overflow-hidden"
          >
            <button
              onClick={() => loadHistory(sensor.id)}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors text-left"
            >
              <div>
                <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  {sensor.name}
                </span>
                <span className="ml-2 text-xs text-text-muted dark:text-dark-text-muted">
                  {sensor.type}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {latest ? (
                  <span className="font-mono text-sm text-text-primary dark:text-dark-text-primary">
                    {String(latest.value)}
                    {sensor.unit ? ` ${sensor.unit}` : ''}
                  </span>
                ) : (
                  <span className="text-xs text-text-muted">No data</span>
                )}
                {isOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                )}
              </div>
            </button>
            {isOpen && (
              <div className="px-3 pb-2 border-t border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
                {hist.length === 0 ? (
                  <p className="text-xs text-text-muted py-2">No history available.</p>
                ) : (
                  <table className="w-full text-xs mt-2">
                    <thead>
                      <tr className="text-text-muted">
                        <th className="text-left font-medium pb-1">Value</th>
                        <th className="text-right font-medium pb-1">Recorded</th>
                      </tr>
                    </thead>
                    <tbody>
                      {hist.map((h) => (
                        <tr
                          key={h.id}
                          className="border-t border-border/50 dark:border-dark-border/50"
                        >
                          <td className="py-1 font-mono text-text-primary dark:text-dark-text-primary">
                            {String(h.value)}
                            {sensor.unit ? ` ${sensor.unit}` : ''}
                          </td>
                          <td className="py-1 text-right text-text-muted">
                            {timeAgo(h.recordedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CommandsTab({ device }: { device: EdgeDevice }) {
  const [cmdType, setCmdType] = useState('');
  const [payloadStr, setPayloadStr] = useState('{}');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [commands, setCommands] = useState<EdgeCommand[]>([]);
  const [isLoadingCmds, setIsLoadingCmds] = useState(true);

  const loadCommands = useCallback(async () => {
    setIsLoadingCmds(true);
    try {
      const data = await edgeApi.getCommands(device.id, 20);
      setCommands(data?.commands ?? []);
    } finally {
      setIsLoadingCmds(false);
    }
  }, [device.id]);

  useEffect(() => {
    loadCommands();
  }, [loadCommands]);

  const handleSend = async () => {
    if (!cmdType.trim()) {
      setSendError('Command type is required.');
      return;
    }
    let payload: Record<string, unknown> = {};
    try {
      if (payloadStr.trim()) payload = JSON.parse(payloadStr) as Record<string, unknown>;
    } catch {
      setSendError('Invalid JSON payload.');
      return;
    }
    setSendError('');
    setIsSending(true);
    try {
      const cmd = await edgeApi.sendCommand(device.id, { commandType: cmdType.trim(), payload });
      if (cmd) setCommands((prev) => [cmd, ...prev]);
      setCmdType('');
      setPayloadStr('{}');
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send command.');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Send command */}
      <div className="border border-border dark:border-dark-border rounded-lg p-3 space-y-2">
        <p className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
          Send Command
        </p>
        {sendError && <p className="text-xs text-red-500">{sendError}</p>}
        <input
          type="text"
          value={cmdType}
          onChange={(e) => setCmdType(e.target.value)}
          placeholder="Command type (e.g. toggle, set_brightness)"
          className="w-full px-3 py-1.5 text-xs border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <textarea
          value={payloadStr}
          onChange={(e) => setPayloadStr(e.target.value)}
          rows={3}
          placeholder='{"key": "value"}'
          className="w-full px-3 py-1.5 text-xs font-mono border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary resize-none"
        />
        <button
          onClick={handleSend}
          disabled={isSending}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          <Send className="w-3.5 h-3.5" />
          {isSending ? 'Sending…' : 'Send'}
        </button>
      </div>

      {/* History */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
            Command History
          </p>
          <button
            onClick={loadCommands}
            disabled={isLoadingCmds}
            className="text-xs text-text-muted hover:text-primary transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${isLoadingCmds ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {commands.length === 0 ? (
          <p className="text-xs text-text-muted dark:text-dark-text-muted">No commands yet.</p>
        ) : (
          <div className="space-y-1.5">
            {commands.map((cmd) => (
              <div
                key={cmd.id}
                className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary"
              >
                <div>
                  <span className="font-medium text-text-primary dark:text-dark-text-primary">
                    {cmd.commandType}
                  </span>
                  <span className="ml-1.5 text-text-muted">{timeAgo(cmd.createdAt)}</span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${CMD_STATUS_COLORS[cmd.status] ?? ''}`}
                >
                  {cmd.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function InfoTab({
  device,
  onUpdated,
}: {
  device: EdgeDevice;
  onUpdated: (d: EdgeDevice) => void;
}) {
  const [name, setName] = useState(device.name);
  const [firmware, setFirmware] = useState(device.firmwareVersion ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const updated = await edgeApi.update(device.id, {
        name: name.trim() || device.name,
        firmwareVersion: firmware.trim() || undefined,
      });
      if (updated) {
        onUpdated(updated);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const mqttBase = `ownpilot/${device.userId}/devices/${device.id}`;

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
            Firmware Version
          </label>
          <input
            type="text"
            value={firmware}
            onChange={(e) => setFirmware(e.target.value)}
            placeholder="e.g. 2.1.0"
            className="w-full px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isSaving ? 'Saving…' : saved ? 'Saved!' : 'Save Changes'}
        </button>
      </div>

      <div className="border-t border-border dark:border-dark-border pt-4 space-y-2">
        <p className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary uppercase tracking-wide">
          MQTT Topics
        </p>
        {[
          { label: 'Telemetry', topic: `${mqttBase}/telemetry` },
          { label: 'Commands', topic: `${mqttBase}/commands` },
          { label: 'Status', topic: `${mqttBase}/status` },
        ].map(({ label, topic }) => (
          <div key={label}>
            <p className="text-[10px] text-text-muted mb-0.5">{label}</p>
            <code className="block text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary px-2 py-1 rounded font-mono text-text-primary dark:text-dark-text-primary break-all">
              {topic}
            </code>
          </div>
        ))}
      </div>

      <div className="border-t border-border dark:border-dark-border pt-4 space-y-1 text-xs text-text-muted dark:text-dark-text-muted">
        <p>
          Protocol:{' '}
          <span className="text-text-primary dark:text-dark-text-primary">{device.protocol}</span>
        </p>
        <p>
          Type: <span className="text-text-primary dark:text-dark-text-primary">{device.type}</span>
        </p>
        <p>
          Registered:{' '}
          <span className="text-text-primary dark:text-dark-text-primary">
            {new Date(device.createdAt).toLocaleDateString()}
          </span>
        </p>
        <p>
          Device ID: <code className="font-mono">{device.id}</code>
        </p>
      </div>
    </div>
  );
}

// =============================================================================
// Main Drawer
// =============================================================================

type Tab = 'sensors' | 'commands' | 'info';

interface Props {
  device: EdgeDevice;
  onClose: () => void;
  onUpdated: (device: EdgeDevice) => void;
}

export function DeviceDetailDrawer({ device, onClose, onUpdated }: Props) {
  const [tab, setTab] = useState<Tab>('sensors');

  const STATUS_DOT: Record<string, string> = {
    online: 'bg-green-500',
    offline: 'bg-gray-400',
    error: 'bg-red-500',
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-md bg-bg-primary dark:bg-dark-bg-primary shadow-2xl flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border dark:border-dark-border flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${STATUS_DOT[device.status] ?? 'bg-gray-400'}`}
              />
              <h2 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
                {device.name}
              </h2>
            </div>
            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
              Last seen: {device.lastSeen ? timeAgo(device.lastSeen) : 'Never'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border dark:border-dark-border flex-shrink-0">
          {(['sensors', 'commands', 'info'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-xs font-medium capitalize transition-colors ${
                tab === t
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'sensors' && <SensorsTab device={device} />}
          {tab === 'commands' && <CommandsTab device={device} />}
          {tab === 'info' && <InfoTab device={device} onUpdated={onUpdated} />}
        </div>
      </div>
    </div>
  );
}
