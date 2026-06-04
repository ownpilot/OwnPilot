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

function createApp(authUserId?: string) {
  const app = new Hono();
  // Simulate the auth middleware having established an identity.
  if (authUserId !== undefined) {
    app.use('*', async (c, next) => {
      c.set('userId', authUserId);
      await next();
    });
  }
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

  it('ignores client-supplied body.userId and scopes to the authenticated user (IDOR)', async () => {
    const app = createApp('default');
    await app.request('/notifications/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Attacker tries to push a notification onto 'victim' channels.
      body: JSON.stringify({ userId: 'victim', title: 'Hi', body: 'There' }),
    });
    expect(mockRouter.notify).toHaveBeenCalledWith('default', expect.anything());
    expect(mockRouter.notify).not.toHaveBeenCalledWith('victim', expect.anything());
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
  it('reads preferences scoped to the authenticated user, ignoring the :userId param (IDOR)', async () => {
    const app = createApp('default');
    // Attacker requests another user's preferences via the URL param.
    const res = await app.request('/notifications/preferences/victim');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.preferences.channelPriority).toEqual(['web']);
    expect(mockRouter.getPreferences).toHaveBeenCalledWith('default');
    expect(mockRouter.getPreferences).not.toHaveBeenCalledWith('victim');
  });
});

describe('PUT /notifications/preferences/:userId', () => {
  it('writes preferences scoped to the authenticated user, ignoring the :userId param (IDOR)', async () => {
    const app = createApp('default');
    const res = await app.request('/notifications/preferences/victim', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelPriority: ['telegram', 'web'], minPriority: 'normal' }),
    });

    expect(res.status).toBe(200);
    expect(mockRouter.setPreferences).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'default', minPriority: 'normal' })
    );
    expect(mockRouter.setPreferences).not.toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'victim' })
    );
  });
});
