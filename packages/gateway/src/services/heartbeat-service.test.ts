/**
 * HeartbeatService Tests
 *
 * Tests for business logic, trigger sync, import/export, and validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeartbeatService, HeartbeatServiceError } from './heartbeat-service.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockEmit = vi.fn();
vi.mock('@ownpilot/core', () => ({
  getEventBus: () => ({ emit: mockEmit }),
  createEvent: vi.fn(
    (type: string, category: string, source: string, data: unknown) => ({
      type,
      category,
      source,
      data,
      timestamp: new Date().toISOString(),
    }),
  ),
  EventTypes: {
    RESOURCE_CREATED: 'resource.created',
    RESOURCE_UPDATED: 'resource.updated',
    RESOURCE_DELETED: 'resource.deleted',
  },
  getServiceRegistry: () => ({
    get: () => mockTriggerService,
  }),
  Services: { Trigger: 'trigger' },
  validateCronExpression: vi.fn((cron: string) => {
    // Simple validation: check 5 fields
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return { valid: false, error: 'Need 5 fields' };
    return { valid: true, nextFire: new Date() };
  }),
}));

const mockTriggerService = {
  createTrigger: vi.fn(async (_userId: string, input: Record<string, unknown>) => ({
    id: 'trigger-1',
    name: input.name,
    type: 'schedule',
    enabled: true,
    nextFire: new Date(),
  })),
  updateTrigger: vi.fn(async () => ({ id: 'trigger-1' })),
  deleteTrigger: vi.fn(async () => true),
};

const mockRepo = {
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getByTriggerId: vi.fn(),
  count: vi.fn(),
};

vi.mock('../db/repositories/heartbeats.js', () => ({
  HeartbeatsRepository: vi.fn(),
  createHeartbeatsRepository: () => mockRepo,
}));

// Mock log
vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeHeartbeat(overrides: Record<string, unknown> = {}) {
  return {
    id: 'hb-1',
    userId: 'user-1',
    name: 'Every morning at 08:00',
    scheduleText: 'Every Morning 8:00',
    cron: '0 8 * * *',
    taskDescription: 'Summarize my emails',
    triggerId: 'trigger-1',
    enabled: true,
    tags: [],
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HeartbeatService', () => {
  let service: HeartbeatService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Also reset mockRepo.get to clear any leftover mockResolvedValueOnce queue
    mockRepo.get.mockReset();
    service = new HeartbeatService();
  });

  // ========================================================================
  // createHeartbeat
  // ========================================================================

  describe('createHeartbeat', () => {
    it('creates a heartbeat with backing trigger', async () => {
      const hb = fakeHeartbeat();
      mockRepo.create.mockResolvedValue(hb);

      const result = await service.createHeartbeat('user-1', {
        scheduleText: 'Every Morning 8:00',
        taskDescription: 'Summarize my emails',
      });

      expect(result).toBe(hb);
      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith('user-1', expect.objectContaining({
        name: expect.stringContaining('[Heartbeat]'),
        type: 'schedule',
        config: { cron: '0 8 * * *' },
        action: { type: 'chat', payload: { prompt: 'Summarize my emails' } },
      }));
      expect(mockRepo.create).toHaveBeenCalledWith(expect.objectContaining({
        scheduleText: 'Every Morning 8:00',
        cron: '0 8 * * *',
        triggerId: 'trigger-1',
      }));
      expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'resource.created',
      }));
    });

    it('throws VALIDATION_ERROR when taskDescription is empty', async () => {
      await expect(
        service.createHeartbeat('user-1', { scheduleText: 'Every Hour', taskDescription: '' }),
      ).rejects.toThrow(/Task description is required/);
    });

    it('throws VALIDATION_ERROR when scheduleText is empty', async () => {
      await expect(
        service.createHeartbeat('user-1', { scheduleText: '', taskDescription: 'Do stuff' }),
      ).rejects.toThrow(/Schedule text is required/);
    });

    it('throws PARSE_ERROR for unparseable schedule', async () => {
      await expect(
        service.createHeartbeat('user-1', { scheduleText: 'whenever', taskDescription: 'Do stuff' }),
      ).rejects.toThrow(HeartbeatServiceError);
    });
  });

  // ========================================================================
  // updateHeartbeat
  // ========================================================================

  describe('updateHeartbeat', () => {
    it('updates heartbeat and syncs trigger', async () => {
      const existing = fakeHeartbeat();
      const updated = fakeHeartbeat({ taskDescription: 'Updated task' });
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.updateHeartbeat('user-1', 'hb-1', {
        taskDescription: 'Updated task',
      });

      expect(result).toBe(updated);
      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith('user-1', 'trigger-1', expect.objectContaining({
        action: { type: 'chat', payload: { prompt: 'Updated task' } },
      }));
      expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'resource.updated',
      }));
    });

    it('re-parses schedule when scheduleText changes', async () => {
      const existing = fakeHeartbeat();
      const updated = fakeHeartbeat({ scheduleText: 'Every Friday 17:00', cron: '0 17 * * 5' });
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(updated);

      await service.updateHeartbeat('user-1', 'hb-1', {
        scheduleText: 'Every Friday 17:00',
      });

      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith('user-1', 'trigger-1', expect.objectContaining({
        config: { cron: '0 17 * * 5' },
      }));
    });

    it('returns null when heartbeat not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const result = await service.updateHeartbeat('user-1', 'missing', { name: 'x' });
      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // deleteHeartbeat
  // ========================================================================

  describe('deleteHeartbeat', () => {
    it('deletes heartbeat and backing trigger', async () => {
      const existing = fakeHeartbeat();
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.delete.mockResolvedValue(true);

      const result = await service.deleteHeartbeat('user-1', 'hb-1');

      expect(result).toBe(true);
      expect(mockTriggerService.deleteTrigger).toHaveBeenCalledWith('user-1', 'trigger-1');
      expect(mockEmit).toHaveBeenCalledWith(expect.objectContaining({
        type: 'resource.deleted',
      }));
    });

    it('returns false when heartbeat not found', async () => {
      mockRepo.get.mockResolvedValue(null);
      const result = await service.deleteHeartbeat('user-1', 'missing');
      expect(result).toBe(false);
    });
  });

  // ========================================================================
  // importMarkdown / exportMarkdown
  // ========================================================================

  describe('importMarkdown', () => {
    it('imports valid entries from markdown', async () => {
      const hb = fakeHeartbeat();
      mockRepo.create.mockResolvedValue(hb);

      const md = `## Every Morning 8:00
Summarize my emails

## Every Friday 17:00
Generate report`;

      const result = await service.importMarkdown('user-1', md);

      expect(result.created).toBe(2);
      expect(result.heartbeats).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it('collects errors for invalid entries', async () => {
      const hb = fakeHeartbeat();
      mockRepo.create.mockResolvedValue(hb);

      const md = `## Every Morning 8:00
Valid task

## Nonsense schedule
Invalid task`;

      const result = await service.importMarkdown('user-1', md);

      expect(result.created).toBe(1);
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('exportMarkdown', () => {
    it('exports heartbeats as markdown', async () => {
      mockRepo.list.mockResolvedValue([
        fakeHeartbeat({ scheduleText: 'Every Morning 8:00', taskDescription: 'Task 1' }),
        fakeHeartbeat({ scheduleText: 'Every Friday 17:00', taskDescription: 'Task 2' }),
      ]);

      const result = await service.exportMarkdown('user-1');

      expect(result).toContain('## Every Morning 8:00');
      expect(result).toContain('Task 1');
      expect(result).toContain('## Every Friday 17:00');
      expect(result).toContain('Task 2');
    });

    it('returns empty string when no heartbeats', async () => {
      mockRepo.list.mockResolvedValue([]);
      const result = await service.exportMarkdown('user-1');
      expect(result).toBe('');
    });
  });

  // ========================================================================
  // Enable / Disable
  // ========================================================================

  describe('enable/disable', () => {
    it('enableHeartbeat delegates to updateHeartbeat', async () => {
      const hb = fakeHeartbeat({ enabled: true });
      mockRepo.get.mockResolvedValue(fakeHeartbeat({ enabled: false }));
      mockRepo.update.mockResolvedValue(hb);

      const result = await service.enableHeartbeat('user-1', 'hb-1');
      expect(result?.enabled).toBe(true);
    });
  });
});
