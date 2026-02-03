/**
 * Resource Service Interface
 *
 * Central registry of resource types in the system.
 * Enables generic resource operations, tool discovery, and audit logging.
 *
 * Each resource type declares its name, capabilities, and ownership.
 */

// ============================================================================
// Types
// ============================================================================

/** Who owns/manages this resource type */
export type ResourceOwnerType = 'user' | 'plugin' | 'system';

/** CRUD + search capabilities for a resource type */
export interface ResourceCapabilities {
  create: boolean;
  read: boolean;
  update: boolean;
  delete: boolean;
  list: boolean;
  search: boolean;
}

/** A resource type definition (metadata, not instances) */
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

/** AI-friendly summary entry */
export interface ResourceSummaryEntry {
  name: string;
  displayName: string;
  description: string;
  capabilities: string[];
}

// ============================================================================
// Interface
// ============================================================================

export interface IResourceService {
  /** Register a resource type. Throws if already registered. */
  register(definition: ResourceTypeDefinition): void;

  /** Get a resource type by name. */
  get(name: string): ResourceTypeDefinition | null;

  /** Get all registered resource types. */
  getAll(): ResourceTypeDefinition[];

  /** Get resource types filtered by owner. */
  getByOwner(ownerType: ResourceOwnerType): ResourceTypeDefinition[];

  /** Get resource types that support a specific capability. */
  getByCapability(capability: keyof ResourceCapabilities): ResourceTypeDefinition[];

  /** Check if a resource type is registered. */
  has(name: string): boolean;

  /** Get names of all registered resource types. */
  getNames(): string[];

  /** Get AI-friendly summary of all resource types. */
  getSummary(): ResourceSummaryEntry[];

  /** Get the number of registered resource types. */
  getCount(): number;
}
