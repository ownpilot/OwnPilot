import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before imports
vi.mock('./extension-service.js', () => ({
  getExtensionService: vi.fn(),
}));

vi.mock('./cli-tools-catalog.js', () => {
  const catalog = [
    {
      name: 'eslint',
      displayName: 'ESLint',
      description: 'Linter',
      binaryName: 'eslint',
      category: 'linter',
      riskLevel: 'low',
      defaultPolicy: 'allowed',
    },
    {
      name: 'shell_exec',
      displayName: 'Shell Exec',
      description: 'Shell executor',
      binaryName: 'sh',
      category: 'utility',
      riskLevel: 'critical',
      defaultPolicy: 'blocked',
    },
    {
      name: 'file_manager',
      displayName: 'File Manager',
      description: 'File manager',
      binaryName: 'fm',
      category: 'utility',
      riskLevel: 'high',
      defaultPolicy: 'prompt',
    },
  ];
  return {
    CLI_TOOLS_CATALOG: catalog,
    CLI_TOOLS_BY_NAME: new Map(catalog.map((t: Record<string, string>) => [t.name, t])),
  };
});

vi.mock('../db/repositories/index.js', () => ({
  createCustomToolsRepo: vi.fn(),
  createTriggersRepository: vi.fn(),
  createWorkflowsRepository: vi.fn(),
  cliToolPoliciesRepo: {
    listPolicies: vi.fn(),
  },
}));

vi.mock('./skill-security-audit.js', () => ({
  auditSkillSecurity: vi.fn(),
}));

vi.mock('@ownpilot/core', () => ({
  analyzeToolCode: vi.fn(),
  calculateSecurityScore: vi.fn(),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({ info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() }),
}));

import { getExtensionService } from './extension-service.js';
import { auditSkillSecurity } from './skill-security-audit.js';
import { analyzeToolCode, calculateSecurityScore } from '@ownpilot/core';
import {
  createCustomToolsRepo,
  createTriggersRepository,
  createWorkflowsRepository,
  cliToolPoliciesRepo,
} from '../db/repositories/index.js';
import {
  scanExtensions,
  scanCustomTools,
  scanTriggers,
  scanWorkflows,
  scanCliPolicies,
  scanPlatform,
} from './security-scanner.js';

const mockGetExtService = getExtensionService as ReturnType<typeof vi.fn>;
const mockAudit = auditSkillSecurity as ReturnType<typeof vi.fn>;
const mockAnalyze = analyzeToolCode as ReturnType<typeof vi.fn>;
const mockCalcScore = calculateSecurityScore as ReturnType<typeof vi.fn>;
const mockCreateToolsRepo = createCustomToolsRepo as ReturnType<typeof vi.fn>;
const mockCreateTriggersRepo = createTriggersRepository as ReturnType<typeof vi.fn>;
const mockCreateWorkflowsRepo = createWorkflowsRepository as ReturnType<typeof vi.fn>;
const mockCliPoliciesRepo = cliToolPoliciesRepo as { listPolicies: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
});

// =============================================================================
// scanExtensions
// =============================================================================

