import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ── Mocks ──

const mockSoulRepo = {
  create: vi.fn(async (data: Record<string, unknown>) => ({ id: 'soul-1', ...data })),
};
const mockAgentsRepo = { create: vi.fn(async () => ({ id: 'agent-1' })) };
const mockTriggerRepo = { create: vi.fn(async () => ({ id: 'trigger-1' })) };
const mockAdapter = { transaction: vi.fn(async (fn: () => Promise<unknown>) => fn()) };

vi.mock('../db/repositories/souls.js', () => ({
  getSoulsRepository: vi.fn(() => mockSoulRepo),
}));
vi.mock('../db/repositories/agents.js', () => ({
  agentsRepo: mockAgentsRepo,
}));
vi.mock('../db/repositories/triggers.js', () => ({
  createTriggersRepository: vi.fn(() => mockTriggerRepo),
}));
vi.mock('../db/adapters/index.js', () => ({
  getAdapterSync: vi.fn(() => mockAdapter),
}));
vi.mock('../db/repositories/index.js', () => ({
  settingsRepo: { get: vi.fn(() => null) },
}));
vi.mock('../services/log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { soulDeployRoutes } = await import('./souls-deploy.js');

function createApp() {
  const app = new Hono();
  app.route('/souls', soulDeployRoutes);
  return app;
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapter.transaction.mockImplementation(async (fn: () => Promise<unknown>) => fn());
});

describe('POST /souls/deploy', () => {
  it('deploys a soul agent with minimal input', async () => {
    const app = createApp();
    const res = await app.request('/souls/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: { name: 'TestBot' },
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.agentId).toBeTruthy();
    expect(json.data.soul).toBeTruthy();
    expect(mockAgentsRepo.create).toHaveBeenCalled();
    expect(mockSoulRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({ name: 'TestBot' }),
      })
    );
  });

  it('returns 400 for invalid autonomy.level', async () => {
    const app = createApp();
    const res = await app.request('/souls/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: { name: 'Bot' },
        autonomy: { level: 10 },
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('autonomy.level');
  });

  it('returns 400 for non-integer autonomy.level', async () => {
    const app = createApp();
    const res = await app.request('/souls/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: { name: 'Bot' },
        autonomy: { level: 2.5 },
      }),
    });

    expect(res.status).toBe(400);
  });

  it('creates heartbeat trigger when enabled', async () => {
    const app = createApp();
    const res = await app.request('/souls/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: { name: 'HBBot' },
        heartbeat: { enabled: true, interval: '0 */6 * * *' },
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.triggerCreated).toBe(true);
    expect(mockTriggerRepo.create).toHaveBeenCalled();
  });

  it('returns 400 for invalid cron in heartbeat.interval', async () => {
    const app = createApp();
    const res = await app.request('/souls/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: { name: 'Bot' },
        heartbeat: { enabled: true, interval: 'not a cron' },
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.message).toContain('cron');
  });

  it('retries on duplicate name conflict', async () => {
    mockAdapter.transaction
      .mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint "agents_name_unique"')
      )
      .mockImplementationOnce(async (fn: () => Promise<unknown>) => fn());

    const app = createApp();
    const res = await app.request('/souls/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: { name: 'DupeBot' } }),
    });

    expect(res.status).toBe(201);
    expect(mockAdapter.transaction).toHaveBeenCalledTimes(2);
  });

  it('returns 500 when transaction fails with non-name error', async () => {
    mockAdapter.transaction.mockRejectedValue(new Error('connection refused'));

    const app = createApp();
    const res = await app.request('/souls/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: { name: 'Bot' } }),
    });

    expect(res.status).toBe(500);
  });

  it('uses default provider/model when not specified', async () => {
    const app = createApp();
    await app.request('/souls/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: { name: 'Bot' } }),
    });

    expect(mockAgentsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'default', model: 'default' })
    );
  });

  it('uses specified provider/model', async () => {
    const app = createApp();
    await app.request('/souls/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: { name: 'Bot' },
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
      }),
    });

    expect(mockAgentsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'anthropic', model: 'claude-3-5-sonnet' })
    );
  });
});
