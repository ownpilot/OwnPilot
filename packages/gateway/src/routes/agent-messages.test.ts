/**
 * Agent Messages Routes Tests
 *
 * Integration tests for the inter-agent communication API endpoints.
 * Mocks getAgentMessagesRepository to keep tests fast and database-free.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Mock: agent-messages repository
// ---------------------------------------------------------------------------

const mockRepo = {
  list: vi.fn(),
  count: vi.fn(),
  listByAgent: vi.fn(),
  findByThread: vi.fn(),
  listByCrew: vi.fn(),
  create: vi.fn(),
};

vi.mock('../db/repositories/agent-messages.js', () => ({
  getAgentMessagesRepository: () => mockRepo,
}));

// ---------------------------------------------------------------------------
// Import route after mocks
// ---------------------------------------------------------------------------

const { agentMessageRoutes } = await import('./agent-messages.js');

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/agent-messages', agentMessageRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg-1',
    from: 'agent-a',
    to: 'agent-b',
    type: 'coordination',
    subject: 'Hello',
    content: 'Test message content',
    attachments: [],
    priority: 'normal',
    threadId: 'thread-1',
    requiresResponse: false,
    deadline: undefined,
    status: 'sent',
    crewId: 'crew-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    readAt: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Agent Messages Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  // =========================================================================
  // GET / — list all messages
  // =========================================================================

  describe('GET /agent-messages', () => {
    it('returns paginated list of messages with total', async () => {
      const messages = [makeMessage({ id: 'msg-1' }), makeMessage({ id: 'msg-2' })];
      mockRepo.list.mockResolvedValue(messages);
      mockRepo.count.mockResolvedValue(2);

      const res = await app.request('/agent-messages');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.items).toHaveLength(2);
      expect(json.data.total).toBe(2);
      expect(json.data.limit).toBe(20);
      expect(json.data.offset).toBe(0);
    });

    it('returns empty list when no messages exist', async () => {
      mockRepo.list.mockResolvedValue([]);
      mockRepo.count.mockResolvedValue(0);

      const res = await app.request('/agent-messages');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.items).toEqual([]);
      expect(json.data.total).toBe(0);
    });

    it('respects limit and offset query parameters', async () => {
      mockRepo.list.mockResolvedValue([]);
      mockRepo.count.mockResolvedValue(50);

      await app.request('/agent-messages?limit=10&offset=20');

      expect(mockRepo.list).toHaveBeenCalledWith(10, 20);
    });

    it('returns 500 on repository error', async () => {
      mockRepo.list.mockRejectedValue(new Error('DB connection lost'));
      mockRepo.count.mockResolvedValue(0);

      const res = await app.request('/agent-messages');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('INTERNAL_ERROR');
      expect(json.error.message).toContain('DB connection lost');
    });
  });

  // =========================================================================
  // GET /agent/:id — messages for a specific agent
  // =========================================================================

  describe('GET /agent-messages/agent/:id', () => {
    it('returns messages for the given agent', async () => {
      const messages = [makeMessage({ from: 'agent-a', to: 'agent-b' })];
      mockRepo.listByAgent.mockResolvedValue(messages);

      const res = await app.request('/agent-messages/agent/agent-a');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(mockRepo.listByAgent).toHaveBeenCalledWith('agent-a', 20, 0);
    });

    it('returns empty array when agent has no messages', async () => {
      mockRepo.listByAgent.mockResolvedValue([]);

      const res = await app.request('/agent-messages/agent/agent-unknown');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual([]);
    });

    it('passes pagination params to repository', async () => {
      mockRepo.listByAgent.mockResolvedValue([]);

      await app.request('/agent-messages/agent/agent-a?limit=5&offset=10');

      expect(mockRepo.listByAgent).toHaveBeenCalledWith('agent-a', 5, 10);
    });

    it('returns 500 on repository error', async () => {
      mockRepo.listByAgent.mockRejectedValue(new Error('Query timeout'));

      const res = await app.request('/agent-messages/agent/agent-a');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // =========================================================================
  // GET /thread/:id — messages in a thread
  // =========================================================================

  describe('GET /agent-messages/thread/:id', () => {
    it('returns all messages in the thread', async () => {
      const messages = [
        makeMessage({ id: 'msg-1', threadId: 'thread-abc' }),
        makeMessage({ id: 'msg-2', threadId: 'thread-abc' }),
      ];
      mockRepo.findByThread.mockResolvedValue(messages);

      const res = await app.request('/agent-messages/thread/thread-abc');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(mockRepo.findByThread).toHaveBeenCalledWith('thread-abc');
    });

    it('returns empty array for a thread with no messages', async () => {
      mockRepo.findByThread.mockResolvedValue([]);

      const res = await app.request('/agent-messages/thread/empty-thread');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual([]);
    });

    it('returns 500 on repository error', async () => {
      mockRepo.findByThread.mockRejectedValue(new Error('Table not found'));

      const res = await app.request('/agent-messages/thread/thread-abc');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });

  // =========================================================================
  // GET /crew/:id — messages for a crew
  // =========================================================================

  describe('GET /agent-messages/crew/:id', () => {
    it('returns messages for the given crew', async () => {
      const messages = [
        makeMessage({ id: 'msg-1', crewId: 'crew-xyz' }),
        makeMessage({ id: 'msg-2', crewId: 'crew-xyz' }),
        makeMessage({ id: 'msg-3', crewId: 'crew-xyz' }),
      ];
      mockRepo.listByCrew.mockResolvedValue(messages);

      const res = await app.request('/agent-messages/crew/crew-xyz');

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(3);
      expect(mockRepo.listByCrew).toHaveBeenCalledWith('crew-xyz', 20, 0);
    });

    it('passes pagination params to repository', async () => {
      mockRepo.listByCrew.mockResolvedValue([]);

      await app.request('/agent-messages/crew/crew-xyz?limit=15&offset=30');

      expect(mockRepo.listByCrew).toHaveBeenCalledWith('crew-xyz', 15, 30);
    });

    it('returns 500 on repository error', async () => {
      mockRepo.listByCrew.mockRejectedValue(new Error('Permission denied'));

      const res = await app.request('/agent-messages/crew/crew-xyz');

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Permission denied');
    });
  });

  // =========================================================================
  // POST / — send a message
  // =========================================================================

  describe('POST /agent-messages', () => {
    it('creates a message with required fields and returns 201', async () => {
      mockRepo.create.mockResolvedValue(undefined);

      const res = await app.request('/agent-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'agent-b',
          content: 'Please process the data.',
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.to).toBe('agent-b');
      expect(json.data.content).toBe('Please process the data.');
      expect(json.data.from).toBe('user');
      expect(json.data.type).toBe('coordination');
      expect(json.data.priority).toBe('normal');
      expect(json.data.status).toBe('sent');
      expect(json.data.id).toBeDefined();
      expect(typeof json.data.id).toBe('string');
    });

    it('uses provided from, type, priority, and subject', async () => {
      mockRepo.create.mockResolvedValue(undefined);

      const res = await app.request('/agent-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'agent-a',
          to: 'agent-b',
          content: 'Urgent task.',
          type: 'task_delegation',
          priority: 'high',
          subject: 'Urgent',
          threadId: 'thread-99',
          crewId: 'crew-1',
          requiresResponse: true,
        }),
      });

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.from).toBe('agent-a');
      expect(json.data.type).toBe('task_delegation');
      expect(json.data.priority).toBe('high');
      expect(json.data.subject).toBe('Urgent');
      expect(json.data.threadId).toBe('thread-99');
      expect(json.data.crewId).toBe('crew-1');
      expect(json.data.requiresResponse).toBe(true);
    });

    it('persists the message via the repository', async () => {
      mockRepo.create.mockResolvedValue(undefined);

      await app.request('/agent-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'agent-b', content: 'Hello!' }),
      });

      expect(mockRepo.create).toHaveBeenCalledOnce();
      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'agent-b',
          content: 'Hello!',
          status: 'sent',
        })
      );
    });

    it('returns 400 when "to" field is missing', async () => {
      const res = await app.request('/agent-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'Missing recipient' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('to');
    });

    it('returns 400 when "content" field is missing', async () => {
      const res = await app.request('/agent-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'agent-b' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('content');
    });

    it('returns 500 when repository create fails', async () => {
      mockRepo.create.mockRejectedValue(new Error('Write failed'));

      const res = await app.request('/agent-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'agent-b', content: 'Test' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.error.message).toContain('Write failed');
    });

    it('parses deadline as a Date when provided', async () => {
      mockRepo.create.mockResolvedValue(undefined);

      await app.request('/agent-messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'agent-b',
          content: 'Do it by tomorrow.',
          deadline: '2026-03-06T12:00:00Z',
        }),
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          deadline: expect.any(Date),
        })
      );
    });
  });

  // =========================================================================
  // Response format
  // =========================================================================

  describe('Response format', () => {
    it('success responses include meta.timestamp', async () => {
      mockRepo.list.mockResolvedValue([]);
      mockRepo.count.mockResolvedValue(0);

      const res = await app.request('/agent-messages');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
      expect(new Date(json.meta.timestamp).getTime()).not.toBeNaN();
    });

    it('error responses include meta.timestamp', async () => {
      mockRepo.list.mockRejectedValue(new Error('fail'));
      mockRepo.count.mockResolvedValue(0);

      const res = await app.request('/agent-messages');
      const json = await res.json();

      expect(json.meta).toBeDefined();
      expect(json.meta.timestamp).toBeDefined();
    });
  });
});
