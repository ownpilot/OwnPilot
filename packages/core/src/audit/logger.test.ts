import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createAuditLogger } from './logger.js';
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
});
