/**
 * Crew Routes Tests
 *
 * Comprehensive test suite for crew management endpoints.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// ─── Hoisted mocks — safe to reference inside vi.mock() factories ─────────────

const {
  mockCrewsRepo,
  mockSoulsRepo,
  mockHbRepo,
  mockAgentsRepo,
  mockTriggersRepo,
  mockAgentMsgsRepo,
  mockSettingsRepo,
} = vi.hoisted(() => {
  const mockCrewsRepo = {
    list: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    getById: vi.fn(),
    updateStatus: vi.fn(),
    delete: vi.fn(),
    getMembers: vi.fn(),
    addMember: vi.fn(),
    removeAllMembers: vi.fn(),
  };
  const mockSoulsRepo = {
    create: vi.fn(),
    getByAgentId: vi.fn(),
    setHeartbeatEnabled: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(),
  };
  const mockHbRepo = {
    getLatestByAgentIds: vi.fn(),
  };
  const mockAgentsRepo = {
    create: vi.fn(),
    delete: vi.fn(),
  };
  const mockTriggersRepo = {
    create: vi.fn(),
    deleteHeartbeatTriggersForAgent: vi.fn(),
  };
  const mockAgentMsgsRepo = {
    create: vi.fn(),
    countUnreadByAgentIds: vi.fn(),
  };
  const mockSettingsRepo = {
    get: vi.fn(),
  };
  return {
    mockCrewsRepo,
    mockSoulsRepo,
    mockHbRepo,
    mockAgentsRepo,
    mockTriggersRepo,
    mockAgentMsgsRepo,
    mockSettingsRepo,
  };
});

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../db/repositories/crews.js', () => ({
  getCrewsRepository: vi.fn(() => mockCrewsRepo),
}));

vi.mock('../db/repositories/souls.js', () => ({
  getSoulsRepository: vi.fn(() => mockSoulsRepo),
}));

vi.mock('../db/repositories/heartbeat-log.js', () => ({
  getHeartbeatLogRepository: vi.fn(() => mockHbRepo),
}));

vi.mock('../db/repositories/agents.js', () => ({
  agentsRepo: mockAgentsRepo,
}));

vi.mock('../db/repositories/triggers.js', () => ({
  createTriggersRepository: vi.fn(() => mockTriggersRepo),
}));

vi.mock('../db/repositories/agent-messages.js', () => ({
  getAgentMessagesRepository: vi.fn(() => mockAgentMsgsRepo),
}));

vi.mock('../db/repositories/index.js', () => ({
  settingsRepo: mockSettingsRepo,
}));

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    listCrewTemplates: vi.fn(() => []),
    getCrewTemplate: vi.fn(() => null),
  };
});

// ─── Import after mocks ────────────────────────────────────────────────────────

import { crewRoutes } from './crews.js';
import { errorHandler } from '../middleware/error-handler.js';
import { listCrewTemplates, getCrewTemplate } from '@ownpilot/core';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route('/crews', crewRoutes);
  return app;
}

function mockCrewRecord(
  overrides: Partial<{
    id: string;
    name: string;
    description: string;
    templateId: string;
    coordinationPattern: string;
    status: string;
    workspaceId: string;
    createdAt: Date;
    updatedAt: Date;
  }> = {}
) {
  return {
    id: overrides.id ?? 'crew-1',
    name: overrides.name ?? 'Test Crew',
    description: overrides.description ?? 'A test crew',
    templateId: overrides.templateId ?? 'template-1',
    coordinationPattern: overrides.coordinationPattern ?? 'sequential',
    status: overrides.status ?? 'active',
    workspaceId: overrides.workspaceId ?? 'default',
    createdAt: overrides.createdAt ?? new Date('2024-01-01'),
    updatedAt: overrides.updatedAt ?? new Date('2024-01-02'),
  };
}

function mockMember(agentId = 'agent-1', role = 'Member') {
  return { crewId: 'crew-1', agentId, role, joinedAt: new Date('2024-01-01') };
}

function mockSoul(agentId = 'agent-1') {
  return {
    id: `soul-${agentId}`,
    agentId,
    identity: { name: 'Test Agent', emoji: '🤖', role: 'Worker' },
    purpose: { mission: 'Be helpful' },
    heartbeat: { enabled: true, interval: '0 */6 * * *' },
    relationships: { peers: [] },
    evolution: { version: 1, learnings: [] },
    updatedAt: new Date(),
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Crew Routes', () => {
  let app: Hono;

  beforeEach(() => {
    app = buildApp();
    vi.clearAllMocks();
    // Reset default mock behaviors
    mockHbRepo.getLatestByAgentIds.mockResolvedValue(new Map());
    mockAgentMsgsRepo.countUnreadByAgentIds.mockResolvedValue(new Map());
  });

  // ─── GET / — list crews ──────────────────────────────────────────────────

  describe('GET /crews - List crews', () => {
    it('should return paginated list of crews', async () => {
      const crews = [mockCrewRecord({ id: 'crew-1' }), mockCrewRecord({ id: 'crew-2' })];
      mockCrewsRepo.list.mockResolvedValue(crews);
      mockCrewsRepo.count.mockResolvedValue(2);

      const res = await app.request('/crews');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.items).toHaveLength(2);
      expect(data.data.total).toBe(2);
      expect(data.data.limit).toBe(20);
      expect(data.data.offset).toBe(0);
    });

    it('should return empty list when no crews exist', async () => {
      mockCrewsRepo.list.mockResolvedValue([]);
      mockCrewsRepo.count.mockResolvedValue(0);

      const res = await app.request('/crews');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.items).toEqual([]);
      expect(data.data.total).toBe(0);
    });

    it('should respect pagination query params', async () => {
      mockCrewsRepo.list.mockResolvedValue([]);
      mockCrewsRepo.count.mockResolvedValue(50);

      const res = await app.request('/crews?limit=10&offset=30');

      expect(res.status).toBe(200);
      expect(mockCrewsRepo.list).toHaveBeenCalledWith('default', 10, 30);
    });

    it('should return 500 on database error', async () => {
      mockCrewsRepo.list.mockRejectedValue(new Error('DB failure'));

      const res = await app.request('/crews');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('INTERNAL_ERROR');
    });
  });

  // ─── GET /templates — list templates ────────────────────────────────────

  describe('GET /crews/templates - List crew templates', () => {
    it('should return list of templates', async () => {
      vi.mocked(listCrewTemplates).mockReturnValue([
        {
          id: 'tpl-1',
          name: 'Research Crew',
          description: 'A research crew',
          coordinationPattern: 'sequential',
          agents: [],
        } as never,
      ]);

      const res = await app.request('/crews/templates');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data).toHaveLength(1);
      expect(data.data[0].id).toBe('tpl-1');
    });

    it('should return empty list when no templates exist', async () => {
      vi.mocked(listCrewTemplates).mockReturnValue([]);

      const res = await app.request('/crews/templates');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toEqual([]);
    });
  });

  // ─── GET /templates/:id — single template ───────────────────────────────

  describe('GET /crews/templates/:id - Single template', () => {
    it('should return template when found', async () => {
      const template = { id: 'tpl-1', name: 'Research Crew', agents: [] };
      vi.mocked(getCrewTemplate).mockReturnValue(template as never);

      const res = await app.request('/crews/templates/tpl-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('tpl-1');
    });

    it('should return 404 when template not found', async () => {
      vi.mocked(getCrewTemplate).mockReturnValue(undefined as never);

      const res = await app.request('/crews/templates/nonexistent');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_FOUND');
      expect(data.error.message).toContain('Template not found');
    });
  });

  // ─── POST /deploy — deploy from template ────────────────────────────────

  describe('POST /crews/deploy - Deploy crew from template', () => {
    it('should return 400 when templateId is missing', async () => {
      const res = await app.request('/crews/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('Validation failed');
    });

    it('should return 404 when template not found', async () => {
      vi.mocked(getCrewTemplate).mockReturnValue(undefined as never);

      const res = await app.request('/crews/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'missing-tpl' }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('Template not found: missing-tpl');
    });

    it('should deploy crew from template successfully', async () => {
      const template = {
        id: 'tpl-1',
        name: 'Research Crew',
        description: 'Research crew',
        coordinationPattern: 'sequential' as const,
        agents: [
          {
            identity: {
              name: 'Researcher',
              role: 'Researcher',
              emoji: '🔬',
              personality: 'curious',
              voice: { tone: 'neutral', language: 'en' },
              boundaries: [],
            },
            purpose: { mission: 'Research topics' },
            heartbeat: {
              enabled: false,
              interval: '0 */6 * * *',
              checklist: [],
              selfHealingEnabled: false,
              maxDurationMs: 120000,
            },
            relationships: { peers: [] },
          },
        ],
      };
      vi.mocked(getCrewTemplate).mockReturnValue(template as never);
      mockSettingsRepo.get.mockResolvedValue(null);
      mockCrewsRepo.create.mockResolvedValue(
        mockCrewRecord({ id: 'crew-new', name: 'Research Crew' })
      );
      mockAgentsRepo.create.mockResolvedValue({ id: 'agent-new' });
      mockSoulsRepo.create.mockResolvedValue(undefined);
      mockCrewsRepo.addMember.mockResolvedValue(undefined);

      const res = await app.request('/crews/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'tpl-1' }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.crewId).toBe('crew-new');
      expect(data.data.createdCount).toBe(1);
      expect(data.data.failedCount).toBe(0);
    });

    it('should return 500 when all agents fail to create', async () => {
      const template = {
        id: 'tpl-1',
        name: 'Research Crew',
        description: 'Research crew',
        coordinationPattern: 'sequential' as const,
        agents: [
          {
            identity: {
              name: 'Researcher',
              role: 'Researcher',
              emoji: '🔬',
              personality: 'curious',
              voice: { tone: 'neutral', language: 'en' },
              boundaries: [],
            },
            purpose: { mission: 'Research topics' },
            heartbeat: {
              enabled: false,
              interval: '0 */6 * * *',
              checklist: [],
              selfHealingEnabled: false,
              maxDurationMs: 120000,
            },
            relationships: { peers: [] },
          },
        ],
      };
      vi.mocked(getCrewTemplate).mockReturnValue(template as never);
      mockSettingsRepo.get.mockResolvedValue(null);
      mockCrewsRepo.create.mockResolvedValue(mockCrewRecord({ id: 'crew-x' }));
      mockAgentsRepo.create.mockRejectedValue(new Error('DB write failed'));
      mockCrewsRepo.updateStatus.mockResolvedValue(undefined);

      const res = await app.request('/crews/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId: 'tpl-1' }),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(mockCrewsRepo.updateStatus).toHaveBeenCalledWith('crew-x', 'disbanded');
    });
  });

  // ─── GET /:id — single crew ──────────────────────────────────────────────

  describe('GET /crews/:id - Get crew', () => {
    it('should return crew with agents', async () => {
      const crew = mockCrewRecord({ id: 'crew-1' });
      const members = [mockMember('agent-1'), mockMember('agent-2')];
      const soul1 = mockSoul('agent-1');
      const soul2 = mockSoul('agent-2');

      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockSoulsRepo.getByAgentId.mockImplementation((id: string) =>
        id === 'agent-1' ? Promise.resolve(soul1) : Promise.resolve(soul2)
      );
      mockHbRepo.getLatestByAgentIds.mockResolvedValue(new Map());

      const res = await app.request('/crews/crew-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe('crew-1');
      expect(data.data.agents).toHaveLength(2);
      expect(data.data.agents[0].agentId).toBe('agent-1');
    });

    it('should return 404 when crew not found', async () => {
      mockCrewsRepo.getById.mockResolvedValue(null);

      const res = await app.request('/crews/nonexistent');

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.code).toBe('NOT_FOUND');
      expect(data.error.message).toContain('Crew not found');
    });

    it('should return 500 on database error', async () => {
      mockCrewsRepo.getById.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/crews/crew-1');

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it('should handle agents with missing soul gracefully', async () => {
      const crew = mockCrewRecord({ id: 'crew-1' });
      const members = [mockMember('agent-no-soul')];

      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);
      mockHbRepo.getLatestByAgentIds.mockResolvedValue(new Map());

      const res = await app.request('/crews/crew-1');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.agents[0].name).toBe('Unknown');
      expect(data.data.agents[0].emoji).toBe('?');
    });
  });

  // ─── POST /:id/pause — pause crew ───────────────────────────────────────

  describe('POST /crews/:id/pause - Pause crew', () => {
    it('should pause crew and disable heartbeats', async () => {
      const crew = mockCrewRecord();
      const members = [mockMember('agent-1'), mockMember('agent-2')];

      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockSoulsRepo.setHeartbeatEnabled.mockResolvedValue(undefined);
      mockCrewsRepo.updateStatus.mockResolvedValue(undefined);

      const res = await app.request('/crews/crew-1/pause', { method: 'POST' });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('paused');
      expect(mockSoulsRepo.setHeartbeatEnabled).toHaveBeenCalledTimes(2);
      expect(mockSoulsRepo.setHeartbeatEnabled).toHaveBeenCalledWith('agent-1', false);
      expect(mockSoulsRepo.setHeartbeatEnabled).toHaveBeenCalledWith('agent-2', false);
      expect(mockCrewsRepo.updateStatus).toHaveBeenCalledWith('crew-1', 'paused');
    });

    it('should return 404 when crew not found', async () => {
      mockCrewsRepo.getById.mockResolvedValue(null);

      const res = await app.request('/crews/nonexistent/pause', { method: 'POST' });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('Crew not found');
    });

    it('should return 500 on error', async () => {
      mockCrewsRepo.getById.mockRejectedValue(new Error('DB crash'));

      const res = await app.request('/crews/crew-1/pause', { method: 'POST' });

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /:id/resume — resume crew ─────────────────────────────────────

  describe('POST /crews/:id/resume - Resume crew', () => {
    it('should resume crew and enable heartbeats', async () => {
      const crew = mockCrewRecord({ status: 'paused' });
      const members = [mockMember('agent-1')];

      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockSoulsRepo.setHeartbeatEnabled.mockResolvedValue(undefined);
      mockCrewsRepo.updateStatus.mockResolvedValue(undefined);

      const res = await app.request('/crews/crew-1/resume', { method: 'POST' });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('active');
      expect(mockSoulsRepo.setHeartbeatEnabled).toHaveBeenCalledWith('agent-1', true);
      expect(mockCrewsRepo.updateStatus).toHaveBeenCalledWith('crew-1', 'active');
    });

    it('should return 404 when crew not found', async () => {
      mockCrewsRepo.getById.mockResolvedValue(null);

      const res = await app.request('/crews/nonexistent/resume', { method: 'POST' });

      expect(res.status).toBe(404);
    });
  });

  // ─── DELETE /:id — delete crew ───────────────────────────────────────────

  describe('DELETE /crews/:id - Delete crew', () => {
    it('should delete crew and all associated agents', async () => {
      const crew = mockCrewRecord({ id: 'crew-1' });
      const members = [mockMember('agent-1'), mockMember('agent-2')];

      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockTriggersRepo.deleteHeartbeatTriggersForAgent.mockResolvedValue(undefined);
      mockSoulsRepo.delete.mockResolvedValue(undefined);
      mockAgentsRepo.delete.mockResolvedValue(true);
      mockCrewsRepo.removeAllMembers.mockResolvedValue(undefined);
      mockCrewsRepo.delete.mockResolvedValue(undefined);

      const res = await app.request('/crews/crew-1', { method: 'DELETE' });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('deleted');
      expect(data.data.deletedAgents).toBe(2);

      // Verify cleanup
      expect(mockTriggersRepo.deleteHeartbeatTriggersForAgent).toHaveBeenCalledTimes(2);
      expect(mockSoulsRepo.delete).toHaveBeenCalledTimes(2);
      expect(mockAgentsRepo.delete).toHaveBeenCalledTimes(2);
      expect(mockCrewsRepo.removeAllMembers).toHaveBeenCalledWith('crew-1');
      expect(mockCrewsRepo.delete).toHaveBeenCalledWith('crew-1');
    });

    it('should return 404 when crew not found', async () => {
      mockCrewsRepo.getById.mockResolvedValue(null);

      const res = await app.request('/crews/nonexistent', { method: 'DELETE' });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('Crew not found');
    });

    it('should return 500 on database error during delete', async () => {
      const crew = mockCrewRecord();
      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockRejectedValue(new Error('DB error'));

      const res = await app.request('/crews/crew-1', { method: 'DELETE' });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  // ─── POST /:id/message — broadcast message ──────────────────────────────

  describe('POST /crews/:id/message - Broadcast message', () => {
    it('should broadcast message to all crew members', async () => {
      const crew = mockCrewRecord({ id: 'crew-1', name: 'Alpha Crew' });
      const members = [mockMember('agent-1'), mockMember('agent-2')];
      const soul = mockSoul('agent-1');

      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockAgentMsgsRepo.create.mockResolvedValue(undefined);

      const res = await app.request('/crews/crew-1/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello crew!', priority: 'high' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.crewId).toBe('crew-1');
      expect(data.data.message).toBe('Hello crew!');
      expect(data.data.sentTo).toBe(2);
      expect(data.data.failed).toBe(0);
      expect(data.data.recipients).toHaveLength(2);
    });

    it('should return 400 when message is missing', async () => {
      const res = await app.request('/crews/crew-1/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toContain('Validation failed');
    });

    it('should return 404 when crew not found', async () => {
      mockCrewsRepo.getById.mockResolvedValue(null);

      const res = await app.request('/crews/nonexistent/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'Hello!' }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── POST /:id/delegate — delegate task ─────────────────────────────────

  describe('POST /crews/:id/delegate - Delegate task', () => {
    it('should delegate task between crew members', async () => {
      const crew = mockCrewRecord({ id: 'crew-1' });
      const members = [mockMember('agent-1', 'Leader'), mockMember('agent-2', 'Worker')];

      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockAgentMsgsRepo.create.mockResolvedValue(undefined);

      const res = await app.request('/crews/crew-1/delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAgentId: 'agent-1',
          toAgentId: 'agent-2',
          task: 'Write unit tests',
          context: { details: 'Use vitest' },
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('delegated');
      expect(data.data.from).toBe('agent-1');
      expect(data.data.to).toBe('agent-2');
      expect(data.data.task).toBe('Write unit tests');
    });

    it('should return 400 when required fields are missing', async () => {
      const res = await app.request('/crews/crew-1/delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromAgentId: 'agent-1' }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Validation failed');
    });

    it('should return 404 when crew not found', async () => {
      mockCrewsRepo.getById.mockResolvedValue(null);

      const res = await app.request('/crews/nonexistent/delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromAgentId: 'a1', toAgentId: 'a2', task: 'Do something' }),
      });

      expect(res.status).toBe(404);
    });

    it('should return 404 when agent not in crew', async () => {
      const crew = mockCrewRecord();
      const members = [mockMember('agent-1')]; // only agent-1, not agent-999

      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);

      const res = await app.request('/crews/crew-1/delegate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAgentId: 'agent-1',
          toAgentId: 'agent-999',
          task: 'Do something',
        }),
      });

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error.message).toContain('Agent not found in crew');
    });
  });

  // ─── GET /:id/status — crew status ──────────────────────────────────────

  describe('GET /crews/:id/status - Crew status', () => {
    it('should return detailed crew status with metrics', async () => {
      const crew = mockCrewRecord({ id: 'crew-1', name: 'Alpha Crew', status: 'active' });
      const members = [mockMember('agent-1')];
      const soul = mockSoul('agent-1');

      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockHbRepo.getLatestByAgentIds.mockResolvedValue(new Map());
      mockAgentMsgsRepo.countUnreadByAgentIds.mockResolvedValue(new Map([['agent-1', 3]]));

      const res = await app.request('/crews/crew-1/status');

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.crewId).toBe('crew-1');
      expect(data.data.name).toBe('Alpha Crew');
      expect(data.data.metrics).toBeDefined();
      expect(data.data.metrics.totalAgents).toBe(1);
      expect(data.data.agents).toHaveLength(1);
      expect(data.data.agents[0].unreadMessages).toBe(3);
    });

    it('should return 404 when crew not found', async () => {
      mockCrewsRepo.getById.mockResolvedValue(null);

      const res = await app.request('/crews/nonexistent/status');

      expect(res.status).toBe(404);
    });

    it('should return 500 on database error', async () => {
      mockCrewsRepo.getById.mockRejectedValue(new Error('DB crash'));

      const res = await app.request('/crews/crew-1/status');

      expect(res.status).toBe(500);
    });
  });

  // ─── POST /:id/sync — knowledge sync ────────────────────────────────────

  describe('POST /crews/:id/sync - Sync knowledge', () => {
    it('should sync context to all crew members', async () => {
      const crew = mockCrewRecord({ id: 'crew-1' });
      const members = [mockMember('agent-1'), mockMember('agent-2')];
      const soul1 = mockSoul('agent-1');
      const soul2 = mockSoul('agent-2');

      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockSoulsRepo.getByAgentId.mockResolvedValueOnce(soul1).mockResolvedValueOnce(soul2);
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/crews/crew-1/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: 'New shared knowledge' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.syncedTo).toBe(2);
      expect(data.data.context).toBe('New shared knowledge');
      expect(data.data.importance).toBe('medium');
      expect(mockSoulsRepo.update).toHaveBeenCalledTimes(2);
    });

    it('should return 400 when context is missing', async () => {
      const res = await app.request('/crews/crew-1/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain('Validation failed');
    });

    it('should return 404 when crew not found', async () => {
      mockCrewsRepo.getById.mockResolvedValue(null);

      const res = await app.request('/crews/crew-1/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: 'some context' }),
      });

      expect(res.status).toBe(404);
    });

    it('should default importance to medium when not provided', async () => {
      const crew = mockCrewRecord({ id: 'crew-1' });
      const members = [mockMember('agent-1')];
      const soul = mockSoul('agent-1');

      mockCrewsRepo.getById.mockResolvedValue(crew);
      mockCrewsRepo.getMembers.mockResolvedValue(members);
      mockSoulsRepo.getByAgentId.mockResolvedValue(soul);
      mockSoulsRepo.update.mockResolvedValue(undefined);

      const res = await app.request('/crews/crew-1/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: 'New knowledge' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.importance).toBe('medium');
    });
  });

  // ─── Response format ─────────────────────────────────────────────────────

  describe('Response format', () => {
    it('should include meta.timestamp in success responses', async () => {
      mockCrewsRepo.list.mockResolvedValue([]);
      mockCrewsRepo.count.mockResolvedValue(0);

      const res = await app.request('/crews');
      const data = await res.json();

      expect(data.meta).toBeDefined();
      expect(data.meta.timestamp).toBeDefined();
      expect(new Date(data.meta.timestamp).getTime()).not.toBeNaN();
    });

    it('should include meta.timestamp in error responses', async () => {
      mockCrewsRepo.getById.mockResolvedValue(null);

      const res = await app.request('/crews/nonexistent');
      const data = await res.json();

      expect(data.meta).toBeDefined();
      expect(data.meta.timestamp).toBeDefined();
    });
  });
});
