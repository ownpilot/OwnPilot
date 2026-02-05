import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type { AuditEvent } from './events.js';
import type { AuditEventId } from '../types/branded.js';
import {
  verifyAuditLog,
  verifyEventChecksum,
  verifyEventChain,
  getAuditSummary,
  exportAuditLog,
} from './verify.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Compute the SHA-256 checksum that verify.ts expects for an event.
 * It strips `checksum` and `previousChecksum`, then hashes the JSON.
 */
function computeTestChecksum(event: Omit<AuditEvent, 'checksum' | 'previousChecksum'> & { checksum?: string; previousChecksum?: string }): string {
  const { checksum: _, previousChecksum: __, ...rest } = event;
  const hash = createHash('sha256');
  hash.update(JSON.stringify(rest));
  return hash.digest('hex');
}

/**
 * Build a single AuditEvent with a correct checksum.
 */
function buildEvent(
  overrides: Partial<Omit<AuditEvent, 'checksum'>> & { previousChecksum?: string } = {}
): AuditEvent {
  const base = {
    id: randomUUID() as AuditEventId,
    timestamp: new Date().toISOString(),
    type: 'system.start' as const,
    severity: 'info' as const,
    actor: { type: 'system' as const, id: 'system', name: 'OwnPilot' },
    resource: { type: 'system', id: 'gateway' },
    outcome: 'success' as const,
    details: {},
    previousChecksum: '',
    ...overrides,
  };

  // Compute checksum over everything except checksum & previousChecksum
  const checksum = computeTestChecksum(base);

  return { ...base, checksum } as unknown as AuditEvent;
}

/**
 * Build a valid chain of N audit events with proper hash linkage.
 */
function buildChain(count: number, options?: { typeOverride?: string; timestampBase?: Date }): AuditEvent[] {
  const events: AuditEvent[] = [];
  let previousChecksum = '';
  const baseTime = options?.timestampBase ?? new Date('2025-01-01T00:00:00.000Z');

  for (let i = 0; i < count; i++) {
    const ts = new Date(baseTime.getTime() + i * 60_000); // 1 minute apart
    const event = buildEvent({
      previousChecksum,
      timestamp: ts.toISOString(),
      type: (options?.typeOverride as AuditEvent['type']) ?? 'system.start',
    });
    events.push(event);
    previousChecksum = event.checksum;
  }
  return events;
}

/**
 * Serialise events to JSONL string.
 */
function toJSONL(events: AuditEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

let testDir: string;
let logPath: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `oaig-verify-test-${randomUUID()}`);
  await mkdir(testDir, { recursive: true });
  logPath = join(testDir, 'audit.jsonl');
});

afterEach(async () => {
  if (existsSync(testDir)) {
    await rm(testDir, { recursive: true, force: true });
  }
});

// ===========================================================================
// verifyEventChecksum
// ===========================================================================

describe('verifyEventChecksum', () => {
  it('returns true for an event with a correct checksum', () => {
    const event = buildEvent();
    expect(verifyEventChecksum(event)).toBe(true);
  });

  it('returns false when the event type has been tampered with', () => {
    const event = buildEvent();
    const tampered = { ...event, type: 'auth.login' } as AuditEvent;
    expect(verifyEventChecksum(tampered)).toBe(false);
  });

  it('returns false when the event details have been tampered with', () => {
    const event = buildEvent({ details: { action: 'original' } });
    const tampered = { ...event, details: { action: 'modified' } } as AuditEvent;
    expect(verifyEventChecksum(tampered)).toBe(false);
  });

  it('returns false when the event timestamp has been tampered with', () => {
    const event = buildEvent();
    const tampered = { ...event, timestamp: '2099-01-01T00:00:00.000Z' } as AuditEvent;
    expect(verifyEventChecksum(tampered)).toBe(false);
  });

  it('returns false when the event actor has been tampered with', () => {
    const event = buildEvent();
    const tampered = {
      ...event,
      actor: { type: 'user' as const, id: 'attacker', name: 'Hacker' },
    } as AuditEvent;
    expect(verifyEventChecksum(tampered)).toBe(false);
  });

  it('returns false when the event id has been tampered with', () => {
    const event = buildEvent();
    const tampered = { ...event, id: randomUUID() } as unknown as AuditEvent;
    expect(verifyEventChecksum(tampered)).toBe(false);
  });

  it('returns true when only checksum fields differ (they are excluded)', () => {
    // Build an event, then verify its checksum is correctly recomputed
    const event = buildEvent({ previousChecksum: 'abc123' });
    expect(verifyEventChecksum(event)).toBe(true);
  });

  it('uses SHA-256 for checksum computation', () => {
    const event = buildEvent();
    const { checksum: _, previousChecksum: __, ...rest } = event;
    const expected = createHash('sha256').update(JSON.stringify(rest)).digest('hex');
    expect(event.checksum).toBe(expected);
    expect(event.checksum).toHaveLength(64); // SHA-256 hex is 64 chars
  });
});

