import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ── Mocks ──

const mockRouter = {
  notify: vi.fn(async () => ({ sent: 1, channels: ['web'] })),
  notifyChannel: vi.fn(async () => 'msg-1'),
  broadcast: vi.fn(async () => ({ sent: 2, channels: ['web', 'telegram'] })),
  getPreferences: vi.fn(async () => ({
    channelPriority: ['web'],
    minPriority: 'low',
  })),
  setPreferences: vi.fn(async () => undefined),
};

vi.mock('../services/notification-router.js', () => ({
  getNotificationRouter: vi.fn(() => mockRouter),
  createNotification: vi.fn((title: string, body: string, opts: Record<string, unknown> = {}) => ({
    id: 'notif-1',
    title,
    body,
    ...opts,
  })),
}));

const { notificationRoutes } = await import('./notifications.js');

// ── App ──

function createApp() {
  const app = new Hono();
  app.route('/notifications', notificationRoutes);
  return app;
}

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /notifications/send', () => {
  it('sends notification and returns result', async () => {
    const app = createApp();
    const res = await app.request('/notifications/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Test', body: 'Hello' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.notification.id).toBe('notif-1');
    expect(mockRouter.notify).toHaveBeenCalledWith(
      'default',
      expect.objectContaining({ title: 'Test' })
    );
  });

  it('returns 400 when title is missing', async () => {
    const app = createApp();
    const res = await app.request('/notifications/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'No title' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is missing', async () => {
    const app = createApp();
    const res = await app.request('/notifications/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'No body' }),
    });
    expect(res.status).toBe(400);
  });

  it('passes userId when provided', async () => {
    const app = createApp();
    await app.request('/notifications/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'user-42', title: 'Hi', body: 'There' }),
    });
    expect(mockRouter.notify).toHaveBeenCalledWith('user-42', expect.anything());
  });
});

describe('POST /notifications/channel', () => {
  it('sends to specific channel', async () => {
    const app = createApp();
    const res = await app.request('/notifications/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: 'ch-1',
        chatId: 'chat-1',
        title: 'Alert',
        body: 'Details',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.messageId).toBe('msg-1');
    expect(mockRouter.notifyChannel).toHaveBeenCalledWith('ch-1', 'chat-1', expect.anything());
  });

  it('returns 400 when channelId missing', async () => {
    const app = createApp();
    const res = await app.request('/notifications/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId: 'c', title: 'T', body: 'B' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /notifications/broadcast', () => {
  it('broadcasts to all channels', async () => {
    const app = createApp();
    const res = await app.request('/notifications/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Broadcast', body: 'To all' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.result.sent).toBe(2);
    expect(mockRouter.broadcast).toHaveBeenCalled();
  });

  it('returns 400 when title missing', async () => {
    const app = createApp();
    const res = await app.request('/notifications/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'No title' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /notifications/preferences/:userId', () => {
  it('returns preferences for user', async () => {
    const app = createApp();
    const res = await app.request('/notifications/preferences/user-1');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.preferences.channelPriority).toEqual(['web']);
    expect(mockRouter.getPreferences).toHaveBeenCalledWith('user-1');
  });
});

describe('PUT /notifications/preferences/:userId', () => {
  it('updates preferences', async () => {
    const app = createApp();
    const res = await app.request('/notifications/preferences/user-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelPriority: ['telegram', 'web'], minPriority: 'medium' }),
    });

    expect(res.status).toBe(200);
    expect(mockRouter.setPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', minPriority: 'medium' })
    );
  });
});