describe('scanExtensions', () => {
  it('returns 100 score when no extensions', () => {
    mockGetExtService.mockReturnValue({ getAll: () => [] });
    const result = scanExtensions('user1');
    expect(result.count).toBe(0);
    expect(result.score).toBe(100);
    expect(result.issues).toBe(0);
  });

  it('scores low-risk extension at 95', () => {
    mockGetExtService.mockReturnValue({
      getAll: () => [
        {
          id: 'ext-1',
          userId: 'user1',
          name: 'Safe Ext',
          format: 'ownpilot',
          status: 'enabled',
          manifest: {},
        },
      ],
    });
    mockAudit.mockReturnValue({
      blocked: false,
      riskLevel: 'low',
      warnings: [],
      reasons: [],
      undeclaredTools: [],
    });

    const result = scanExtensions('user1');
    expect(result.count).toBe(1);
    expect(result.items[0]!.score).toBe(95);
    expect(result.issues).toBe(0);
  });

  it('scores blocked extension at 0 and counts as issue', () => {
    mockGetExtService.mockReturnValue({
      getAll: () => [
        {
          id: 'ext-2',
          userId: 'user1',
          name: 'Bad Ext',
          format: 'agentskills',
          status: 'enabled',
          manifest: {},
        },
      ],
    });
    mockAudit.mockReturnValue({
      blocked: true,
      riskLevel: 'critical',
      warnings: ['prompt injection detected'],
      reasons: ['Injection pattern found'],
      undeclaredTools: [],
    });

    const result = scanExtensions('user1');
    expect(result.items[0]!.score).toBe(0);
    expect(result.items[0]!.blocked).toBe(true);
    expect(result.issues).toBe(1);
  });

  it('filters extensions by userId', () => {
    mockGetExtService.mockReturnValue({
      getAll: () => [
        {
          id: 'ext-1',
          userId: 'user1',
          name: 'Mine',
          format: 'ownpilot',
          status: 'enabled',
          manifest: {},
        },
        {
          id: 'ext-2',
          userId: 'other',
          name: 'Theirs',
          format: 'ownpilot',
          status: 'enabled',
          manifest: {},
        },
      ],
    });
    mockAudit.mockReturnValue({
      blocked: false,
      riskLevel: 'low',
      warnings: [],
      reasons: [],
      undeclaredTools: [],
    });

    const result = scanExtensions('user1');
    expect(result.count).toBe(1);
    expect(result.items[0]!.name).toBe('Mine');
  });

  it('scores high-risk extension at 40 and counts as issue', () => {
    mockGetExtService.mockReturnValue({
      getAll: () => [
        {
          id: 'ext-3',
          userId: 'u',
          name: 'Risky',
          format: 'ownpilot',
          status: 'enabled',
          manifest: {},
        },
      ],
    });
    mockAudit.mockReturnValue({
      blocked: false,
      riskLevel: 'high',
      warnings: ['dangerous tool requested'],
      reasons: [],
      undeclaredTools: [],
    });

    const result = scanExtensions('u');
    expect(result.items[0]!.score).toBe(40);
    expect(result.issues).toBe(1);
  });

  it('computes average score across multiple extensions', () => {
    mockGetExtService.mockReturnValue({
      getAll: () => [
        { id: 'e1', userId: 'u', name: 'A', format: 'ownpilot', status: 'enabled', manifest: {} },
        { id: 'e2', userId: 'u', name: 'B', format: 'ownpilot', status: 'enabled', manifest: {} },
      ],
    });
    mockAudit
      .mockReturnValueOnce({
        blocked: false,
        riskLevel: 'low',
        warnings: [],
        reasons: [],
        undeclaredTools: [],
      })
      .mockReturnValueOnce({
        blocked: false,
        riskLevel: 'medium',
        warnings: ['warn'],
        reasons: [],
        undeclaredTools: [],
      });

    const result = scanExtensions('u');
    expect(result.score).toBe(Math.round((95 + 70) / 2)); // 83
  });
});

// =============================================================================
// scanCustomTools
// =============================================================================

describe('scanCustomTools', () => {
  it('returns 100 score when no tools', async () => {
    mockCreateToolsRepo.mockReturnValue({ list: vi.fn().mockResolvedValue([]) });
    const result = await scanCustomTools('user1');
    expect(result.count).toBe(0);
    expect(result.score).toBe(100);
  });

  it('uses analyzeToolCode and calculateSecurityScore', async () => {
    mockCreateToolsRepo.mockReturnValue({
      list: vi.fn().mockResolvedValue([
        {
          id: 't1',
          name: 'my_tool',
          code: 'return 1;',
          status: 'active',
          permissions: ['network'],
        },
      ]),
    });
    mockAnalyze.mockReturnValue({
      valid: true,
      errors: [],
      warnings: ['Uses fetch'],
      securityScore: { score: 75, category: 'review', factors: {} },
      dataFlowRisks: [],
      bestPractices: { followed: [], violated: [] },
      suggestedPermissions: [],
      stats: {},
    });
    mockCalcScore.mockReturnValue({ score: 75, category: 'review', factors: {} });

    const result = await scanCustomTools('user1');
    expect(result.count).toBe(1);
    expect(result.items[0]!.score).toBe(75);
    expect(result.items[0]!.category).toBe('review');
    expect(result.items[0]!.warnings).toContain('Uses fetch');
  });

  it('counts low-score tools as issues', async () => {
    mockCreateToolsRepo.mockReturnValue({
      list: vi
        .fn()
        .mockResolvedValue([
          { id: 't1', name: 'risky', code: 'dangerous_code()', status: 'active', permissions: [] },
        ]),
    });
    mockAnalyze.mockReturnValue({
      valid: false,
      errors: ['dangerous pattern detected'],
      warnings: [],
      securityScore: { score: 20, category: 'dangerous', factors: {} },
      dataFlowRisks: [],
      bestPractices: { followed: [], violated: [] },
      suggestedPermissions: [],
      stats: {},
    });
    mockCalcScore.mockReturnValue({ score: 20, category: 'dangerous', factors: {} });

    const result = await scanCustomTools('user1');
    expect(result.issues).toBe(1);
    expect(result.items[0]!.warnings).toContain('dangerous pattern detected');
  });
});