// ===========================================================================
// verifyEventChain
// ===========================================================================

describe('verifyEventChain', () => {
  it('returns true when current.previousChecksum equals previous.checksum', () => {
    const chain = buildChain(2);
    expect(verifyEventChain(chain[0], chain[1])).toBe(true);
  });

  it('returns false when chain is broken (wrong previousChecksum)', () => {
    const chain = buildChain(2);
    const broken = { ...chain[1], previousChecksum: 'wrong-hash' } as unknown as AuditEvent;
    expect(verifyEventChain(chain[0], broken)).toBe(false);
  });

  it('returns false when previous event checksum has been tampered', () => {
    const chain = buildChain(2);
    const tampered = { ...chain[0], checksum: 'tampered-checksum' } as unknown as AuditEvent;
    expect(verifyEventChain(tampered, chain[1])).toBe(false);
  });

  it('works correctly for a three-event chain', () => {
    const chain = buildChain(3);
    expect(verifyEventChain(chain[0], chain[1])).toBe(true);
    expect(verifyEventChain(chain[1], chain[2])).toBe(true);
    // Out of order should fail
    expect(verifyEventChain(chain[0], chain[2])).toBe(false);
  });

  it('returns true when first event has empty previousChecksum', () => {
    const chain = buildChain(1);
    // First event in chain always has previousChecksum = ''
    expect(chain[0].previousChecksum).toBe('');
  });
});

// ===========================================================================
// verifyAuditLog
// ===========================================================================

