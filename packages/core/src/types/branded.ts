/**
 * Branded types prevent mixing IDs of different entities at compile time
 * e.g., you can't pass a SessionId where a UserId is expected
 */

declare const brand: unique symbol;

/**
 * Brand a type with a unique identifier
 */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

// ============================================
// Pre-defined branded types
// ============================================

export type UserId = Brand<string, 'UserId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type PluginId = Brand<string, 'PluginId'>;
export type ChannelId = Brand<string, 'ChannelId'>;
export type MessageId = Brand<string, 'MessageId'>;
export type AuditEventId = Brand<string, 'AuditEventId'>;
export type ToolId = Brand<string, 'ToolId'>;
export type ConversationId = Brand<string, 'ConversationId'>;

// ============================================
// Validation patterns
// ============================================

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/;

// ============================================
// Constructors with validation
// ============================================

/**
 * Create a UserId from a string (UUID format)
 */
export function createUserId(id: string): UserId {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`Invalid UserId format: ${id}`);
  }
  return id as UserId;
}

/**
 * Create a SessionId from a string (UUID format)
 */
export function createSessionId(id: string): SessionId {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`Invalid SessionId format: ${id}`);
  }
  return id as SessionId;
}

/**
 * Create a PluginId from a string (lowercase alphanumeric with hyphens)
 */
export function createPluginId(id: string): PluginId {
  if (!PLUGIN_ID_PATTERN.test(id) || id.length > 50) {
    throw new Error(`Invalid PluginId format: ${id}`);
  }
  return id as PluginId;
}

/**
 * Create a ChannelId from a string (format: type:id)
 */
export function createChannelId(id: string): ChannelId {
  if (!id.includes(':') || id.length < 3) {
    throw new Error(`Invalid ChannelId format: ${id}. Expected format: type:id`);
  }
  return id as ChannelId;
}

/**
 * Create a MessageId from a string
 */
export function createMessageId(id: string): MessageId {
  if (!id || id.length === 0) {
    throw new Error('MessageId cannot be empty');
  }
  return id as MessageId;
}

/**
 * Create an AuditEventId from a string (UUIDv7 format)
 */
export function createAuditEventId(id: string): AuditEventId {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`Invalid AuditEventId format: ${id}`);
  }
  return id as AuditEventId;
}

/**
 * Create a ToolId from a string
 */
export function createToolId(id: string): ToolId {
  if (!id || id.length === 0 || id.length > 100) {
    throw new Error('ToolId must be 1-100 characters');
  }
  return id as ToolId;
}

/**
 * Create a ConversationId from a string (UUID format)
 */
export function createConversationId(id: string): ConversationId {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`Invalid ConversationId format: ${id}`);
  }
  return id as ConversationId;
}

// ============================================
// Unsafe constructors (skip validation)
// Use only when you're certain the value is valid
// ============================================

export function unsafeUserId(id: string): UserId {
  return id as UserId;
}

export function unsafeSessionId(id: string): SessionId {
  return id as SessionId;
}

export function unsafePluginId(id: string): PluginId {
  return id as PluginId;
}

export function unsafeChannelId(id: string): ChannelId {
  return id as ChannelId;
}

export function unsafeMessageId(id: string): MessageId {
  return id as MessageId;
}

export function unsafeAuditEventId(id: string): AuditEventId {
  return id as AuditEventId;
}

export function unsafeToolId(id: string): ToolId {
  return id as ToolId;
}

export function unsafeConversationId(id: string): ConversationId {
  return id as ConversationId;
}
