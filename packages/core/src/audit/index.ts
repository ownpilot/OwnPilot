/**
 * Audit module for OwnPilot
 * Tamper-evident logging with hash chain verification
 * @packageDocumentation
 */

// Event definitions
export {
  type AuditEventType,
  type AuditSeverity,
  type AuditActor,
  type AuditResource,
  type AuditOutcome,
  type AuditEvent,
  type AuditEventInput,
  type AuditQuery,
  type AuditIntegrityResult,
  SEVERITY_ORDER,
  EVENT_SEVERITY,
  SYSTEM_ACTOR,
} from './events.js';

// Logger
export {
  AuditLogger,
  createAuditLogger,
  type AuditLoggerConfig,
} from './logger.js';

// Verification
export {
  verifyAuditLog,
  verifyEventChecksum,
  verifyEventChain,
  getAuditSummary,
  exportAuditLog,
} from './verify.js';