describe('verifyAuditLog', () => {
  it('returns valid result with 0 events for non-existent file', async () => {
    const result = await verifyAuditLog(join(testDir, 'does-not-exist.jsonl'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.totalEvents).toBe(0);
      expect(result.value.errors).toHaveLength(0);
    }
  });

  it('returns valid result for empty file', async () => {
    await writeFile(logPath, '');
    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.totalEvents).toBe(0);
      expect(result.value.errors).toHaveLength(0);
    }
  });

  it('returns valid result for file with only whitespace lines', async () => {
    await writeFile(logPath, '\n  \n\n');
    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.totalEvents).toBe(0);
    }
  });

  it('returns valid result for a correctly chained single event', async () => {
    const events = buildChain(1);
    await writeFile(logPath, toJSONL(events));

    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.totalEvents).toBe(1);
      expect(result.value.errors).toHaveLength(0);
      expect(result.value.firstEventAt).toBe(events[0].timestamp);
      expect(result.value.lastEventAt).toBe(events[0].timestamp);
    }
  });

  it('returns valid result for a correctly chained multi-event log', async () => {
    const events = buildChain(5);
    await writeFile(logPath, toJSONL(events));

    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.totalEvents).toBe(5);
      expect(result.value.errors).toHaveLength(0);
      expect(result.value.firstEventAt).toBe(events[0].timestamp);
      expect(result.value.lastEventAt).toBe(events[4].timestamp);
    }
  });

  it('detects broken hash chain (modified previousChecksum)', async () => {
    const events = buildChain(3);
    // Tamper with the second event's previousChecksum
    const tampered = { ...events[1], previousChecksum: 'tampered-hash' } as unknown as AuditEvent;
    const logEvents = [events[0], tampered, events[2]];
    await writeFile(logPath, toJSONL(logEvents));

    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      // Both the chain break AND the checksum mismatch for the tampered event
      expect(result.value.errors.length).toBeGreaterThanOrEqual(1);
      const chainError = result.value.errors.find((e) => e.error.includes('Chain break'));
      expect(chainError).toBeDefined();
    }
  });

  it('detects tampered event (modified checksum)', async () => {
    const events = buildChain(3);
    // Tamper with the first event's details without updating checksum
    const tampered = { ...events[0], details: { hacked: true } } as AuditEvent;
    const logEvents = [tampered, events[1], events[2]];
    await writeFile(logPath, toJSONL(logEvents));

    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      const checksumError = result.value.errors.find((e) => e.error.includes('checksum mismatch'));
      expect(checksumError).toBeDefined();
    }
  });

  it('handles malformed JSONL (invalid JSON on a line)', async () => {
    const events = buildChain(2);
    const lines = [JSON.stringify(events[0]), '{not valid json!!!', JSON.stringify(events[1])];
    await writeFile(logPath, lines.join('\n') + '\n');

    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      const jsonError = result.value.errors.find((e) => e.error.includes('Invalid JSON'));
      expect(jsonError).toBeDefined();
      expect(jsonError!.eventId).toBe('unknown');
      expect(jsonError!.line).toBe(2);
    }
  });

  it('reports correct line numbers for errors', async () => {
    const events = buildChain(1);
    const lines = [JSON.stringify(events[0]), '', '{bad json}'];
    await writeFile(logPath, lines.join('\n') + '\n');

    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const jsonError = result.value.errors.find((e) => e.error.includes('Invalid JSON'));
      expect(jsonError).toBeDefined();
      // Line 2 is blank (skipped), so bad json is line 3
      expect(jsonError!.line).toBe(3);
    }
  });

  it('verifies first event has empty previousChecksum', async () => {
    // Build an event where the first event has a non-empty previousChecksum
    const badFirst = buildEvent({ previousChecksum: 'should-be-empty' });
    await writeFile(logPath, JSON.stringify(badFirst) + '\n');

    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      const chainError = result.value.errors.find((e) => e.error.includes('Chain break'));
      expect(chainError).toBeDefined();
    }
  });

  it('reports multiple errors across the log', async () => {
    const events = buildChain(4);
    // Tamper with event 1 (details) and break chain on event 3
    const tampered1 = { ...events[1], details: { hacked: true } } as AuditEvent;
    const tampered3 = { ...events[3], previousChecksum: 'wrong' } as unknown as AuditEvent;
    const logEvents = [events[0], tampered1, events[2], tampered3];
    await writeFile(logPath, toJSONL(logEvents));

    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(false);
      // Should have at least 2 distinct errors (one for event 1 tampered, one for event 3 chain)
      expect(result.value.errors.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('correctly tracks firstEventAt and lastEventAt timestamps', async () => {
    const ts1 = '2025-01-01T00:00:00.000Z';
    const ts2 = '2025-06-15T12:30:00.000Z';
    const ts3 = '2025-12-31T23:59:59.000Z';

    let prevChecksum = '';
    const e1 = buildEvent({ timestamp: ts1, previousChecksum: prevChecksum });
    prevChecksum = e1.checksum;
    const e2 = buildEvent({ timestamp: ts2, previousChecksum: prevChecksum });
    prevChecksum = e2.checksum;
    const e3 = buildEvent({ timestamp: ts3, previousChecksum: prevChecksum });

    await writeFile(logPath, toJSONL([e1, e2, e3]));
    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.firstEventAt).toBe(ts1);
      expect(result.value.lastEventAt).toBe(ts3);
    }
  });

  it('counts only valid parsed events (not malformed lines)', async () => {
    const events = buildChain(2);
    const lines = [JSON.stringify(events[0]), 'not json', JSON.stringify(events[1])];
    await writeFile(logPath, lines.join('\n') + '\n');

    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Only 2 valid parsed events, not 3
      expect(result.value.totalEvents).toBe(2);
    }
  });

  it('handles a large chain of events', async () => {
    const events = buildChain(50);
    await writeFile(logPath, toJSONL(events));

    const result = await verifyAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.totalEvents).toBe(50);
      expect(result.value.errors).toHaveLength(0);
    }
  });
});

// ===========================================================================
// getAuditSummary
// ===========================================================================

