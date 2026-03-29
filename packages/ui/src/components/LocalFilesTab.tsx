/**
 * LocalFilesTab — Nautilus-style file bookmark browser for the Customize page.
 *
 * Structure:
 *   Edge Devices header (clickable → detail panel, + button)
 *   Machine profiles (expandable drawers with bookmarks)
 *   IoT devices (leaf items with ON/OFF badges)
 *
 * All data is static (from local-files-data.ts). API integration planned for later phases.
 */
import { useCallback } from 'react';
import { ChevronRight, Plus, Wifi } from './icons';
import { useLocalFiles } from '../hooks/useLocalFiles';
import {
  EDGE_DEVICES,
  isSeparator,
  type MachineDevice,
  type IoTDevice,
  type BookmarkEntry,
} from '../constants/local-files-data';

interface LocalFilesTabProps {
  onSelectItem: (key: string) => void;
}

export function LocalFilesTab({ onSelectItem }: LocalFilesTabProps) {
  const { isDeviceOpen, toggleDevice, isDirOpen, toggleDir } = useLocalFiles();

  const handleEdgeHeaderClick = useCallback(() => {
    onSelectItem('__edge_overview__');
  }, [onSelectItem]);

  return (
    <div
      className="flex-1 overflow-y-auto py-1"
      data-testid="local-files-tree"
    >
      {/* Edge Devices header */}
      <button
        className="w-full flex items-center gap-1.5 px-2.5 py-2 cursor-pointer hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
        onClick={handleEdgeHeaderClick}
        data-testid="local-files-edge-header"
      >
        <Wifi className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted opacity-60" />
        <span className="flex-1 text-left text-xs font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
          Edge Devices
        </span>
        <button
          className="w-5 h-5 rounded border border-border dark:border-dark-border flex items-center justify-center text-text-muted dark:text-dark-text-muted hover:text-primary hover:border-primary transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            onSelectItem('__edge_add__');
          }}
          title="Add new device"
          data-testid="local-files-add-device"
        >
          <Plus className="w-3 h-3" />
        </button>
      </button>

      {/* Device list */}
      {EDGE_DEVICES.map((entry) => {
        if (isSeparator(entry)) {
          return (
            <div
              key={entry.id}
              className="border-t border-border dark:border-dark-border mx-4 my-0.5"
            />
          );
        }

        if (entry.type === 'machine') {
          return (
            <MachineDeviceItem
              key={entry.id}
              device={entry}
              isOpen={isDeviceOpen(entry.id, entry.active)}
              onToggle={() => toggleDevice(entry.id, entry.active)}
              isDirOpen={isDirOpen}
              onToggleDir={toggleDir}
              onSelectItem={onSelectItem}
            />
          );
        }

        if (entry.type === 'iot') {
          return (
            <IoTDeviceItem
              key={entry.id}
              device={entry}
              onSelectItem={onSelectItem}
            />
          );
        }

        return null;
      })}
    </div>
  );
}

// ---- Machine Device ----

interface MachineDeviceItemProps {
  device: MachineDevice;
  isOpen: boolean;
  onToggle: () => void;
  isDirOpen: (key: string) => boolean;
  onToggleDir: (key: string) => void;
  onSelectItem: (key: string) => void;
}

function MachineDeviceItem({
  device,
  isOpen,
  onToggle,
  isDirOpen,
  onToggleDir,
  onSelectItem,
}: MachineDeviceItemProps) {
  return (
    <div data-testid={`local-files-device-${device.id}`}>
      {/* Device row */}
      <button
        className="w-full flex items-center gap-1.5 pl-4 pr-2.5 py-1.5 text-base cursor-pointer hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
        onClick={onToggle}
      >
        <ChevronRight
          className={`w-3 h-3 text-text-muted dark:text-dark-text-muted transition-transform duration-150 shrink-0 ${
            isOpen ? 'rotate-90' : ''
          }`}
        />
        <span className="shrink-0">{device.icon}</span>
        <span className="flex-1 text-left text-text-primary dark:text-dark-text-primary truncate">
          {device.label}
          <span className="text-text-muted dark:text-dark-text-muted text-xs font-normal ml-1">
            ({device.sublabel})
          </span>
        </span>
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            device.status === 'online' ? 'bg-success' : 'bg-text-muted dark:bg-dark-text-muted'
          }`}
          title={device.status}
        />
      </button>

      {/* Bookmarks (expanded) */}
      {isOpen && (
        <div>
          {device.bookmarks.map((bm) => {
            if (isSeparator(bm)) {
              return (
                <div
                  key={bm.id}
                  className="border-t border-border dark:border-dark-border mx-8 my-0.5"
                />
              );
            }
            return (
              <BookmarkItem
                key={bm.id}
                bookmark={bm}
                deviceId={device.id}
                isDirOpen={isDirOpen}
                onToggleDir={onToggleDir}
                onSelectItem={onSelectItem}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---- Bookmark Item ----

interface BookmarkItemProps {
  bookmark: BookmarkEntry & { type?: never };
  deviceId: string;
  isDirOpen: (key: string) => boolean;
  onToggleDir: (key: string) => void;
  onSelectItem: (key: string) => void;
}

function BookmarkItem({
  bookmark,
  deviceId,
  onSelectItem,
}: BookmarkItemProps) {
  if ('type' in bookmark && bookmark.type === 'separator') return null;
  const bm = bookmark as Exclude<BookmarkEntry, { type: 'separator' }>;

  const handleClick = () => {
    onSelectItem(`__bookmark__:${deviceId}:${bm.id}:${bm.label}:${bm.path}`);
  };

  return (
    <button
      className="w-full flex items-center gap-2 pl-8 pr-2.5 py-1 text-base cursor-pointer hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
      onClick={handleClick}
      data-testid={`local-files-bookmark-${bm.id}`}
    >
      <span className="text-sm shrink-0">{bm.icon}</span>
      <span className="flex-1 text-left text-text-primary dark:text-dark-text-primary truncate">
        {bm.label}
      </span>
    </button>
  );
}

// ---- IoT Device ----

interface IoTDeviceItemProps {
  device: IoTDevice;
  onSelectItem: (key: string) => void;
}

function IoTDeviceItem({ device, onSelectItem }: IoTDeviceItemProps) {
  const handleClick = () => {
    onSelectItem(`__iot__:${device.id}:${device.label}:${device.status}:${device.description}`);
  };

  return (
    <button
      className="w-full flex items-center gap-2 pl-5 pr-2.5 py-1.5 text-base cursor-pointer hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
      onClick={handleClick}
      data-testid={`local-files-iot-${device.id}`}
    >
      <span className="text-sm shrink-0">{device.icon}</span>
      <span className="flex-1 text-left text-text-primary dark:text-dark-text-primary truncate">
        {device.label}
      </span>
      <span
        className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
          device.status === 'online'
            ? 'bg-success/10 text-success'
            : 'bg-error/10 text-error'
        }`}
      >
        {device.status === 'online' ? 'ON' : 'OFF'}
      </span>
    </button>
  );
}
