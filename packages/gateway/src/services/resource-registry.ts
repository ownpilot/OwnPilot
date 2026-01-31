/**
 * Resource Registry
 *
 * Central registry of all resource types in the system.
 * Enables generic resource operations, tool discovery, and audit logging.
 *
 * Each resource type declares its name, display name, capabilities,
 * and optionally a service reference for generic CRUD operations.
 */

// ============================================================================
// Types
// ============================================================================

export type ResourceOwnerType = 'user' | 'plugin' | 'system';

export interface ResourceCapabilities {
  /** Supports create operation */
  create: boolean;
  /** Supports read by ID */
  read: boolean;
  /** Supports update */
  update: boolean;
  /** Supports delete */
  delete: boolean;
  /** Supports listing */
  list: boolean;
  /** Supports search */
  search: boolean;
}

export interface ResourceTypeDefinition {
  /** Machine name (e.g. 'goal', 'memory', 'task') */
  name: string;
  /** Human-friendly name (e.g. 'Goals', 'Memories', 'Tasks') */
  displayName: string;
  /** Short description for AI tool discovery */
  description: string;
  /** Who owns this resource type */
  ownerType: ResourceOwnerType;
  /** What operations are supported */
  capabilities: ResourceCapabilities;
  /** If user-scoped, operations require userId */
  userScoped: boolean;
}

// ============================================================================
// ResourceRegistry
// ============================================================================

export class ResourceRegistry {
  private resources = new Map<string, ResourceTypeDefinition>();

  /**
   * Register a resource type.
   * Throws if name already registered.
   */
  register(definition: ResourceTypeDefinition): void {
    if (this.resources.has(definition.name)) {
      throw new Error(`Resource type already registered: ${definition.name}`);
    }
    this.resources.set(definition.name, definition);
  }

  /**
   * Get a resource type by name.
   */
  get(name: string): ResourceTypeDefinition | null {
    return this.resources.get(name) ?? null;
  }

  /**
   * Get all registered resource types.
   */
  getAll(): ResourceTypeDefinition[] {
    return Array.from(this.resources.values());
  }

  /**
   * Get resource types filtered by owner.
   */
  getByOwner(ownerType: ResourceOwnerType): ResourceTypeDefinition[] {
    return this.getAll().filter((r) => r.ownerType === ownerType);
  }

  /**
   * Get resource types that support a specific capability.
   */
  getByCapability(capability: keyof ResourceCapabilities): ResourceTypeDefinition[] {
    return this.getAll().filter((r) => r.capabilities[capability]);
  }

  /**
   * Check if a resource type is registered.
   */
  has(name: string): boolean {
    return this.resources.has(name);
  }

  /**
   * Get names of all registered resource types.
   */
  getNames(): string[] {
    return Array.from(this.resources.keys());
  }

  /**
   * Get a summary suitable for AI prompts or tool discovery.
   */
  getSummary(): Array<{
    name: string;
    displayName: string;
    description: string;
    capabilities: string[];
  }> {
    return this.getAll().map((r) => ({
      name: r.name,
      displayName: r.displayName,
      description: r.description,
      capabilities: Object.entries(r.capabilities)
        .filter(([, v]) => v)
        .map(([k]) => k),
    }));
  }

  /**
   * Clear all registrations (for testing).
   */
  clear(): void {
    this.resources.clear();
  }
}

// ============================================================================
// Default Resource Definitions
// ============================================================================

const FULL_CRUD: ResourceCapabilities = {
  create: true,
  read: true,
  update: true,
  delete: true,
  list: true,
  search: true,
};

export const CORE_RESOURCE_TYPES: ResourceTypeDefinition[] = [
  {
    name: 'goal',
    displayName: 'Goals',
    description: 'User goals with hierarchical steps, priorities, and progress tracking',
    ownerType: 'user',
    capabilities: FULL_CRUD,
    userScoped: true,
  },
  {
    name: 'memory',
    displayName: 'Memories',
    description: 'Persistent AI memories including facts, preferences, events, and skills',
    ownerType: 'user',
    capabilities: FULL_CRUD,
    userScoped: true,
  },
  {
    name: 'task',
    displayName: 'Tasks',
    description: 'Personal tasks/todos with priorities, due dates, and categories',
    ownerType: 'user',
    capabilities: FULL_CRUD,
    userScoped: true,
  },
  {
    name: 'custom_table',
    displayName: 'Custom Tables',
    description: 'Dynamic user-defined data tables with custom schemas',
    ownerType: 'user',
    capabilities: FULL_CRUD,
    userScoped: false,
  },
  {
    name: 'trigger',
    displayName: 'Triggers',
    description: 'Automated triggers that execute actions on events or schedules',
    ownerType: 'system',
    capabilities: { ...FULL_CRUD, search: false },
    userScoped: false,
  },
  {
    name: 'plan',
    displayName: 'Plans',
    description: 'Multi-step execution plans for complex tasks',
    ownerType: 'system',
    capabilities: { ...FULL_CRUD, search: false },
    userScoped: false,
  },
];

// ============================================================================
// Singleton
// ============================================================================

let instance: ResourceRegistry | null = null;

/**
 * Get the global ResourceRegistry, registering core resource types on first access.
 */
export function getResourceRegistry(): ResourceRegistry {
  if (!instance) {
    instance = new ResourceRegistry();
    for (const def of CORE_RESOURCE_TYPES) {
      instance.register(def);
    }
  }
  return instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetResourceRegistry(): void {
  instance = null;
}
