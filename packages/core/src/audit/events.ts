/**
 * Audit event definitions
 * All security-relevant actions are logged with these types
 */

import type { AuditEventId } from '../types/branded.js';

/**
 * All possible audit event types
 */
export type AuditEventType =
  // Authentication
  | 'auth.login'
  | 'auth.logout'
  | 'auth.failure'
  | 'auth.token_refresh'
  | 'auth.token_revoke'
  // Sessions
  | 'session.create'
  | 'session.destroy'
  | 'session.timeout'
  // Messages
  | 'message.receive'
  | 'message.send'
  | 'message.delete'
  // Privacy/PII
  | 'pii.detected'
  | 'pii.redacted'
  | 'pii.logged' // Should never happen - indicates a bug
  // Plugins
  | 'plugin.install'
  | 'plugin.uninstall'
  | 'plugin.enable'
  | 'plugin.disable'
  | 'plugin.update'
  | 'plugin.invoke'
  | 'plugin.api_call'
  | 'plugin.permission_denied'
  | 'plugin.domain_blocked'
  | 'plugin.rate_limited'
  | 'plugin.timeout'
  | 'plugin.error'
  | 'plugin.storage_quota_exceeded'
  // Tools
  | 'tool.register'
  | 'tool.execute'
  | 'tool.success'
  | 'tool.error'
  // Configuration
  | 'config.change'
  | 'config.reload'
  // Channels
  | 'channel.connect'
  | 'channel.disconnect'
  | 'channel.error'
  | 'channel.message_receive'
  | 'channel.message_send'
  // Security
  | 'security.vault_unlock'
  | 'security.vault_lock'
  | 'security.key_rotate'
  | 'security.threat_detected'
  | 'security.audit_verify'
  // System
  | 'system.start'
  | 'system.stop'
  | 'system.error'
  | 'system.health_check';

/**
 * Severity levels (ordered from lowest to highest)
 */
export type AuditSeverity = 'debug' | 'info' | 'warn' | 'error' | 'critical';

/**
 * Severity level order for filtering
 */
export const SEVERITY_ORDER: Record<AuditSeverity, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

/**
 * Default severity for each event type
 */
export const EVENT_SEVERITY: Record<AuditEventType, AuditSeverity> = {
  // Auth
  'auth.login': 'info',
  'auth.logout': 'info',
  'auth.failure': 'warn',
  'auth.token_refresh': 'debug',
  'auth.token_revoke': 'info',
  // Sessions
  'session.create': 'info',
  'session.destroy': 'info',
  'session.timeout': 'info',
  // Messages
  'message.receive': 'debug',
  'message.send': 'debug',
  'message.delete': 'info',
  // Privacy
  'pii.detected': 'warn',
  'pii.redacted': 'info',
  'pii.logged': 'error',
  // Plugins
  'plugin.install': 'info',
  'plugin.uninstall': 'info',
  'plugin.enable': 'info',
  'plugin.disable': 'info',
  'plugin.update': 'info',
  'plugin.invoke': 'debug',
  'plugin.api_call': 'debug',
  'plugin.permission_denied': 'warn',
  'plugin.domain_blocked': 'warn',
  'plugin.rate_limited': 'warn',
  'plugin.timeout': 'warn',
  'plugin.error': 'error',
  'plugin.storage_quota_exceeded': 'warn',
  // Tools
  'tool.register': 'info',
  'tool.execute': 'debug',
  'tool.success': 'debug',
  'tool.error': 'error',
  // Config
  'config.change': 'info',
  'config.reload': 'info',
  // Channels
  'channel.connect': 'info',
  'channel.disconnect': 'info',
  'channel.error': 'error',
  'channel.message_receive': 'debug',
  'channel.message_send': 'debug',
  // Security
  'security.vault_unlock': 'info',
  'security.vault_lock': 'info',
  'security.key_rotate': 'info',
  'security.threat_detected': 'critical',
  'security.audit_verify': 'info',
  // System
  'system.start': 'info',
  'system.stop': 'info',
  'system.error': 'error',
  'system.health_check': 'debug',
};

/**
 * Actor that performed the action
 */
export interface AuditActor {
  readonly type: 'user' | 'system' | 'plugin' | 'channel' | 'agent';
  readonly id: string;
  readonly name?: string;
  readonly ip?: string;
}

/**
 * Resource that was affected
 */
export interface AuditResource {
  readonly type: string;
  readonly id: string;
  readonly name?: string;
}

/**
 * Outcome of the action
 */
export type AuditOutcome = 'success' | 'failure' | 'unknown';

/**
 * Full audit event structure
 */
export interface AuditEvent {
  /** Unique event ID (UUIDv7 - time-ordered) */
  readonly id: AuditEventId;
  /** ISO 8601 timestamp */
  readonly timestamp: string;
  /** Event type */
  readonly type: AuditEventType;
  /** Severity level */
  readonly severity: AuditSeverity;
  /** Who performed the action */
  readonly actor: AuditActor;
  /** What was affected */
  readonly resource: AuditResource;
  /** Result of the action */
  readonly outcome: AuditOutcome;
  /** Additional details (NEVER include PII) */
  readonly details: Record<string, unknown>;
  /** Correlation ID for tracing related events */
  readonly correlationId?: string;
  /** Parent event ID for nested operations */
  readonly parentId?: AuditEventId;
  /** SHA-256 checksum of the event (without checksum fields) */
  readonly checksum: string;
  /** Checksum of the previous event (hash chain) */
  readonly previousChecksum: string;
}

/**
 * Input for creating a new audit event
 */
export interface AuditEventInput {
  type: AuditEventType;
  actor: AuditActor;
  resource: AuditResource;
  outcome: AuditOutcome;
  details?: Record<string, unknown>;
  severity?: AuditSeverity;
  correlationId?: string;
  parentId?: AuditEventId;
}

/**
 * Query parameters for audit log search
 */
export interface AuditQuery {
  readonly types?: AuditEventType[];
  readonly actorId?: string;
  readonly actorType?: AuditActor['type'];
  readonly resourceId?: string;
  readonly resourceType?: string;
  readonly minSeverity?: AuditSeverity;
  readonly outcome?: AuditOutcome;
  readonly from?: Date;
  readonly to?: Date;
  readonly correlationId?: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly order?: 'asc' | 'desc';
}

/**
 * Result of integrity verification
 */
export interface AuditIntegrityResult {
  readonly valid: boolean;
  readonly totalEvents: number;
  readonly firstEventAt?: string;
  readonly lastEventAt?: string;
  readonly errors: ReadonlyArray<{
    line: number;
    eventId: string;
    error: string;
    expected?: string;
    actual?: string;
  }>;
}

/**
 * System actor (for system-generated events)
 */
export const SYSTEM_ACTOR: AuditActor = {
  type: 'system',
  id: 'system',
  name: 'OwnPilot',
};
