/**
 * Toast Notification System
 *
 * Provides lightweight, auto-dismissing toast notifications.
 * Used for API error feedback, success confirmations, and warnings.
 *
 * Usage:
 *   const toast = useToast();
 *   toast.success('Saved!');
 *   toast.error('Failed to load data');
 */

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import { Check, X, AlertCircle, AlertTriangle, Info } from './icons';

// ============================================================================
// Types
// ============================================================================

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  /** Auto-dismiss duration in ms. 0 = persistent. Default 5000. */
  duration: number;
  /** Whether the toast is currently animating out */
  exiting?: boolean;
}

interface ToastContextValue {
  addToast: (toast: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => void;
  removeToast: (id: string) => void;
  success: (message: string, title?: string) => void;
  error: (message: string, title?: string) => void;
  warning: (message: string, title?: string) => void;
  info: (message: string, title?: string) => void;
}

// ============================================================================
// Context
// ============================================================================

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

// ============================================================================
// Styling
// ============================================================================

const ICONS: Record<ToastType, typeof Check> = {
  success: Check,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS: Record<ToastType, { bg: string; icon: string; border: string }> = {
  success: {
    bg: 'bg-success/10 dark:bg-success/20',
    icon: 'text-success',
    border: 'border-success/30',
  },
  error: {
    bg: 'bg-error/10 dark:bg-error/20',
    icon: 'text-error',
    border: 'border-error/30',
  },
  warning: {
    bg: 'bg-warning/10 dark:bg-warning/20',
    icon: 'text-warning',
    border: 'border-warning/30',
  },
  info: {
    bg: 'bg-primary/10 dark:bg-primary/20',
    icon: 'text-primary',
    border: 'border-primary/30',
  },
};

const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  error: 6000,
  warning: 5000,
  info: 4000,
};

// ============================================================================
// Toast Item Component
// ============================================================================

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const colors = COLORS[toast.type];
  const Icon = ICONS[toast.type];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (toast.duration > 0) {
      timerRef.current = setTimeout(() => onRemove(toast.id), toast.duration);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.duration, onRemove]);

  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg
        ${colors.bg} ${colors.border}
        bg-bg-primary/95 dark:bg-dark-bg-secondary/95 backdrop-blur-sm
        ${toast.exiting ? 'animate-slide-out' : 'animate-[slideIn_0.2s_ease-out]'}
        max-w-sm w-full`}
      role="alert"
    >
      <Icon className={`w-5 h-5 mt-0.5 shrink-0 ${colors.icon}`} />
      <div className="flex-1 min-w-0">
        {toast.title && (
          <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            {toast.title}
          </p>
        )}
        <p className="text-sm text-text-secondary dark:text-dark-text-secondary break-words">
          {toast.message}
        </p>
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="shrink-0 p-0.5 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
      </button>
    </div>
  );
}

// ============================================================================
// Provider
// ============================================================================

let toastCounter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const exitTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Clean up animation timers on unmount
  useEffect(() => {
    const timers = exitTimersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const removeToast = useCallback((id: string) => {
    // Prevent double-removal
    if (exitTimersRef.current.has(id)) return;
    // Mark as exiting first for slide-out animation
    setToasts(prev => prev.map(t => t.id === id ? { ...t, exiting: true } : t));
    // Remove from DOM after animation completes
    const timer = setTimeout(() => {
      exitTimersRef.current.delete(id);
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 300);
    exitTimersRef.current.set(id, timer);
  }, []);

  const addToast = useCallback(
    (input: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => {
      const id = `toast-${++toastCounter}`;
      const duration = input.duration ?? DEFAULT_DURATION[input.type];
      setToasts(prev => {
        // Deduplicate: skip if same message already visible
        if (prev.some(t => t.message === input.message && !t.exiting)) return prev;
        // Cap at 5 visible toasts — drop oldest
        const capped = prev.length >= 5 ? prev.slice(1) : prev;
        return [...capped, { ...input, id, duration }];
      });
    },
    [],
  );

  const success = useCallback(
    (message: string, title?: string) => addToast({ type: 'success', message, title }),
    [addToast],
  );

  const error = useCallback(
    (message: string, title?: string) => addToast({ type: 'error', message, title }),
    [addToast],
  );

  const warning = useCallback(
    (message: string, title?: string) => addToast({ type: 'warning', message, title }),
    [addToast],
  );

  const info = useCallback(
    (message: string, title?: string) => addToast({ type: 'info', message, title }),
    [addToast],
  );

  const value: ToastContextValue = { addToast, removeToast, success, error, warning, info };

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Toast container — top-right, stacked */}
      {toasts.length > 0 && (
        <div
          className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-auto"
          aria-live="polite"
        >
          {toasts.map(toast => (
            <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
}
