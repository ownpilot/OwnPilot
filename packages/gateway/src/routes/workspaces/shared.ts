/**
 * Shared utilities for workspace routes
 *
 * Contains path sanitization, container config validation,
 * and constants used across workspace sub-route modules.
 */

import path from 'node:path';
import type { ContainerConfig } from '@ownpilot/core';

// ============================================
// Path traversal protection
// ============================================

/**
 * Sanitize file paths to prevent directory traversal attacks.
 * Ensures the resolved path stays within the workspace root.
 *
 * Returns the normalized relative path, or null if the path
 * attempts to escape the workspace directory.
 */
export function sanitizeFilePath(filePath: string): string | null {
  // Normalize the path using posix to get consistent forward slashes,
  // then resolve any ../ sequences
  const normalized = path.posix.normalize(filePath);

  // Reject if path tries to escape (starts with .. or is exactly '..')
  if (normalized.startsWith('..') || normalized === '..') {
    return null;
  }

  // Strip leading slashes to ensure the path is relative
  const relative = normalized.replace(/^\/+/, '');

  // After stripping, re-check (e.g. "/../foo" normalizes to "../foo")
  if (relative.startsWith('..')) {
    return null;
  }

  return relative;
}

// ============================================
// Container config limits
// ============================================

export const CONTAINER_LIMITS = {
  memoryMB: { min: 64, max: 2048 },
  cpuCores: { min: 0.25, max: 4 },
  storageGB: { min: 1, max: 10 },
  timeoutMs: { min: 5000, max: 120000 },
} as const;

export const VALID_NETWORK_POLICIES = ['none', 'restricted', 'full'] as const;

/**
 * Validate and clamp user-supplied container config against safe limits
 */
export function sanitizeContainerConfig(
  base: ContainerConfig,
  userConfig?: Partial<ContainerConfig>
): ContainerConfig {
  if (!userConfig || typeof userConfig !== 'object') return { ...base };

  const clamp = (val: unknown, limits: { min: number; max: number }, fallback: number): number =>
    typeof val === 'number' ? Math.max(limits.min, Math.min(limits.max, val)) : fallback;

  return {
    memoryMB: clamp(userConfig.memoryMB, CONTAINER_LIMITS.memoryMB, base.memoryMB),
    cpuCores: clamp(userConfig.cpuCores, CONTAINER_LIMITS.cpuCores, base.cpuCores),
    storageGB: clamp(userConfig.storageGB, CONTAINER_LIMITS.storageGB, base.storageGB),
    timeoutMs: clamp(userConfig.timeoutMs, CONTAINER_LIMITS.timeoutMs, base.timeoutMs),
    networkPolicy: VALID_NETWORK_POLICIES.includes(
      userConfig.networkPolicy as (typeof VALID_NETWORK_POLICIES)[number]
    )
      ? (userConfig.networkPolicy as ContainerConfig['networkPolicy'])
      : base.networkPolicy,
    ...(userConfig.allowedHosts && Array.isArray(userConfig.allowedHosts)
      ? {
          allowedHosts: userConfig.allowedHosts
            .filter((h): h is string => typeof h === 'string')
            .slice(0, 50),
        }
      : {}),
  };
}
