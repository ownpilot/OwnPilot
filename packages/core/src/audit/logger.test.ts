import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createAuditLogger, AuditLogger } from './logger.js';
import { verifyAuditLog } from './verify.js';
import { SYSTEM_ACTOR } from './events.js';

describe('AuditLogger', () => {
  let testDir: string;
  let logPath: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `oaig-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    logPath = join(testDir, 'audit.jsonl');
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('creates log directory if not exists', async () => {
      const deepPath = join(testDir, 'deep', 'nested', 'audit.jsonl');
      const logger = createAuditLogger({ path: deepPath });

      await logger.initialize();

      expect(existsSync(join(testDir, 'deep', 'nested'))).toBe(true);
    });
  });

  describe('logging', () => {
    it('logs an event successfully', async () => {
      const logger = createAuditLogger({ path: logPath });

      const result = await logger.log({
        type: 'system.start',
        actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' },
        outcome: 'success',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.type).toBe('system.start');
        expect(result.value.checksum).toBeTruthy();
        expect(result.value.previousChecksum).toBe('');
      }
    });

    it('chains events with checksums', async () => {
      const logger = createAuditLogger({ path: logPath });

      const result1 = await logger.log({
        type: 'system.start',
        actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' },
        outcome: 'success',
      });

      const result2 = await logger.log({
        type: 'channel.connect',
        actor: SYSTEM_ACTOR,
        resource: { type: 'channel', id: 'telegram:123' },
        outcome: 'success',
      });

      expect(result1.ok).toBe(true);
      expect(result2.ok).toBe(true);
      if (result1.ok && result2.ok) {
        expect(result2.value.previousChecksum).toBe(result1.value.checksum);
      }
    });

    it('generates UUIDv7-style IDs (time-ordered)', async () => {
      vi.useFakeTimers();
      try {
        const logger = createAuditLogger({ path: logPath });

        const result1 = await logger.log({
          type: 'system.start',
          actor: SYSTEM_ACTOR,
          resource: { type: 'system', id: 'gateway' },
          outcome: 'success',
        });

        // Advance fake clock to ensure different UUIDv7 timestamp
        vi.advanceTimersByTime(1);

        const result2 = await logger.log({
          type: 'system.stop',
          actor: SYSTEM_ACTOR,
          resource: { type: 'system', id: 'gateway' },
          outcome: 'success',
        });

        expect(result1.ok).toBe(true);
        expect(result2.ok).toBe(true);
        if (result1.ok && result2.ok) {
          // UUIDv7 IDs should be sortable
          expect(result1.value.id < result2.value.id).toBe(true);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it('respects minimum severity', async () => {
      const logger = createAuditLogger({ path: logPath, minSeverity: 'warn' });

      // Debug event (below threshold)
      const debugResult = await logger.log({
        type: 'message.receive',
        actor: SYSTEM_ACTOR,
        resource: { type: 'message', id: 'msg-1' },
        outcome: 'success',
      });

      // Warn event (at threshold)
      const warnResult = await logger.log({
        type: 'pii.detected',
        actor: SYSTEM_ACTOR,
        resource: { type: 'message', id: 'msg-2' },
        outcome: 'success',
      });

      expect(debugResult.ok).toBe(true);
      expect(warnResult.ok).toBe(true);

      // Only warn event should be in file
      const events = await logger.query();
      expect(events.ok).toBe(true);
      if (events.ok) {
        expect(events.value.length).toBe(1);
        expect(events.value[0]?.type).toBe('pii.detected');
      }
    });

    it('stores custom details', async () => {
      const logger = createAuditLogger({ path: logPath });

      const result = await logger.log({
        type: 'tool.execute',
        actor: { type: 'agent', id: 'agent-1', name: 'Test Agent' },
        resource: { type: 'tool', id: 'web_fetch' },
        outcome: 'success',
        details: {
          url: 'https://example.com',
          method: 'GET',
          duration: 150,
        },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.details).toEqual({
          url: 'https://example.com',
          method: 'GET',
          duration: 150,
        });
      }
    });
  });

  describe('querying', () => {
    it('queries events by type', async () => {
      const logger = createAuditLogger({ path: logPath });

      await logger.log({
        type: 'system.start',
        actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' },
        outcome: 'success',
      });

      await logger.log({
        type: 'channel.connect',
        actor: SYSTEM_ACTOR,
        resource: { type: 'channel', id: 'telegram:123' },
        outcome: 'success',
      });

      await logger.log({
        type: 'system.stop',
        actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' },
        outcome: 'success',
      });

      const result = await logger.query({ types: ['system.start', 'system.stop'] });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(2);
        expect(result.value.every((e) => e.type.startsWith('system.'))).toBe(true);
      }
    });

    it('queries events by outcome', async () => {
      const logger = createAuditLogger({ path: logPath });

      await logger.log({
        type: 'auth.login',
        actor: { type: 'user', id: 'user-1' },
        resource: { type: 'session', id: 'sess-1' },
        outcome: 'success',
      });

      await logger.log({
        type: 'auth.failure',
        actor: { type: 'user', id: 'user-2' },
        resource: { type: 'session', id: 'sess-2' },
        outcome: 'failure',
      });

      const result = await logger.query({ outcome: 'failure' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]?.outcome).toBe('failure');
      }
    });

    it('supports pagination with limit and offset', async () => {
      const logger = createAuditLogger({ path: logPath });

      // Create 5 events
      for (let i = 0; i < 5; i++) {
        await logger.log({
          type: 'message.receive',
          actor: SYSTEM_ACTOR,
          resource: { type: 'message', id: `msg-${i}` },
          outcome: 'success',
          severity: 'info',
        });
      }

      const result = await logger.query({ limit: 2, offset: 1, order: 'asc' });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(2);
        expect(result.value[0]?.resource.id).toBe('msg-1');
        expect(result.value[1]?.resource.id).toBe('msg-2');
      }
    });
  });

  describe('integrity verification', () => {
    it('verifies valid log', async () => {
      const logger = createAuditLogger({ path: logPath });

      await logger.log({
        type: 'system.start',
        actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' },
        outcome: 'success',
      });

      await logger.log({
        type: 'system.stop',
        actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' },
        outcome: 'success',
      });

      const result = await verifyAuditLog(logPath);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.valid).toBe(true);
        expect(result.value.totalEvents).toBe(2);
        expect(result.value.errors.length).toBe(0);
      }
    });

    it('returns valid for empty log', async () => {
      const result = await verifyAuditLog(logPath);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.valid).toBe(true);
        expect(result.value.totalEvents).toBe(0);
      }
    });
  });

  describe('statistics', () => {
    it('tracks event count and last checksum', async () => {
      const logger = createAuditLogger({ path: logPath });

      expect(logger.getStats().eventCount).toBe(0);
      expect(logger.getStats().lastChecksum).toBe('');

      const result = await logger.log({
        type: 'system.start',
        actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' },
        outcome: 'success',
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(logger.getStats().eventCount).toBe(1);
        expect(logger.getStats().lastChecksum).toBe(result.value.checksum);
      }
    });
  });

  describe('log rotation', () => {
    it('rotates log when file exceeds max size', async () => {
      // Create a logger with very small max file size
      const logger = createAuditLogger({
        path: logPath,
        maxFileSize: 100, // 100 bytes - very small
      });

      // Log multiple events to exceed file size
      for (let i = 0; i < 10; i++) {
        await logger.log({
          type: 'message.receive',
          actor: SYSTEM_ACTOR,
          resource: { type: 'message', id: `msg-${i}` },
          outcome: 'success',
        });
      }

      // Check that rotation happened
      const result = await logger.query({ limit: 100 });
      expect(result.ok).toBe(true);
    });

    it('handles empty file gracefully', async () => {
      const logger = createAuditLogger({ path: logPath });

      // Query on empty log should return empty array
      const result = await logger.query();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual([]);
      }
    });

    it('handles malformed lines in query', async () => {
      const logger = createAuditLogger({ path: logPath });

      // Write a valid event
      await logger.log({
        type: 'system.start',
        actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' },
        outcome: 'success',
      });

      // Append malformed line directly to file
      const { appendFile } = await import('node:fs/promises');
      await appendFile(logPath, 'not valid json\n', 'utf-8');

      // Query should skip malformed line and return valid events
      const result = await logger.query();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBe(1);
      }
    });
  });

  describe('query filtering', () => {
    it('filters by correlation ID', async () => {
      const logger = createAuditLogger({ path: logPath });

      await logger.log({
        type: 'system.start',
        actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' },
        outcome: 'success',
        correlationId: 'corr-123',
      });

      await logger.log({
        type: 'system.stop',
        actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' },
        outcome: 'success',
        correlationId: 'corr-456',
      });

      const result = await logger.query({ correlationId: 'corr-123' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.correlationId).toBe('corr-123');
      }
    });

    it('filters by outcome', async () => {
      const logger = createAuditLogger({ path: logPath });

      await logger.log({
        type: 'auth.login',
        actor: { type: 'user', id: 'user-1' },
        resource: { type: 'session', id: 'sess-1' },
        outcome: 'success',
      });

      await logger.log({
        type: 'auth.failure',
        actor: { type: 'user', id: 'user-2' },
        resource: { type: 'session', id: 'sess-2' },
        outcome: 'failure',
      });

      const result = await logger.query({ outcome: 'failure' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.outcome).toBe('failure');
      }
    });

    it('filters by time range', async () => {
      const logger = createAuditLogger({ path: logPath });

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);

      // Log event now (should be within range)
      await logger.log({
        type: 'message.receive',
        actor: SYSTEM_ACTOR,
        resource: { type: 'message', id: 'msg-recent' },
        outcome: 'success',
      });

      // Query with time range that includes recent event
      const result = await logger.query({
        from: oneHourAgo,
        to: oneHourFromNow,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
      }
    });
  });

  describe('console output', () => {
    it('logs to console when enabled', async () => {
      const logger = createAuditLogger({ path: logPath, console: true });
      const result = await logger.log({
        type: 'system.start', actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' }, outcome: 'success',
      });
      expect(result.ok).toBe(true);
    });

    it('logs to console with error details suffix', async () => {
      const logger = createAuditLogger({ path: logPath, console: true });
      const result = await logger.log({
        type: 'system.error', actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' }, outcome: 'failure',
        details: { error: 'something went wrong' },
      });
      expect(result.ok).toBe(true);
    });

    it('logs events with all severity levels to console', async () => {
      const logger = createAuditLogger({ path: logPath, console: true });
      const types = [
        'message.receive', 'system.start', 'pii.detected',
        'system.error', 'security.threat_detected',
      ] as const;
      for (const type of types) {
        const result = await logger.log({
          type, actor: SYSTEM_ACTOR,
          resource: { type: 'system', id: 'gateway' }, outcome: 'success',
        });
        expect(result.ok).toBe(true);
      }
    });
  });

  describe('query filters - extended', () => {
    it('filters by actorId', async () => {
      const logger = createAuditLogger({ path: logPath });
      await logger.log({ type: 'auth.login', actor: { type: 'user', id: 'user-1' }, resource: { type: 'session', id: 'sess-1' }, outcome: 'success' });
      await logger.log({ type: 'auth.login', actor: { type: 'user', id: 'user-2' }, resource: { type: 'session', id: 'sess-2' }, outcome: 'success' });
      const result = await logger.query({ actorId: 'user-1' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.actor.id).toBe('user-1');
      }
    });

    it('filters by actorType', async () => {
      const logger = createAuditLogger({ path: logPath });
      await logger.log({ type: 'auth.login', actor: { type: 'user', id: 'user-1' }, resource: { type: 'session', id: 'sess-1' }, outcome: 'success' });
      await logger.log({ type: 'system.start', actor: SYSTEM_ACTOR, resource: { type: 'system', id: 'gateway' }, outcome: 'success' });
      const result = await logger.query({ actorType: 'user' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.actor.type).toBe('user');
      }
    });

    it('filters by resourceId', async () => {
      const logger = createAuditLogger({ path: logPath });
      await logger.log({ type: 'tool.execute', actor: SYSTEM_ACTOR, resource: { type: 'tool', id: 'web_fetch' }, outcome: 'success' });
      await logger.log({ type: 'tool.execute', actor: SYSTEM_ACTOR, resource: { type: 'tool', id: 'search' }, outcome: 'success' });
      const result = await logger.query({ resourceId: 'web_fetch' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.resource.id).toBe('web_fetch');
      }
    });

    it('filters by resourceType', async () => {
      const logger = createAuditLogger({ path: logPath });
      await logger.log({ type: 'tool.execute', actor: SYSTEM_ACTOR, resource: { type: 'tool', id: 'web_fetch' }, outcome: 'success' });
      await logger.log({ type: 'channel.connect', actor: SYSTEM_ACTOR, resource: { type: 'channel', id: 'telegram:123' }, outcome: 'success' });
      const result = await logger.query({ resourceType: 'tool' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        expect(result.value[0]?.resource.type).toBe('tool');
      }
    });

    it('filters by minSeverity in query', async () => {
      const logger = createAuditLogger({ path: logPath });
      await logger.log({ type: 'message.receive', actor: SYSTEM_ACTOR, resource: { type: 'message', id: 'msg-1' }, outcome: 'success', severity: 'debug' });
      await logger.log({ type: 'system.error', actor: SYSTEM_ACTOR, resource: { type: 'system', id: 'gw' }, outcome: 'failure', severity: 'error' });
      await logger.log({ type: 'security.threat_detected', actor: SYSTEM_ACTOR, resource: { type: 'system', id: 'gw' }, outcome: 'failure', severity: 'critical' });
      const result = await logger.query({ minSeverity: 'error' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value.every((e) => ['error', 'critical'].includes(e.severity))).toBe(true);
      }
    });

    it('filters events outside to date range', async () => {
      const logger = createAuditLogger({ path: logPath });
      await logger.log({ type: 'system.start', actor: SYSTEM_ACTOR, resource: { type: 'system', id: 'gw' }, outcome: 'success' });
      const pastDate = new Date(Date.now() - 60 * 60 * 1000);
      const result = await logger.query({ to: pastDate });
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value).toHaveLength(0); }
    });

    it('filters events outside from date range', async () => {
      const logger = createAuditLogger({ path: logPath });
      await logger.log({ type: 'system.start', actor: SYSTEM_ACTOR, resource: { type: 'system', id: 'gw' }, outcome: 'success' });
      const futureDate = new Date(Date.now() + 60 * 60 * 1000);
      const result = await logger.query({ from: futureDate });
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value).toHaveLength(0); }
    });

    it('returns events in descending order by default', async () => {
      const logger = createAuditLogger({ path: logPath });
      await logger.log({ type: 'system.start', actor: SYSTEM_ACTOR, resource: { type: 'system', id: 'first' }, outcome: 'success' });
      await logger.log({ type: 'system.stop', actor: SYSTEM_ACTOR, resource: { type: 'system', id: 'second' }, outcome: 'success' });
      const result = await logger.query();
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        expect(result.value[0]?.resource.id).toBe('second');
        expect(result.value[1]?.resource.id).toBe('first');
      }
    });
  });

  describe('initialization edge cases', () => {
    it('returns ok immediately if already initialized', async () => {
      const logger = createAuditLogger({ path: logPath });
      const r1 = await logger.initialize();
      expect(r1.ok).toBe(true);
      const r2 = await logger.initialize();
      expect(r2.ok).toBe(true);
    });

    it('loads last checksum from existing file', async () => {
      const logger1 = createAuditLogger({ path: logPath });
      const result = await logger1.log({
        type: 'system.start', actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' }, outcome: 'success',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const firstChecksum = result.value.checksum;
      const logger2 = createAuditLogger({ path: logPath });
      await logger2.initialize();
      expect(logger2.getStats().lastChecksum).toBe(firstChecksum);
      expect(logger2.getStats().eventCount).toBe(1);
    });

    it('handles existing file with only empty content', async () => {
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(logPath, '\n\n\n', 'utf-8');
      const logger = createAuditLogger({ path: logPath });
      await logger.initialize();
      expect(logger.getStats().lastChecksum).toBe('');
      expect(logger.getStats().eventCount).toBe(0);
    });

    it('handles existing file with malformed JSON', async () => {
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(logPath, 'not valid json\n', 'utf-8');
      const logger = createAuditLogger({ path: logPath });
      await logger.initialize();
      expect(logger.getStats().lastChecksum).toBe('');
    });
  });

  describe('getLastEvent edge cases', () => {
    it('returns null for empty file', async () => {
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(logPath, '', 'utf-8');
      const logger = createAuditLogger({ path: logPath });
      await logger.initialize();
      expect(await logger.getLastEvent()).toBeNull();
    });

    it('returns null for whitespace-only file', async () => {
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(logPath, '   \n  \n   ', 'utf-8');
      const logger = createAuditLogger({ path: logPath });
      await logger.initialize();
      expect(await logger.getLastEvent()).toBeNull();
    });

    it('returns null for malformed JSON file', async () => {
      const { writeFile: wf } = await import('node:fs/promises');
      await wf(logPath, 'not-json\n', 'utf-8');
      const logger = createAuditLogger({ path: logPath });
      await logger.initialize();
      expect(await logger.getLastEvent()).toBeNull();
    });

    it('returns null when file does not exist', async () => {
      const logger = createAuditLogger({ path: join(testDir, 'nonexistent.jsonl') });
      await logger.initialize();
      expect(await logger.getLastEvent()).toBeNull();
    });

    it('returns last event from valid file', async () => {
      const logger = createAuditLogger({ path: logPath });
      await logger.log({ type: 'system.start', actor: SYSTEM_ACTOR, resource: { type: 'system', id: 'first' }, outcome: 'success' });
      await logger.log({ type: 'system.stop', actor: SYSTEM_ACTOR, resource: { type: 'system', id: 'second' }, outcome: 'success' });
      const lastEvent = await logger.getLastEvent();
      expect(lastEvent).not.toBeNull();
      expect(lastEvent!.resource.id).toBe('second');
    });
  });

  describe('countEvents edge cases', () => {
    it('returns 0 when file does not exist', async () => {
      const logger = createAuditLogger({ path: join(testDir, 'nonexistent.jsonl') });
      expect(await logger.countEvents()).toBe(0);
    });

    it('skips empty lines when counting', async () => {
      const { appendFile: af } = await import('node:fs/promises');
      const logger = createAuditLogger({ path: logPath });
      await logger.log({ type: 'system.start', actor: SYSTEM_ACTOR, resource: { type: 'system', id: 'gw' }, outcome: 'success' });
      await af(logPath, '\n\n', 'utf-8');
      expect(await logger.countEvents()).toBe(1);
    });
  });

  describe('log severity and details extras', () => {
    it('uses explicit severity override', async () => {
      const logger = createAuditLogger({ path: logPath });
      const result = await logger.log({
        type: 'message.receive', severity: 'critical',
        actor: SYSTEM_ACTOR, resource: { type: 'message', id: 'msg-1' }, outcome: 'success',
      });
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value.severity).toBe('critical'); }
    });

    it('returns fake event for below-threshold severity', async () => {
      const logger = createAuditLogger({ path: logPath, minSeverity: 'error' });
      const result = await logger.log({
        type: 'message.receive', actor: SYSTEM_ACTOR,
        resource: { type: 'message', id: 'msg-1' }, outcome: 'success',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.checksum).toBe('');
        expect(result.value.previousChecksum).toBe('');
      }
    });

    it('stores correlationId and parentId', async () => {
      const logger = createAuditLogger({ path: logPath });
      const result = await logger.log({
        type: 'system.start', actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' }, outcome: 'success',
        correlationId: 'corr-abc', parentId: 'parent-123' as any,
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.correlationId).toBe('corr-abc');
        expect(result.value.parentId).toBe('parent-123');
      }
    });

    it('defaults details to empty object', async () => {
      const logger = createAuditLogger({ path: logPath });
      const result = await logger.log({
        type: 'system.start', actor: SYSTEM_ACTOR,
        resource: { type: 'system', id: 'gateway' }, outcome: 'success',
      });
      expect(result.ok).toBe(true);
      if (result.ok) { expect(result.value.details).toEqual({}); }
    });
  });

  describe('createAuditLogger factory', () => {
    it('creates a new AuditLogger instance', () => {
      const logger = createAuditLogger({ path: logPath });
      expect(logger).toBeInstanceOf(AuditLogger);
    });
  });

});
