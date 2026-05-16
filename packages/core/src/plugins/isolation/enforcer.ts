/**
 * Isolation enforcer — monitors plugin access and auto-blocks repeat offenders.
 */

import type { PluginId } from '../../types/branded.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { getLog } from '../../services/get-log.js';
import type { AccessViolation, ForbiddenResource } from './types.js';

const FORBIDDEN_RESOURCES: ForbiddenResource[] = [
  'memory:user',
  'credentials:user',
  'memory:system',
  'credentials:system',
  'audit:logs',
  'audit:modify',
  'plugins:internal',
  'filesystem:system',
  'process:spawn',
  'process:env',
  'crypto:keys',
];

export class IsolationEnforcer {
  private violations: AccessViolation[] = [];
  private blockedPlugins: Set<string> = new Set();
  private readonly maxViolations: number;

  constructor(config: { maxViolations?: number } = {}) {
    this.maxViolations = config.maxViolations ?? 3;
  }

  /**
   * Check if access is allowed.
   */
  checkAccess(pluginId: PluginId, resource: string, action: string): Result<void, AccessViolation> {
    if (this.blockedPlugins.has(pluginId)) {
      return err({
        pluginId,
        timestamp: new Date(),
        attemptedResource: resource,
        action,
        stackTrace: new Error().stack,
      });
    }

    if (FORBIDDEN_RESOURCES.includes(resource as ForbiddenResource)) {
      const violation: AccessViolation = {
        pluginId,
        timestamp: new Date(),
        attemptedResource: resource as ForbiddenResource,
        action,
        stackTrace: new Error().stack,
      };

      this.recordViolation(violation);
      return err(violation);
    }

    return ok(undefined);
  }

  /**
   * Record a security violation.
   */
  recordViolation(violation: AccessViolation): void {
    this.violations.push(violation);

    // Trim old violations to prevent unbounded growth (keep most recent 500)
    if (this.violations.length > 1000) {
      this.violations = this.violations.slice(-500);
    }

    const pluginViolations = this.violations.filter(
      (v) => v.pluginId === violation.pluginId
    ).length;

    if (pluginViolations >= this.maxViolations) {
      this.blockedPlugins.add(violation.pluginId);
      getLog('Security').error(
        `Plugin ${violation.pluginId} blocked after ${pluginViolations} violations`
      );
    }
  }

  getViolations(pluginId?: PluginId): AccessViolation[] {
    if (pluginId) {
      return this.violations.filter((v) => v.pluginId === pluginId);
    }
    return [...this.violations];
  }

  isBlocked(pluginId: PluginId): boolean {
    return this.blockedPlugins.has(pluginId);
  }

  unblock(pluginId: PluginId): void {
    this.blockedPlugins.delete(pluginId);
  }

  clearViolations(pluginId?: PluginId): void {
    if (pluginId) {
      this.violations = this.violations.filter((v) => v.pluginId !== pluginId);
    } else {
      this.violations = [];
    }
  }
}
