/**
 * Provider Auth API — OAuth 2.0 device-code sign-in for LLM providers.
 *
 * Backs the ProviderAuthPanel: starts the device flow, polls until the
 * user authorizes in their browser, and lists each provider's stored
 * auth method. Token values are never returned to the client — the
 * gateway holds the credential and surfaces only the method label.
 */

import { apiClient } from '../client';

export interface DeviceFlowStart {
  provider: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export type DeviceFlowPollResult =
  | { provider: string; status: 'success'; method: string }
  | { provider: string; status: 'pending'; intervalSec: number }
  | { provider: string; status: 'expired' }
  | { provider: string; status: 'denied'; reason?: string }
  | { provider: string; status: 'error'; reason?: string };

export interface ProviderAuthInfo {
  provider: string;
  /** OAuth shape exists somewhere (catalog or user override). */
  oauthCapable: boolean;
  /** All three required fields are filled — sign-in will succeed. */
  oauthReady: boolean;
  storedMethod?: string;
  hasExpiry?: boolean;
  expiresAt?: number;
}

export interface ProviderOAuthOverride {
  deviceCodeUrl?: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  clientId?: string;
  scopes?: string[];
}

export const providerAuthApi = {
  startDeviceFlow: (provider: string) =>
    apiClient.post<DeviceFlowStart>('/provider-auth/oauth/device/start', { provider }),
  pollDeviceFlow: (provider: string) =>
    apiClient.post<DeviceFlowPollResult>('/provider-auth/oauth/device/poll', { provider }),
  signOut: (provider: string) =>
    apiClient.post<{ provider: string; signedOut: boolean }>('/provider-auth/signout', {
      provider,
    }),
  listProviders: () => apiClient.get<{ providers: ProviderAuthInfo[] }>('/provider-auth/providers'),
  getConfig: (provider: string) =>
    apiClient.get<{ provider: string; override: ProviderOAuthOverride | null }>(
      `/provider-auth/config/${encodeURIComponent(provider)}`
    ),
  setConfig: (provider: string, override: ProviderOAuthOverride) =>
    apiClient.put<{ provider: string; override: ProviderOAuthOverride }>(
      `/provider-auth/config/${encodeURIComponent(provider)}`,
      override as unknown as Record<string, unknown>
    ),
  clearConfig: (provider: string) =>
    apiClient.delete<{ provider: string; cleared: boolean }>(
      `/provider-auth/config/${encodeURIComponent(provider)}`
    ),
};
