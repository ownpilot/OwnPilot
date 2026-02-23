/**
 * Auth API Endpoints
 *
 * UI password authentication for the web dashboard.
 */

import { apiClient } from '../client';

export interface AuthStatus {
  passwordConfigured: boolean;
  authenticated: boolean;
}

export interface LoginResponse {
  token: string;
  expiresAt: string;
}

export interface PasswordResponse {
  message: string;
  token?: string;
  expiresAt?: string;
}

export interface SessionsResponse {
  activeSessions: number;
}

export const authApi = {
  /** Check auth status (public) */
  status: () => apiClient.get<AuthStatus>('/auth/status'),

  /** Login with password (public) */
  login: (password: string) => apiClient.post<LoginResponse>('/auth/login', { password }),

  /** Logout current session */
  logout: () => apiClient.post<{ message: string }>('/auth/logout'),

  /** Set or change password */
  setPassword: (data: { password: string; currentPassword?: string }) =>
    apiClient.post<PasswordResponse>('/auth/password', data),

  /** Remove password */
  removePassword: () => apiClient.delete<{ message: string }>('/auth/password'),

  /** Get active session count */
  sessions: () => apiClient.get<SessionsResponse>('/auth/sessions'),
};
