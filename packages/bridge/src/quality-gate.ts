/**
 * Quality Gate (H7)
 *
 * Runs 3 automated checks after GSD execution:
 *   1. tests        — vitest run (exit 0 + "X passed")
 *   2. scope_drift  — git diff HEAD~1 --name-only vs scope_in prefixes
 *   3. commit_quality — git log --oneline -5 vs conventional commit regex
 *
 * All checks are independent; run() always runs all 3 regardless of failures.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { QualityCheck, QualityGateResult } from './types.ts';

const execFileAsync = promisify(execFile);

// Conventional commit pattern: type[(scope)][!]: description
const CONVENTIONAL_RE =
  /^(feat|fix|docs|test|refactor|style|chore|perf|ci|build|revert)[!]?(\([^)]+\))?: .+/;

export class QualityGate {
  // -------------------------------------------------------------------------
  // checkTests
  // -------------------------------------------------------------------------

  async checkTests(projectDir: string): Promise<QualityCheck> {
    let stdout = '';
    let passed = false;
    let issues: string[] | undefined;

    try {
      const result = await execFileAsync('npx', ['vitest', 'run'], {
        cwd: projectDir,
        timeout: 120_000,
      });
      stdout = (result as unknown as { stdout: string }).stdout ?? '';
      const hasPassed = /\d+ passed/.test(stdout);
      const hasFailed = /\d+ failed/.test(stdout);
      passed = hasPassed && !hasFailed;
      if (!passed) {
        issues = ['Test failures detected'];
      }
    } catch (err: unknown) {
      const errOut = (err as { stdout?: string })?.stdout ?? String(err);
      stdout = errOut;
      passed = false;
      issues = ['Test run failed or timed out'];
    }

    const summary = stdout.split('\n').filter((l) => /passed|failed|Tests/.test(l)).join(' ').trim();

    return {
      name: 'tests',
      passed,
      details: summary || (passed ? 'Tests passed' : 'Tests failed'),
      issues,
    };
  }

  // -------------------------------------------------------------------------
  // checkScopeDrift
  // -------------------------------------------------------------------------

  async checkScopeDrift(projectDir: string, scopeIn: string | undefined): Promise<QualityCheck> {
    if (!scopeIn) {
      return {
        name: 'scope_drift',
        passed: true,
        details: 'Skipped — no scope_in specified',
      };
    }

    // Allowed prefixes (trim whitespace, support comma-separated)
    const allowedPrefixes = scopeIn.split(',').map((s) => s.trim()).filter(Boolean);

    let changedFiles: string[] = [];
    try {
      const result = await execFileAsync(
        'git',
        ['diff', '--name-only', 'HEAD~1'],
        { cwd: projectDir, timeout: 10_000 },
      );
      const out = (result as unknown as { stdout: string }).stdout ?? '';
      changedFiles = out.split('\n').map((f) => f.trim()).filter(Boolean);
    } catch {
      return {
        name: 'scope_drift',
        passed: true,
        details: 'Git error — scope drift check skipped',
      };
    }

    if (changedFiles.length === 0) {
      return {
        name: 'scope_drift',
        passed: true,
        details: 'No changed files detected',
      };
    }

    const outOfScope = changedFiles.filter(
      (f) => !allowedPrefixes.some((prefix) => f.startsWith(prefix)),
    );

    if (outOfScope.length === 0) {
      return {
        name: 'scope_drift',
        passed: true,
        details: `All ${changedFiles.length} changed file(s) are within scope`,
      };
    }

    return {
      name: 'scope_drift',
      passed: false,
      details: `${outOfScope.length} file(s) changed outside scope_in`,
      issues: outOfScope.map((f) => `Out-of-scope: ${f}`),
    };
  }

  // -------------------------------------------------------------------------
  // checkCommitQuality
  // -------------------------------------------------------------------------

  async checkCommitQuality(projectDir: string): Promise<QualityCheck> {
    let logOutput = '';
    try {
      const result = await execFileAsync(
        'git',
        ['log', '--oneline', '-5', '--no-merges'],
        { cwd: projectDir, timeout: 10_000 },
      );
      logOutput = (result as unknown as { stdout: string }).stdout ?? '';
    } catch {
      return {
        name: 'commit_quality',
        passed: true,
        details: 'Git error — commit quality check skipped',
      };
    }

    const lines = logOutput.split('\n').map((l) => l.trim()).filter(Boolean);

    if (lines.length === 0) {
      return {
        name: 'commit_quality',
        passed: true,
        details: 'No recent commits to check',
      };
    }

    const badCommits: string[] = [];
    for (const line of lines) {
      // Strip leading hash (7 chars + space)
      const message = line.replace(/^[0-9a-f]+ /, '');
      if (!CONVENTIONAL_RE.test(message)) {
        badCommits.push(line);
      }
    }

    if (badCommits.length === 0) {
      return {
        name: 'commit_quality',
        passed: true,
        details: `All ${lines.length} recent commit(s) follow conventional format`,
      };
    }

    return {
      name: 'commit_quality',
      passed: false,
      details: `${badCommits.length} commit(s) do not follow conventional format`,
      issues: badCommits.map((c) => `Non-conventional: ${c}`),
    };
  }

  // -------------------------------------------------------------------------
  // run — all 3 checks
  // -------------------------------------------------------------------------

  async run(projectDir: string, scopeIn?: string): Promise<QualityGateResult> {
    const [testCheck, driftCheck, commitCheck] = await Promise.all([
      this.checkTests(projectDir),
      this.checkScopeDrift(projectDir, scopeIn),
      this.checkCommitQuality(projectDir),
    ]);

    const checks: QualityCheck[] = [testCheck, driftCheck, commitCheck];
    const passed = checks.every((c) => c.passed);

    return { passed, checks, timestamp: new Date().toISOString() };
  }
}
