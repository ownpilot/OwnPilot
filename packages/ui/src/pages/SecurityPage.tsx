/**
 * Security Settings Page
 *
 * Set, change, or remove UI password protection.
 */

import { useState, useEffect, type FormEvent } from 'react';
import { ShieldCheck, AlertCircle } from '../components/icons';
import { useToast } from '../components/ToastProvider';
import { useDialog } from '../components/ConfirmDialog';
import { useAuth } from '../hooks/useAuth';
import { authApi } from '../api/endpoints/auth';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { STORAGE_KEYS } from '../constants/storage-keys';

export function SecurityPage() {
  const toast = useToast();
  const { confirm } = useDialog();
  const { passwordConfigured, refreshStatus } = useAuth();
  const [activeSessions, setActiveSessions] = useState<number | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);

  // Form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (passwordConfigured) {
      loadSessions();
    }
  }, [passwordConfigured]);

  const loadSessions = async () => {
    setIsLoadingSessions(true);
    try {
      const data = await authApi.sessions();
      setActiveSessions(data.activeSessions);
    } catch {
      // Not critical
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setFormError(null);
  };

  const handleSetPassword = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (newPassword.length < 8) {
      setFormError('Password must be at least 8 characters');
      return;
    }

    if (newPassword !== confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }

    if (passwordConfigured && !currentPassword) {
      setFormError('Current password is required');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await authApi.setPassword({
        password: newPassword,
        currentPassword: passwordConfigured ? currentPassword : undefined,
      });

      // Store the new session token and notify other components (WebSocket reconnect)
      if (result.token) {
        localStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, result.token);
        window.dispatchEvent(
          new StorageEvent('storage', { key: STORAGE_KEYS.SESSION_TOKEN, newValue: result.token })
        );
      }

      toast.success(passwordConfigured ? 'Password changed' : 'Password set');
      resetForm();
      await refreshStatus();
      loadSessions();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRemovePassword = async () => {
    const confirmed = await confirm({
      title: 'Remove Password',
      message:
        'This will remove password protection from your dashboard. Anyone with access to the server will be able to use it. Are you sure?',
    });

    if (!confirmed) return;

    try {
      await authApi.removePassword();
      localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
      window.dispatchEvent(
        new StorageEvent('storage', { key: STORAGE_KEYS.SESSION_TOKEN, newValue: null })
      );
      toast.success('Password removed');
      await refreshStatus();
      setActiveSessions(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove password');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="border-b border-border dark:border-dark-border px-6 py-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-5 h-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Security
            </h1>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Manage dashboard password protection
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-2xl">
        {/* Status Card */}
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-4">
          <h2 className="text-sm font-medium text-text-primary dark:text-dark-text-primary mb-3">
            Status
          </h2>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-text-muted dark:text-dark-text-muted">Password Protection</span>
              <span
                className={
                  passwordConfigured
                    ? 'text-success font-medium'
                    : 'text-warning font-medium'
                }
              >
                {passwordConfigured ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            {passwordConfigured && (
              <div className="flex justify-between">
                <span className="text-text-muted dark:text-dark-text-muted">Active Sessions</span>
                <span className="text-text-primary dark:text-dark-text-primary">
                  {isLoadingSessions ? (
                    <LoadingSpinner size="sm" />
                  ) : (
                    activeSessions ?? '-'
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Password Form */}
        <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border p-4">
          <h2 className="text-sm font-medium text-text-primary dark:text-dark-text-primary mb-3">
            {passwordConfigured ? 'Change Password' : 'Set Password'}
          </h2>
          <form onSubmit={handleSetPassword} className="space-y-3">
            {passwordConfigured && (
              <div>
                <label className="block text-xs text-text-muted dark:text-dark-text-muted mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            )}
            <div>
              <label className="block text-xs text-text-muted dark:text-dark-text-muted mb-1">
                {passwordConfigured ? 'New Password' : 'Password'}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Minimum 8 characters"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div>
              <label className="block text-xs text-text-muted dark:text-dark-text-muted mb-1">
                Confirm Password
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                className="w-full px-3 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            {formError && (
              <div className="flex items-center gap-2 text-sm text-error">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={!newPassword || !confirmPassword || isSubmitting}
              className="px-4 py-2 text-sm rounded-lg bg-primary text-white font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSubmitting
                ? 'Saving...'
                : passwordConfigured
                  ? 'Change Password'
                  : 'Set Password'}
            </button>
          </form>
        </div>

        {/* Remove Password */}
        {passwordConfigured && (
          <div className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-error/30 p-4">
            <h2 className="text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
              Remove Password
            </h2>
            <p className="text-xs text-text-muted dark:text-dark-text-muted mb-3">
              Disabling password protection will allow anyone with network access to your server to
              use the dashboard.
            </p>
            <button
              onClick={handleRemovePassword}
              className="px-4 py-2 text-sm rounded-lg border border-error text-error hover:bg-error/10 transition-colors"
            >
              Remove Password
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
