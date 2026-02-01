/**
 * Integration Types
 *
 * Shared types for OAuth integrations (IntegrationsTab, etc.)
 */

export interface Integration {
  id: string;
  provider: string;
  service: string;
  email?: string;
  status: 'active' | 'expired' | 'revoked' | 'error';
  scopes: string[];
  lastSyncAt?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AvailableIntegration {
  provider: string;
  service: string;
  name: string;
  description: string;
  icon: string;
  requiredConfig: string[];
  isConfigured: boolean;
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}
