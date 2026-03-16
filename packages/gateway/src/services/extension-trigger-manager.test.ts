import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──

const mockTriggerService = {
  listTriggers: vi.fn(async () => []),
  createTrigger: vi.fn(async () => ({ id: 'trig-1' })),
  deleteTrigger: vi.fn(async () => true),
};

vi.mock('@ownpilot/core', async (importOriginal) => ({
  ...(await importOriginal()),
  getServiceRegistry: vi.fn(() => ({
    get: vi.fn(() => mockTriggerService),
  })),
  Services: { Trigger: 'trigger' },
}));

vi.mock('../db/repositories/extensions.js', () => ({
  extensionsRepo: {
    getAll: vi.fn(() => [{ id: 'ext-1' }, { id: 'ext-2' }]),
  },
}));

vi.mock('./log.js', () => ({
  getLog: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

const { activateExtensionTriggers, deactivateExtensionTriggers, cleanupOrphanTriggers } =
  await import('./extension-trigger-manager.js');

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
});

describe('activateExtensionTriggers', () => {
  it('does nothing when manifest has no triggers', async () => {
    await activateExtensionTriggers({ id: 'ext-1', name: 'Test', triggers: [] } as never, 'user-1');
    expect(mockTriggerService.createTrigger).not.toHaveBeenCalled();
  });

  it('does nothing when triggers is undefined', async () => {
    await activateExtensionTriggers({ id: 'ext-1', name: 'Test' } as never, 'user-1');
    expect(mockTriggerService.createTrigger).not.toHaveBeenCalled();
  });

  it('removes existing triggers with same prefix before creating', async () => {
    mockTriggerService.listTriggers.mockResolvedValue([
      { id: 'old-1', name: '[Ext:ext-1] Old trigger' },
      { id: 'other', name: 'Unrelated trigger' },
    ]);

    await activateExtensionTriggers(
      {
        id: 'ext-1',
        name: 'Test',
        triggers: [{ name: 'New', type: 'cron', config: {}, action: 'run' }],
      } as never,
      'user-1'
    );

    expect(mockTriggerService.deleteTrigger).toHaveBeenCalledWith('user-1', 'old-1');
    expect(mockTriggerService.deleteTrigger).not.toHaveBeenCalledWith('user-1', 'other');
  });

  it('creates triggers with prefixed name', async () => {
    await activateExtensionTriggers(
      {
        id: 'ext-1',
        name: 'My Extension',
        triggers: [
          {
            name: 'Daily Check',
            type: 'cron',
            config: { cron: '0 9 * * *' },
            action: 'notify',
            description: 'Runs daily',
          },
        ],
      } as never,
      'user-1'
    );

    expect(mockTriggerService.createTrigger).toHaveBeenCalledWith('user-1', {
      name: '[Ext:ext-1] Daily Check',
      description: 'Runs daily',
      type: 'cron',
      config: { cron: '0 9 * * *' },
      action: 'notify',
      enabled: true,
    });
  });

  it('continues creating remaining triggers on failure', async () => {
    mockTriggerService.createTrigger
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce({ id: 'trig-2' });

    await activateExtensionTriggers(
      {
        id: 'ext-1',
        name: 'Test',
        triggers: [
          { name: 'A', type: 'cron', config: {}, action: 'run' },
          { name: 'B', type: 'cron', config: {}, action: 'run' },
        ],
      } as never,
      'user-1'
    );

    expect(mockTriggerService.createTrigger).toHaveBeenCalledTimes(2);
  });
});

describe('deactivateExtensionTriggers', () => {
  it('deletes triggers matching extension prefix', async () => {
    mockTriggerService.listTriggers.mockResolvedValue([
      { id: 't1', name: '[Ext:ext-1] Trigger A' },
      { id: 't2', name: '[Ext:ext-1] Trigger B' },
      { id: 't3', name: '[Ext:ext-2] Other' },
    ]);

    await deactivateExtensionTriggers('ext-1', 'user-1');

    expect(mockTriggerService.deleteTrigger).toHaveBeenCalledTimes(2);
    expect(mockTriggerService.deleteTrigger).toHaveBeenCalledWith('user-1', 't1');
    expect(mockTriggerService.deleteTrigger).toHaveBeenCalledWith('user-1', 't2');
  });

  it('handles errors gracefully', async () => {
    mockTriggerService.listTriggers.mockRejectedValue(new Error('fail'));
    await expect(deactivateExtensionTriggers('ext-1', 'user-1')).resolves.toBeUndefined();
  });
});

describe('cleanupOrphanTriggers', () => {
  it('removes triggers for extensions not in DB', async () => {
    // extensionsRepo.getAll returns ext-1 and ext-2
    mockTriggerService.listTriggers.mockResolvedValue([
      { id: 't1', name: '[Ext:ext-1] Valid' },
      { id: 't2', name: '[Ext:deleted-ext] Orphan' },
      { id: 't3', name: 'Regular trigger' },
    ]);

    const cleaned = await cleanupOrphanTriggers('user-1');

    expect(cleaned).toBe(1);
    expect(mockTriggerService.deleteTrigger).toHaveBeenCalledWith('user-1', 't2');
    expect(mockTriggerService.deleteTrigger).toHaveBeenCalledTimes(1);
  });

  it('returns 0 when no orphans', async () => {
    mockTriggerService.listTriggers.mockResolvedValue([{ id: 't1', name: '[Ext:ext-1] Valid' }]);

    const cleaned = await cleanupOrphanTriggers('user-1');
    expect(cleaned).toBe(0);
  });

  it('handles errors gracefully', async () => {
    mockTriggerService.listTriggers.mockRejectedValue(new Error('DB error'));
    const cleaned = await cleanupOrphanTriggers();
    expect(cleaned).toBe(0);
  });
});
