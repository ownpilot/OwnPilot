/**
 * Unit tests for plan-generator module
 *
 * Tests cover:
 * - formatPlanMd: YAML frontmatter + markdown body generation
 * - parsePlanOutput: JSON extraction from CC output (plain, code block, wrapped)
 * - writePlanFiles: filesystem writing with proper directory structure
 * - generatePlans: CC synthesis via claudeManager mock
 * - slugify: title normalization for directory/file names
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Mock dependencies BEFORE importing the module under test
// ---------------------------------------------------------------------------

const { mockSend } = vi.hoisted(() => ({
  mockSend: vi.fn(),
}));

vi.mock('../src/claude-manager.ts', () => ({
  claudeManager: {
    send: mockSend,
  },
}));

vi.mock('../src/utils/logger.ts', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Import AFTER mocks
// ---------------------------------------------------------------------------

import {
  formatPlanMd,
  parsePlanOutput,
  writePlanFiles,
  generatePlans,
  slugify,
} from '../src/plan-generator.ts';
import type { GeneratedPlanEntry, GeneratedPlan, PlanGenerationInput } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlanEntry(overrides: Partial<GeneratedPlanEntry> = {}): GeneratedPlanEntry {
  return {
    planId: '01',
    title: 'Add user auth module',
    wave: 1,
    dependsOn: [],
    tdd: true,
    goal: 'Implement JWT-based authentication',
    tasks: ['Create auth middleware', 'Add token validation', 'Write integration tests'],
    testStrategy: 'Unit tests for middleware, integration tests for token flow',
    estimatedFiles: ['src/auth.ts', 'tests/auth.test.ts'],
    ...overrides,
  };
}

function makeGeneratedPlan(overrides: Partial<GeneratedPlan> = {}): GeneratedPlan {
  return {
    phaseNumber: 18,
    phaseTitle: 'God Mode Authentication',
    plans: [makePlanEntry()],
    ...overrides,
  };
}

async function* mockStream(chunks: Array<{ type: string; text?: string; error?: string; usage?: unknown }>) {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('plan-generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // formatPlanMd
  // =========================================================================
  describe('formatPlanMd', () => {
    it('produces valid YAML frontmatter', () => {
      const plan = makePlanEntry();
      const result = formatPlanMd(18, plan, 'src/auth.ts', 'src/index.ts');

      // Must start and end frontmatter with ---
      expect(result).toMatch(/^---\n/);
      expect(result).toMatch(/\n---\n/);

      // Check frontmatter fields
      expect(result).toContain('phase: 18');
      expect(result).toContain('plan: "01"');
      expect(result).toContain('title: "Add user auth module"');
      expect(result).toContain('wave: 1');
      expect(result).toContain('depends_on: []');
      expect(result).toContain('tdd: true');
    });

    it('includes all plan fields in markdown body', () => {
      const plan = makePlanEntry();
      const result = formatPlanMd(18, plan, 'src/auth.ts', 'src/index.ts');

      expect(result).toContain('## Goal');
      expect(result).toContain('Implement JWT-based authentication');
      expect(result).toContain('## Tasks');
      expect(result).toContain('Create auth middleware');
      expect(result).toContain('Add token validation');
      expect(result).toContain('Write integration tests');
      expect(result).toContain('## Test Strategy');
      expect(result).toContain('Unit tests for middleware');
      expect(result).toContain('## Estimated Files');
      expect(result).toContain('src/auth.ts');
      expect(result).toContain('tests/auth.test.ts');
      expect(result).toContain('## Scope');
      expect(result).toContain('- IN: src/auth.ts');
      expect(result).toContain('- OUT: src/index.ts');
    });

    it('handles empty tasks array', () => {
      const plan = makePlanEntry({ tasks: [] });
      const result = formatPlanMd(18, plan, 'in', 'out');

      expect(result).toContain('## Tasks');
      // No TASK- lines should appear
      expect(result).not.toMatch(/TASK-\d+/);
    });

    it('handles empty dependsOn', () => {
      const plan = makePlanEntry({ dependsOn: [] });
      const result = formatPlanMd(18, plan, 'in', 'out');
      expect(result).toContain('depends_on: []');
    });

    it('handles special characters in title and goal', () => {
      const plan = makePlanEntry({
        title: 'Fix "quotes" & <angles>',
        goal: 'Handle edge: cases with "special" chars & more',
      });
      const result = formatPlanMd(18, plan, 'in', 'out');
      expect(result).toContain('title: "Fix \\"quotes\\" & <angles>"');
      expect(result).toContain('Handle edge: cases with "special" chars & more');
    });

    it('numbers tasks correctly (TASK-01, TASK-02, etc.)', () => {
      const plan = makePlanEntry({
        tasks: ['First task', 'Second task', 'Third task'],
      });
      const result = formatPlanMd(18, plan, 'in', 'out');
      expect(result).toContain('- [ ] TASK-01: First task');
      expect(result).toContain('- [ ] TASK-02: Second task');
      expect(result).toContain('- [ ] TASK-03: Third task');
    });

    it('formats dependsOn as quoted strings', () => {
      const plan = makePlanEntry({ dependsOn: ['01', '02'] });
      const result = formatPlanMd(18, plan, 'in', 'out');
      expect(result).toContain('depends_on: ["01", "02"]');
    });
  });

  // =========================================================================
  // parsePlanOutput
  // =========================================================================
  describe('parsePlanOutput', () => {
    const validPlan: GeneratedPlan = {
      phaseNumber: 18,
      phaseTitle: 'Auth Phase',
      plans: [
        {
          planId: '01',
          title: 'Auth module',
          wave: 1,
          dependsOn: [],
          tdd: true,
          goal: 'Add auth',
          tasks: ['Create middleware'],
          testStrategy: 'Unit tests',
          estimatedFiles: ['src/auth.ts'],
        },
      ],
    };

    it('parses valid JSON string', () => {
      const result = parsePlanOutput(JSON.stringify(validPlan));
      expect(result.phaseNumber).toBe(18);
      expect(result.phaseTitle).toBe('Auth Phase');
      expect(result.plans).toHaveLength(1);
      expect(result.plans[0].planId).toBe('01');
    });

    it('parses JSON wrapped in ```json code block', () => {
      const output = `Here is the plan:\n\`\`\`json\n${JSON.stringify(validPlan, null, 2)}\n\`\`\`\nLet me know if you want changes.`;
      const result = parsePlanOutput(output);
      expect(result.phaseNumber).toBe(18);
      expect(result.plans).toHaveLength(1);
    });

    it('parses JSON with surrounding text', () => {
      const output = `I analyzed the codebase.\n\n${JSON.stringify(validPlan)}\n\nThis plan covers authentication.`;
      const result = parsePlanOutput(output);
      expect(result.phaseNumber).toBe(18);
    });

    it('throws on no JSON found', () => {
      expect(() => parsePlanOutput('No JSON here at all')).toThrow(/no valid JSON/i);
    });

    it('throws on invalid JSON structure (missing plans)', () => {
      const invalid = JSON.stringify({ phaseNumber: 18, phaseTitle: 'Auth' });
      expect(() => parsePlanOutput(invalid)).toThrow(/plans/i);
    });

    it('throws on plan missing required fields', () => {
      const invalid = JSON.stringify({
        phaseNumber: 18,
        phaseTitle: 'Auth',
        plans: [{ planId: '01' }],
      });
      expect(() => parsePlanOutput(invalid)).toThrow();
    });
  });

  // =========================================================================
  // writePlanFiles
  // =========================================================================
  describe('writePlanFiles', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'plan-gen-test-'));
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('creates phase directory', async () => {
      const plan = makeGeneratedPlan();
      await writePlanFiles(tempDir, plan, 'in-scope', 'out-scope');

      const phaseDir = join(tempDir, '.planning', 'phases', '18-god-mode-authentication');
      expect(existsSync(phaseDir)).toBe(true);
    });

    it('writes correct number of plan files', async () => {
      const plan = makeGeneratedPlan({
        plans: [
          makePlanEntry({ planId: '01' }),
          makePlanEntry({ planId: '02', title: 'Second plan' }),
        ],
      });
      const paths = await writePlanFiles(tempDir, plan, 'in', 'out');
      expect(paths).toHaveLength(2);
    });

    it('returns absolute file paths', async () => {
      const plan = makeGeneratedPlan();
      const paths = await writePlanFiles(tempDir, plan, 'in', 'out');

      for (const p of paths) {
        expect(p).toMatch(/^\//); // absolute path
        expect(existsSync(p)).toBe(true);
      }
    });

    it('file content matches formatPlanMd output', async () => {
      const plan = makeGeneratedPlan();
      const paths = await writePlanFiles(tempDir, plan, 'my-scope-in', 'my-scope-out');

      const content = readFileSync(paths[0], 'utf-8');
      const expected = formatPlanMd(18, plan.plans[0], 'my-scope-in', 'my-scope-out');
      expect(content).toBe(expected);
    });

    it('slugifies phase title correctly', async () => {
      const plan = makeGeneratedPlan({ phaseTitle: 'Hello World!! Feature (v2)' });
      const paths = await writePlanFiles(tempDir, plan, 'in', 'out');

      // Path should contain slugified title
      expect(paths[0]).toContain('18-hello-world-feature-v2');
    });

    it('handles phaseNumber zero-padding', async () => {
      const plan = makeGeneratedPlan({ phaseNumber: 5 });
      const paths = await writePlanFiles(tempDir, plan, 'in', 'out');

      expect(paths[0]).toContain('05-god-mode-authentication');
    });
  });

  // =========================================================================
  // generatePlans
  // =========================================================================
  describe('generatePlans', () => {
    const validPlan: GeneratedPlan = {
      phaseNumber: 18,
      phaseTitle: 'Auth Phase',
      plans: [
        {
          planId: '01',
          title: 'Auth module',
          wave: 1,
          dependsOn: [],
          tdd: true,
          goal: 'Add auth',
          tasks: ['Create middleware'],
          testStrategy: 'Unit tests',
          estimatedFiles: ['src/auth.ts'],
        },
      ],
    };

    const input: PlanGenerationInput = {
      message: 'Add authentication',
      scopeIn: 'src/auth/',
      scopeOut: 'src/index.ts',
      researchFindings: ['JWT is best for API auth', 'bcrypt for password hashing'],
      daRiskScore: 3,
      projectDir: '/tmp/test-project',
    };

    it('calls claudeManager.send with synthesis prompt', async () => {
      mockSend.mockReturnValue(
        mockStream([
          { type: 'text', text: JSON.stringify(validPlan) },
          { type: 'done', usage: { input_tokens: 100, output_tokens: 200 } },
        ]),
      );

      await generatePlans(input);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const [convId, prompt, projectDir] = mockSend.mock.calls[0];
      expect(typeof convId).toBe('string');
      expect(prompt).toContain('Add authentication');
      expect(projectDir).toBe('/tmp/test-project');
    });

    it('includes research findings in prompt', async () => {
      mockSend.mockReturnValue(
        mockStream([
          { type: 'text', text: JSON.stringify(validPlan) },
          { type: 'done' },
        ]),
      );

      await generatePlans(input);

      const prompt = mockSend.mock.calls[0][1];
      expect(prompt).toContain('JWT is best for API auth');
      expect(prompt).toContain('bcrypt for password hashing');
    });

    it('includes risk score in prompt', async () => {
      mockSend.mockReturnValue(
        mockStream([
          { type: 'text', text: JSON.stringify(validPlan) },
          { type: 'done' },
        ]),
      );

      await generatePlans(input);

      const prompt = mockSend.mock.calls[0][1];
      expect(prompt).toContain('3/10');
    });

    it('parses CC output into GeneratedPlan', async () => {
      mockSend.mockReturnValue(
        mockStream([
          { type: 'text', text: '{"phase' },
          { type: 'text', text: `Number":18,"phaseTitle":"Auth Phase","plans":[{"planId":"01","title":"Auth module","wave":1,"dependsOn":[],"tdd":true,"goal":"Add auth","tasks":["Create middleware"],"testStrategy":"Unit tests","estimatedFiles":["src/auth.ts"]}]}` },
          { type: 'done' },
        ]),
      );

      const result = await generatePlans(input);
      expect(result.phaseNumber).toBe(18);
      expect(result.plans).toHaveLength(1);
      expect(result.plans[0].planId).toBe('01');
    });

    it('throws when CC returns error chunk', async () => {
      mockSend.mockReturnValue(
        mockStream([
          { type: 'error', error: 'CC process crashed' },
        ]),
      );

      await expect(generatePlans(input)).rejects.toThrow(/CC process crashed/);
    });

    it('throws when CC output has no valid JSON', async () => {
      mockSend.mockReturnValue(
        mockStream([
          { type: 'text', text: 'I could not generate a valid plan.' },
          { type: 'done' },
        ]),
      );

      await expect(generatePlans(input)).rejects.toThrow(/no valid JSON/i);
    });
  });

  // =========================================================================
  // slugify
  // =========================================================================
  describe('slugify', () => {
    it('lowercases and replaces spaces with hyphens', () => {
      expect(slugify('Hello World')).toBe('hello-world');
    });

    it('removes special characters', () => {
      expect(slugify('Auth (v2)!!')).toBe('auth-v2');
    });

    it('collapses multiple hyphens', () => {
      expect(slugify('hello---world')).toBe('hello-world');
    });

    it('trims to max 40 characters', () => {
      const long = 'this-is-a-very-long-title-that-exceeds-forty-characters-limit';
      const result = slugify(long);
      expect(result.length).toBeLessThanOrEqual(40);
    });

    it('trims leading and trailing hyphens', () => {
      expect(slugify('--hello--')).toBe('hello');
    });
  });
});
