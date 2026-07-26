import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockBroadcast, mockLog } = vi.hoisted(() => ({
  mockBroadcast: vi.fn(),
  mockLog: { info: vi.fn() },
}));

vi.mock('../ws/server.js', () => ({
  wsGateway: { broadcast: mockBroadcast },
}));

vi.mock('../services/log.js', () => ({
  getLog: () => mockLog,
}));

import { DmPairingService } from './dm-pairing-service.js';

function createHarness() {
  const requests = {
    listPending: vi.fn(),
    create: vi.fn(),
    consumeByCode: vi.fn(),
    findValidToken: vi.fn(),
    consume: vi.fn(),
  };
  const users = {
    findByPlatform: vi.fn(),
    updateStatus: vi.fn(),
    markVerified: vi.fn(),
    block: vi.fn(),
  };
  const service = new DmPairingService(requests as never, users as never);
  return { service, requests, users };
}

describe('DmPairingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a pending request and marks an existing sender pending', async () => {
    const { service, requests, users } = createHarness();
    requests.create.mockResolvedValue({});
    users.findByPlatform.mockResolvedValue({ id: 'channel-user-1' });

    const code = await service.generateDmPairingCode(
      'telegram.main',
      'telegram',
      'sender-1',
      'owner-1'
    );

    expect(code).toMatch(/^\d{6}$/);
    expect(requests.create).toHaveBeenCalledWith({
      platform: 'telegram',
      platformUserId: 'sender-1',
      code,
      expiresInMinutes: 10,
    });
    expect(users.updateStatus).toHaveBeenCalledWith('channel-user-1', 'pending');
    expect(mockBroadcast).toHaveBeenCalledWith('data:changed', {
      entity: 'dm-pairing',
      action: 'pending',
    });
  });

  it('retries when a generated code conflicts with another pending sender', async () => {
    const { service, requests, users } = createHarness();
    requests.create.mockResolvedValueOnce(null).mockResolvedValueOnce({});
    users.findByPlatform.mockResolvedValue(null);

    const code = await service.generateDmPairingCode(
      'telegram.main',
      'telegram',
      'sender-1',
      'owner-1'
    );

    expect(code).toMatch(/^\d{6}$/);
    expect(requests.create).toHaveBeenCalledTimes(2);
    expect(requests.create.mock.calls[1]![0]).toMatchObject({
      platform: 'telegram',
      platformUserId: 'sender-1',
      code,
    });
  });

  it('fails closed after repeated pairing-code collisions', async () => {
    const { service, requests, users } = createHarness();
    requests.create.mockResolvedValue(null);

    await expect(
      service.generateDmPairingCode('telegram.main', 'telegram', 'sender-1', 'owner-1')
    ).rejects.toThrow('Could not allocate a unique DM pairing code');

    expect(requests.create).toHaveBeenCalledTimes(5);
    expect(users.findByPlatform).not.toHaveBeenCalled();
    expect(mockBroadcast).not.toHaveBeenCalled();
  });

  it('rejects an invalid or expired approval code', async () => {
    const { service, requests, users } = createHarness();
    requests.consumeByCode.mockResolvedValue(null);

    await expect(service.approvePendingSender('telegram', '123456')).resolves.toEqual({
      success: false,
      error: 'Invalid or expired code.',
    });
    expect(requests.consume).not.toHaveBeenCalled();
    expect(users.updateStatus).not.toHaveBeenCalled();
  });

  it('approves a sender without logging the pairing credential', async () => {
    const { service, requests, users } = createHarness();
    requests.consumeByCode.mockResolvedValue({
      id: 'token-1',
      platformUserId: 'sender-1',
      usedAt: new Date(),
    });
    users.findByPlatform.mockResolvedValue({ id: 'channel-user-1' });

    await expect(service.approvePendingSender('telegram', '654321')).resolves.toEqual({
      success: true,
    });

    expect(requests.consumeByCode).toHaveBeenCalledWith('654321', 'telegram');
    expect(users.updateStatus).toHaveBeenCalledWith('channel-user-1', 'active');
    expect(users.markVerified).toHaveBeenCalledWith('channel-user-1', 'default', 'admin');
    expect(mockLog.info).toHaveBeenCalledWith('Pending sender approved via DM pairing code', {
      platform: 'telegram',
      senderUserId: 'sender-1',
    });
    expect(mockLog.info).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ code: expect.anything() })
    );
  });

  it('allows only one of two concurrent approvals to activate the sender', async () => {
    const { service, requests, users } = createHarness();
    requests.consumeByCode
      .mockResolvedValueOnce({
        id: 'token-1',
        platformUserId: 'sender-1',
        usedAt: new Date(),
      })
      .mockResolvedValueOnce(null);
    users.findByPlatform.mockResolvedValue({ id: 'channel-user-1' });

    const results = await Promise.all([
      service.approvePendingSender('telegram', '654321'),
      service.approvePendingSender('telegram', '654321'),
    ]);

    expect(results).toEqual([
      { success: true },
      { success: false, error: 'Invalid or expired code.' },
    ]);
    expect(requests.consumeByCode).toHaveBeenCalledTimes(2);
    expect(users.updateStatus).toHaveBeenCalledOnce();
    expect(users.markVerified).toHaveBeenCalledOnce();
  });

  it('denies a sender and consumes an existing token', async () => {
    const { service, requests, users } = createHarness();
    requests.findValidToken.mockResolvedValue({ id: 'token-1' });
    users.findByPlatform.mockResolvedValue({ id: 'channel-user-1' });

    await expect(service.denyPendingSender('discord', 'sender-1')).resolves.toEqual({
      success: true,
    });

    expect(requests.consume).toHaveBeenCalledWith('token-1');
    expect(users.block).toHaveBeenCalledWith('channel-user-1');
  });

  it('enriches pending requests with channel display names', async () => {
    const { service, requests, users } = createHarness();
    const expiresAt = new Date('2026-01-01T00:10:00.000Z');
    requests.listPending.mockResolvedValue([
      { platformUserId: 'sender-1', code: '123456', expiresAt },
    ]);
    users.findByPlatform.mockResolvedValue({
      id: 'channel-user-1',
      displayName: 'Ada',
    });

    await expect(service.listPendingSenders('telegram')).resolves.toEqual([
      {
        platformUserId: 'sender-1',
        displayName: 'Ada',
        code: '123456',
        expiresAt,
      },
    ]);
  });
});
