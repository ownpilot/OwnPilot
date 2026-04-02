/**
 * Notification Center Component
 *
 * Bell icon with dropdown panel showing notification history.
 * Used in the global header for persistent notification access.
 */

import { useState, useEffect, useRef } from 'react';
import { Check, X, AlertCircle, AlertTriangle, Info, Bell, Trash2, Clock } from './icons';
import type { ToastType, NotificationHistoryItem } from './ToastProvider';

// ============================================================================
// Types
// ============================================================================

interface NotificationCenterProps {
  history: NotificationHistoryItem[];
  unreadCount: number;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
  onClear: () => void;
  onRemove: (id: string) => void;
}

// ============================================================================
// Constants
// ============================================================================

const ICONS: Record<ToastType, typeof Check> = {
  success: Check,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS: Record<ToastType, { bg: string; icon: string }> = {
  success: {
    bg: 'bg-success/10 dark:bg-success/20',
    icon: 'text-success',
  },
  error: {
    bg: 'bg-error/10 dark:bg-error/20',
    icon: 'text-error',
  },
  warning: {
    bg: 'bg-warning/10 dark:bg-warning/20',
    icon: 'text-warning',
  },
  info: {
    bg: 'bg-primary/10 dark:bg-primary/20',
    icon: 'text-primary',
  },
};

// ============================================================================
// Component
// ============================================================================

export function NotificationCenter({
  history,
  unreadCount,
  onMarkAsRead,
  onMarkAllAsRead,
  onClear,
  onRemove,
}: NotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="relative">
      {/* Bell Button */}
      <button
        ref={buttonRef}
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2 rounded-lg transition-all ${
          isOpen
            ? 'bg-primary/10 text-primary'
            : 'text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
        } ${unreadCount > 0 ? 'animate-pulse-slow' : ''}`}
        aria-label={`Notifications ${unreadCount > 0 ? `(${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 w-5 h-5 bg-error text-white text-xs font-bold rounded-full flex items-center justify-center shadow-sm"
            aria-hidden="true"
          >
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notification Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          className="absolute right-0 top-full mt-2 w-96 max-h-[500px] bg-bg-primary dark:bg-dark-bg-primary rounded-xl border border-border dark:border-dark-border shadow-2xl z-[9999] overflow-hidden animate-[fadeIn_0.15s_ease-out]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-primary" />
              <span className="font-semibold text-text-primary dark:text-dark-text-primary">
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 bg-error/10 text-error text-xs rounded-full font-medium">
                  {unreadCount} new
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button
                  onClick={onMarkAllAsRead}
                  className="px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
                  title="Mark all as read"
                >
                  Mark all read
                </button>
              )}
              {history.length > 0 && (
                <button
                  onClick={onClear}
                  className="p-1.5 text-text-muted hover:text-error hover:bg-error/10 rounded transition-colors"
                  title="Clear all"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Notification List */}
          <div className="max-h-[400px] overflow-y-auto">
            {history.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="w-16 h-16 rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary flex items-center justify-center mb-3">
                  <Bell className="w-8 h-8 text-text-muted/50" />
                </div>
                <p className="text-text-muted dark:text-dark-text-muted font-medium">
                  No notifications yet
                </p>
                <p className="text-sm text-text-muted/70 mt-1">
                  New notifications will appear here
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border dark:divide-dark-border">
                {history.map((item) => {
                  const Icon = ICONS[item.type];
                  const colors = COLORS[item.type];
                  return (
                    <div
                      key={item.id}
                      onClick={() => onMarkAsRead(item.id)}
                      className={`group relative px-4 py-3 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors cursor-pointer ${
                        !item.read ? 'bg-primary/5 dark:bg-primary/10' : ''
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`p-1.5 rounded-lg ${colors.bg} ${colors.icon} shrink-0 mt-0.5`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          {item.title && (
                            <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary line-clamp-1">
                              {item.title}
                            </p>
                          )}
                          <p className="text-sm text-text-secondary dark:text-dark-text-secondary line-clamp-2">
                            {item.message}
                          </p>
                          <div className="flex items-center gap-2 mt-1.5">
                            <Clock className="w-3 h-3 text-text-muted" />
                            <span className="text-xs text-text-muted">
                              {formatTime(item.timestamp)}
                            </span>
                            {!item.read && (
                              <span className="w-2 h-2 bg-primary rounded-full ml-1" />
                            )}
                          </div>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemove(item.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-error rounded transition-all"
                          title="Remove"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          {history.length > 0 && (
            <div className="px-4 py-2 border-t border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-center">
              <span className="text-xs text-text-muted">
                {history.filter(i => !i.read).length} unread · {history.length} total
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationCenter;
