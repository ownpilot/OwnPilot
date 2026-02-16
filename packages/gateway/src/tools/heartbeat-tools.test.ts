/**
 * HeartbeatTools Tests
 *
 * Tests for all 4 heartbeat AI tools.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeHeartbeatTool } from './heartbeat-tools.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockService = {
  createHeartbeat: vi.fn(),
  listHeartbeats: vi.fn(),
  updateHeartbeat: vi.fn(),
  deleteHeartbeat: vi.fn(),
};

vi.mock('../services/heartbeat-service.js', () => ({
  getHeartbeatService: () => mockService,
  HeartbeatServiceError: class extends Error {
    code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('@ownpilot/core', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeHeartbeatTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create_heartbeat', () => {
    it('creates a heartbeat and returns details', async () => {
      mockService.createHeartbeat.mockResolvedValue({
        id: 'hb-1',
        name: 'Every morning at 08:00',
        scheduleText: 'Every Morning 8:00',
        cron: '0 8 * * *',
        enabled: true,
        triggerId: 'trigger-1',
      });

      const result = await executeHeartbeatTool('create_heartbeat', {
        schedule: 'Every Morning 8:00',
        task: 'Summarize emails',
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual(expect.objectContaining({
        id: 'hb-1',
        cron: '0 8 * * *',
      }));
      expect(mockService.createHeartbeat).toHaveBeenCalledWith('default', expect.objectContaining({
        scheduleText: 'Every Morning 8:00',
        taskDescription: 'Summarize emails',
      }));
    });

    it('returns error on failure', async () => {
      mockService.createHeartbeat.mockRejectedValue(new Error('Parse error'));

      const result = await executeHeartbeatTool('create_heartbeat', {
        schedule: 'bad',
        task: 'stuff',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Parse error');
    });
  });

  describe('list_heartbeats', () => {
    it('lists heartbeats', async () => {
      mockService.listHeartbeats.mockResolvedValue([
        {
          id: 'hb-1',
          name: 'Morning',
          scheduleText: 'Every Morning',
          cron: '0 8 * * *',
          taskDescription: 'Task',
          enabled: true,
          triggerId: 'trigger-1',
          tags: [],
        },
      ]);

      const result = await executeHeartbeatTool('list_heartbeats', {});

      expect(result.success).toBe(true);
      expect(result.result).toHaveLength(1);
    });
  });

  describe('update_heartbeat', () => {
    it('updates a heartbeat', async () => {
      mockService.updateHeartbeat.mockResolvedValue({
        id: 'hb-1',
        name: 'Updated',
        scheduleText: 'Every Friday 17:00',
        cron: '0 17 * * 5',
        enabled: true,
      });

      const result = await executeHeartbeatTool('update_heartbeat', {
        heartbeat_id: 'hb-1',
        schedule: 'Every Friday 17:00',
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual(expect.objectContaining({ id: 'hb-1' }));
    });

    it('returns error when not found', async () => {
      mockService.updateHeartbeat.mockResolvedValue(null);

      const result = await executeHeartbeatTool('update_heartbeat', {
        heartbeat_id: 'missing',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('delete_heartbeat', () => {
    it('deletes a heartbeat', async () => {
      mockService.deleteHeartbeat.mockResolvedValue(true);

      const result = await executeHeartbeatTool('delete_heartbeat', {
        heartbeat_id: 'hb-1',
      });

      expect(result.success).toBe(true);
    });

    it('returns error when not found', async () => {
      mockService.deleteHeartbeat.mockResolvedValue(false);

      const result = await executeHeartbeatTool('delete_heartbeat', {
        heartbeat_id: 'missing',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeHeartbeatTool('unknown_tool', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown');
    });
  });
});
