import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseAdapter } from '../../adapters/types.js';

const mockAdapter: {
  [K in keyof DatabaseAdapter]: ReturnType<typeof vi.fn>;
} = {
  type: 'postgres' as unknown as ReturnType<typeof vi.fn>,
  isConnected: vi.fn().mockReturnValue(true),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
  execute: vi.fn().mockResolvedValue({ changes: 0 }),
  exec: vi.fn().mockResolvedValue(undefined),
  transaction: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
  now: vi.fn().mockReturnValue('NOW()'),
  date: vi.fn(),
  dateSubtract: vi.fn(),
  placeholder: vi.fn().mockImplementation((i: number) => `$${i}`),
  boolean: vi.fn().mockImplementation((v: boolean) => v),
  parseBoolean: vi.fn().mockImplementation((v: unknown) => Boolean(v)),
  close: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../adapters/index.js', () => ({
  getAdapter: vi.fn().mockResolvedValue(mockAdapter),
  getAdapterSync: vi.fn().mockReturnValue(mockAdapter),
}));

const { DmPairingRequestsRepository } = await import('./dm-pairing.js');

function makeRequestRow() {
  return {
    id: 'token-1',
    platform: 'telegram',
    platform_user_id: 'sender-1',
    code: '654321',
    expires_at: '2026-07-26T12:10:00.000Z',
    created_at: '2026-07-26T12:00:00.000Z',
    used_at: '2026-07-26T12:01:00.000Z',
  };
}

describe('DmPairingRequestsRepository', () => {
  let repo: InstanceType<typeof DmPairingRequestsRepository>;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new DmPairingRequestsRepository();
  });

  it('creates a request after removing stale code collisions', async () => {
    mockAdapter.execute.mockResolvedValue({ changes: 1 });
    mockAdapter.queryOne.mockResolvedValueOnce({
      ...makeRequestRow(),
      used_at: null,
    });

    const result = await repo.create({
      platform: 'telegram',
      platformUserId: 'sender-1',
      code: '654321',
    });

    expect(result).toMatchObject({
      platform: 'telegram',
      platformUserId: 'sender-1',
      code: '654321',
    });
    expect(mockAdapter.execute).toHaveBeenCalledTimes(3);
    const staleDeleteSql = mockAdapter.execute.mock.calls[1]![0] as string;
    expect(staleDeleteSql).toContain('expires_at <= NOW()');
    expect(mockAdapter.execute.mock.calls[1]![1]).toEqual(['telegram', '654321']);
    const insertSql = mockAdapter.execute.mock.calls[2]![0] as string;
    expect(insertSql).toContain('ON CONFLICT DO NOTHING');
  });

  it('returns null when an active code conflicts', async () => {
    mockAdapter.execute
      .mockResolvedValueOnce({ changes: 1 })
      .mockResolvedValueOnce({ changes: 0 })
      .mockResolvedValueOnce({ changes: 0 });

    await expect(
      repo.create({
        platform: 'telegram',
        platformUserId: 'sender-1',
        code: '654321',
      })
    ).resolves.toBeNull();

    expect(mockAdapter.queryOne).not.toHaveBeenCalled();
  });

  it('atomically consumes a valid code and returns the claimed request', async () => {
    mockAdapter.queryOne.mockResolvedValueOnce(makeRequestRow());

    const result = await repo.consumeByCode('654321', 'telegram');

    expect(result).toMatchObject({
      id: 'token-1',
      platform: 'telegram',
      platformUserId: 'sender-1',
      code: '654321',
    });
    const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE dm_pairing_requests');
    expect(sql).toContain('SET used_at = NOW()');
    expect(sql).toContain('AND used_at IS NULL');
    expect(sql).toContain('AND expires_at > NOW()');
    expect(sql).toContain('RETURNING *');
    expect(params).toEqual(['654321', 'telegram']);
  });

  it('returns null when another request already consumed the code', async () => {
    mockAdapter.queryOne.mockResolvedValueOnce(null);

    await expect(repo.consumeByCode('654321', 'telegram')).resolves.toBeNull();
  });

  it('conditionally consumes a token by id', async () => {
    mockAdapter.queryOne.mockResolvedValueOnce({ id: 'token-1' });

    await expect(repo.consume('token-1')).resolves.toBe(true);

    const [sql, params] = mockAdapter.queryOne.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('WHERE id = $1');
    expect(sql).toContain('AND used_at IS NULL');
    expect(sql).toContain('AND expires_at > NOW()');
    expect(sql).toContain('RETURNING id');
    expect(params).toEqual(['token-1']);
  });

  it('reports a token that was already consumed as unclaimed', async () => {
    mockAdapter.queryOne.mockResolvedValueOnce(null);

    await expect(repo.consume('token-1')).resolves.toBe(false);
  });
});
