/**
 * Tamper-evident audit logger
 * - Append-only JSONL format
 * - Blockchain-like hash chain
 * - UUIDv7 for time-ordered event IDs
 */

import { appendFile, readFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { type Result, ok, err } from '../types/result.js';
import { createAuditEventId } from '../types/branded.js';
import { InternalError, ValidationError } from '../types/errors.js';
import { getLog } from '../services/get-log.js';
import { getErrorMessage } from '../services/error-utils.js';

const log = getLog('AuditLogger');
import {
  type AuditEvent,
  type AuditEventInput,
  type AuditQuery,
  type AuditSeverity,
  EVENT_SEVERITY,
  SEVERITY_ORDER,
} from './events.js';

/**
 * Audit logger configuration
 */
export interface AuditLoggerConfig {
  /** Path to audit log file */
  path: string;
  /** Minimum severity to log (default: debug) */
  minSeverity?: AuditSeverity;
  /** Maximum file size before rotation (default: 100MB) */
  maxFileSize?: number;
  /** Enable console output (default: false) */
  console?: boolean;
}

/**
 * Generate a UUIDv7 (time-ordered UUID)
 * Uses current timestamp + random bits for uniqueness
 */
function generateUUIDv7(): string {
  const timestamp = Date.now();

  // Get a random UUID and replace the first 48 bits with timestamp
  const uuid = randomUUID();
  const parts = uuid.split('-');

  // Convert timestamp to hex (48 bits = 12 hex chars)
  const timestampHex = timestamp.toString(16).padStart(12, '0');

  // Replace first two parts with timestamp
  parts[0] = timestampHex.slice(0, 8);
  parts[1] = timestampHex.slice(8, 12);

  // Set version to 7 (0111 in binary)
  const part2 = parts[2];
  if (part2) {
    parts[2] = '7' + part2.slice(1);
  }

  return parts.join('-');
}

/**
 * Compute SHA-256 checksum of an event (without checksum fields)
 */
function computeChecksum(event: Omit<AuditEvent, 'checksum' | 'previousChecksum'>): string {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(event));
  return hash.digest('hex');
}

/**
 * AuditLogger - Tamper-evident append-only logger
 */
export class AuditLogger {
  private readonly config: Required<AuditLoggerConfig>;
  private previousChecksum: string = '';
  private eventCount: number = 0;
  private initialized: boolean = false;

  constructor(config: AuditLoggerConfig) {
    this.config = {
      path: config.path,
      minSeverity: config.minSeverity ?? 'debug',
      maxFileSize: config.maxFileSize ?? 100 * 1024 * 1024, // 100MB
      console: config.console ?? false,
    };
  }

