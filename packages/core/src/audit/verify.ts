/**
 * Audit log integrity verification
 * Verifies the hash chain to detect tampering
 */

import { existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { type Result, ok, err } from '../types/result.js';
import { InternalError } from '../types/errors.js';
import { type AuditEvent, type AuditIntegrityResult } from './events.js';

/**
 * Compute checksum of an event (without checksum fields)
 */
function computeChecksum(event: AuditEvent): string {
  // Create a copy without checksum fields
  const { checksum: _, previousChecksum: __, ...eventWithoutChecksums } = event;
  const hash = createHash('sha256');
  hash.update(JSON.stringify(eventWithoutChecksums));
  return hash.digest('hex');
}

/**
 * Verify the integrity of an audit log file
 *
 * @param path - Path to the audit log file
 * @returns Verification result with any errors found
 */
export async function verifyAuditLog(
  path: string
): Promise<Result<AuditIntegrityResult, InternalError>> {
  if (!existsSync(path)) {
    return ok({
      valid: true,
      totalEvents: 0,
      errors: [],
    });
  }

  try {
    const errors: AuditIntegrityResult['errors'][number][] = [];
    let totalEvents = 0;
    let previousChecksum = '';
    let firstEventAt: string | undefined;
    let lastEventAt: string | undefined;

    const fileStream = createReadStream(path);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let lineNumber = 0;

    for await (const line of rl) {
      lineNumber++;
      if (!line.trim()) continue;

      let event: AuditEvent;
      try {
        event = JSON.parse(line) as AuditEvent;
      } catch (parseError) {
        errors.push({
          line: lineNumber,
          eventId: 'unknown',
          error: `Invalid JSON: ${parseError}`,
        });
        continue;
      }

      totalEvents++;

      // Track first/last timestamps
      if (!firstEventAt) {
        firstEventAt = event.timestamp;
      }
      lastEventAt = event.timestamp;

      // Verify chain continuity
      if (event.previousChecksum !== previousChecksum) {
        errors.push({
          line: lineNumber,
          eventId: event.id,
          error: 'Chain break: previousChecksum mismatch',
          expected: previousChecksum,
          actual: event.previousChecksum,
        });
      }

      // Verify event checksum
      const computedChecksum = computeChecksum(event);
      if (event.checksum !== computedChecksum) {
        errors.push({
          line: lineNumber,
          eventId: event.id,
          error: 'Event modified: checksum mismatch',
          expected: computedChecksum,
          actual: event.checksum,
        });
      }

      // Update for next iteration
      previousChecksum = event.checksum;
    }

    return ok({
      valid: errors.length === 0,
      totalEvents,
      firstEventAt,
      lastEventAt,
      errors,
    });
  } catch (error) {
    return err(new InternalError(`Failed to verify audit log: ${error}`, { cause: error }));
  }
}

/**
 * Verify a single event's checksum
 */
export function verifyEventChecksum(event: AuditEvent): boolean {
  const computedChecksum = computeChecksum(event);
  return event.checksum === computedChecksum;
}

/**
 * Verify that two consecutive events are properly chained
 */
export function verifyEventChain(previous: AuditEvent, current: AuditEvent): boolean {
  return current.previousChecksum === previous.checksum;
}

/**
 * Get a summary of audit log integrity
 */
export async function getAuditSummary(
  path: string
): Promise<
  Result<
    {
      totalEvents: number;
      firstEvent?: string;
      lastEvent?: string;
      isValid: boolean;
      errorCount: number;
    },
    InternalError
  >
> {
  const verifyResult = await verifyAuditLog(path);
  if (!verifyResult.ok) {
    return verifyResult;
  }

  const result = verifyResult.value;
  return ok({
    totalEvents: result.totalEvents,
    firstEvent: result.firstEventAt,
    lastEvent: result.lastEventAt,
    isValid: result.valid,
    errorCount: result.errors.length,
  });
}

/**
 * Export audit log to JSON array format
 */
export async function exportAuditLog(
  path: string,
  options: {
    from?: Date;
    to?: Date;
    types?: string[];
  } = {}
): Promise<Result<AuditEvent[], InternalError>> {
  if (!existsSync(path)) {
    return ok([]);
  }

  try {
    const events: AuditEvent[] = [];
    const fileStream = createReadStream(path);
    const rl = createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const event = JSON.parse(line) as AuditEvent;

        // Apply filters
        if (options.from) {
          const eventDate = new Date(event.timestamp);
          if (eventDate < options.from) continue;
        }
        if (options.to) {
          const eventDate = new Date(event.timestamp);
          if (eventDate > options.to) continue;
        }
        if (options.types && options.types.length > 0 && !options.types.includes(event.type)) {
          continue;
        }

        events.push(event);
      } catch {
        // Skip malformed lines
        continue;
      }
    }

    return ok(events);
  } catch (error) {
    return err(new InternalError(`Failed to export audit log: ${error}`, { cause: error }));
  }
}
