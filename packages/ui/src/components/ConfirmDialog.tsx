/**
 * Reusable Confirm & Alert Dialog
 *
 * Replaces native browser confirm() and alert() with styled modals.
 *
 * Usage:
 *   const { confirm, alert } = useDialog();
 *   if (!await confirm('Delete this item?')) return;
 *   await alert('Item deleted successfully');
 */

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

interface DialogOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'default' | 'danger';
}

interface DialogState extends DialogOptions {
  type: 'confirm' | 'alert';
  resolve: (value: boolean) => void;
}

interface DialogContextValue {
  confirm: (messageOrOptions: string | DialogOptions) => Promise<boolean>;
  alert: (messageOrOptions: string | DialogOptions) => Promise<void>;
}

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────

const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error('useDialog must be used within <DialogProvider>');
  return ctx;
}

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

export function DialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const confirm = useCallback((messageOrOptions: string | DialogOptions): Promise<boolean> => {
    const options = typeof messageOrOptions === 'string'
      ? { message: messageOrOptions }
      : messageOrOptions;
    return new Promise<boolean>((resolve) => {
      setDialog({ ...options, type: 'confirm', resolve });
    });
  }, []);

  const alert = useCallback((messageOrOptions: string | DialogOptions): Promise<void> => {
    const options = typeof messageOrOptions === 'string'
      ? { message: messageOrOptions }
      : messageOrOptions;
    return new Promise<void>((resolve) => {
      setDialog({ ...options, type: 'alert', resolve: () => resolve() });
    });
  }, []);

  const close = useCallback((result: boolean) => {
    if (dialog) {
      dialog.resolve(result);
      setDialog(null);
    }
  }, [dialog]);

  // Close on Escape key
  useEffect(() => {
    if (!dialog) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close(false);
      } else if (e.key === 'Enter') {
        close(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog, close]);

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {dialog && (
        <DialogOverlay
          dialog={dialog}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
          backdropRef={backdropRef}
        />
      )}
    </DialogContext.Provider>
  );
}

// ─────────────────────────────────────────────
// Dialog UI
// ─────────────────────────────────────────────

function DialogOverlay({
  dialog,
  onConfirm,
  onCancel,
  backdropRef,
}: {
  dialog: DialogState;
  onConfirm: () => void;
  onCancel: () => void;
  backdropRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isDanger = dialog.variant === 'danger';
  const isAlert = dialog.type === 'alert';

  const title = dialog.title ?? (isAlert ? 'Notice' : 'Confirm');
  const confirmText = dialog.confirmText ?? (isAlert ? 'OK' : (isDanger ? 'Delete' : 'Confirm'));
  const cancelText = dialog.cancelText ?? 'Cancel';

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] animate-[fadeIn_150ms_ease-out]"
      onClick={(e) => {
        if (e.target === backdropRef.current) onCancel();
      }}
    >
      <div className="w-full max-w-md mx-4 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-2xl animate-[scaleIn_150ms_ease-out]">
        {/* Header */}
        <div className="px-6 pt-6 pb-2">
          <div className="flex items-center gap-3">
            {isDanger ? (
              <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
                </svg>
              </div>
            ) : isAlert ? (
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m11.25 11.25.041-.02a.75.75 0 0 1 1.063.852l-.708 2.836a.75.75 0 0 0 1.063.853l.041-.021M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-3.75h.008v.008H12V8.25Z" />
                </svg>
              </div>
            ) : (
              <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-blue-600 dark:text-blue-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" />
                </svg>
              </div>
            )}
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {title}
            </h3>
          </div>
        </div>

        {/* Message */}
        <div className="px-6 py-4">
          <p className="text-sm text-text-secondary dark:text-dark-text-secondary leading-relaxed">
            {dialog.message}
          </p>
        </div>

        {/* Actions */}
        <div className="px-6 pb-6 flex justify-end gap-3">
          {!isAlert && (
            <button
              onClick={onCancel}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={onConfirm}
            autoFocus
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              isDanger
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-primary hover:bg-primary-dark text-white'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