  /**
   * Initialize the logger (load last checksum if file exists)
   */
  async initialize(): Promise<Result<void, InternalError>> {
    if (this.initialized) {
      return ok(undefined);
    }

    try {
      // Ensure directory exists
      const dir = dirname(this.config.path);
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }

      // If file exists, read last event to get previous checksum
      if (existsSync(this.config.path)) {
        const lastEvent = await this.getLastEvent();
        if (lastEvent) {
          this.previousChecksum = lastEvent.checksum;
          this.eventCount = await this.countEvents();
        }
      }

      this.initialized = true;
      return ok(undefined);
    } catch (error) {
      return err(new InternalError(`Failed to initialize audit logger: ${error}`, { cause: error }));
    }
  }

  /**
   * Log an audit event
   */
  async log(input: AuditEventInput): Promise<Result<AuditEvent, InternalError | ValidationError>> {
    if (!this.initialized) {
      const initResult = await this.initialize();
      if (!initResult.ok) {
        return initResult;
      }
    }

    // Get severity (from input or default for event type)
    const severity = input.severity ?? EVENT_SEVERITY[input.type];

    // Check minimum severity
    if (SEVERITY_ORDER[severity] < SEVERITY_ORDER[this.config.minSeverity]) {
      // Below threshold, don't log but return a fake event
      const fakeEvent: AuditEvent = {
        id: createAuditEventId(generateUUIDv7()),
        timestamp: new Date().toISOString(),
        type: input.type,
        severity,
        actor: input.actor,
        resource: input.resource,
        outcome: input.outcome,
        details: input.details ?? {},
        correlationId: input.correlationId,
        parentId: input.parentId,
        checksum: '',
        previousChecksum: '',
      };
      return ok(fakeEvent);
    }

    // Build event without checksums
    const eventWithoutChecksum = {
      id: createAuditEventId(generateUUIDv7()),
      timestamp: new Date().toISOString(),
      type: input.type,
      severity,
      actor: input.actor,
      resource: input.resource,
      outcome: input.outcome,
      details: input.details ?? {},
      correlationId: input.correlationId,
      parentId: input.parentId,
    };

    // Compute checksum
    const checksum = computeChecksum(eventWithoutChecksum);

    // Build full event
    const event: AuditEvent = {
      ...eventWithoutChecksum,
      checksum,
      previousChecksum: this.previousChecksum,
    };

    try {
      // Check file size and rotate if needed
      await this.rotateIfNeeded();

      // Append to file (JSONL format)
      await appendFile(this.config.path, JSON.stringify(event) + '\n', 'utf-8');

      // Update state
      this.previousChecksum = checksum;
      this.eventCount++;

      // Console output if enabled
      if (this.config.console) {
        this.logToConsole(event);
      }

      return ok(event);
    } catch (error) {
      return err(new InternalError(`Failed to write audit event: ${error}`, { cause: error }));
    }
  }

  /**
   * Query audit events
   */
  async query(params: AuditQuery = {}): Promise<Result<AuditEvent[], InternalError>> {
    if (!existsSync(this.config.path)) {
      return ok([]);
    }

    try {
      const events: AuditEvent[] = [];
      const fileStream = createReadStream(this.config.path);
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      let _lineNumber = 0;
      let skipped = 0;

      for await (const line of rl) {
        _lineNumber++;
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line) as AuditEvent;

          // Apply filters
          if (!this.matchesQuery(event, params)) {
            continue;
          }

          // Handle offset
          if (params.offset && skipped < params.offset) {
            skipped++;
            continue;
          }

          events.push(event);

          // Handle limit
          if (params.limit && events.length >= params.limit) {
            break;
          }
        } catch {
          // Skip malformed lines
          continue;
        }
      }

      // Apply ordering (default: desc = newest first)
      if (params.order !== 'asc') {
        events.reverse();
      }

      return ok(events);
    } catch (error) {
      return err(new InternalError(`Failed to query audit log: ${error}`, { cause: error }));
    }
  }

  /**
   * Get total event count
   */
  async countEvents(): Promise<number> {
    if (!existsSync(this.config.path)) {
      return 0;
    }

    let count = 0;
    const fileStream = createReadStream(this.config.path);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (line.trim()) {
        count++;
      }
    }

    return count;
  }

  /**
   * Get the last event in the log
   */
  async getLastEvent(): Promise<AuditEvent | null> {
    if (!existsSync(this.config.path)) {
      return null;
    }

    const content = await readFile(this.config.path, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);

    if (lines.length === 0) {
      return null;
    }

    const lastLine = lines[lines.length - 1];
    if (!lastLine) {
      return null;
    }

    try {
      return JSON.parse(lastLine) as AuditEvent;
    } catch {
      return null;
    }
  }

  /**
   * Get current statistics
   */
  getStats(): { eventCount: number; lastChecksum: string } {
    return {
      eventCount: this.eventCount,
      lastChecksum: this.previousChecksum,
    };
  }

  /**
   * Check if event matches query parameters
   */
  private matchesQuery(event: AuditEvent, params: AuditQuery): boolean {
    // Type filter
    if (params.types && params.types.length > 0 && !params.types.includes(event.type)) {
      return false;
    }

    // Actor filters
    if (params.actorId && event.actor.id !== params.actorId) {
      return false;
    }
    if (params.actorType && event.actor.type !== params.actorType) {
      return false;
    }

    // Resource filters
    if (params.resourceId && event.resource.id !== params.resourceId) {
      return false;
    }
    if (params.resourceType && event.resource.type !== params.resourceType) {
      return false;
    }

    // Severity filter
    if (params.minSeverity && SEVERITY_ORDER[event.severity] < SEVERITY_ORDER[params.minSeverity]) {
      return false;
    }

    // Outcome filter
    if (params.outcome && event.outcome !== params.outcome) {
      return false;
    }

    // Date range filters
    if (params.from) {
      const eventDate = new Date(event.timestamp);
      if (eventDate < params.from) {
        return false;
      }
    }
    if (params.to) {
      const eventDate = new Date(event.timestamp);
      if (eventDate > params.to) {
        return false;
      }
    }

    // Correlation filter
    if (params.correlationId && event.correlationId !== params.correlationId) {
      return false;
    }

    return true;
  }

  /**
   * Rotate log file if it exceeds max size
   */
  private async rotateIfNeeded(): Promise<void> {
    if (!existsSync(this.config.path)) {
      return;
    }

    try {
      const stats = await stat(this.config.path);
      if (stats.size >= this.config.maxFileSize) {
        // Rename current file with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const rotatedPath = this.config.path.replace(/\.jsonl$/, '') + `.${timestamp}.jsonl`;

        const { rename } = await import('node:fs/promises');
        await rename(this.config.path, rotatedPath);

        // Reset state
        this.previousChecksum = '';
        this.eventCount = 0;
      }
    } catch (error) {
      log.warn('Log rotation failed:', getErrorMessage(error));
    }
  }

  /**
   * Log event to console (for development)
   */
  private logToConsole(event: AuditEvent): void {
    const colors: Record<AuditSeverity, string> = {
      debug: '\x1b[90m', // gray
      info: '\x1b[36m', // cyan
      warn: '\x1b[33m', // yellow
      error: '\x1b[31m', // red
      critical: '\x1b[35m', // magenta
    };
    const reset = '\x1b[0m';
    const color = colors[event.severity];

    const errorSuffix = event.details?.error ? ` error="${event.details.error}"` : '';
    log.info(
      `${color}[${event.severity.toUpperCase()}]${reset} ` +
        `${event.timestamp} ${event.type} ` +
        `actor=${event.actor.type}:${event.actor.id} ` +
        `resource=${event.resource.type}:${event.resource.id} ` +
        `outcome=${event.outcome}${errorSuffix}`
    );
  }
}

/**
 * Create an audit logger instance
 */
export function createAuditLogger(config: AuditLoggerConfig): AuditLogger {
  return new AuditLogger(config);
}
