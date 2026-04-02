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
import {
  Cpu,
  Globe,
  Power,
  Circle,
  Search,
  RefreshCw,
  Plus,
  Home,
  Wifi,
  Brain,
  Activity,
  Zap,
} from '../components/icons';
import { PageHomeTab } from '../components/PageHomeTab';
import { edgeApi } from '../api/endpoints/edge';
import type { EdgeDevice, EdgeDeviceType, EdgeDeviceStatus } from '../api/endpoints/edge';
import { useGateway } from '../hooks/useWebSocket';

type PageTabId = 'home' | 'devices';

const PAGE_TAB_LABELS: Record<PageTabId, string> = {
  home: 'Home',
  devices: 'Devices',
};

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
  const [pageTab, setPageTab] = useState<PageTabId>('home');

  // Skip home screen preference
  const SKIP_HOME_KEY = 'ownpilot_skip_home__edge_devices';
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try {
      localStorage.setItem(SKIP_HOME_KEY, checked ? 'true' : 'false');
    } catch {
      // Ignore storage errors
    }
  }, []);
  useEffect(() => {
    if (skipHome) {
      setPageTab('devices');
    }
  }, [skipHome]);

  const [filterTab, setFilterTab] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [devices, setDevices] = useState<EdgeDevice[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [mqttConnected, setMqttConnected] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<EdgeDevice | null>(null);

  const fetchDevices = useCallback(async () => {
    const filter = FILTER_TABS.find((t) => t.key === filterTab)?.filter ?? {};
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
  }, [filterTab, searchQuery]);

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

      {/* Page tab bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'devices'] as PageTabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setPageTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              pageTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {PAGE_TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Home tab */}
      {pageTab === 'home' && (
        <div className="flex-1 overflow-y-auto">
          <PageHomeTab
            heroIcons={[
              { icon: Wifi, color: 'text-primary bg-primary/10' },
              { icon: Cpu, color: 'text-orange-500 bg-orange-500/10' },
              { icon: Brain, color: 'text-violet-500 bg-violet-500/10' },
            ]}
            title="Connect Physical Devices to Your AI"
            subtitle="Stream sensor data from IoT hardware into OwnPilot over MQTT, then query, analyze, and control devices using natural language."
            cta={{ label: 'View Devices', icon: Wifi, onClick: () => setPageTab('devices') }}
            skipHomeChecked={skipHome}
            onSkipHomeChange={handleSkipHomeChange}
            skipHomeLabel="Skip this screen and go directly to Devices"
            features={[
              {
                icon: Wifi,
                color: 'text-blue-500 bg-blue-500/10',
                title: 'MQTT Protocol',
                description:
                  'Connect devices over the standard MQTT protocol with automatic topic management and QoS.',
              },
              {
                icon: Activity,
                color: 'text-purple-500 bg-purple-500/10',
                title: 'Sensor Data',
                description:
                  'Stream temperature, humidity, motion, and any custom sensor readings in real time.',
              },
              {
                icon: Zap,
                color: 'text-emerald-500 bg-emerald-500/10',
                title: 'Remote Control',
                description:
                  'Send commands to your devices — toggle relays, update settings, trigger actions remotely.',
              },
              {
                icon: Brain,
                color: 'text-orange-500 bg-orange-500/10',
                title: 'AI Integration',
                description:
                  'Let your AI assistant query sensor data, detect anomalies, and control devices via natural language.',
              },
            ]}
            steps={[
              {
                title: 'Set up MQTT broker',
                detail: 'Configure your Mosquitto or other MQTT broker and connect it to OwnPilot.',
              },
              {
                title: 'Register your device',
                detail: 'Add a new device with its type, capabilities, and MQTT topic.',
              },
              {
                title: 'Flash client code',
                detail: 'Upload the OwnPilot client library to your microcontroller or SBC.',
              },
              {
                title: 'Watch data flow in',
                detail: 'See live sensor readings and control your device from the dashboard.',
              },
            ]}
            quickActions={[
              {
                icon: Cpu,
                label: 'Manage Devices',
                description: 'View, register, and monitor your connected devices',
                onClick: () => setPageTab('devices'),
              },
            ]}
          />
        </div>
      )}

      {/* Filter tabs + search */}
      {pageTab === 'devices' && (
        <div className="px-6 py-3 border-b border-border dark:border-dark-border flex flex-wrap items-center gap-3">
          <div className="flex gap-1 flex-wrap">
            {FILTER_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = filterTab === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setFilterTab(tab.key)}
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
      )}

      {/* Content */}
      {pageTab === 'devices' && (
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
      )}

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
