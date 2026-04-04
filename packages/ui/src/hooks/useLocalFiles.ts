/**
 * useLocalFiles — state management for the Local Files tab.
 *
 * Manages expand/collapse state for devices and bookmark directories,
 * persisted to localStorage. Active device (ownpilot-local) defaults to open.
 */
import { useState, useCallback } from 'react';
import { STORAGE_KEYS } from '../constants/storage-keys';

type ExpandState = Record<string, boolean>;

function readJson(key: string): ExpandState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as ExpandState;
      }
    }
  } catch {
    // Malformed JSON — fall through
  }
  return {};
}

function writeJson(key: string, state: ExpandState) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage full or unavailable
  }
}

export function useLocalFiles() {
  const [deviceState, setDeviceState] = useState<ExpandState>(() =>
    readJson(STORAGE_KEYS.LOCAL_FILES_DEVICES),
  );
  const [dirState, setDirState] = useState<ExpandState>(() =>
    readJson(STORAGE_KEYS.LOCAL_FILES_DIRS),
  );

  /** Check if a device is expanded. Active device defaults to open. */
  const isDeviceOpen = useCallback(
    (deviceId: string, isActive?: boolean): boolean => {
      if (deviceId in deviceState) return deviceState[deviceId] ?? false;
      // Default: active device is open, others closed
      return isActive === true;
    },
    [deviceState],
  );

  /** Toggle device expand/collapse */
  const toggleDevice = useCallback((deviceId: string, isActive?: boolean) => {
    setDeviceState((prev) => {
      const wasOpen = deviceId in prev ? prev[deviceId] : isActive === true;
      const next = { ...prev, [deviceId]: !wasOpen };
      writeJson(STORAGE_KEYS.LOCAL_FILES_DEVICES, next);
      return next;
    });
  }, []);

  /** Check if a bookmark directory is expanded. Keyed as "deviceId:bookmarkId". */
  const isDirOpen = useCallback(
    (key: string): boolean => dirState[key] === true,
    [dirState],
  );

  /** Toggle bookmark directory expand/collapse */
  const toggleDir = useCallback((key: string) => {
    setDirState((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      writeJson(STORAGE_KEYS.LOCAL_FILES_DIRS, next);
      return next;
    });
  }, []);

  return {
    isDeviceOpen,
    toggleDevice,
    isDirOpen,
    toggleDir,
  };
}
