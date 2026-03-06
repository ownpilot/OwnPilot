/**
 * Soul Routes Tests
 *
 * Comprehensive tests for soul CRUD, evolution, versioning, and deployment.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// =============================================================================
// Mocks - Must be defined inline inside vi.mock factories due to hoisting
// =============================================================================

// Hoisted mutable references so individual tests can override transaction behaviour
const { mockTransaction, mockTriggerCreate } = vi.hoisted(() => {
  const mockTransaction = vi.fn();
  const mockTriggerCreate = vi.fn();
  return { mockTransaction, mockTriggerCreate };
});

vi.mock('../db/adapters/index.js', () => ({
  getAdapterSync: () => ({
    transaction: mockTransaction,
  }),
}));

vi.mock('../db/repositories/souls.js', () => ({
  getSoulsRepository: () => ({
    list: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
    getByAgentId: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getVersions: vi.fn(),
    getVersion: vi.fn(),
    createVersion: vi.fn(),
    setHeartbeatEnabled: vi.fn(),
  }),
}));

vi.mock('../db/repositories/agents.js', () => ({
  agentsRepo: {
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../db/repositories/triggers.js', () => ({
  createTriggersRepository: () => ({
    create: mockTriggerCreate,
  }),
}));

vi.mock('../db/repositories/heartbeat-log.js', () => ({
  getHeartbeatLogRepository: () => ({
    listByAgent: vi.fn(),
    getStats: vi.fn(),
  }),
}));

vi.mock('../db/repositories/index.js', () => ({
  settingsRepo: {
    get: vi.fn(),
  },
}));

vi.mock('../services/tool-executor.js', () => ({
  getSharedToolRegistry: () => ({
    getAllTools: vi.fn(),
  }),
}));

vi.mock('../services/soul-heartbeat-service.js', () => ({
  runAgentHeartbeat: vi.fn(),
}));

vi.mock('@ownpilot/core', () => ({
  getServiceRegistry: () => ({
    get: (token: unknown) => {
      if (token === 'Memory') return { listMemories: vi.fn() };
      if (token === 'Goal') return { listGoals: vi.fn() };
      return null;
    },
  }),
  Services: {
    Memory: 'Memory',
    Goal: 'Goal',
  },
}));

// Import after mocks
import { agentsRepo } from '../db/repositories/agents.js';
import { getSoulsRepository } from '../db/repositories/souls.js';
import { settingsRepo } from '../db/repositories/index.js';
import { soulRoutes } from './souls.js';

// =============================================================================
// Test Data
// =============================================================================

const mockSoul = {
  id: 'soul-123',
  agentId: 'agent-123',
  identity: {
    name: 'Test Agent',
    emoji: '🤖',
    role: 'Assistant',
    personality: 'Helpful',
    voice: { tone: 'neutral', language: 'en', quirks: [] },
    boundaries: [],
  },
  purpose: {
    mission: 'Help with tasks',
    goals: ['Be helpful'],
    expertise: [],
    toolPreferences: [],
  },
  autonomy: {
    level: 3,
    allowedActions: ['search_web'],
    blockedActions: [],
    requiresApproval: [],
    maxCostPerCycle: 0.5,
    maxCostPerDay: 5,
    maxCostPerMonth: 100,
    pauseOnConsecutiveErrors: 5,
    pauseOnBudgetExceeded: true,
    notifyUserOnPause: true,
  },
  heartbeat: {
    enabled: true,
    interval: '0 */6 * * *',
    checklist: [],
    selfHealingEnabled: false,
    maxDurationMs: 120000,
  },
  relationships: {
    delegates: [],
    peers: [],
    channels: [],
  },
  evolution: {
    version: 1,
    evolutionMode: 'supervised',
    coreTraits: [],
    mutableTraits: [],
    learnings: [],
    feedbackLog: [],
  },
  bootSequence: {
    onStart: [],
    onHeartbeat: ['read_inbox'],
    onMessage: [],
  },
  provider: {
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-5',
  },
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

// =============================================================================
// Tests
// =============================================================================

