/**
 * QualityGate Tests (H7)
 *
 * TDD: RED phase — written BEFORE implementation.
 *
 * Tests cover:
 * - checkTests(): vitest pass/fail
 * - checkScopeDrift(): files in/out of scope_in
 * - checkCommitQuality(): conventional commits
 * - run(): combined gate execution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock child_process BEFORE importing QualityGate
// ---------------------------------------------------------------------------

const { mockExecFile } = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}));

vi.mock('node:util', () => ({
  promisify: (fn: unknown) => fn,
}));

import { QualityGate } from '../src/quality-gate.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockExec(stdout: string, _stderr = '', exitCode = 0): void {
  if (exitCode === 0) {
    mockExecFile.mockResolvedValue({ stdout, stderr: _stderr });
  } else {
    mockExecFile.mockRejectedValue(Object.assign(new Error('Command failed'), { stdout }));
  }
}

function mockExecSequence(results: Array<{ stdout: string; exitCode?: number }>): void {
  let mock = mockExecFile as ReturnType<typeof vi.fn>;
  for (const r of results) {
    if ((r.exitCode ?? 0) === 0) {
      mock = mock.mockResolvedValueOnce({ stdout: r.stdout, stderr: '' });
    } else {
      mock = mock.mockRejectedValueOnce(
        Object.assign(new Error('Command failed'), { stdout: r.stdout }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// checkTests()
// ---------------------------------------------------------------------------

describe('QualityGate.checkTests()', () => {
  let gate: QualityGate;
  beforeEach(() => {
    vi.clearAllMocks();
    gate = new QualityGate();
  });

  it('returns passed=true when vitest reports all tests passed', async () => {
    mockExec('Test Files  5 passed (5)\nTests  42 passed (42)');
    const result = await gate.checkTests('/tmp/proj');
    expect(result.name).toBe('tests');
    expect(result.passed).toBe(true);
  });

  it('returns passed=false when vitest reports failures', async () => {
    mockExec('Tests  3 failed | 39 passed (42)', '', 1);
    const result = await gate.checkTests('/tmp/proj');
    expect(result.passed).toBe(false);
    expect(result.issues).toBeDefined();
    expect(result.issues!.length).toBeGreaterThan(0);
  });

  it('returns passed=false when vitest exits non-zero', async () => {
    mockExec('', 'some error', 1);
    const result = await gate.checkTests('/tmp/proj');
    expect(result.passed).toBe(false);
  });

  it('includes test output summary in details', async () => {
    mockExec('Tests  10 passed (10)');
    const result = await gate.checkTests('/tmp/proj');
    expect(result.details).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// checkScopeDrift()
// ---------------------------------------------------------------------------

describe('QualityGate.checkScopeDrift()', () => {
  let gate: QualityGate;
  beforeEach(() => {
    vi.clearAllMocks();
    gate = new QualityGate();
  });

  it('returns passed=true when no scope_in provided (no check)', async () => {
    const result = await gate.checkScopeDrift('/tmp/proj', undefined);
    expect(result.passed).toBe(true);
    expect(result.details).toMatch(/skipped|no scope/i);
  });

  it('returns passed=true when all changed files are within scope_in', async () => {
    mockExec('src/foo.ts\nsrc/bar.ts\n');
    const result = await gate.checkScopeDrift('/tmp/proj', 'src/');
    expect(result.passed).toBe(true);
  });

  it('returns passed=false when files outside scope_in were changed', async () => {
    mockExec('src/foo.ts\ndocs/README.md\npackage.json\n');
    const result = await gate.checkScopeDrift('/tmp/proj', 'src/');
    expect(result.passed).toBe(false);
    expect(result.issues).toBeDefined();
    expect(result.issues!.some((i) => i.includes('docs/README.md'))).toBe(true);
  });

  it('supports multiple scope_in paths separated by comma', async () => {
    mockExec('src/foo.ts\ntests/foo.test.ts\ndocs/note.md\n');
    const result = await gate.checkScopeDrift('/tmp/proj', 'src/, tests/');
    expect(result.passed).toBe(false);
    expect(result.issues!.some((i) => i.includes('docs/note.md'))).toBe(true);
    expect(result.issues!.some((i) => i.includes('src/foo.ts'))).toBe(false);
  });

  it('returns passed=true when git diff returns empty (no recent commits)', async () => {
    mockExec('');
    const result = await gate.checkScopeDrift('/tmp/proj', 'src/');
    expect(result.passed).toBe(true);
  });

  it('returns passed=true on git error (graceful fallback)', async () => {
    mockExec('', 'not a git repo', 128);
    const result = await gate.checkScopeDrift('/tmp/proj', 'src/');
    expect(result.passed).toBe(true);
    expect(result.details).toMatch(/git error|skipped/i);
  });
});

// ---------------------------------------------------------------------------
// checkCommitQuality()
// ---------------------------------------------------------------------------

describe('QualityGate.checkCommitQuality()', () => {
  let gate: QualityGate;
  beforeEach(() => {
    vi.clearAllMocks();
    gate = new QualityGate();
  });

  it('returns passed=true when recent commits follow conventional format', async () => {
    mockExec(
      'abc1234 feat(auth): add JWT validation\n' +
      'def5678 fix(api): handle null response\n' +
      '789abcd test(unit): add coverage for edge cases\n',
    );
    const result = await gate.checkCommitQuality('/tmp/proj');
    expect(result.name).toBe('commit_quality');
    expect(result.passed).toBe(true);
  });

  it('returns passed=false when commits do not follow conventional format', async () => {
    mockExec(
      'abc1234 did some stuff\n' +
      'def5678 fix things\n',
    );
    const result = await gate.checkCommitQuality('/tmp/proj');
    expect(result.passed).toBe(false);
    expect(result.issues).toBeDefined();
    expect(result.issues!.length).toBeGreaterThan(0);
  });

  it('returns passed=true when no recent commits (empty log)', async () => {
    mockExec('');
    const result = await gate.checkCommitQuality('/tmp/proj');
    expect(result.passed).toBe(true);
    expect(result.details).toMatch(/no recent commits/i);
  });

  it('returns passed=true on git error (graceful fallback)', async () => {
    mockExec('', 'fatal: not a git repo', 128);
    const result = await gate.checkCommitQuality('/tmp/proj');
    expect(result.passed).toBe(true);
    expect(result.details).toMatch(/git error|skipped/i);
  });

  it('allows docs: prefix in commit messages', async () => {
    mockExec('abc1234 docs(readme): update installation guide\n');
    const result = await gate.checkCommitQuality('/tmp/proj');
    expect(result.passed).toBe(true);
  });

  it('allows breaking change marker !', async () => {
    mockExec('abc1234 feat!: remove deprecated API\n');
    const result = await gate.checkCommitQuality('/tmp/proj');
    expect(result.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// run() — combined gate
// ---------------------------------------------------------------------------

describe('QualityGate.run()', () => {
  let gate: QualityGate;
  beforeEach(() => {
    vi.clearAllMocks();
    gate = new QualityGate();
  });

  it('returns passed=true when all 3 checks pass', async () => {
    mockExecSequence([
      { stdout: 'Tests  5 passed (5)' },                           // vitest
      { stdout: 'src/foo.ts\n' },                                   // git diff
      { stdout: 'abc1234 feat(x): add feature\n' },                // git log
    ]);
    const result = await gate.run('/tmp/proj', 'src/');
    expect(result.passed).toBe(true);
    expect(result.checks).toHaveLength(3);
    expect(result.timestamp).toBeDefined();
  });

  it('returns passed=false when any check fails', async () => {
    mockExecSequence([
      { stdout: 'Tests  2 failed | 3 passed (5)', exitCode: 1 },  // vitest fail
      { stdout: 'src/foo.ts\n' },                                   // git diff ok
      { stdout: 'abc1234 feat(x): add feature\n' },                // git log ok
    ]);
    const result = await gate.run('/tmp/proj', 'src/');
    expect(result.passed).toBe(false);
    const testCheck = result.checks.find((c) => c.name === 'tests');
    expect(testCheck?.passed).toBe(false);
  });

  it('runs all 3 checks even when one fails', async () => {
    mockExecSequence([
      { stdout: 'Tests  1 failed', exitCode: 1 },
      { stdout: 'src/foo.ts\n' },
      { stdout: 'abc1234 feat(x): add feature\n' },
    ]);
    const result = await gate.run('/tmp/proj', 'src/');
    expect(result.checks).toHaveLength(3);
  });

  it('skips scope_drift check when scopeIn is undefined', async () => {
    mockExecSequence([
      { stdout: 'Tests  5 passed (5)' },
      { stdout: 'abc1234 feat(x): add feature\n' },
    ]);
    const result = await gate.run('/tmp/proj', undefined);
    expect(result.checks).toHaveLength(3);
    const driftCheck = result.checks.find((c) => c.name === 'scope_drift');
    expect(driftCheck?.passed).toBe(true); // skipped = pass
  });
});
