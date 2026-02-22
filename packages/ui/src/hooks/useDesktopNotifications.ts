/**
 * useDesktopNotifications Hook
 *
 * Provides browser desktop notification support.
 * Notifications only fire when the tab is not focused.
 * Auto-closes after 8 seconds, clicking focuses the tab.
 */

import { useState, useCallback, useEffect } from 'react';
import { STORAGE_KEYS } from '../constants/storage-keys';

type Permission = NotificationPermission | 'unsupported';

export function useDesktopNotifications() {
  const supported = typeof window !== 'undefined' && 'Notification' in window;

  const [permission, setPermission] = useState<Permission>(() => {
    if (!supported) return 'unsupported';
    return Notification.permission;
  });

  const [enabled, setEnabled] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.DESKTOP_NOTIFICATIONS) === 'true';
  });

  // Persist enabled state
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.DESKTOP_NOTIFICATIONS, String(enabled));
  }, [enabled]);

  const requestPermission = useCallback(async () => {
    if (!supported) return 'unsupported' as const;

    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === 'granted') {
      setEnabled(true);
    }
    return result;
  }, [supported]);

  const notify = useCallback(
    (title: string, options?: NotificationOptions) => {
      if (!supported || !enabled || permission !== 'granted') return;
      // Only notify when tab is not focused
      if (document.hasFocus()) return;

      const notification = new Notification(title, {
        icon: '/favicon.ico',
        ...options,
      });

      // Auto-close after 8 seconds
      const timer = setTimeout(() => notification.close(), 8000);

      notification.onclick = () => {
        window.focus();
        notification.close();
        clearTimeout(timer);
      };
    },
    [supported, enabled, permission]
  );

  return {
    supported,
    permission,
    enabled,
    setEnabled,
    requestPermission,
    notify,
  };
}
