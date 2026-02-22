/**
 * Composio Service — SDK wrapper singleton
 *
 * Wraps @composio/core SDK with lazy initialization,
 * Config Center integration, and caching.
 */

import { configServicesRepo } from '../db/repositories/config-services.js';
import { getLog } from './log.js';

const log = getLog('Composio');

const APPS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Types matching the SDK's response shapes (avoids importing internal SDK types)
export interface ComposioApp {
  slug: string;
  name: string;
  description?: string;
  logo?: string;
  categories?: string[];
}

export interface ComposioConnection {
  id: string;
  appName: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ComposioActionInfo {
  slug: string;
  name: string;
  description: string;
  appName: string;
  parameters?: Record<string, unknown>;
  tags?: string[];
}

export interface ComposioConnectionRequest {
  redirectUrl: string | null;
  connectedAccountId: string;
  connectionStatus: string;
}

/** Safely extract a string from a value that may be string, object, or other. */
function toStr(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value != null && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    // SDK objects may have name, slug, or key fields
    if (typeof v.name === 'string') return v.name;
    if (typeof v.slug === 'string') return v.slug;
    if (typeof v.key === 'string') return v.key;
    if (typeof v.id === 'string') return v.id;
  }
  if (value != null) return String(value);
  return fallback;
}

class ComposioService {
  private client: unknown = null;
  private appsCache: { data: ComposioApp[]; timestamp: number } | null = null;

  /**
   * Resolve API key from Config Center or env var.
   */
  private getApiKey(): string | undefined {
    const cfgValue = configServicesRepo.getFieldValue('composio', 'api_key');
    if (cfgValue && typeof cfgValue === 'string') return cfgValue;
    return process.env.COMPOSIO_API_KEY;
  }

  /**
   * Check if Composio API key is configured (sync, no SDK call).
   */
  isConfigured(): boolean {
    return !!this.getApiKey();
  }

  /**
   * Lazy-init the Composio SDK client.
   */
  private async getClient(): Promise<unknown> {
    if (this.client) return this.client;

    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error(
        'Composio API key not configured. Set it in Config Center → Composio, or set COMPOSIO_API_KEY environment variable.'
      );
    }