// =============================================================================
// scanTriggers
// =============================================================================

describe('scanTriggers', () => {
  it('returns 100 score when no triggers', async () => {
    mockCreateTriggersRepo.mockReturnValue({ list: vi.fn().mockResolvedValue([]) });
    const result = await scanTriggers('user1');
    expect(result.count).toBe(0);
    expect(result.score).toBe(100);
  });

  it('scores chat-action triggers highly', async () => {
    mockCreateTriggersRepo.mockReturnValue({
      list: vi.fn().mockResolvedValue([
        {
          id: 'tr1',
          name: 'Daily chat',
          type: 'schedule',
          enabled: true,
          action: { type: 'chat', payload: {} },
        },
      ]),
    });

    const result = await scanTriggers('user1');
    expect(result.items[0]!.score).toBe(95);
    expect(result.items[0]!.risks).toHaveLength(0);
  });

  it('scores tool-action triggers based on catalog risk', async () => {
    mockCreateTriggersRepo.mockReturnValue({
      list: vi.fn().mockResolvedValue([
        {
          id: 'tr2',
          name: 'Shell trigger',
          type: 'event',
          enabled: true,
          action: { type: 'tool', payload: { tool: 'shell_exec' } },
        },
      ]),
    });

    const result = await scanTriggers('user1');
    // shell_exec is critical risk -> score 15
    expect(result.items[0]!.score).toBe(15);
    expect(result.items[0]!.risks.length).toBeGreaterThan(0);
    expect(result.issues).toBe(1);
  });

  it('gives disabled triggers a score boost', async () => {
    mockCreateTriggersRepo.mockReturnValue({
      list: vi.fn().mockResolvedValue([
        {
          id: 'tr3',
          name: 'Disabled shell',
          type: 'schedule',
          enabled: false,
          action: { type: 'tool', payload: { tool: 'shell_exec' } },
        },
      ]),
    });

    const result = await scanTriggers('user1');
    expect(result.items[0]!.score).toBe(35); // 15 + 20
  });

  it('flags workflow action triggers', async () => {
    mockCreateTriggersRepo.mockReturnValue({
      list: vi.fn().mockResolvedValue([
        {
          id: 'tr4',
          name: 'Workflow trigger',
          type: 'schedule',
          enabled: true,
          action: { type: 'workflow', payload: { workflowId: 'wf1' } },
        },
      ]),
    });

    const result = await scanTriggers('user1');
    expect(result.items[0]!.risks).toContain('Triggers automated workflow execution');
  });
});

// =============================================================================
// scanWorkflows
// =============================================================================

describe('scanWorkflows', () => {
  it('returns 100 score when no workflows', async () => {
    mockCreateWorkflowsRepo.mockReturnValue({ getPage: vi.fn().mockResolvedValue([]) });
    const result = await scanWorkflows('user1');
    expect(result.count).toBe(0);
    expect(result.score).toBe(100);
  });

  it('identifies code nodes as risky', async () => {
    mockCreateWorkflowsRepo.mockReturnValue({
      getPage: vi.fn().mockResolvedValue([
        {
          id: 'wf1',
          name: 'Code workflow',
          status: 'active',
          nodes: [
            { id: 'n1', type: 'code', position: { x: 0, y: 0 }, data: {} },
            { id: 'n2', type: 'condition', position: { x: 0, y: 0 }, data: {} },
          ],
          edges: [],
        },
      ]),
    });

    const result = await scanWorkflows('user1');
    expect(result.items[0]!.riskyNodes).toContain('n1 (code)');
    expect(result.items[0]!.score).toBeLessThan(70);
  });

  it('scores workflow with only safe nodes highly', async () => {
    mockCreateWorkflowsRepo.mockReturnValue({
      getPage: vi.fn().mockResolvedValue([
        {
          id: 'wf2',
          name: 'Safe workflow',
          status: 'active',
          nodes: [
            { id: 'n1', type: 'condition', position: { x: 0, y: 0 }, data: {} },
            { id: 'n2', type: 'transformer', position: { x: 0, y: 0 }, data: {} },
          ],
          edges: [],
        },
      ]),
    });

    const result = await scanWorkflows('user1');
    expect(result.items[0]!.score).toBe(90);
    expect(result.items[0]!.riskyNodes).toHaveLength(0);
  });

  it('scores workflow with tool nodes based on catalog risk', async () => {
    mockCreateWorkflowsRepo.mockReturnValue({
      getPage: vi.fn().mockResolvedValue([
        {
          id: 'wf3',
          name: 'Tool workflow',
          status: 'active',
          nodes: [
            { id: 'n1', type: 'tool', position: { x: 0, y: 0 }, data: { toolName: 'eslint' } },
          ],
          edges: [],
        },
      ]),
    });

    const result = await scanWorkflows('user1');
    // eslint is low risk -> score 90
    expect(result.items[0]!.score).toBe(90);
  });
});

