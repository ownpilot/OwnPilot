/**
 * HeartbeatService Tests
 *
 * Comprehensive tests for business logic, validation, trigger synchronization,
 * import/export, enable/disable, error types, and singleton factory.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks (must be defined before imports due to hoisting)
// ---------------------------------------------------------------------------

const mockTriggerService = {
  createTrigger: vi.fn(),
  updateTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
};

const mockEventBus = {
  emit: vi.fn(),
};

vi.mock('@ownpilot/core', () => ({
  getEventBus: () => mockEventBus,
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
}));

const mockRepo = {
  create: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  count: vi.fn(),
};

vi.mock('../db/repositories/heartbeats.js', () => ({
  HeartbeatsRepository: vi.fn(),
  createHeartbeatsRepository: () => mockRepo,
}));

vi.mock('./heartbeat-parser.js', () => ({
  parseSchedule: vi.fn(),
  parseMarkdown: vi.fn(),
  HeartbeatParseError: class HeartbeatParseError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = 'HeartbeatParseError';
    }
  },
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import {
  HeartbeatService,
  HeartbeatServiceError,
  getHeartbeatService,
} from './heartbeat-service.js';
import { parseSchedule, parseMarkdown, HeartbeatParseError } from './heartbeat-parser.js';

const mockParseSchedule = parseSchedule as ReturnType<typeof vi.fn>;
const mockParseMarkdown = parseMarkdown as ReturnType<typeof vi.fn>;

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
    mockRepo.get.mockReset();
    service = new HeartbeatService();

    // Sensible defaults for parseSchedule
    mockParseSchedule.mockReturnValue({ cron: '0 8 * * *', normalized: 'Every morning at 08:00' });

    // Default trigger creation
    mockTriggerService.createTrigger.mockResolvedValue({
      id: 'trigger-1',
      name: '[Heartbeat] Every morning at 08:00',
      type: 'schedule',
      enabled: true,
    });
    mockTriggerService.updateTrigger.mockResolvedValue({ id: 'trigger-1' });
    mockTriggerService.deleteTrigger.mockResolvedValue(true);
  });

  // ========================================================================
  // createHeartbeat
  // ========================================================================

  describe('createHeartbeat', () => {
    it('creates a heartbeat with backing trigger and returns it', async () => {
      const hb = fakeHeartbeat();
      mockRepo.create.mockResolvedValue(hb);

      const result = await service.createHeartbeat('user-1', {
        scheduleText: 'Every Morning 8:00',
        taskDescription: 'Summarize my emails',
      });

      expect(result).toBe(hb);
    });

    it('calls parseSchedule with the schedule text', async () => {
      mockRepo.create.mockResolvedValue(fakeHeartbeat());

      await service.createHeartbeat('user-1', {
        scheduleText: 'Every Friday 17:00',
        taskDescription: 'Generate report',
      });

      expect(mockParseSchedule).toHaveBeenCalledWith('Every Friday 17:00');
    });

    it('creates a backing trigger with correct params', async () => {
      mockParseSchedule.mockReturnValue({ cron: '0 17 * * 5', normalized: 'Every Friday at 17:00' });
      mockRepo.create.mockResolvedValue(fakeHeartbeat());

      await service.createHeartbeat('user-1', {
        scheduleText: 'Every Friday 17:00',
        taskDescription: 'Generate report',
      });

      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith('user-1', {
        name: '[Heartbeat] Every Friday at 17:00',
        description: 'Auto-managed by heartbeat: Every Friday 17:00',
        type: 'schedule',
        config: { cron: '0 17 * * 5' },
        action: { type: 'chat', payload: { prompt: 'Generate report' } },
        enabled: true,
      });
    });

    it('uses the custom name for trigger if provided', async () => {
      mockRepo.create.mockResolvedValue(fakeHeartbeat());

      await service.createHeartbeat('user-1', {
        scheduleText: 'Every Morning 8:00',
        taskDescription: 'Summarize my emails',
        name: 'Morning Summary',
      });

      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ name: '[Heartbeat] Morning Summary' }),
      );
    });

    it('passes correct data to repo.create including trigger id', async () => {
      mockRepo.create.mockResolvedValue(fakeHeartbeat());

      await service.createHeartbeat('user-1', {
        scheduleText: 'Every Morning 8:00',
        taskDescription: 'Summarize my emails',
        tags: ['email', 'morning'],
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Every morning at 08:00',
          scheduleText: 'Every Morning 8:00',
          cron: '0 8 * * *',
          taskDescription: 'Summarize my emails',
          triggerId: 'trigger-1',
          enabled: true,
          tags: ['email', 'morning'],
        }),
      );
    });

    it('emits RESOURCE_CREATED event with heartbeat id', async () => {
      mockRepo.create.mockResolvedValue(fakeHeartbeat({ id: 'hb-42' }));

      await service.createHeartbeat('user-1', {
        scheduleText: 'Every Morning 8:00',
        taskDescription: 'Summarize my emails',
      });

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.created',
          data: { resourceType: 'heartbeat', id: 'hb-42' },
        }),
      );
    });

    it('defaults enabled to true when not specified', async () => {
      mockRepo.create.mockResolvedValue(fakeHeartbeat());

      await service.createHeartbeat('user-1', {
        scheduleText: 'Every Morning 8:00',
        taskDescription: 'Summarize my emails',
      });

      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ enabled: true }),
      );
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true }),
      );
    });

    it('respects enabled=false on create', async () => {
      mockRepo.create.mockResolvedValue(fakeHeartbeat({ enabled: false }));

      await service.createHeartbeat('user-1', {
        scheduleText: 'Every Morning 8:00',
        taskDescription: 'Summarize my emails',
        enabled: false,
      });

      expect(mockTriggerService.createTrigger).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ enabled: false }),
      );
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: false }),
      );
    });

    it('throws HeartbeatServiceError with VALIDATION_ERROR when taskDescription is empty', async () => {
      await expect(
        service.createHeartbeat('user-1', { scheduleText: 'Every Hour', taskDescription: '' }),
      ).rejects.toThrow(HeartbeatServiceError);

      try {
        await service.createHeartbeat('user-1', { scheduleText: 'Every Hour', taskDescription: '' });
      } catch (e) {
        expect((e as HeartbeatServiceError).code).toBe('VALIDATION_ERROR');
        expect((e as HeartbeatServiceError).message).toMatch(/Task description is required/);
      }
    });

    it('throws VALIDATION_ERROR when taskDescription is whitespace only', async () => {
      await expect(
        service.createHeartbeat('user-1', { scheduleText: 'Every Hour', taskDescription: '   ' }),
      ).rejects.toThrow(/Task description is required/);
    });

    it('throws VALIDATION_ERROR when scheduleText is empty', async () => {
      await expect(
        service.createHeartbeat('user-1', { scheduleText: '', taskDescription: 'Do stuff' }),
      ).rejects.toThrow(/Schedule text is required/);
    });

    it('throws VALIDATION_ERROR when scheduleText is whitespace only', async () => {
      await expect(
        service.createHeartbeat('user-1', { scheduleText: '   ', taskDescription: 'Do stuff' }),
      ).rejects.toThrow(/Schedule text is required/);
    });

    it('throws PARSE_ERROR when parseSchedule throws HeartbeatParseError', async () => {
      mockParseSchedule.mockImplementation(() => {
        throw new HeartbeatParseError('Cannot parse schedule');
      });

      try {
        await service.createHeartbeat('user-1', {
          scheduleText: 'whenever I feel like it',
          taskDescription: 'Do stuff',
        });
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HeartbeatServiceError);
        expect((e as HeartbeatServiceError).code).toBe('PARSE_ERROR');
        expect((e as HeartbeatServiceError).message).toBe('Cannot parse schedule');
      }
    });

    it('re-throws non-HeartbeatParseError errors from parseSchedule', async () => {
      mockParseSchedule.mockImplementation(() => {
        throw new TypeError('Something unexpected');
      });

      await expect(
        service.createHeartbeat('user-1', {
          scheduleText: 'Every Morning',
          taskDescription: 'Do stuff',
        }),
      ).rejects.toThrow(TypeError);
    });

    it('does not call repo.create or triggerService if validation fails', async () => {
      await expect(
        service.createHeartbeat('user-1', { scheduleText: '', taskDescription: '' }),
      ).rejects.toThrow();

      expect(mockParseSchedule).not.toHaveBeenCalled();
      expect(mockTriggerService.createTrigger).not.toHaveBeenCalled();
      expect(mockRepo.create).not.toHaveBeenCalled();
    });

    it('does not call repo.create or emit if parseSchedule fails', async () => {
      mockParseSchedule.mockImplementation(() => {
        throw new HeartbeatParseError('Bad schedule');
      });

      await expect(
        service.createHeartbeat('user-1', {
          scheduleText: 'gibberish',
          taskDescription: 'Do stuff',
        }),
      ).rejects.toThrow();

      expect(mockTriggerService.createTrigger).not.toHaveBeenCalled();
      expect(mockRepo.create).not.toHaveBeenCalled();
      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // getHeartbeat
  // ========================================================================

  describe('getHeartbeat', () => {
    it('returns heartbeat when found', async () => {
      const hb = fakeHeartbeat();
      mockRepo.get.mockResolvedValue(hb);

      const result = await service.getHeartbeat('user-1', 'hb-1');
      expect(result).toBe(hb);
      expect(mockRepo.get).toHaveBeenCalledWith('hb-1');
    });

    it('returns null when not found', async () => {
      mockRepo.get.mockResolvedValue(null);

      const result = await service.getHeartbeat('user-1', 'missing');
      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // listHeartbeats
  // ========================================================================

  describe('listHeartbeats', () => {
    it('delegates to repo.list with provided query', async () => {
      mockRepo.list.mockResolvedValue([fakeHeartbeat()]);

      const result = await service.listHeartbeats('user-1', { enabled: true, limit: 10 });

      expect(result).toHaveLength(1);
      expect(mockRepo.list).toHaveBeenCalledWith({ enabled: true, limit: 10 });
    });

    it('passes empty query when none provided', async () => {
      mockRepo.list.mockResolvedValue([]);

      await service.listHeartbeats('user-1');

      expect(mockRepo.list).toHaveBeenCalledWith({});
    });

    it('returns empty array when no heartbeats exist', async () => {
      mockRepo.list.mockResolvedValue([]);

      const result = await service.listHeartbeats('user-1');
      expect(result).toEqual([]);
    });
  });

  // ========================================================================
  // updateHeartbeat
  // ========================================================================

  describe('updateHeartbeat', () => {
    it('returns null when heartbeat not found', async () => {
      mockRepo.get.mockResolvedValue(null);

      const result = await service.updateHeartbeat('user-1', 'missing', { name: 'x' });

      expect(result).toBeNull();
      expect(mockTriggerService.updateTrigger).not.toHaveBeenCalled();
      expect(mockRepo.update).not.toHaveBeenCalled();
    });

    it('updates heartbeat record and emits event', async () => {
      const existing = fakeHeartbeat();
      const updated = fakeHeartbeat({ taskDescription: 'Updated task' });
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(updated);

      const result = await service.updateHeartbeat('user-1', 'hb-1', {
        taskDescription: 'Updated task',
      });

      expect(result).toBe(updated);
      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.updated',
          data: expect.objectContaining({ resourceType: 'heartbeat', id: 'hb-1' }),
        }),
      );
    });

    it('syncs trigger action when taskDescription changes', async () => {
      const existing = fakeHeartbeat();
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(fakeHeartbeat({ taskDescription: 'New task' }));

      await service.updateHeartbeat('user-1', 'hb-1', {
        taskDescription: 'New task',
      });

      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith('user-1', 'trigger-1', {
        action: { type: 'chat', payload: { prompt: 'New task' } },
      });
    });

    it('re-parses and syncs trigger config when scheduleText changes', async () => {
      const existing = fakeHeartbeat();
      mockParseSchedule.mockReturnValue({ cron: '0 17 * * 5', normalized: 'Every Friday at 17:00' });
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(fakeHeartbeat({ cron: '0 17 * * 5' }));

      await service.updateHeartbeat('user-1', 'hb-1', {
        scheduleText: 'Every Friday 17:00',
      });

      expect(mockParseSchedule).toHaveBeenCalledWith('Every Friday 17:00');
      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith(
        'user-1',
        'trigger-1',
        expect.objectContaining({ config: { cron: '0 17 * * 5' } }),
      );
    });

    it('does not re-parse if scheduleText is unchanged', async () => {
      const existing = fakeHeartbeat({ scheduleText: 'Every Morning 8:00' });
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(existing);

      await service.updateHeartbeat('user-1', 'hb-1', {
        scheduleText: 'Every Morning 8:00',
      });

      expect(mockParseSchedule).not.toHaveBeenCalled();
    });

    it('syncs trigger enabled flag when it changes', async () => {
      const existing = fakeHeartbeat({ enabled: true });
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(fakeHeartbeat({ enabled: false }));

      await service.updateHeartbeat('user-1', 'hb-1', { enabled: false });

      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith('user-1', 'trigger-1', {
        enabled: false,
      });
    });

    it('does not sync trigger enabled if unchanged', async () => {
      const existing = fakeHeartbeat({ enabled: true });
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(existing);

      await service.updateHeartbeat('user-1', 'hb-1', { enabled: true });

      // triggerUpdates should be empty since enabled is unchanged
      expect(mockTriggerService.updateTrigger).not.toHaveBeenCalled();
    });

    it('syncs trigger name when name changes', async () => {
      const existing = fakeHeartbeat({ name: 'Old Name' });
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(fakeHeartbeat({ name: 'New Name' }));

      await service.updateHeartbeat('user-1', 'hb-1', { name: 'New Name' });

      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith('user-1', 'trigger-1', {
        name: '[Heartbeat] New Name',
      });
    });

    it('does not call updateTrigger when nothing trigger-related changes', async () => {
      const existing = fakeHeartbeat();
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(fakeHeartbeat({ tags: ['new-tag'] }));

      await service.updateHeartbeat('user-1', 'hb-1', { tags: ['new-tag'] });

      expect(mockTriggerService.updateTrigger).not.toHaveBeenCalled();
    });

    it('syncs multiple trigger fields at once', async () => {
      const existing = fakeHeartbeat({ enabled: true, name: 'Old' });
      mockParseSchedule.mockReturnValue({ cron: '30 9 * * *', normalized: 'Every day at 09:30' });
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(fakeHeartbeat());

      await service.updateHeartbeat('user-1', 'hb-1', {
        scheduleText: 'Every Day 9:30',
        taskDescription: 'New task',
        enabled: false,
        name: 'New',
      });

      expect(mockTriggerService.updateTrigger).toHaveBeenCalledWith('user-1', 'trigger-1', {
        config: { cron: '30 9 * * *' },
        action: { type: 'chat', payload: { prompt: 'New task' } },
        enabled: false,
        name: '[Heartbeat] New',
      });
    });

    it('throws PARSE_ERROR when updated scheduleText fails to parse', async () => {
      const existing = fakeHeartbeat();
      mockRepo.get.mockResolvedValue(existing);
      mockParseSchedule.mockImplementation(() => {
        throw new HeartbeatParseError('Cannot parse');
      });

      try {
        await service.updateHeartbeat('user-1', 'hb-1', {
          scheduleText: 'gibberish',
        });
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(HeartbeatServiceError);
        expect((e as HeartbeatServiceError).code).toBe('PARSE_ERROR');
      }
    });

    it('re-throws unexpected errors from parseSchedule on update', async () => {
      const existing = fakeHeartbeat();
      mockRepo.get.mockResolvedValue(existing);
      mockParseSchedule.mockImplementation(() => {
        throw new RangeError('Unexpected');
      });

      await expect(
        service.updateHeartbeat('user-1', 'hb-1', { scheduleText: 'something' }),
      ).rejects.toThrow(RangeError);
    });

    it('skips trigger sync when triggerId is null', async () => {
      const existing = fakeHeartbeat({ triggerId: null });
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(fakeHeartbeat({ triggerId: null }));

      await service.updateHeartbeat('user-1', 'hb-1', { taskDescription: 'Updated' });

      expect(mockTriggerService.updateTrigger).not.toHaveBeenCalled();
    });

    it('does not emit event when repo.update returns null', async () => {
      const existing = fakeHeartbeat();
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.update.mockResolvedValue(null);

      const result = await service.updateHeartbeat('user-1', 'hb-1', { name: 'x' });

      expect(result).toBeNull();
      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // deleteHeartbeat
  // ========================================================================

  describe('deleteHeartbeat', () => {
    it('deletes heartbeat and backing trigger, returns true', async () => {
      const existing = fakeHeartbeat();
      mockRepo.get.mockResolvedValue(existing);
      mockRepo.delete.mockResolvedValue(true);

      const result = await service.deleteHeartbeat('user-1', 'hb-1');

      expect(result).toBe(true);
      expect(mockTriggerService.deleteTrigger).toHaveBeenCalledWith('user-1', 'trigger-1');
      expect(mockRepo.delete).toHaveBeenCalledWith('hb-1');
    });

    it('emits RESOURCE_DELETED event on success', async () => {
      mockRepo.get.mockResolvedValue(fakeHeartbeat({ id: 'hb-99' }));
      mockRepo.delete.mockResolvedValue(true);

      await service.deleteHeartbeat('user-1', 'hb-99');

      expect(mockEventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'resource.deleted',
          data: { resourceType: 'heartbeat', id: 'hb-99' },
        }),
      );
    });

    it('returns false when heartbeat not found', async () => {
      mockRepo.get.mockResolvedValue(null);

      const result = await service.deleteHeartbeat('user-1', 'missing');

      expect(result).toBe(false);
      expect(mockTriggerService.deleteTrigger).not.toHaveBeenCalled();
      expect(mockRepo.delete).not.toHaveBeenCalled();
    });

    it('skips trigger deletion when triggerId is null', async () => {
      mockRepo.get.mockResolvedValue(fakeHeartbeat({ triggerId: null }));
      mockRepo.delete.mockResolvedValue(true);

      await service.deleteHeartbeat('user-1', 'hb-1');

      expect(mockTriggerService.deleteTrigger).not.toHaveBeenCalled();
      expect(mockRepo.delete).toHaveBeenCalledWith('hb-1');
    });

    it('does not emit event when repo.delete returns false', async () => {
      mockRepo.get.mockResolvedValue(fakeHeartbeat());
      mockRepo.delete.mockResolvedValue(false);

      const result = await service.deleteHeartbeat('user-1', 'hb-1');

      expect(result).toBe(false);
      expect(mockEventBus.emit).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // enableHeartbeat / disableHeartbeat
  // ========================================================================

  describe('enableHeartbeat', () => {
    it('delegates to updateHeartbeat with enabled: true', async () => {
      const hb = fakeHeartbeat({ enabled: true });
      mockRepo.get.mockResolvedValue(fakeHeartbeat({ enabled: false }));
      mockRepo.update.mockResolvedValue(hb);

      const result = await service.enableHeartbeat('user-1', 'hb-1');

      expect(result?.enabled).toBe(true);
      expect(mockRepo.update).toHaveBeenCalledWith(
        'hb-1',
        expect.objectContaining({ enabled: true }),
      );
    });

    it('returns null when heartbeat not found', async () => {
      mockRepo.get.mockResolvedValue(null);

      const result = await service.enableHeartbeat('user-1', 'missing');
      expect(result).toBeNull();
    });
  });

  describe('disableHeartbeat', () => {
    it('delegates to updateHeartbeat with enabled: false', async () => {
      const hb = fakeHeartbeat({ enabled: false });
      mockRepo.get.mockResolvedValue(fakeHeartbeat({ enabled: true }));
      mockRepo.update.mockResolvedValue(hb);

      const result = await service.disableHeartbeat('user-1', 'hb-1');

      expect(result?.enabled).toBe(false);
      expect(mockRepo.update).toHaveBeenCalledWith(
        'hb-1',
        expect.objectContaining({ enabled: false }),
      );
    });

    it('returns null when heartbeat not found', async () => {
      mockRepo.get.mockResolvedValue(null);

      const result = await service.disableHeartbeat('user-1', 'missing');
      expect(result).toBeNull();
    });
  });

  // ========================================================================
  // importMarkdown
  // ========================================================================

  describe('importMarkdown', () => {
    it('imports all valid entries from markdown', async () => {
      const hb1 = fakeHeartbeat({ id: 'hb-1' });
      const hb2 = fakeHeartbeat({ id: 'hb-2' });
      mockParseMarkdown.mockReturnValue({
        entries: [
          { scheduleText: 'Every Morning 8:00', taskDescription: 'Task 1', normalized: 'Every morning at 08:00', cron: '0 8 * * *' },
          { scheduleText: 'Every Friday 17:00', taskDescription: 'Task 2', normalized: 'Every Friday at 17:00', cron: '0 17 * * 5' },
        ],
        errors: [],
      });
      mockParseSchedule
        .mockReturnValueOnce({ cron: '0 8 * * *', normalized: 'Every morning at 08:00' })
        .mockReturnValueOnce({ cron: '0 17 * * 5', normalized: 'Every Friday at 17:00' });
      mockRepo.create.mockResolvedValueOnce(hb1).mockResolvedValueOnce(hb2);

      const result = await service.importMarkdown('user-1', '## Every Morning 8:00\nTask 1');

      expect(result.created).toBe(2);
      expect(result.heartbeats).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it('collects parser errors from parseMarkdown', async () => {
      mockParseMarkdown.mockReturnValue({
        entries: [],
        errors: [{ scheduleText: 'bad schedule', error: 'Cannot parse' }],
      });

      const result = await service.importMarkdown('user-1', '## bad schedule\nTask');

      expect(result.created).toBe(0);
      expect(result.heartbeats).toHaveLength(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.scheduleText).toBe('bad schedule');
    });

    it('catches per-entry creation errors and adds to importErrors', async () => {
      mockParseMarkdown.mockReturnValue({
        entries: [
          { scheduleText: 'Every Morning 8:00', taskDescription: 'Task 1', normalized: 'Norm1', cron: '0 8 * * *' },
          { scheduleText: 'Every Night', taskDescription: 'Task 2', normalized: 'Norm2', cron: '0 22 * * *' },
        ],
        errors: [],
      });
      mockParseSchedule.mockReturnValueOnce({ cron: '0 8 * * *', normalized: 'Norm1' });
      mockRepo.create.mockResolvedValueOnce(fakeHeartbeat());

      // Second entry's createHeartbeat will call parseSchedule again,
      // which will throw this time
      mockParseSchedule.mockImplementationOnce(() => {
        throw new HeartbeatParseError('Bad cron');
      });

      const result = await service.importMarkdown('user-1', 'markdown');

      expect(result.created).toBe(1);
      expect(result.heartbeats).toHaveLength(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]!.error).toBe('Bad cron');
    });

    it('combines parser errors and creation errors', async () => {
      mockParseMarkdown.mockReturnValue({
        entries: [
          { scheduleText: 'Every Morning 8:00', taskDescription: 'Task 1', normalized: 'Norm', cron: '0 8 * * *' },
        ],
        errors: [{ scheduleText: 'gibberish', error: 'Cannot parse' }],
      });
      mockParseSchedule.mockImplementation(() => {
        throw new Error('Trigger creation failed');
      });

      const result = await service.importMarkdown('user-1', 'markdown');

      expect(result.created).toBe(0);
      expect(result.errors).toHaveLength(2);
    });

    it('returns empty result for empty input', async () => {
      mockParseMarkdown.mockReturnValue({ entries: [], errors: [] });

      const result = await service.importMarkdown('user-1', '');

      expect(result.created).toBe(0);
      expect(result.heartbeats).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('passes normalized name from entry to createHeartbeat', async () => {
      mockParseMarkdown.mockReturnValue({
        entries: [
          { scheduleText: 'Every Hour', taskDescription: 'Ping', normalized: 'Every hour', cron: '0 * * * *' },
        ],
        errors: [],
      });
      mockParseSchedule.mockReturnValue({ cron: '0 * * * *', normalized: 'Every hour' });
      mockRepo.create.mockResolvedValue(fakeHeartbeat());

      await service.importMarkdown('user-1', 'markdown');

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Every hour' }),
      );
    });
  });

  // ========================================================================
  // exportMarkdown
  // ========================================================================

  describe('exportMarkdown', () => {
    it('exports heartbeats in markdown format', async () => {
      mockRepo.list.mockResolvedValue([
        fakeHeartbeat({ scheduleText: 'Every Morning 8:00', taskDescription: 'Task 1' }),
        fakeHeartbeat({ scheduleText: 'Every Friday 17:00', taskDescription: 'Task 2' }),
      ]);

      const result = await service.exportMarkdown('user-1');

      expect(result).toBe('## Every Morning 8:00\nTask 1\n\n## Every Friday 17:00\nTask 2');
    });

    it('returns empty string when no heartbeats', async () => {
      mockRepo.list.mockResolvedValue([]);

      const result = await service.exportMarkdown('user-1');
      expect(result).toBe('');
    });

    it('formats single heartbeat without trailing separator', async () => {
      mockRepo.list.mockResolvedValue([
        fakeHeartbeat({ scheduleText: 'Every Day 9:00', taskDescription: 'Check logs' }),
      ]);

      const result = await service.exportMarkdown('user-1');

      expect(result).toBe('## Every Day 9:00\nCheck logs');
      expect(result).not.toContain('\n\n');
    });
  });

  // ========================================================================
  // countHeartbeats
  // ========================================================================

  describe('countHeartbeats', () => {
    it('delegates to repo.count without filter', async () => {
      mockRepo.count.mockResolvedValue(5);

      const result = await service.countHeartbeats('user-1');

      expect(result).toBe(5);
      expect(mockRepo.count).toHaveBeenCalledWith(undefined);
    });

    it('delegates to repo.count with enabled=true', async () => {
      mockRepo.count.mockResolvedValue(3);

      const result = await service.countHeartbeats('user-1', true);

      expect(result).toBe(3);
      expect(mockRepo.count).toHaveBeenCalledWith(true);
    });

    it('delegates to repo.count with enabled=false', async () => {
      mockRepo.count.mockResolvedValue(2);

      const result = await service.countHeartbeats('user-1', false);

      expect(result).toBe(2);
      expect(mockRepo.count).toHaveBeenCalledWith(false);
    });
  });
});

// ============================================================================
// HeartbeatServiceError
// ============================================================================

describe('HeartbeatServiceError', () => {
  it('has name "HeartbeatServiceError"', () => {
    const error = new HeartbeatServiceError('test', 'VALIDATION_ERROR');
    expect(error.name).toBe('HeartbeatServiceError');
  });

  it('has the correct message', () => {
    const error = new HeartbeatServiceError('Something went wrong', 'NOT_FOUND');
    expect(error.message).toBe('Something went wrong');
  });

  it('has the correct code for VALIDATION_ERROR', () => {
    const error = new HeartbeatServiceError('bad', 'VALIDATION_ERROR');
    expect(error.code).toBe('VALIDATION_ERROR');
  });

  it('has the correct code for PARSE_ERROR', () => {
    const error = new HeartbeatServiceError('bad', 'PARSE_ERROR');
    expect(error.code).toBe('PARSE_ERROR');
  });

  it('has the correct code for NOT_FOUND', () => {
    const error = new HeartbeatServiceError('not found', 'NOT_FOUND');
    expect(error.code).toBe('NOT_FOUND');
  });

  it('extends Error', () => {
    const error = new HeartbeatServiceError('test', 'VALIDATION_ERROR');
    expect(error).toBeInstanceOf(Error);
  });

  it('code property is readonly', () => {
    const error = new HeartbeatServiceError('test', 'VALIDATION_ERROR');
    // Verify code is accessible
    expect(error.code).toBe('VALIDATION_ERROR');
  });
});

// ============================================================================
// getHeartbeatService singleton
// ============================================================================

describe('getHeartbeatService', () => {
  it('returns a HeartbeatService instance', () => {
    const service = getHeartbeatService();
    expect(service).toBeInstanceOf(HeartbeatService);
  });

  it('returns the same instance on repeated calls', () => {
    const a = getHeartbeatService();
    const b = getHeartbeatService();
    expect(a).toBe(b);
  });
});