    try {
      const { Composio } = await import('@composio/core');
      this.client = new Composio({ apiKey });
      log.info('Composio SDK initialized');
      return this.client;
    } catch (err) {
      throw new Error(
        `Failed to initialize Composio SDK: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Reset client (e.g., when API key changes).
   */
  resetClient(): void {
    this.client = null;
    this.appsCache = null;
  }

  // ---------------------------------------------------------------------------
  // App Discovery
  // ---------------------------------------------------------------------------

  /**
   * List available Composio apps/toolkits (cached).
   */
  async getAvailableApps(): Promise<ComposioApp[]> {
    if (this.appsCache && Date.now() - this.appsCache.timestamp < APPS_CACHE_TTL_MS) {
      return this.appsCache.data;
    }

    const client = (await this.getClient()) as Record<string, unknown>;
    const toolkits = client.toolkits as { get: (q?: unknown) => Promise<unknown> };
    const response = (await toolkits.get()) as { items?: unknown[] };

    const apps: ComposioApp[] = (response.items || []).map((item: unknown) => {
      const t = item as Record<string, unknown>;
      return {
        slug: toStr(t.slug),
        name: toStr(t.name) || toStr(t.slug),
        description: t.description ? toStr(t.description) : undefined,
        logo: t.logo ? toStr(t.logo) : undefined,
        categories: Array.isArray(t.categories) ? t.categories.map((c) => toStr(c)) : undefined,
      };
    });

    this.appsCache = { data: apps, timestamp: Date.now() };
    return apps;
  }

  // ---------------------------------------------------------------------------
  // Action Search & Execution
  // ---------------------------------------------------------------------------

  /**
   * Search for available Composio actions.
   */
  async searchActions(query: string, appName?: string, limit = 10): Promise<ComposioActionInfo[]> {
    const client = (await this.getClient()) as Record<string, unknown>;
    const tools = client.tools as { getRawComposioTools: (q: unknown) => Promise<unknown> };

    const filters: Record<string, unknown> = { search: query, limit: Math.min(limit, 25) };
    if (appName) filters.toolkit = appName;

    const response = (await tools.getRawComposioTools(filters)) as { items?: unknown[] };

    return (response.items || []).map((item: unknown) => {
      const t = item as Record<string, unknown>;
      return {
        slug: toStr(t.slug),
        name: toStr(t.name) || toStr(t.slug),
        description: toStr(t.description),
        appName: toStr(t.appName) || toStr(t.toolkit),
        parameters: t.parameters as Record<string, unknown> | undefined,
        tags: Array.isArray(t.tags) ? t.tags.map((tag) => toStr(tag)) : undefined,
      };
    });
  }

  /**
   * Execute a Composio action.
   */
  async executeAction(
    userId: string,
    actionSlug: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const client = (await this.getClient()) as Record<string, unknown>;
    const tools = client.tools as {
      execute: (slug: string, body: unknown, modifiers?: unknown) => Promise<unknown>;
    };

    const result = await tools.execute(actionSlug, {
      userId,
      arguments: args,
      dangerouslySkipVersionCheck: true,
    });

    return result;
  }

  // ---------------------------------------------------------------------------
  // Connection Management
  // ---------------------------------------------------------------------------

  /**
   * List all connections for a user.
   */
  async getConnections(userId: string): Promise<ComposioConnection[]> {
    const client = (await this.getClient()) as Record<string, unknown>;
    const accounts = client.connectedAccounts as { list: (q?: unknown) => Promise<unknown> };

    const response = (await accounts.list({ userId })) as { items?: unknown[] };

    return (response.items || []).map((item: unknown) => {
      const c = item as Record<string, unknown>;
      return {
        id: toStr(c.id) || toStr(c.nanoid),
        appName: toStr(c.appName) || toStr(c.toolkit),
        status: toStr(c.status, 'UNKNOWN'),
        createdAt: c.createdAt ? toStr(c.createdAt) : undefined,
        updatedAt: c.updatedAt ? toStr(c.updatedAt) : undefined,
      };
    });
  }

  /**
   * Check connection status for a specific app.
   */
  async getConnectionStatus(userId: string, appName: string): Promise<ComposioConnection | null> {
    const connections = await this.getConnections(userId);
    return connections.find((c) => c.appName.toLowerCase() === appName.toLowerCase()) ?? null;
  }

  /**
   * Initiate OAuth connection for an app.
   */
  async initiateConnection(
    userId: string,
    appName: string,
    _redirectUrl?: string
  ): Promise<ComposioConnectionRequest> {
    const client = (await this.getClient()) as Record<string, unknown>;
    const toolkits = client.toolkits as {
      authorize: (userId: string, toolkit: string, authConfigId?: string) => Promise<unknown>;
    };

    const result = (await toolkits.authorize(userId, appName)) as Record<string, unknown>;

    return {
      redirectUrl: result.redirectUrl ? toStr(result.redirectUrl) : null,
      connectedAccountId: toStr(result.connectedAccountId),
      connectionStatus: toStr(result.connectionStatus, 'INITIATED'),
    };
  }

  /**
   * Wait for a connection to become active.
   */
  async waitForConnection(
    connectedAccountId: string,
    timeoutSeconds = 60
  ): Promise<ComposioConnection> {
    const client = (await this.getClient()) as Record<string, unknown>;
    const accounts = client.connectedAccounts as {
      waitForConnection: (id: string, timeout?: number) => Promise<unknown>;
    };

    const result = (await accounts.waitForConnection(connectedAccountId, timeoutSeconds)) as Record<
      string,
      unknown
    >;

    return {
      id: toStr(result.id) || toStr(result.nanoid) || connectedAccountId,
      appName: toStr(result.appName) || toStr(result.toolkit),
      status: toStr(result.status, 'UNKNOWN'),
      createdAt: result.createdAt ? toStr(result.createdAt) : undefined,
      updatedAt: result.updatedAt ? toStr(result.updatedAt) : undefined,
    };
  }

  /**
   * Disconnect (delete) a connected account.
   */
  async disconnect(connectionId: string): Promise<void> {
    const client = (await this.getClient()) as Record<string, unknown>;
    const accounts = client.connectedAccounts as { delete: (id: string) => Promise<unknown> };
    await accounts.delete(connectionId);
  }

  /**
   * Refresh a connection's tokens.
   */
  async refreshConnection(connectionId: string): Promise<ComposioConnection> {
    const client = (await this.getClient()) as Record<string, unknown>;
    const accounts = client.connectedAccounts as { refresh: (id: string) => Promise<unknown> };
    const result = (await accounts.refresh(connectionId)) as Record<string, unknown>;

    return {
      id: toStr(result.id) || toStr(result.nanoid) || connectionId,
      appName: toStr(result.appName) || toStr(result.toolkit),
      status: toStr(result.status, 'UNKNOWN'),
    };
  }
}

export const composioService = new ComposioService();