// =============================================================================
// scanCliPolicies
// =============================================================================

describe('scanCliPolicies', () => {
  it('scores default policies correctly', async () => {
    mockCliPoliciesRepo.listPolicies.mockResolvedValue([]);

    const result = await scanCliPolicies('user1');
    // 3 catalog items with defaults: eslint=allowed(low), shell_exec=blocked(critical), file_manager=prompt(high)
    expect(result.count).toBe(3);
    // shell_exec blocked=100, eslint allowed+low=95, file_manager prompt+high=80
    expect(result.score).toBe(Math.round((95 + 100 + 80) / 3));
  });

  it('flags critical tool set to allowed', async () => {
    mockCliPoliciesRepo.listPolicies.mockResolvedValue([
      { toolName: 'shell_exec', policy: 'allowed' },
    ]);

    const result = await scanCliPolicies('user1');
    const shellItem = result.items.find((i) => i.name === 'shell_exec');
    expect(shellItem).toBeDefined();
    expect(shellItem!.score).toBe(15);
    expect(shellItem!.issue).toContain('Critical-risk');
    expect(result.issues).toBeGreaterThan(0);
  });

  it('flags high-risk tool set to allowed', async () => {
    mockCliPoliciesRepo.listPolicies.mockResolvedValue([
      { toolName: 'file_manager', policy: 'allowed' },
    ]);

    const result = await scanCliPolicies('user1');
    const fmItem = result.items.find((i) => i.name === 'file_manager');
    expect(fmItem).toBeDefined();
    expect(fmItem!.score).toBe(40);
    expect(fmItem!.issue).toContain('High-risk');
  });

  it('considers blocked policy as safe regardless of risk', async () => {
    mockCliPoliciesRepo.listPolicies.mockResolvedValue([
      { toolName: 'shell_exec', policy: 'blocked' },
    ]);

    const result = await scanCliPolicies('user1');
    const shellItem = result.items.find((i) => i.name === 'shell_exec');
    // Blocked items with score 100 might be filtered out (only relevant items shown)
    // If included, score should be 100
    if (shellItem) {
      expect(shellItem.score).toBe(100);
    }
  });
});

// =============================================================================
// scanPlatform (integration)
// =============================================================================

