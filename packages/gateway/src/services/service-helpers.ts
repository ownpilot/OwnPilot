/**
 * Service Registry Helpers
 *
 * Shared utilities for safely accessing services from the registry.
 * Avoids duplicating the try/catch pattern across multiple files.
 */

import {
  hasServiceRegistry,
  getServiceRegistry,
  type ServiceToken,
} from '@ownpilot/core';

/**
 * Try to get a service from the registry.
 * Returns null if the registry is not available or the service is not registered.
 */
export function tryGetService<T>(token: ServiceToken<T>): T | null {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(token);
    } catch {
      return null;
    }
  }
  return null;
}
