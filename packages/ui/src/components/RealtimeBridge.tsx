/**
 * RealtimeBridge
 *
 * Invisible side-effect component that wires WebSocket events and API errors
 * to the UI (toasts, badge counts). Renders nothing — mount once in Layout.
 */

import { useEffect } from 'react';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from './ToastProvider';
import { apiClient } from '../api/client';

export interface BadgeCounts {
  inbox: number;
  tasks: number;
}

interface RealtimeBridgeProps {
  onBadgeUpdate: (updater: (prev: BadgeCounts) => BadgeCounts) => void;
}

export function RealtimeBridge({ onBadgeUpdate }: RealtimeBridgeProps) {
  const { subscribe } = useGateway();
  const toast = useToast();

  // Wire apiClient global error handler → toast
  useEffect(() => {
    apiClient.setOnError((error) => {
      // Skip network errors — they're transient and the connection indicator covers it
      if (error.code === 'NETWORK_ERROR') return;
      toast.error(error.message, 'API Error');
    });

    return () => {
      // Clear the handler on unmount
      apiClient.setOnError(() => {});
    };
  }, [toast]);

  // WS: system:notification → toast
  useEffect(() => {
    return subscribe<{ message: string; level?: string }>('system:notification', (data) => {
      const level = data.level ?? 'info';
      const method = level === 'error' ? 'error'
        : level === 'warning' ? 'warning'
        : level === 'success' ? 'success'
        : 'info';
      toast[method](data.message);
    });
  }, [subscribe, toast]);

  // WS: channel:message → increment inbox badge
  useEffect(() => {
    return subscribe('channel:message', () => {
      onBadgeUpdate((prev) => ({ ...prev, inbox: prev.inbox + 1 }));
    });
  }, [subscribe, onBadgeUpdate]);

  return null;
}