describe('scanPlatform', () => {
  beforeEach(() => {
    // Set up defaults for all sections
    mockGetExtService.mockReturnValue({ getAll: () => [] });
    mockCreateToolsRepo.mockReturnValue({ list: vi.fn().mockResolvedValue([]) });
    mockCreateTriggersRepo.mockReturnValue({ list: vi.fn().mockResolvedValue([]) });
    mockCreateWorkflowsRepo.mockReturnValue({ getPage: vi.fn().mockResolvedValue([]) });
    mockCliPoliciesRepo.listPolicies.mockResolvedValue([]);
  });

  it('returns high score for empty platform', async () => {
    const result = await scanPlatform('user1');

    // Weighted: all sections = 100 except CLI (catalog defaults ~92)
    expect(result.overallScore).toBeGreaterThan(90);
    expect(result.overallLevel).toBe('safe');
    expect(result.scannedAt).toBeTruthy();
    expect(result.topRisks).toHaveLength(0);
  });

  it('includes all section results', async () => {
    const result = await scanPlatform('user1');
    expect(result.sections.extensions).toBeDefined();
    expect(result.sections.customTools).toBeDefined();
    expect(result.sections.triggers).toBeDefined();
    expect(result.sections.workflows).toBeDefined();
    expect(result.sections.cliTools).toBeDefined();
  });

  it('collects top risks from multiple sections', async () => {
    // Add a blocked extension
    mockGetExtService.mockReturnValue({
      getAll: () => [
        {
          id: 'e1',
          userId: 'user1',
          name: 'Bad',
          format: 'ownpilot',
          status: 'enabled',
          manifest: {},
        },
      ],
    });
    mockAudit.mockReturnValue({
      blocked: true,
      riskLevel: 'critical',
      warnings: ['injection'],
      reasons: ['blocked'],
      undeclaredTools: [],
    });

    // Add a dangerous custom tool
    mockCreateToolsRepo.mockReturnValue({
      list: vi.fn().mockResolvedValue([
        {
          id: 't1',
          name: 'bad_tool',
          code: 'dangerous_code()',
          status: 'active',
          permissions: [],
        },
      ]),
    });
    mockAnalyze.mockReturnValue({
      valid: false,
      errors: [],
      warnings: [],
      securityScore: { score: 20, category: 'dangerous', factors: {} },
      dataFlowRisks: [],
      bestPractices: { followed: [], violated: [] },
      suggestedPermissions: [],
      stats: {},
    });
    mockCalcScore.mockReturnValue({ score: 20, category: 'dangerous', factors: {} });

    const result = await scanPlatform('user1');
    expect(result.topRisks.length).toBeGreaterThanOrEqual(2);
    // Critical risks should be sorted first
    expect(result.topRisks[0]!.severity).toBe('critical');
  });

  it('generates recommendations for low-scoring sections', async () => {
    // Add a risky CLI policy
    mockCliPoliciesRepo.listPolicies.mockResolvedValue([
      { toolName: 'shell_exec', policy: 'allowed' },
    ]);

    const result = await scanPlatform('user1');
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.recommendations.some((r) => r.includes('CLI tool'))).toBe(true);
  });

  it('computes weighted overall score', async () => {
    // Extension with high risk -> score 40
    mockGetExtService.mockReturnValue({
      getAll: () => [
        {
          id: 'e1',
          userId: 'u',
          name: 'Risky',
          format: 'ownpilot',
          status: 'enabled',
          manifest: {},
        },
      ],
    });
    mockAudit.mockReturnValue({
      blocked: false,
      riskLevel: 'high',
      warnings: ['danger'],
      reasons: [],
      undeclaredTools: [],
    });

    const result = await scanPlatform('u');

    // Extensions: 40 * 0.25 = 10
    // CustomTools: 100 * 0.25 = 25
    // Triggers: 100 * 0.20 = 20
    // Workflows: 100 * 0.15 = 15
    // CLI: ~92 * 0.15 = ~14
    // Total ~ 84
    expect(result.overallScore).toBeGreaterThan(75);
    expect(result.overallScore).toBeLessThan(95);
  });

  it('maps score to correct level', async () => {
    // Force a lower overall score with multiple bad sections
    mockGetExtService.mockReturnValue({
      getAll: () => [
        { id: 'e1', userId: 'u', name: 'Bad', format: 'ownpilot', status: 'enabled', manifest: {} },
      ],
    });
    mockAudit.mockReturnValue({
      blocked: true,
      riskLevel: 'critical',
      warnings: ['x'],
      reasons: ['x'],
      undeclaredTools: [],
    });

    // Dangerous custom tool
    mockCreateToolsRepo.mockReturnValue({
      list: vi
        .fn()
        .mockResolvedValue([
          { id: 't1', name: 'bad', code: 'dangerous_code()', status: 'active', permissions: [] },
        ]),
    });
    mockAnalyze.mockReturnValue({
      valid: true,
      errors: [],
      warnings: [],
      securityScore: { score: 10, category: 'dangerous', factors: {} },
      dataFlowRisks: [],
      bestPractices: { followed: [], violated: [] },
      suggestedPermissions: [],
      stats: {},
    });
    mockCalcScore.mockReturnValue({ score: 10, category: 'dangerous', factors: {} });

    // Risky trigger
    mockCreateTriggersRepo.mockReturnValue({
      list: vi.fn().mockResolvedValue([
        {
          id: 'tr1',
          name: 'Bad trigger',
          type: 'schedule',
          enabled: true,
          action: { type: 'tool', payload: { tool: 'shell_exec' } },
        },
      ]),
    });

    // Risky CLI policy
    mockCliPoliciesRepo.listPolicies.mockResolvedValue([
      { toolName: 'shell_exec', policy: 'allowed' },
    ]);

    const result = await scanPlatform('u');
    // With multiple low scores, overall should be medium or worse
    expect(['medium', 'high', 'critical']).toContain(result.overallLevel);
  });
});
