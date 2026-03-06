/**
 * EdgeDevicesPage
 *
 * Management page for IoT/edge devices with filter tabs,
 * MQTT status, grid layout, and WS-driven refresh.
 */

import { useState, useCallback, useEffect } from 'react';
import { DeviceCard } from '../components/DeviceCard';
import { RegisterDeviceModal } from '../components/RegisterDeviceModal';
import { DeviceDetailDrawer } from '../components/DeviceDetailDrawer';
import { EdgeDevicesOnboarding } from '../components/EdgeDevicesOnboarding';
import { SkeletonCard } from '../components/Skeleton';
import { Cpu, Globe, Power, Circle, Search, RefreshCw, Plus } from '../components/icons';
import { edgeApi } from '../api/endpoints/edge';
import type { EdgeDevice, EdgeDeviceType, EdgeDeviceStatus } from '../api/endpoints/edge';
import { useGateway } from '../hooks/useWebSocket';

// =============================================================================
// Filter tabs
// =============================================================================

interface FilterTab {
  key: string;
  label: string;
  icon: typeof Cpu;
  filter: { type?: EdgeDeviceType; status?: EdgeDeviceStatus };
}

const FILTER_TABS: FilterTab[] = [
  { key: 'all', label: 'All', icon: Cpu, filter: {} },
  { key: 'online', label: 'Online', icon: Globe, filter: { status: 'online' } },
  { key: 'offline', label: 'Offline', icon: Power, filter: { status: 'offline' } },
  { key: 'raspberry-pi', label: 'RPi', icon: Cpu, filter: { type: 'raspberry-pi' } },
  { key: 'esp32', label: 'ESP32', icon: Circle, filter: { type: 'esp32' } },
  { key: 'arduino', label: 'Arduino', icon: Circle, filter: { type: 'arduino' } },
];

// =============================================================================
// Component
// =============================================================================

export function EdgeDevicesPage() {
  const { subscribe } = useGateway();
  const [activeTab, setActiveTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [devices, setDevices] = useState<EdgeDevice[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<EdgeDevice | null>(null);

  const fetchDevices = useCallback(async () => {
    const filter = FILTER_TABS.find((t) => t.key === activeTab)?.filter ?? {};
    try {
      const data = await edgeApi.list({
        ...filter,
        search: searchQuery || undefined,
        limit: 50,
      });
      setDevices(data?.devices ?? []);
      setTotal(data?.total ?? 0);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, searchQuery]);

  const fetchMqttStatus = useCallback(async () => {
    try {
      const status = await edgeApi.getMqttStatus();
      setMqttConnected(status?.connected ?? false);
    } catch {
      setMqttConnected(false);
    }
  }, []);

  useEffect(() => {
    setIsLoading(true);
    fetchDevices();
  }, [fetchDevices]);

  useEffect(() => {
    fetchMqttStatus();
  }, [fetchMqttStatus]);

  // WS-driven refresh
  useEffect(() => {
    const unsub = subscribe<{ entity: string }>('data:changed', (payload) => {
      if (payload.entity === 'edge-device') {
        fetchDevices();
      }
    });
    return () => {
      unsub();
    };
  }, [subscribe, fetchDevices]);

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const handleDelete = useCallback(
    (id: string) => {
      setDevices((prev) => prev.filter((d) => d.id !== id));
      setTotal((prev) => Math.max(0, prev - 1));
      if (selectedDevice?.id === id) setSelectedDevice(null);
    },
    [selectedDevice]
  );

  const handleUpdate = useCallback(
    (updated: EdgeDevice) => {
      setDevices((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      if (selectedDevice?.id === updated.id) setSelectedDevice(updated);
    },
    [selectedDevice]
  );

  const handleCreated = useCallback((device: EdgeDevice) => {
    setDevices((prev) => [device, ...prev]);
    setTotal((prev) => prev + 1);
    setShowRegister(false);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Under development banner */}
      <div className="flex items-center gap-2 px-6 py-2.5 bg-amber-50 dark:bg-amber-500/10 border-b border-amber-200 dark:border-amber-500/30 text-xs text-amber-700 dark:text-amber-400">
        <span className="text-sm">🚧</span>
        <span>
          <span className="font-semibold">Experimental feature</span> — Edge Devices is under active
          development and not yet ready for production use.
        </span>
      </div>

      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Edge Devices
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            IoT device management ({total} device{total !== 1 ? 's' : ''})
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* MQTT Status */}
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${mqttConnected ? 'bg-green-500' : 'bg-gray-400'}`}
            />
            <span className="text-text-muted dark:text-dark-text-muted">
              MQTT {mqttConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
          <button
            onClick={() => {
              setIsLoading(true);
              fetchDevices();
              fetchMqttStatus();
            }}
            className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4 text-text-muted" />
          </button>
          <button
            onClick={() => setShowRegister(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Register Device
          </button>
        </div>
      </header>

      {/* Filter tabs + search */}
      <div className="px-6 py-3 border-b border-border dark:border-dark-border flex flex-wrap items-center gap-3">
        <div className="flex gap-1 flex-wrap">
          {FILTER_TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-primary text-white'
                    : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            placeholder="Search devices..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-8 pr-3 py-1.5 text-xs border border-border dark:border-dark-border rounded-lg bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary w-48 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            <SkeletonCard count={6} />
          </div>
        ) : devices.length === 0 ? (
          searchQuery ? (
            <div className="flex flex-col items-center justify-center py-16 text-center gap-2">
              <Cpu className="w-8 h-8 text-text-muted" />
              <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                No devices match your search
              </p>
              <p className="text-xs text-text-muted dark:text-dark-text-muted">
                Try a different name or clear the filter.
              </p>
            </div>
          ) : (
            <EdgeDevicesOnboarding onRegister={() => setShowRegister(true)} />
          )
        ) : (
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
            {devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
                onClick={() => setSelectedDevice(device)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      {showRegister && (
        <RegisterDeviceModal onClose={() => setShowRegister(false)} onCreated={handleCreated} />
      )}
      {selectedDevice && (
        <DeviceDetailDrawer
          device={selectedDevice}
          onClose={() => setSelectedDevice(null)}
          onUpdated={handleUpdate}
        />
      )}
    </div>
  );
}
