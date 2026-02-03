/**
 * ResourceService Implementation
 *
 * Wraps the existing ResourceRegistry to provide IResourceService interface.
 * Direct pass-through adapter.
 *
 * Usage:
 *   const resources = registry.get(Services.Resource);
 *   const goals = resources.get('goal');
 */

import type {
  IResourceService,
  ResourceOwnerType,
  ResourceCapabilities,
  ResourceTypeDefinition,
  ResourceSummaryEntry,
} from '@ownpilot/core';
import { getResourceRegistry } from './resource-registry.js';

// ============================================================================
// ResourceServiceImpl Adapter
// ============================================================================

export class ResourceServiceImpl implements IResourceService {
  private get registry() {
    return getResourceRegistry();
  }

  register(definition: ResourceTypeDefinition): void {
    this.registry.register(definition);
  }

  get(name: string): ResourceTypeDefinition | null {
    return this.registry.get(name);
  }

  getAll(): ResourceTypeDefinition[] {
    return this.registry.getAll();
  }

  getByOwner(ownerType: ResourceOwnerType): ResourceTypeDefinition[] {
    return this.registry.getByOwner(ownerType);
  }

  getByCapability(capability: keyof ResourceCapabilities): ResourceTypeDefinition[] {
    return this.registry.getByCapability(capability);
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  getNames(): string[] {
    return this.registry.getNames();
  }

  getSummary(): ResourceSummaryEntry[] {
    return this.registry.getSummary();
  }

  getCount(): number {
    return this.registry.getAll().length;
  }
}

/**
 * Create a new ResourceServiceImpl instance.
 */
export function createResourceServiceImpl(): IResourceService {
  return new ResourceServiceImpl();
}
