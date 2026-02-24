/**
 * Auth Hook & Provider
 *
 * Manages UI password authentication state.
 * Provides login/logout/refreshStatus and global 401 handling.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authApi } from '../api/endpoints/auth';
import { apiClient } from '../api/client';
import { STORAGE_KEYS } from '../constants/storage-keys';

interface AuthState {
  isAuthenticated: boolean;
  passwordConfigured: boolean;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    isAuthenticated: false,
    passwordConfigured: false,
    isLoading: true,
  });

  const refreshStatus = useCallback(async () => {
    try {
      const status = await authApi.status();

      if (!status.passwordConfigured) {
        // No password configured — everyone is authenticated
        setState({
          isAuthenticated: true,
          passwordConfigured: false,
          isLoading: false,
        });
      } else {
        // Password configured — use server's authentication check
        setState({
          isAuthenticated: status.authenticated,
          passwordConfigured: true,
          isLoading: false,
        });
      }
    } catch {
      // If status call fails, check if we have a token (optimistic)
      const hasToken = !!localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN);
      setState((prev) => ({
        ...prev,
        isAuthenticated: hasToken,
        isLoading: false,
      }));
    }
  }, []);

  const login = useCallback(async (password: string) => {
    const result = await authApi.login(password);
    localStorage.setItem(STORAGE_KEYS.SESSION_TOKEN, result.token);
    setState((prev) => ({ ...prev, isAuthenticated: true }));
    // Notify other components (e.g. WebSocket) to reconnect with the new token.
    // StorageEvent only fires cross-tab natively, so dispatch synthetic event for same-tab.
    window.dispatchEvent(
      new StorageEvent('storage', { key: STORAGE_KEYS.SESSION_TOKEN, newValue: result.token })
    );
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout errors (token might already be invalid)
    }
    localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
    setState((prev) => ({ ...prev, isAuthenticated: false }));
    // Notify other components (WebSocket will close/reconnect without token)
    window.dispatchEvent(
      new StorageEvent('storage', { key: STORAGE_KEYS.SESSION_TOKEN, newValue: null })
    );
  }, []);

  // Set up global 401 handler on mount.
  // When the server returns 401 (session expired / server restart),
  // clear the token and force re-authentication.
  useEffect(() => {
    return apiClient.addOnError((error) => {
      if (error.status === 401) {
        localStorage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
        window.dispatchEvent(
          new StorageEvent('storage', { key: STORAGE_KEYS.SESSION_TOKEN, newValue: null })
        );
        setState((prev) => {
          if (!prev.isAuthenticated) return prev;
          return { ...prev, isAuthenticated: false, passwordConfigured: true };
        });
      }
    });
  }, []);

  // Listen for session token removal (from raw fetch 401 handlers or other tabs)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.SESSION_TOKEN && e.newValue === null) {
        setState((prev) => {
          if (!prev.isAuthenticated) return prev;
          return { ...prev, isAuthenticated: false, passwordConfigured: true };
        });
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Fetch status on mount
  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, refreshStatus }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