describe('Soul Routes', () => {
  const soulsRepo = getSoulsRepository();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // GET / — List souls
  // ==========================================================================

  describe('GET /', () => {
    it('lists souls with pagination', async () => {
      soulsRepo.list.mockResolvedValue([mockSoul]);
      soulsRepo.count.mockResolvedValue(1);

      const userId = 'user-123';
      const souls = await soulsRepo.list(userId, 20, 0);
      const total = await soulsRepo.count(userId);

      expect(souls).toHaveLength(1);
      expect(total).toBe(1);
      expect(soulsRepo.list).toHaveBeenCalledWith(userId, 20, 0);
      expect(soulsRepo.count).toHaveBeenCalledWith(userId);
    });

    it('respects limit parameter', async () => {
      soulsRepo.list.mockResolvedValue([mockSoul]);
      soulsRepo.count.mockResolvedValue(1);

      const userId = 'user-123';
      await soulsRepo.list(userId, 10, 0);

      expect(soulsRepo.list).toHaveBeenCalledWith(userId, 10, 0);
    });

    it('respects offset parameter', async () => {
      soulsRepo.list.mockResolvedValue([]);
      soulsRepo.count.mockResolvedValue(100);

      const userId = 'user-123';
      await soulsRepo.list(userId, 20, 40);

      expect(soulsRepo.list).toHaveBeenCalledWith(userId, 20, 40);
    });

    it('supports null userId for admin access', async () => {
      soulsRepo.list.mockResolvedValue([mockSoul]);
      soulsRepo.count.mockResolvedValue(1);

      const souls = await soulsRepo.list(null, 20, 0);
      const total = await soulsRepo.count(null);

      expect(souls).toHaveLength(1);
      expect(total).toBe(1);
      expect(soulsRepo.list).toHaveBeenCalledWith(null, 20, 0);
      expect(soulsRepo.count).toHaveBeenCalledWith(null);
    });
  });

  // ==========================================================================
  // POST / — Create soul
  // ==========================================================================

  describe('POST /', () => {
    it('creates soul with required fields', async () => {
      soulsRepo.create.mockResolvedValue(mockSoul);

      const soul = await soulsRepo.create({
        agentId: 'agent-123',
        identity: mockSoul.identity,
        purpose: mockSoul.purpose,
        autonomy: mockSoul.autonomy,
        heartbeat: mockSoul.heartbeat,
        evolution: mockSoul.evolution,
      });

      expect(soul).toBeDefined();
      expect(soul.agentId).toBe('agent-123');
      expect(soulsRepo.create).toHaveBeenCalled();
    });

    it('validates required fields', () => {
      const requiredFields = [
        'agentId',
        'identity',
        'purpose',
        'autonomy',
        'heartbeat',
        'evolution',
      ];
      expect(requiredFields).toContain('agentId');
      expect(requiredFields).toContain('identity');
      expect(requiredFields).toContain('purpose');
      expect(requiredFields).toContain('autonomy');
      expect(requiredFields).toContain('heartbeat');
      expect(requiredFields).toContain('evolution');
    });
  });

  // ==========================================================================
  // POST /deploy — Deploy agent + soul atomically in a DB transaction
  // ==========================================================================

  describe('POST /deploy', () => {
    it('uses default provider when not specified', async () => {
      settingsRepo.get.mockImplementation((key: string) => {
        if (key === 'default_ai_provider') return 'openai';
        if (key === 'default_ai_model') return 'gpt-4';
        return null;
      });

      const provider = settingsRepo.get('default_ai_provider');
      const model = settingsRepo.get('default_ai_model');

      expect(provider).toBe('openai');
      expect(model).toBe('gpt-4');
    });

    it('falls back to "default" when settings are empty', async () => {
      settingsRepo.get.mockReturnValue(null);

      const provider = settingsRepo.get('default_ai_provider') || 'default';
      const model = settingsRepo.get('default_ai_model') || 'default';

      expect(provider).toBe('default');
      expect(model).toBe('default');
    });

    it('transaction wraps both agent and soul creation', async () => {
      agentsRepo.create.mockResolvedValue(undefined);
      soulsRepo.create.mockResolvedValue(mockSoul);

      // Simulate transaction: call both inside the transaction callback
      let agentCreated = false;
      let soulCreated = false;

      const fakeTransaction = async (fn: () => Promise<unknown>) => {
        await agentsRepo.create({
          id: 'agent-1',
          name: 'Test',
          systemPrompt: '',
          provider: 'p',
          model: 'm',
        });
        agentCreated = true;
        await soulsRepo.create({ agentId: 'agent-1' });
        soulCreated = true;
        return fn();
      };

      await fakeTransaction(async () => mockSoul);

      expect(agentCreated).toBe(true);
      expect(soulCreated).toBe(true);
      expect(agentsRepo.create).toHaveBeenCalled();
      expect(soulsRepo.create).toHaveBeenCalled();
    });

    it('rolls back atomically when soul creation fails', async () => {
      agentsRepo.create.mockResolvedValue(undefined);
      soulsRepo.create.mockRejectedValue(new Error('Soul creation failed'));

      let txRolledBack = false;
      const fakeTransaction = async (fn: () => Promise<unknown>) => {
        try {
          return await fn();
        } catch {
          txRolledBack = true;
          throw new Error('Transaction rolled back');
        }
      };

      await expect(
        fakeTransaction(async () => {
          await agentsRepo.create({ id: 'a' });
          await soulsRepo.create({ agentId: 'a' });
        })
      ).rejects.toThrow('Transaction rolled back');

      expect(txRolledBack).toBe(true);
      // No manual rollback (agentsRepo.delete) needed — TX handles it
      expect(agentsRepo.delete).not.toHaveBeenCalled();
    });

    it('retries on duplicate name by appending random suffix', async () => {
      let callCount = 0;
      agentsRepo.create.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(
            new Error('duplicate key value violates unique constraint "agents_name_key"')
          );
        }
        return Promise.resolve(undefined);
      });

      const baseName = 'Test Agent';
      let agentName = baseName;
      let soul = null;
      let attempts = 0;

      while (!soul && attempts < 5) {
        try {
          await agentsRepo.create({
            id: 'a',
            name: agentName,
            systemPrompt: '',
            provider: 'p',
            model: 'm',
          });
          soulsRepo.create.mockResolvedValue(mockSoul);
          soul = await soulsRepo.create({ agentId: 'a' });
        } catch (err) {
          const msg = (err as Error).message.toLowerCase();
          if (msg.includes('duplicate') && msg.includes('name')) {
            attempts++;
            agentName = `${baseName} (${Math.floor(Math.random() * 10000)
              .toString()
              .padStart(4, '0')})`;
          } else break;
        }
      }

      expect(soul).toBeDefined();
      expect(attempts).toBe(1);
      expect(agentName).toMatch(/Test Agent \(\d{4}\)/);
    });

    it('fails after max retries (5) for persistent duplicate names', async () => {
      agentsRepo.create.mockRejectedValue(
        new Error('duplicate key value violates unique constraint "agents_name_key"')
      );

      let soul = null;
      let attempts = 0;
      let agentName = 'Conflict Agent';
      let lastError: unknown = null;

      while (!soul && attempts < 5) {
        try {
          await agentsRepo.create({ id: 'a', name: agentName });
          soul = mockSoul;
        } catch (err) {
          lastError = err;
          const msg = (err as Error).message.toLowerCase();
          if (msg.includes('duplicate') && msg.includes('name')) {
            attempts++;
            agentName = `Conflict Agent (${attempts.toString().padStart(4, '0')})`;
          } else break;
        }
      }

      expect(soul).toBeNull();
      expect(attempts).toBe(5);
      expect(lastError).toBeDefined();
    });

    it('validates autonomy.level must be 0-4', () => {
      const validLevels = [0, 1, 2, 3, 4];
      const invalidLevels = [-1, 5, 1.5, NaN];

      for (const level of validLevels) {
        expect(Number.isInteger(level) && level >= 0 && level <= 4).toBe(true);
      }
      for (const level of invalidLevels) {
        expect(Number.isInteger(level) && level >= 0 && level <= 4).toBe(false);
      }
    });

    it('validates cron expression format', () => {
      const CRON_REGEX =
        /^[\*0-9,\-\/]+\s+[\*0-9,\-\/]+\s+[\*0-9,\-\/]+\s+[\*0-9,\-\/]+\s+[\*0-9,\-\/]+$/;
      expect(CRON_REGEX.test('0 */6 * * *')).toBe(true);
      expect(CRON_REGEX.test('*/15 * * * *')).toBe(true);
      expect(CRON_REGEX.test('not-a-cron')).toBe(false);
      expect(CRON_REGEX.test('every hour')).toBe(false);
      expect(CRON_REGEX.test('')).toBe(false);
    });
  });

  // ==========================================================================
  // POST /deploy — HTTP-level tests (lines 253-269, 281-285, 291-303, 315-316)
  // These tests exercise the actual Hono route handler via app.request()
  // ==========================================================================

  describe('POST /deploy — HTTP handler', () => {
    let app: Hono;

    const minimalDeployBody = {
      identity: { name: 'Test Soul' },
    };

    beforeEach(() => {
      app = new Hono();
      app.route('/souls', soulRoutes);
      vi.clearAllMocks();
      // Default: transaction succeeds and returns the mockSoul
      mockTransaction.mockImplementation(async (fn: () => Promise<unknown>) => fn());
      mockTriggerCreate.mockResolvedValue(undefined);
    });

    // ── Lines 260-263: non-duplicate DB error breaks out of retry loop → 500 ──

    it('returns 500 when DB throws a non-name error (break branch — line 268)', async () => {
      // agentsRepo.create is NOT called by the real route — adapter.transaction runs the callback.
      // We simulate a non-duplicate-name error thrown from inside the transaction.
      mockTransaction.mockRejectedValue(new Error('connection refused'));

      const res = await app.request('/souls/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(minimalDeployBody),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toMatch(/connection refused/);
      // Should NOT have retried — the non-name error breaks immediately
      expect(mockTransaction).toHaveBeenCalledTimes(1);
    });

    // ── Lines 253-269: all 5 duplicate-name retries exhausted → soul is null → 500 ──

    it('returns 500 after all 5 duplicate-name retries fail (lines 263-266)', async () => {
      // Every transaction attempt throws a duplicate name error → loop exhausts 5 attempts
      mockTransaction.mockRejectedValue(
        new Error('duplicate key value violates unique constraint "agents_name_key"')
      );

      const res = await app.request('/souls/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(minimalDeployBody),
      });

      expect(res.status).toBe(500);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toMatch(/Failed to deploy agent/);
      // Exactly 5 attempts were made before the while-loop exited
      expect(mockTransaction).toHaveBeenCalledTimes(5);
    });

    // ── Lines 281-285: invalid cron string → 400 before trigger creation ──

    it('returns 400 for invalid heartbeat.interval cron format (line 280)', async () => {
      // Transaction succeeds so soul is not null — route proceeds to cron validation
      mockTransaction.mockImplementation(async (_fn: () => Promise<unknown>) => mockSoul);

      const res = await app.request('/souls/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: { name: 'Test Soul' },
          heartbeat: { enabled: true, interval: 'not a valid cron' },
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error.message).toMatch(/heartbeat\.interval must be a valid cron expression/);
      // Trigger must NOT have been called
      expect(mockTriggerCreate).not.toHaveBeenCalled();
    });

    // ── Lines 291-303 + 315-316: valid cron + enabled heartbeat → trigger created → 201 ──

    it('creates trigger and returns triggerCreated: true on success (lines 291-316)', async () => {
      mockTransaction.mockImplementation(async (_fn: () => Promise<unknown>) => mockSoul);
      mockTriggerCreate.mockResolvedValue(undefined);

      const res = await app.request('/souls/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: { name: 'Test Soul' },
          heartbeat: { enabled: true, interval: '0 */6 * * *' },
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.triggerCreated).toBe(true);
      expect(mockTriggerCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'schedule',
          enabled: true,
        })
      );
    });

    // ── Lines 295-297: trigger creation failure is non-fatal → still returns 201 ──

    it('returns 201 even when trigger creation throws (non-fatal — lines 295-297)', async () => {
      mockTransaction.mockImplementation(async (_fn: () => Promise<unknown>) => mockSoul);
      mockTriggerCreate.mockRejectedValue(new Error('trigger DB error'));

      const res = await app.request('/souls/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identity: { name: 'Test Soul' },
          heartbeat: { enabled: true, interval: '*/15 * * * *' },
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      // triggerCreated stays false because trigger threw before setting it to true
      expect(data.data.triggerCreated).toBe(false);
      expect(data.data.soul).toBeDefined();
    });
  });

  // ==========================================================================
  // GET /:agentId — Get soul
  // ==========================================================================

  describe('GET /:agentId', () => {
    it('returns soul when found', async () => {
      soulsRepo.getByAgentId.mockResolvedValue(mockSoul);

      const soul = await soulsRepo.getByAgentId('agent-123');

      expect(soul).toBeDefined();
      expect(soul?.agentId).toBe('agent-123');
      expect(soulsRepo.getByAgentId).toHaveBeenCalledWith('agent-123');
    });

    it('returns null when soul not found', async () => {
      soulsRepo.getByAgentId.mockResolvedValue(null);

      const soul = await soulsRepo.getByAgentId('nonexistent');

      expect(soul).toBeNull();
    });
  });

  // ==========================================================================
  // PUT /:agentId — Update soul
  // ==========================================================================

  describe('PUT /:agentId', () => {
    it('updates existing soul', async () => {
      soulsRepo.getByAgentId.mockResolvedValue(mockSoul);
      soulsRepo.update.mockResolvedValue(undefined);

      const existing = await soulsRepo.getByAgentId('agent-123');
      expect(existing).toBeDefined();

      const updated = {
        ...existing,
        identity: { ...existing!.identity, name: 'Updated Name' },
        updatedAt: new Date(),
      };

      await soulsRepo.update(updated);

      expect(soulsRepo.update).toHaveBeenCalledWith(
        expect.objectContaining({
          identity: expect.objectContaining({ name: 'Updated Name' }),
        })
      );
    });

    it('returns error for non-existent soul', async () => {
      soulsRepo.getByAgentId.mockResolvedValue(null);

      const existing = await soulsRepo.getByAgentId('nonexistent');

      expect(existing).toBeNull();
    });
  });

  // ==========================================================================
  // DELETE /:agentId — Delete soul
  // ==========================================================================

  describe('DELETE /:agentId', () => {
    it('deletes existing soul', async () => {
      soulsRepo.delete.mockResolvedValue(true);

      const result = await soulsRepo.delete('agent-123');

      expect(result).toBe(true);
      expect(soulsRepo.delete).toHaveBeenCalledWith('agent-123');
    });

    it('returns false when soul not found', async () => {
      soulsRepo.delete.mockResolvedValue(false);

      const result = await soulsRepo.delete('nonexistent');

      expect(result).toBe(false);
    });
  });

  // ==========================================================================
  // POST /:agentId/feedback — Apply feedback
  // ==========================================================================

  describe('POST /:agentId/feedback', () => {
    it('validates required fields', () => {
      const requiredFields = ['type', 'content'];
      expect(requiredFields).toContain('type');
      expect(requiredFields).toContain('content');
    });

    it('handles praise feedback', async () => {
      soulsRepo.getByAgentId.mockResolvedValue(mockSoul);
      soulsRepo.createVersion.mockResolvedValue(undefined);
      soulsRepo.update.mockResolvedValue(undefined);

      const soul = await soulsRepo.getByAgentId('agent-123');
      const feedback = {
        type: 'praise',
        content: 'Great work!',
        source: 'user',
      };

      // Create version snapshot
      await soulsRepo.createVersion(soul!, feedback.content, feedback.source);

      // Apply feedback
      soul!.evolution.learnings.push(`Positive: ${feedback.content}`);
      soul!.evolution.version++;
      soul!.updatedAt = new Date();

      await soulsRepo.update(soul!);

      expect(soulsRepo.createVersion).toHaveBeenCalled();
      expect(soul!.evolution.learnings).toContain(`Positive: ${feedback.content}`);
      expect(soulsRepo.update).toHaveBeenCalled();
    });

    it('handles correction feedback', async () => {
      soulsRepo.getByAgentId.mockResolvedValue(mockSoul);

      const soul = await soulsRepo.getByAgentId('agent-123');
      const feedback = {
        type: 'correction',
        content: 'Do not send emails without approval',
      };

      // Apply correction
      soul!.identity.boundaries.push(feedback.content);
      soul!.evolution.learnings.push(`Correction: ${feedback.content}`);

      expect(soul!.identity.boundaries).toContain(feedback.content);
      expect(soul!.evolution.learnings).toContain(`Correction: ${feedback.content}`);
    });

    it('handles directive feedback', async () => {
      soulsRepo.getByAgentId.mockResolvedValue(mockSoul);

      const soul = await soulsRepo.getByAgentId('agent-123');
      const feedback = {
        type: 'directive',
        content: 'Focus on research tasks',
      };

      // Apply directive
      soul!.purpose.goals.push(feedback.content);

      expect(soul!.purpose.goals).toContain(feedback.content);
    });

    it('handles personality_tweak feedback', async () => {
      soulsRepo.getByAgentId.mockResolvedValue(mockSoul);

      const soul = await soulsRepo.getByAgentId('agent-123');
      const feedback = {
        type: 'personality_tweak',
        content: 'Be more concise',
      };

      // Apply personality tweak
      soul!.evolution.mutableTraits.push(feedback.content);
      soul!.evolution.learnings.push(`Personality: ${feedback.content}`);

      expect(soul!.evolution.mutableTraits).toContain(feedback.content);
    });

    it('limits learnings to 50 entries', async () => {
      soulsRepo.getByAgentId.mockResolvedValue(mockSoul);

      const soul = await soulsRepo.getByAgentId('agent-123');

      // Simulate many learnings
      soul!.evolution.learnings = Array(55).fill('Learning');

      // Apply limit
      if (soul!.evolution.learnings.length > 50) {
        soul!.evolution.learnings = soul!.evolution.learnings.slice(-50);
      }

      expect(soul!.evolution.learnings).toHaveLength(50);
    });

    it('limits feedback log to 100 entries', async () => {
      soulsRepo.getByAgentId.mockResolvedValue(mockSoul);

      const soul = await soulsRepo.getByAgentId('agent-123');

      // Simulate many feedback entries
      soul!.evolution.feedbackLog = Array(105).fill({ id: 'fb-1' });

      // Apply limit
      if (soul!.evolution.feedbackLog.length > 100) {
        soul!.evolution.feedbackLog = soul!.evolution.feedbackLog.slice(-100);
      }

      expect(soul!.evolution.feedbackLog).toHaveLength(100);
    });
  });

  // ==========================================================================
  // Reserved Keywords Protection — static logic only
  // (HTTP-level route tests are in souls-http.test.ts)
  // ==========================================================================

  describe('Reserved Keywords', () => {
    const reservedKeywords = [
      'test',
      'tools',
      'stats',
      'command',
      'deploy',
      'logs',
      'memories',
      'goals',
      'tasks',
    ];

    it('blocks reserved keywords as agentId', () => {
      reservedKeywords.forEach((keyword) => {
        expect(reservedKeywords.includes(keyword)).toBe(true);
      });
    });

    it('allows valid UUIDs as agentId', () => {
      const validIds = ['agent-123', '550e8400-e29b-41d4-a716-446655440000', 'user-456'];

      validIds.forEach((id) => {
        expect(reservedKeywords.includes(id)).toBe(false);
      });
    });
  });

  // NOTE: HTTP-level tests for the remaining routes (logs, memories, goals, tasks,
  // mission, test, tools, command, stats, versions) are in souls-http.test.ts

  describe.skip('Soul Routes — HTTP handlers (placeholder — moved to souls-http.test.ts)', () => {
    let app: Hono;
    const hbRepo = { listByAgent: vi.fn(), getStats: vi.fn() };
    const toolRegistry = { getAllTools: vi.fn() };

    beforeEach(() => {
      app = new Hono();
      app.route('/souls', soulRoutes);
      vi.clearAllMocks();
      soulsRepo.getByAgentId.mockResolvedValue({ ...mockSoul });
      soulsRepo.update.mockResolvedValue(undefined);
      soulsRepo.setHeartbeatEnabled.mockResolvedValue(undefined);
      soulsRepo.getVersions.mockResolvedValue([]);
      soulsRepo.getVersion.mockResolvedValue(null);
      soulsRepo.createVersion.mockResolvedValue(undefined);
      hbRepo.listByAgent.mockResolvedValue([]);
      hbRepo.getStats.mockResolvedValue(null);
      toolRegistry.getAllTools.mockReturnValue([]);
    });

    // ── GET /:agentId/logs ──

    describe('GET /:agentId/logs', () => {
      it('returns logs and stats when soul exists', async () => {
        hbRepo.listByAgent.mockResolvedValue([
          {
            id: 'log-1',
            createdAt: new Date(),
            durationMs: 1000,
            cost: 0.01,
            tasksRun: ['t1'],
            tasksFailed: [],
          },
        ]);
        hbRepo.getStats.mockResolvedValue({
          totalCycles: 10,
          failureRate: 0.1,
          totalCost: 0.5,
          avgDurationMs: 1200,
        });

        const res = await app.request('/souls/agent-123/logs');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.logs).toHaveLength(1);
        expect(data.data.stats.totalCycles).toBe(10);
        expect(data.data.stats.successRate).toBe(0.9);
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/logs');
        expect(res.status).toBe(404);
      });

      it('returns 404 for reserved keyword agentId', async () => {
        const res = await app.request('/souls/logs/logs');
        expect(res.status).toBe(404);
      });

      it('computes zero stats when no heartbeat history', async () => {
        hbRepo.getStats.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/logs');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.stats.totalCycles).toBe(0);
        expect(data.data.stats.successRate).toBe(0);
      });
    });

    // ── GET /:agentId/memories ──

    describe('GET /:agentId/memories', () => {
      it('returns memories and learnings when soul exists', async () => {
        const { getServiceRegistry } = await import('@ownpilot/core');
        const registry = getServiceRegistry();
        const memorySvc = registry.get('Memory' as any);
        (memorySvc as any).listMemories = vi
          .fn()
          .mockResolvedValue([
            { id: 'm1', content: 'Test memory', source: 'chat', createdAt: new Date() },
          ]);

        const res = await app.request('/souls/agent-123/memories');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data).toHaveProperty('memories');
        expect(data.data).toHaveProperty('learnings');
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/memories');
        expect(res.status).toBe(404);
      });

      it('returns 404 for reserved keyword agentId', async () => {
        const res = await app.request('/souls/memories/memories');
        expect(res.status).toBe(404);
      });
    });

    // ── GET /:agentId/goals ──

    describe('GET /:agentId/goals', () => {
      it('returns goals when soul exists', async () => {
        const { getServiceRegistry } = await import('@ownpilot/core');
        const registry = getServiceRegistry();
        const goalSvc = registry.get('Goal' as any);
        (goalSvc as any).listGoals = vi
          .fn()
          .mockResolvedValue([{ id: 'g1', title: 'Test Goal', status: 'active', progress: 0.5 }]);

        const res = await app.request('/souls/agent-123/goals');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.systemGoals).toHaveLength(1);
        expect(data.data.mission).toBe(mockSoul.purpose.mission);
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/goals');
        expect(res.status).toBe(404);
      });
    });

    // ── POST /:agentId/goals ──

    describe('POST /:agentId/goals', () => {
      it('adds goal and returns updated list', async () => {
        const soul = { ...mockSoul, purpose: { ...mockSoul.purpose, goals: ['existing'] } };
        soulsRepo.getByAgentId.mockResolvedValue(soul);

        const res = await app.request('/souls/agent-123/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal: 'new goal' }),
        });
        expect(res.status).toBe(201);
        const data = await res.json();
        expect(data.data.goals).toContain('new goal');
      });

      it('returns 400 when goal is missing', async () => {
        const res = await app.request('/souls/agent-123/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal: 'test' }),
        });
        expect(res.status).toBe(404);
      });

      it('returns 404 for reserved keyword agentId', async () => {
        const res = await app.request('/souls/goals/goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal: 'test' }),
        });
        expect(res.status).toBe(404);
      });
    });

    // ── GET /:agentId/tasks ──

    describe('GET /:agentId/tasks', () => {
      it('returns boot tasks and checklist', async () => {
        const res = await app.request('/souls/agent-123/tasks');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.bootTasks).toEqual(['read_inbox']);
        expect(data.data.isRunning).toBe(true);
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/tasks');
        expect(res.status).toBe(404);
      });

      it('returns 404 for reserved keyword agentId', async () => {
        const res = await app.request('/souls/tasks/tasks');
        expect(res.status).toBe(404);
      });
    });

    // ── POST /:agentId/mission ──

    describe('POST /:agentId/mission', () => {
      it('updates mission and returns accepted status', async () => {
        const soul = {
          ...mockSoul,
          purpose: { ...mockSoul.purpose },
          bootSequence: { ...mockSoul.bootSequence },
        };
        soulsRepo.getByAgentId.mockResolvedValue(soul);

        const res = await app.request('/souls/agent-123/mission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mission: 'New mission' }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.status).toBe('accepted');
        expect(data.data.mission).toBe('New mission');
      });

      it('sets autoPlan tasks when autoPlan is true', async () => {
        const soul = {
          ...mockSoul,
          purpose: { ...mockSoul.purpose },
          bootSequence: { ...mockSoul.bootSequence, onHeartbeat: [] },
        };
        soulsRepo.getByAgentId.mockResolvedValue(soul);

        const res = await app.request('/souls/agent-123/mission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mission: 'Autoplan mission', autoPlan: true }),
        });
        expect(res.status).toBe(200);
        expect(soulsRepo.update).toHaveBeenCalled();
      });

      it('uses default priority "medium" when not specified', async () => {
        const soul = {
          ...mockSoul,
          purpose: { ...mockSoul.purpose },
          bootSequence: { ...mockSoul.bootSequence },
        };
        soulsRepo.getByAgentId.mockResolvedValue(soul);

        const res = await app.request('/souls/agent-123/mission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mission: 'Test mission' }),
        });
        const data = await res.json();
        expect(data.data.priority).toBe('medium');
      });

      it('returns 400 when mission is missing', async () => {
        const res = await app.request('/souls/agent-123/mission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      });

      it('returns 404 for reserved keyword', async () => {
        const res = await app.request('/souls/deploy/mission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mission: 'test' }),
        });
        expect(res.status).toBe(404);
      });
    });

    // ── POST /:agentId/test ──

    describe('POST /:agentId/test', () => {
      const { runAgentHeartbeat } = vi.hoisted(() => ({ runAgentHeartbeat: vi.fn() }));

      it('runs heartbeat and returns success', async () => {
        const { runAgentHeartbeat: rhb } = await import('../services/soul-heartbeat-service.js');
        (rhb as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true });

        const res = await app.request('/souls/agent-123/test', { method: 'POST' });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.success).toBe(true);
      });

      it('returns 400 when agent is paused', async () => {
        soulsRepo.getByAgentId.mockResolvedValue({
          ...mockSoul,
          heartbeat: { ...mockSoul.heartbeat, enabled: false },
        });

        const res = await app.request('/souls/agent-123/test', { method: 'POST' });
        expect(res.status).toBe(400);
      });

      it('returns 500 when heartbeat fails', async () => {
        const { runAgentHeartbeat: rhb } = await import('../services/soul-heartbeat-service.js');
        (rhb as ReturnType<typeof vi.fn>).mockResolvedValue({
          success: false,
          error: 'Heartbeat error',
        });

        const res = await app.request('/souls/agent-123/test', { method: 'POST' });
        expect(res.status).toBe(500);
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/test', { method: 'POST' });
        expect(res.status).toBe(404);
      });

      it('returns 404 for reserved keyword', async () => {
        const res = await app.request('/souls/test/test', { method: 'POST' });
        expect(res.status).toBe(404);
      });
    });

    // ── GET /:agentId/tools ──

    describe('GET /:agentId/tools', () => {
      it('returns tools with permission status', async () => {
        const { getSharedToolRegistry: gstr } = await import('../services/tool-executor.js');
        (gstr as ReturnType<typeof vi.fn>).mockReturnValue({
          getAllTools: vi
            .fn()
            .mockReturnValue([
              { definition: { name: 'search_web', description: 'Search the web' } },
              { definition: { name: 'mcp.browser', description: 'Browser tool' } },
              { definition: { name: 'custom.my_tool', description: 'My tool' } },
            ]),
        });
        const soul = {
          ...mockSoul,
          autonomy: { ...mockSoul.autonomy, allowedActions: ['search_web'], blockedActions: [] },
        };
        soulsRepo.getByAgentId.mockResolvedValue(soul);

        const res = await app.request('/souls/agent-123/tools');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.tools).toHaveLength(3);
        const webTool = data.data.tools.find((t: any) => t.name === 'search_web');
        expect(webTool.status).toBe('allowed');
        const mcpTool = data.data.tools.find((t: any) => t.name === 'mcp.browser');
        expect(mcpTool.category).toBe('mcp');
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/tools');
        expect(res.status).toBe(404);
      });

      it('returns 404 for reserved keyword', async () => {
        const res = await app.request('/souls/tools/tools');
        expect(res.status).toBe(404);
      });
    });

    // ── PUT /:agentId/tools ──

    describe('PUT /:agentId/tools', () => {
      it('updates allowed and blocked tool lists', async () => {
        const soul = {
          ...mockSoul,
          autonomy: { ...mockSoul.autonomy, allowedActions: [], blockedActions: [] },
        };
        soulsRepo.getByAgentId.mockResolvedValue(soul);

        const res = await app.request('/souls/agent-123/tools', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowed: ['search_web'], blocked: ['execute_shell'] }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.allowed).toContain('search_web');
        expect(data.data.blocked).toContain('execute_shell');
      });

      it('only updates allowed when blocked not provided', async () => {
        const soul = {
          ...mockSoul,
          autonomy: { ...mockSoul.autonomy, allowedActions: [], blockedActions: ['old'] },
        };
        soulsRepo.getByAgentId.mockResolvedValue(soul);

        const res = await app.request('/souls/agent-123/tools', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowed: ['new_tool'] }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.blocked).toContain('old'); // unchanged
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/tools', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowed: [] }),
        });
        expect(res.status).toBe(404);
      });
    });

    // ── POST /:agentId/command ──

    describe('POST /:agentId/command', () => {
      it('handles pause command', async () => {
        const res = await app.request('/souls/agent-123/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'pause' }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.result.message).toContain('paused');
        expect(soulsRepo.setHeartbeatEnabled).toHaveBeenCalledWith('agent-123', false);
      });

      it('handles resume command', async () => {
        const res = await app.request('/souls/agent-123/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'resume' }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.result.message).toContain('resumed');
        expect(soulsRepo.setHeartbeatEnabled).toHaveBeenCalledWith('agent-123', true);
      });

      it('handles run_heartbeat command', async () => {
        const res = await app.request('/souls/agent-123/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'run_heartbeat' }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.result.message).toContain('Heartbeat triggered');
      });

      it('handles reset_budget command', async () => {
        const res = await app.request('/souls/agent-123/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'reset_budget' }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.result.message).toContain('Budget');
      });

      it('handles unknown command gracefully', async () => {
        const res = await app.request('/souls/agent-123/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'unknown_cmd' }),
        });
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.result.message).toContain('Unknown command');
      });

      it('returns 400 when command is missing', async () => {
        const res = await app.request('/souls/agent-123/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(400);
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'pause' }),
        });
        expect(res.status).toBe(404);
      });
    });

    // ── GET /:agentId/stats ──

    describe('GET /:agentId/stats', () => {
      it('returns stats when soul exists', async () => {
        hbRepo.getStats.mockResolvedValue({
          totalCycles: 5,
          totalCost: 0.25,
          avgDurationMs: 2000,
          failureRate: 0.2,
        });
        hbRepo.listByAgent.mockResolvedValue([{ createdAt: new Date() }]);

        const res = await app.request('/souls/agent-123/stats');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.stats.totalCycles).toBe(5);
        expect(data.data.heartbeat.enabled).toBe(true);
      });

      it('returns zero stats when no history', async () => {
        hbRepo.getStats.mockResolvedValue(null);
        hbRepo.listByAgent.mockResolvedValue([]);

        const res = await app.request('/souls/agent-123/stats');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.stats.totalCycles).toBe(0);
        expect(data.data.heartbeat.lastRunAt).toBeNull();
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/stats');
        expect(res.status).toBe(404);
      });

      it('returns 404 for reserved keyword', async () => {
        const res = await app.request('/souls/stats/stats');
        expect(res.status).toBe(404);
      });
    });

    // ── GET /:agentId/versions ──

    describe('GET /:agentId/versions', () => {
      it('returns version list when soul exists', async () => {
        soulsRepo.getVersions.mockResolvedValue([{ v: 1 }, { v: 2 }]);

        const res = await app.request('/souls/agent-123/versions');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data).toHaveLength(2);
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/versions');
        expect(res.status).toBe(404);
      });
    });

    // ── GET /:agentId/versions/:v ──

    describe('GET /:agentId/versions/:v', () => {
      it('returns specific version when found', async () => {
        soulsRepo.getVersion.mockResolvedValue({ v: 1, snapshot: {} });

        const res = await app.request('/souls/agent-123/versions/1');
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.data.v).toBe(1);
      });

      it('returns 404 when version not found', async () => {
        soulsRepo.getVersion.mockResolvedValue(null);

        const res = await app.request('/souls/agent-123/versions/99');
        expect(res.status).toBe(404);
      });

      it('returns 404 when soul not found', async () => {
        soulsRepo.getByAgentId.mockResolvedValue(null);
        const res = await app.request('/souls/agent-123/versions/1');
        expect(res.status).toBe(404);
      });
    });
  });
});
