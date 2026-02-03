/**
 * ResourceServiceImpl Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockResourceRegistry = vi.hoisted(() => ({
  register: vi.fn(),
  get: vi.fn(),
  getAll: vi.fn(),
  getByOwner: vi.fn(),
  getByCapability: vi.fn(),
  has: vi.fn(),
  getNames: vi.fn(),
  getSummary: vi.fn(),
  clear: vi.fn(),
}));

vi.mock('./resource-registry.js', () => ({
  getResourceRegistry: () => mockResourceRegistry,
}));

import { ResourceServiceImpl, createResourceServiceImpl } from './resource-service-impl.js';

const mockResourceDef = {
  name: 'goal',
  displayName: 'Goals',
  description: 'User goals with hierarchical steps',
  ownerType: 'user' as const,
  capabilities: {
    create: true,
    read: true,
    update: true,
    delete: true,
    list: true,
    search: true,
  },
  userScoped: true,
};

const mockSystemResource = {
  name: 'trigger',
  displayName: 'Triggers',
  description: 'Automated triggers',
  ownerType: 'system' as const,
  capabilities: {
    create: true,
    read: true,
    update: true,
    delete: true,
    list: true,
    search: false,
  },
  userScoped: false,
};

describe('ResourceServiceImpl', () => {
  let service: ResourceServiceImpl;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ResourceServiceImpl();
  });

  describe('register', () => {
    it('delegates to registry', () => {
      service.register(mockResourceDef);
      expect(mockResourceRegistry.register).toHaveBeenCalledWith(mockResourceDef);
    });
  });

  describe('get', () => {
    it('returns resource type by name', () => {
      mockResourceRegistry.get.mockReturnValue(mockResourceDef);

      const result = service.get('goal');
      expect(result).toBeDefined();
      expect(result!.name).toBe('goal');
      expect(mockResourceRegistry.get).toHaveBeenCalledWith('goal');
    });

    it('returns null for unknown resource', () => {
      mockResourceRegistry.get.mockReturnValue(null);
      expect(service.get('nonexistent')).toBeNull();
    });
  });

  describe('getAll', () => {
    it('returns all registered resource types', () => {
      mockResourceRegistry.getAll.mockReturnValue([mockResourceDef, mockSystemResource]);

      const result = service.getAll();
      expect(result).toHaveLength(2);
    });

    it('returns empty array when none registered', () => {
      mockResourceRegistry.getAll.mockReturnValue([]);
      expect(service.getAll()).toHaveLength(0);
    });
  });

  describe('getByOwner', () => {
    it('filters by user owner', () => {
      mockResourceRegistry.getByOwner.mockReturnValue([mockResourceDef]);

      const result = service.getByOwner('user');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('goal');
      expect(mockResourceRegistry.getByOwner).toHaveBeenCalledWith('user');
    });

    it('filters by system owner', () => {
      mockResourceRegistry.getByOwner.mockReturnValue([mockSystemResource]);

      const result = service.getByOwner('system');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('trigger');
    });

    it('returns empty for unmatched owner', () => {
      mockResourceRegistry.getByOwner.mockReturnValue([]);
      expect(service.getByOwner('plugin')).toHaveLength(0);
    });
  });

  describe('getByCapability', () => {
    it('filters by search capability', () => {
      mockResourceRegistry.getByCapability.mockReturnValue([mockResourceDef]);

      const result = service.getByCapability('search');
      expect(result).toHaveLength(1);
      expect(mockResourceRegistry.getByCapability).toHaveBeenCalledWith('search');
    });

    it('returns all with read capability', () => {
      mockResourceRegistry.getByCapability.mockReturnValue([mockResourceDef, mockSystemResource]);

      const result = service.getByCapability('read');
      expect(result).toHaveLength(2);
    });
  });

  describe('has', () => {
    it('returns true for registered resource', () => {
      mockResourceRegistry.has.mockReturnValue(true);

      expect(service.has('goal')).toBe(true);
      expect(mockResourceRegistry.has).toHaveBeenCalledWith('goal');
    });

    it('returns false for unregistered resource', () => {
      mockResourceRegistry.has.mockReturnValue(false);
      expect(service.has('nonexistent')).toBe(false);
    });
  });

  describe('getNames', () => {
    it('returns all resource type names', () => {
      mockResourceRegistry.getNames.mockReturnValue(['goal', 'trigger']);

      const result = service.getNames();
      expect(result).toEqual(['goal', 'trigger']);
    });

    it('returns empty array when none registered', () => {
      mockResourceRegistry.getNames.mockReturnValue([]);
      expect(service.getNames()).toEqual([]);
    });
  });

  describe('getSummary', () => {
    it('returns AI-friendly summary', () => {
      const summaryData = [
        {
          name: 'goal',
          displayName: 'Goals',
          description: 'User goals',
          capabilities: ['create', 'read', 'update', 'delete', 'list', 'search'],
        },
      ];
      mockResourceRegistry.getSummary.mockReturnValue(summaryData);

      const result = service.getSummary();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('goal');
      expect(result[0].capabilities).toContain('search');
    });

    it('returns empty array when no resources', () => {
      mockResourceRegistry.getSummary.mockReturnValue([]);
      expect(service.getSummary()).toHaveLength(0);
    });
  });

  describe('getCount', () => {
    it('returns count of registered resources', () => {
      mockResourceRegistry.getAll.mockReturnValue([mockResourceDef, mockSystemResource]);
      expect(service.getCount()).toBe(2);
    });

    it('returns 0 when empty', () => {
      mockResourceRegistry.getAll.mockReturnValue([]);
      expect(service.getCount()).toBe(0);
    });
  });

  describe('createResourceServiceImpl factory', () => {
    it('returns a ResourceServiceImpl instance', () => {
      const svc = createResourceServiceImpl();
      expect(svc).toBeInstanceOf(ResourceServiceImpl);
    });
  });
});