describe('getAuditSummary', () => {
  it('returns summary with total events, date range, and valid status', async () => {
    const events = buildChain(3, { timestampBase: new Date('2025-03-01T00:00:00.000Z') });
    await writeFile(logPath, toJSONL(events));

    const result = await getAuditSummary(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalEvents).toBe(3);
      expect(result.value.firstEvent).toBe(events[0].timestamp);
      expect(result.value.lastEvent).toBe(events[2].timestamp);
      expect(result.value.isValid).toBe(true);
      expect(result.value.errorCount).toBe(0);
    }
  });

  it('returns invalid status for tampered log', async () => {
    const events = buildChain(2);
    const tampered = { ...events[1], details: { hacked: true } } as AuditEvent;
    await writeFile(logPath, toJSONL([events[0], tampered]));

    const result = await getAuditSummary(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isValid).toBe(false);
      expect(result.value.errorCount).toBeGreaterThan(0);
    }
  });

  it('handles empty log (no file)', async () => {
    const result = await getAuditSummary(join(testDir, 'nonexistent.jsonl'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalEvents).toBe(0);
      expect(result.value.isValid).toBe(true);
      expect(result.value.errorCount).toBe(0);
      expect(result.value.firstEvent).toBeUndefined();
      expect(result.value.lastEvent).toBeUndefined();
    }
  });

  it('handles empty file', async () => {
    await writeFile(logPath, '');
    const result = await getAuditSummary(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.totalEvents).toBe(0);
      expect(result.value.isValid).toBe(true);
    }
  });

  it('returns correct error count for multiple issues', async () => {
    const events = buildChain(3);
    // Break chain on second and third event
    const bad2 = { ...events[1], previousChecksum: 'bad', details: { hacked: true } } as unknown as AuditEvent;
    const bad3 = { ...events[2], previousChecksum: 'bad' } as unknown as AuditEvent;
    await writeFile(logPath, toJSONL([events[0], bad2, bad3]));

    const result = await getAuditSummary(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isValid).toBe(false);
      expect(result.value.errorCount).toBeGreaterThanOrEqual(2);
    }
  });
});

// ===========================================================================
// exportAuditLog
// ===========================================================================

