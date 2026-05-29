/**
 * Claw skill executor tests — claw_recall_skill and claw_save_skill (explicit
 * body path). Mocks the ExtensionService, claw context, and claws repo so no
 * DB / provider is touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockGetClawContext,
  mockInstallFromManifest,
  mockGetEnabledMetadata,
  mockGetById,
  mockGetClawById,
} = vi.hoisted(() => ({
  mockGetClawContext: vi.fn(),
  mockInstallFromManifest: vi.fn().mockResolvedValue({ id: 'installed' }),
  mockGetEnabledMetadata: vi.fn().mockReturnValue([]),
  mockGetById: vi.fn(),
  mockGetClawById: vi.fn(),
}));

vi.mock('../../services/claw/context.js', () => ({
  getClawContext: mockGetClawContext,
}));

vi.mock('../../services/extension/service.js', () => ({
  getExtensionService: () => ({
    installFromManifest: mockInstallFromManifest,
    getEnabledMetadata: mockGetEnabledMetadata,
    getById: mockGetById,
  }),
}));

vi.mock('../../db/repositories/claws.js', () => ({
  getClawsRepository: () => ({
    getById: mockGetClawById,
    getHistory: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
  }),
}));

const { executeRecallSkill, executeSaveSkill } = await import('./skill-executors.js');

const baseConfig = {
  id: 'claw-1',
  userId: 'user-1',
  name: 'Bot',
  mission: 'm',
  mode: 'continuous',
  allowedTools: [],
  limits: { maxTurnsPerCycle: 1, maxToolCallsPerCycle: 1, maxCyclesPerHour: 1, cycleTimeoutMs: 1 },
  autoStart: false,
  depth: 0,
  sandbox: 'auto',
  createdBy: 'user',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('executeRecallSkill', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requires a query', async () => {
    const res = await executeRecallSkill({}, 'user-1');
    expect(res.success).toBe(false);
  });

  it('returns matching learned skills as procedures', async () => {
    mockGetEnabledMetadata.mockReturnValue([
      {
        id: 'claw-learned-pricing',
        name: 'claw-learned-pricing',
        description: 'research competitor pricing',
        format: 'agentskills',
        toolNames: [],
        keywords: ['claw-learned', 'claw-1'],
      },
    ]);
    mockGetById.mockReturnValue({ manifest: { instructions: 'step 1' } });

    const res = await executeRecallSkill({ query: 'competitor pricing' }, 'user-1');
    expect(res.success).toBe(true);
    const result = res.result as { count: number; skills: Array<{ procedure: string }> };
    expect(result.count).toBe(1);
    expect(result.skills[0].procedure).toBe('step 1');
  });
});

describe('executeSaveSkill (explicit body)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fails outside a claw context', async () => {
    mockGetClawContext.mockReturnValue(undefined);
    const res = await executeSaveSkill({ title: 'x', procedure: 'y' }, 'user-1');
    expect(res.success).toBe(false);
  });

  it('persists a provided procedure as a learned skill', async () => {
    mockGetClawContext.mockReturnValue({ clawId: 'claw-1' });
    mockGetClawById.mockResolvedValue(baseConfig);

    const res = await executeSaveSkill(
      { title: 'Scrape a paginated table', procedure: '## Procedure\n1. open page' },
      'user-1'
    );

    expect(res.success).toBe(true);
    expect(mockInstallFromManifest).toHaveBeenCalledTimes(1);
    const [manifest, userId] = mockInstallFromManifest.mock.calls[0];
    expect(userId).toBe('user-1');
    expect(manifest.instructions).toContain('open page');
    expect(manifest.tags).toContain('claw-learned');
  });

  it('requires a title', async () => {
    mockGetClawContext.mockReturnValue({ clawId: 'claw-1' });
    const res = await executeSaveSkill({ procedure: 'y' }, 'user-1');
    expect(res.success).toBe(false);
  });
});
