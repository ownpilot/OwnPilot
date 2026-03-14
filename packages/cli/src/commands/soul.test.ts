/**
 * Soul, Crew, Message & Heartbeat CLI Commands Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Mocks
// ============================================================================

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function apiOk<T>(data: T) {
  return { ok: true, status: 200, json: async () => ({ success: true, data }) };
}

function apiErr(status = 500) {
  return {
    ok: false,
    status,
    text: async () => 'Server error',
    statusText: 'Internal Server Error',
  };
}

// ============================================================================
// Import after mocks
// ============================================================================

import {
  soulList,
  soulGet,
  soulDelete,
  soulFeedback,
  soulVersions,
  crewList,
  crewGet,
  crewPause,
  crewResume,
  crewDisband,
  crewTemplates,
  msgList,
  msgSend,
  msgAgent,
  heartbeatList,
  heartbeatStats,
  heartbeatAgent,
} from './soul.js';

describe('Soul CLI Commands', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  // --------------------------------------------------------------------------
  // Soul
  // --------------------------------------------------------------------------

  describe('soulList', () => {
    it('lists souls', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          items: [
            {
              agentId: 'soul-1',
              name: 'Helper',
              identity: { displayName: 'Helper Bot', emoji: '🧠' },
              autonomy: { level: 'supervised' },
              heartbeat: { enabled: true },
              evolution: { version: 3 },
            },
          ],
          total: 1,
        })
      );

      await soulList();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Agent Souls (1)'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Helper Bot'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('supervised'));
    });

    it('shows empty message', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ items: [], total: 0 }));

      await soulList();

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No souls'));
    });
  });

  describe('soulGet', () => {
    it('prints soul JSON', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ agentId: 'soul-1', name: 'Helper' }));

      await soulGet('soul-1');

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('"agentId"'));
    });

    it('shows usage when no agentId', async () => {
      await soulGet('');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });

  describe('soulDelete', () => {
    it('deletes soul', async () => {
      mockFetch.mockResolvedValueOnce(apiOk(null));
      await soulDelete('soul-1');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('deleted'));
    });

    it('shows usage when no agentId', async () => {
      await soulDelete('');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });

  describe('soulFeedback', () => {
    it('applies feedback', async () => {
      mockFetch.mockResolvedValueOnce(apiOk(null));
      await soulFeedback('soul-1', 'praise', 'Great job!');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Feedback (praise)'));
    });

    it('shows usage when missing args', async () => {
      await soulFeedback('', '', '');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });

  describe('soulVersions', () => {
    it('lists versions', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk([{ version: 1, changelog: 'Initial', createdAt: '2026-01-01T00:00:00Z' }])
      );

      await soulVersions('soul-1');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('v1'));
    });

    it('shows empty message', async () => {
      mockFetch.mockResolvedValueOnce(apiOk([]));
      await soulVersions('soul-1');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No versions'));
    });

    it('shows usage when no agentId', async () => {
      await soulVersions('');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });

  // --------------------------------------------------------------------------
  // Crew
  // --------------------------------------------------------------------------

  describe('crewList', () => {
    it('lists crews', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          items: [
            {
              id: 'crew-1',
              name: 'Research Crew',
              status: 'active',
              coordinationPattern: 'pipeline',
              members: [{ agentId: 'a1', role: 'lead' }],
            },
          ],
          total: 1,
        })
      );

      await crewList();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Research Crew'));
    });

    it('shows empty message', async () => {
      mockFetch.mockResolvedValueOnce(apiOk({ items: [], total: 0 }));
      await crewList();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No crews'));
    });
  });

  describe('crewGet', () => {
    it('shows usage when no id', async () => {
      await crewGet('');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });

  describe('crewPause', () => {
    it('pauses crew', async () => {
      mockFetch.mockResolvedValueOnce(apiOk(null));
      await crewPause('crew-1');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('paused'));
    });
  });

  describe('crewResume', () => {
    it('resumes crew', async () => {
      mockFetch.mockResolvedValueOnce(apiOk(null));
      await crewResume('crew-1');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('resumed'));
    });
  });

  describe('crewDisband', () => {
    it('disbands crew', async () => {
      mockFetch.mockResolvedValueOnce(apiOk(null));
      await crewDisband('crew-1');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('disbanded'));
    });
  });

  describe('crewTemplates', () => {
    it('lists templates', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk([
          {
            id: 'tmpl-1',
            name: 'Research',
            description: 'Research crew',
            coordinationPattern: 'pipeline',
            agents: [{ displayName: 'Lead', role: 'lead' }],
          },
        ])
      );

      await crewTemplates();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Research'));
    });
  });

  // --------------------------------------------------------------------------
  // Messages
  // --------------------------------------------------------------------------

  describe('msgList', () => {
    it('lists messages', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          items: [
            {
              id: 'm1',
              from: 'a1',
              to: 'a2',
              type: 'direct',
              subject: 'Hello',
              content: 'Hi there',
              createdAt: '2026-01-01T00:00:00Z',
            },
          ],
          total: 1,
        })
      );

      await msgList();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('a1'));
    });
  });

  describe('msgSend', () => {
    it('sends message', async () => {
      mockFetch.mockResolvedValueOnce(apiOk(null));
      await msgSend('agent-1', 'Hello');
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('sent'));
    });

    it('shows usage when missing args', async () => {
      await msgSend('', '');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });

  describe('msgAgent', () => {
    it('shows usage when no agentId', async () => {
      await msgAgent('');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });

  // --------------------------------------------------------------------------
  // Heartbeat
  // --------------------------------------------------------------------------

  describe('heartbeatList', () => {
    it('lists heartbeat logs', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({
          items: [
            {
              id: 'h1',
              agentId: 'soul-1',
              triggeredAt: '2026-01-01T00:00:00Z',
              tasksRun: 3,
              tasksSucceeded: 2,
              tasksFailed: 1,
              totalCost: 0.05,
            },
          ],
          total: 1,
        })
      );

      await heartbeatList();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('soul-1'));
    });
  });

  describe('heartbeatStats', () => {
    it('shows stats', async () => {
      mockFetch.mockResolvedValueOnce(
        apiOk({ total: 10, avgTasksRun: 2.5, avgCost: 0.01, totalCost: 0.1, successRate: 0.9 })
      );

      await heartbeatStats();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Total runs'));
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('90.0%'));
    });
  });

  describe('heartbeatAgent', () => {
    it('shows usage when no agentId', async () => {
      await heartbeatAgent('');
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Usage'));
    });
  });

  // --------------------------------------------------------------------------
  // API error handling
  // --------------------------------------------------------------------------

  describe('API errors', () => {
    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(apiErr(500));
      await expect(soulList()).rejects.toThrow(/failed.*500/);
    });
  });
});