describe('exportAuditLog', () => {
  it('returns empty array for non-existent file', async () => {
    const result = await exportAuditLog(join(testDir, 'missing.jsonl'));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([]);
    }
  });

  it('exports all events when no filter is provided', async () => {
    const events = buildChain(4);
    await writeFile(logPath, toJSONL(events));

    const result = await exportAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(4);
      expect(result.value[0].id).toBe(events[0].id);
      expect(result.value[3].id).toBe(events[3].id);
    }
  });

  it('filters by startDate (from)', async () => {
    const base = new Date('2025-01-01T00:00:00.000Z');
    const events = buildChain(5, { timestampBase: base });
    await writeFile(logPath, toJSONL(events));

    // Filter from 3 minutes after base (should skip first 3 events)
    const from = new Date(base.getTime() + 3 * 60_000);
    const result = await exportAuditLog(logPath, { from });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0].id).toBe(events[3].id);
      expect(result.value[1].id).toBe(events[4].id);
    }
  });

  it('filters by endDate (to)', async () => {
    const base = new Date('2025-01-01T00:00:00.000Z');
    const events = buildChain(5, { timestampBase: base });
    await writeFile(logPath, toJSONL(events));

    // Filter to 2 minutes after base (should include first 3 events: 0m, 1m, 2m)
    const to = new Date(base.getTime() + 2 * 60_000);
    const result = await exportAuditLog(logPath, { to });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
      expect(result.value[0].id).toBe(events[0].id);
      expect(result.value[2].id).toBe(events[2].id);
    }
  });

  it('filters by event type', async () => {
    // Build events with different types
    let prevChecksum = '';
    const e1 = buildEvent({ type: 'auth.login', previousChecksum: prevChecksum });
    prevChecksum = e1.checksum;
    const e2 = buildEvent({ type: 'system.start', previousChecksum: prevChecksum });
    prevChecksum = e2.checksum;
    const e3 = buildEvent({ type: 'auth.login', previousChecksum: prevChecksum });
    prevChecksum = e3.checksum;
    const e4 = buildEvent({ type: 'auth.logout', previousChecksum: prevChecksum });

    await writeFile(logPath, toJSONL([e1, e2, e3, e4]));

    const result = await exportAuditLog(logPath, { types: ['auth.login'] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value.every((e) => e.type === 'auth.login')).toBe(true);
    }
  });

  it('filters by multiple event types', async () => {
    let prevChecksum = '';
    const e1 = buildEvent({ type: 'auth.login', previousChecksum: prevChecksum });
    prevChecksum = e1.checksum;
    const e2 = buildEvent({ type: 'system.start', previousChecksum: prevChecksum });
    prevChecksum = e2.checksum;
    const e3 = buildEvent({ type: 'auth.logout', previousChecksum: prevChecksum });

    await writeFile(logPath, toJSONL([e1, e2, e3]));

    const result = await exportAuditLog(logPath, { types: ['auth.login', 'auth.logout'] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0].type).toBe('auth.login');
      expect(result.value[1].type).toBe('auth.logout');
    }
  });

  it('combines date range and type filters', async () => {
    const base = new Date('2025-01-01T00:00:00.000Z');
    let prevChecksum = '';

    const e1 = buildEvent({ type: 'auth.login', timestamp: new Date(base.getTime()).toISOString(), previousChecksum: prevChecksum });
    prevChecksum = e1.checksum;
    const e2 = buildEvent({ type: 'auth.login', timestamp: new Date(base.getTime() + 60_000).toISOString(), previousChecksum: prevChecksum });
    prevChecksum = e2.checksum;
    const e3 = buildEvent({ type: 'system.start', timestamp: new Date(base.getTime() + 2 * 60_000).toISOString(), previousChecksum: prevChecksum });
    prevChecksum = e3.checksum;
    const e4 = buildEvent({ type: 'auth.login', timestamp: new Date(base.getTime() + 3 * 60_000).toISOString(), previousChecksum: prevChecksum });

    await writeFile(logPath, toJSONL([e1, e2, e3, e4]));

    // Filter: from 1 minute, to 3 minutes, type auth.login
    const from = new Date(base.getTime() + 60_000);
    const to = new Date(base.getTime() + 3 * 60_000);
    const result = await exportAuditLog(logPath, { from, to, types: ['auth.login'] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0].id).toBe(e2.id);
      expect(result.value[1].id).toBe(e4.id);
    }
  });

  it('returns empty array when no events match filters', async () => {
    const events = buildChain(3, { timestampBase: new Date('2025-01-01T00:00:00.000Z') });
    await writeFile(logPath, toJSONL(events));

    const result = await exportAuditLog(logPath, { types: ['auth.failure'] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('returns empty array when date range excludes all events', async () => {
    const events = buildChain(3, { timestampBase: new Date('2025-01-01T00:00:00.000Z') });
    await writeFile(logPath, toJSONL(events));

    const from = new Date('2026-01-01T00:00:00.000Z');
    const result = await exportAuditLog(logPath, { from });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('skips malformed JSONL lines silently', async () => {
    const events = buildChain(2);
    const lines = [JSON.stringify(events[0]), '{bad json}', JSON.stringify(events[1])];
    await writeFile(logPath, lines.join('\n') + '\n');

    const result = await exportAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
    }
  });

  it('handles empty file', async () => {
    await writeFile(logPath, '');
    const result = await exportAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(0);
    }
  });

  it('exports events preserving all fields', async () => {
    const event = buildEvent({
      details: { key: 'value', nested: { a: 1 } },
      correlationId: 'corr-123',
    });
    await writeFile(logPath, JSON.stringify(event) + '\n');

    const result = await exportAuditLog(logPath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      const exported = result.value[0];
      expect(exported.id).toBe(event.id);
      expect(exported.type).toBe(event.type);
      expect(exported.details).toEqual({ key: 'value', nested: { a: 1 } });
      expect(exported.correlationId).toBe('corr-123');
      expect(exported.checksum).toBe(event.checksum);
      expect(exported.previousChecksum).toBe(event.previousChecksum);
    }
  });

  it('handles types filter with empty array (no filter applied)', async () => {
    const events = buildChain(3);
    await writeFile(logPath, toJSONL(events));

    const result = await exportAuditLog(logPath, { types: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(3);
    }
  });

  it('filters with from date equal to event timestamp (inclusive)', async () => {
    const base = new Date('2025-06-01T12:00:00.000Z');
    const events = buildChain(3, { timestampBase: base });
    await writeFile(logPath, toJSONL(events));

    // Use the exact timestamp of the second event
    const from = new Date(events[1].timestamp);
    const result = await exportAuditLog(logPath, { from });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Second event's timestamp is equal to from, so it should NOT be filtered out
      // (eventDate < from skips, so equal passes)
      expect(result.value).toHaveLength(2);
    }
  });

  it('filters with to date equal to event timestamp (inclusive)', async () => {
    const base = new Date('2025-06-01T12:00:00.000Z');
    const events = buildChain(3, { timestampBase: base });
    await writeFile(logPath, toJSONL(events));

    // Use the exact timestamp of the second event
    const to = new Date(events[1].timestamp);
    const result = await exportAuditLog(logPath, { to });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Second event's timestamp is equal to to, so it should NOT be filtered out
      // (eventDate > to skips, so equal passes)
      expect(result.value).toHaveLength(2);
    }
  });
});
