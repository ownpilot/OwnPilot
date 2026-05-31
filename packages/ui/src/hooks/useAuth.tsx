/**
 * Auth Hook & Provider
 *
 * Manages UI password authentication state.
 * Provides login/logout/refreshStatus and global 401 handling.
 */

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authApi } from '../api/endpoints/auth';
import { apiClient } from '../api/client';
import { dispatchSessionChanged, onSessionChanged } from '../utils/session-events';

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
      // Cookie-backed sessions are HttpOnly, so the server status endpoint is
      // the source of truth. Fail closed when we cannot reach it: treat the
      // app as "password configured, not authenticated" so AuthGuard sends
      // the user to /login instead of letting the full Layout flash with
      // optimistic state (cached chat list, sidebar pins, etc) before the
      // first pageload API call eventually returns 401.
      setState({
        isAuthenticated: false,
        passwordConfigured: true,
        isLoading: false,
      });
    }
  }, []);

  const login = useCallback(async (password: string) => {
    await authApi.login(password);
    setState((prev) => ({ ...prev, isAuthenticated: true }));
    dispatchSessionChanged(true);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Ignore logout errors (token might already be invalid)
    }
    setState((prev) => ({ ...prev, isAuthenticated: false }));
    dispatchSessionChanged(false);
  }, []);

  // Set up global 401 handler on mount.
  // When the server returns 401 (session expired / server restart),
  // mark the cookie-backed session invalid and force re-authentication.
  useEffect(() => {
    return apiClient.addOnError((error) => {
      if (error.status === 401) {
        dispatchSessionChanged(false);
        setState((prev) => {
          if (!prev.isAuthenticated) return prev;
          // No password configured → the app is open; a stray 401 from any
          // endpoint must not eject the owner to a login screen they cannot
          // satisfy. Only force re-auth when a password actually gates the UI.
          if (!prev.passwordConfigured) return prev;
          return { ...prev, isAuthenticated: false };
        });
      }
    });
  }, []);

  // Listen for session invalidation from raw fetch 401 handlers.
  useEffect(() => {
    return onSessionChanged((detail) => {
      if (!detail.authenticated) {
        setState((prev) => {
          if (!prev.isAuthenticated) return prev;
          // No password configured → the app is open; a stray 401 from any
          // endpoint must not eject the owner to a login screen they cannot
          // satisfy. Only force re-auth when a password actually gates the UI.
          if (!prev.passwordConfigured) return prev;
          return { ...prev, isAuthenticated: false };
        });
      }
    });
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
