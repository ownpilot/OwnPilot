/**
 * ResourceRegistry Tests
 *
 * Tests for the central resource type registry including:
 * - Registration and retrieval
 * - Filtering by owner and capability
 * - Summary generation for AI discovery
 * - Core resource type defaults
 * - Singleton lifecycle
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ResourceRegistry,
  getResourceRegistry,
  resetResourceRegistry,
  CORE_RESOURCE_TYPES,
  type ResourceTypeDefinition,
} from './resource-registry.js';

describe('ResourceRegistry', () => {
  let registry: ResourceRegistry;

  beforeEach(() => {
    registry = new ResourceRegistry();
  });

  // ==========================================================================
  // register / get / has
  // ==========================================================================

  describe('register and get', () => {
    const testResource: ResourceTypeDefinition = {
      name: 'test',
      displayName: 'Test Resource',
      description: 'A test resource type',
      ownerType: 'user',
      capabilities: {
        create: true,
        read: true,
        update: true,
        delete: true,
        list: true,
        search: false,
      },
      userScoped: true,
    };

    it('registers and retrieves a resource type', () => {
      registry.register(testResource);
      const result = registry.get('test');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('test');
      expect(result!.displayName).toBe('Test Resource');
    });

    it('returns null for unregistered resource', () => {
      const result = registry.get('nonexistent');
      expect(result).toBeNull();
    });

    it('throws on duplicate registration', () => {
      registry.register(testResource);
      expect(() => registry.register(testResource)).toThrow(/already registered/);
    });

    it('reports has correctly', () => {
      expect(registry.has('test')).toBe(false);
      registry.register(testResource);
      expect(registry.has('test')).toBe(true);
    });
  });

  // ==========================================================================
  // getAll / getNames
  // ==========================================================================

  describe('getAll and getNames', () => {
    it('returns empty array when no resources registered', () => {
      expect(registry.getAll()).toEqual([]);
      expect(registry.getNames()).toEqual([]);
    });

    it('returns all registered resources', () => {
      registry.register({
        name: 'a',
        displayName: 'A',
        description: 'Resource A',
        ownerType: 'user',
        capabilities: {
          create: true,
          read: true,
          update: false,
          delete: false,
          list: true,
          search: false,
        },
        userScoped: true,
      });
      registry.register({
        name: 'b',
        displayName: 'B',
        description: 'Resource B',
        ownerType: 'system',
        capabilities: {
          create: true,
          read: true,
          update: true,
          delete: true,
          list: true,
          search: true,
        },
        userScoped: false,
      });

      expect(registry.getAll()).toHaveLength(2);
      expect(registry.getNames()).toEqual(['a', 'b']);
    });
  });

  // ==========================================================================
  // getByOwner
  // ==========================================================================

  describe('getByOwner', () => {
    beforeEach(() => {
      registry.register({
        name: 'user_res',
        displayName: 'User Resource',
        description: 'Owned by user',
        ownerType: 'user',
        capabilities: {
          create: true,
          read: true,
          update: true,
          delete: true,
          list: true,
          search: false,
        },
        userScoped: true,
      });
      registry.register({
        name: 'system_res',
        displayName: 'System Resource',
        description: 'Owned by system',
        ownerType: 'system',
        capabilities: {
          create: true,
          read: true,
          update: false,
          delete: false,
          list: true,
          search: false,
        },
        userScoped: false,
      });
    });

    it('filters by user owner', () => {
      const userResources = registry.getByOwner('user');
      expect(userResources).toHaveLength(1);
      expect(userResources[0]!.name).toBe('user_res');
    });

    it('filters by system owner', () => {
      const systemResources = registry.getByOwner('system');
      expect(systemResources).toHaveLength(1);
      expect(systemResources[0]!.name).toBe('system_res');
    });

    it('returns empty for unmatched owner', () => {
      const pluginResources = registry.getByOwner('plugin');
      expect(pluginResources).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getByCapability
  // ==========================================================================

  describe('getByCapability', () => {
    beforeEach(() => {
      registry.register({
        name: 'searchable',
        displayName: 'Searchable',
        description: 'Has search',
        ownerType: 'user',
        capabilities: {
          create: true,
          read: true,
          update: true,
          delete: true,
          list: true,
          search: true,
        },
        userScoped: true,
      });
      registry.register({
        name: 'readonly',
        displayName: 'Readonly',
        description: 'Read and list only',
        ownerType: 'system',
        capabilities: {
          create: false,
          read: true,
          update: false,
          delete: false,
          list: true,
          search: false,
        },
        userScoped: false,
      });
    });

    it('filters by search capability', () => {
      const searchable = registry.getByCapability('search');
      expect(searchable).toHaveLength(1);
      expect(searchable[0]!.name).toBe('searchable');
    });

    it('filters by read capability (both have it)', () => {
      const readable = registry.getByCapability('read');
      expect(readable).toHaveLength(2);
    });

    it('filters by create capability', () => {
      const creatable = registry.getByCapability('create');
      expect(creatable).toHaveLength(1);
      expect(creatable[0]!.name).toBe('searchable');
    });
  });

  // ==========================================================================
  // getSummary
  // ==========================================================================

  describe('getSummary', () => {
    it('returns empty array for empty registry', () => {
      expect(registry.getSummary()).toEqual([]);
    });

    it('returns summary with capability names', () => {
      registry.register({
        name: 'goal',
        displayName: 'Goals',
        description: 'User goals',
        ownerType: 'user',
        capabilities: {
          create: true,
          read: true,
          update: true,
          delete: true,
          list: true,
          search: false,
        },
        userScoped: true,
      });

      const summary = registry.getSummary();
      expect(summary).toHaveLength(1);
      expect(summary[0]).toEqual({
        name: 'goal',
        displayName: 'Goals',
        description: 'User goals',
        capabilities: ['create', 'read', 'update', 'delete', 'list'],
      });
    });

    it('only includes enabled capabilities', () => {
      registry.register({
        name: 'minimal',
        displayName: 'Minimal',
        description: 'Read only',
        ownerType: 'system',
        capabilities: {
          create: false,
          read: true,
          update: false,
          delete: false,
          list: false,
          search: false,
        },
        userScoped: false,
      });

      const summary = registry.getSummary();
      expect(summary[0]!.capabilities).toEqual(['read']);
    });
  });

  // ==========================================================================
  // clear
  // ==========================================================================

  describe('clear', () => {
    it('removes all registrations', () => {
      registry.register({
        name: 'temp',
        displayName: 'Temp',
        description: 'Temporary',
        ownerType: 'user',
        capabilities: {
          create: true,
          read: true,
          update: true,
          delete: true,
          list: true,
          search: true,
        },
        userScoped: true,
      });

      expect(registry.getAll()).toHaveLength(1);
      registry.clear();
      expect(registry.getAll()).toHaveLength(0);
    });
  });
});

// ============================================================================
// Core resource type defaults
// ============================================================================

describe('CORE_RESOURCE_TYPES', () => {
  it('has expected resource types', () => {
    const names = CORE_RESOURCE_TYPES.map((r) => r.name);
    expect(names).toContain('goal');
    expect(names).toContain('memory');
    expect(names).toContain('task');
    expect(names).toContain('custom_table');
    expect(names).toContain('trigger');
    expect(names).toContain('plan');
  });

  it('user-scoped resources are marked correctly', () => {
    const goal = CORE_RESOURCE_TYPES.find((r) => r.name === 'goal')!;
    const memory = CORE_RESOURCE_TYPES.find((r) => r.name === 'memory')!;
    const trigger = CORE_RESOURCE_TYPES.find((r) => r.name === 'trigger')!;

    expect(goal.userScoped).toBe(true);
    expect(memory.userScoped).toBe(true);
    expect(trigger.userScoped).toBe(false);
  });
});

// ============================================================================
// Singleton lifecycle
// ============================================================================

describe('getResourceRegistry / resetResourceRegistry', () => {
  beforeEach(() => {
    resetResourceRegistry();
  });

  it('returns a registry with core types pre-registered', () => {
    const reg = getResourceRegistry();
    expect(reg.has('goal')).toBe(true);
    expect(reg.has('memory')).toBe(true);
    expect(reg.has('task')).toBe(true);
    expect(reg.has('custom_table')).toBe(true);
    expect(reg.has('trigger')).toBe(true);
    expect(reg.has('plan')).toBe(true);
  });

  it('returns the same instance on repeated calls', () => {
    const reg1 = getResourceRegistry();
    const reg2 = getResourceRegistry();
    expect(reg1).toBe(reg2);
  });

  it('creates a new instance after reset', () => {
    const reg1 = getResourceRegistry();
    resetResourceRegistry();
    const reg2 = getResourceRegistry();
    expect(reg1).not.toBe(reg2);
  });

  it('summary includes all core resources', () => {
    const reg = getResourceRegistry();
    const summary = reg.getSummary();
    expect(summary.length).toBe(CORE_RESOURCE_TYPES.length);
  });
});
