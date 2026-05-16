/**
 * Mediated inter-plugin communication. Routes through the registry and
 * checks the enforcer before exposing one plugin's API to another.
 */

import type { PluginId } from '../../types/branded.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import type { IsolationEnforcer } from './enforcer.js';
import type { IsolatedPluginAPI, PluginCommError, PluginRegistryInterface } from './types.js';

export class PluginIsolatedPluginAPI implements IsolatedPluginAPI {
  private readonly pluginId: PluginId;
  private readonly registry: PluginRegistryInterface;
  private readonly enforcer: IsolationEnforcer;

  constructor(pluginId: PluginId, registry: PluginRegistryInterface, enforcer: IsolationEnforcer) {
    this.pluginId = pluginId;
    this.registry = registry;
    this.enforcer = enforcer;
  }

  async getPublicAPI(targetPluginId: string): Promise<Record<string, unknown> | null> {
    const plugin = this.registry.getPlugin(targetPluginId);
    if (!plugin) return null;

    const check = this.enforcer.checkAccess(this.pluginId, `plugin:${targetPluginId}:api`, 'read');
    if (!check.ok) return null;

    return plugin.publicAPI ?? null;
  }

  async sendMessage(
    targetPluginId: string,
    message: unknown
  ): Promise<Result<void, PluginCommError>> {
    const plugin = this.registry.getPlugin(targetPluginId);
    if (!plugin) {
      return err({ type: 'plugin_not_found', pluginId: targetPluginId });
    }

    const messageStr = JSON.stringify(message);
    if (messageStr.length > 64 * 1024) {
      return err({ type: 'message_too_large', maxSize: 64 * 1024 });
    }

    this.registry.deliverMessage(this.pluginId, targetPluginId, message);
    return ok(undefined);
  }

  async listPlugins(): Promise<Array<{ id: string; name: string; version: string }>> {
    return this.registry.listPlugins().map((p) => ({
      id: p.id,
      name: p.name,
      version: p.version,
    }));
  }
}
