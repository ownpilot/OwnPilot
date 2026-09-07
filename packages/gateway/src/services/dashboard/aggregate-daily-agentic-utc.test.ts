/**
 * Proof-of-bug: DashboardService.aggregateDailyData uses UTC-based `today`
 * for agenticExecutions.todayExecutions / todayCostUsd (lines 280-281).
 *
 * The rest of the same function was localized in round 18. The agentic block
 * still uses:
 *   const today = new Date().toISOString().split('T')[0] ?? '';   // UTC date
 *   const todayExecs = executions.filter((e) => e.startedAt.toISOString().startsWith(today));
 *
 * Proof: read the actual production source and assert the CORRECT local-date
 * pattern is used.  BUG: source contains UTC pattern → test FAILS.
 * FIX: source contains local-date pattern → test PASSES.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_PATH = join(__dirname, 'index.ts');

describe('aggregateDailyData — agentic todayExecutions must use LOCAL date', () => {
  it('agentic block uses getDate/getMonth/getFullYear for today (not toISOString split)', () => {
    const source = readFileSync(SOURCE_PATH, 'utf-8');

    // Find the Agentic Executions section start
    const agenticStart = source.indexOf('// Agentic Executions');
    expect(agenticStart, '"// Agentic Executions" comment not found').toBeGreaterThan(-1);

    // Find the next blank-line-return block that closes the agentic section
    // (the closing `}` of the try block that contains agenticSummary = { ... })
    const afterSection = source.slice(agenticStart);
    // Find the return that delivers agenticSummary
    const agenticReturn = afterSection.indexOf('agenticSummary = {');
    expect(agenticReturn, 'agenticSummary assignment not found').toBeGreaterThan(-1);

    // Extract a bounded window: from the comment to the end of the agentic try-catch
    // (next "} catch" or end of function return)
    const windowEnd = afterSection.indexOf('} catch', agenticReturn);
    const window = afterSection.slice(0, windowEnd > 0 ? windowEnd + 7 : afterSection.length);

    // BUG 1: UTC-based today derivation
    const buggyToday = /const today\s*=\s*new Date\(\)\.toISOString\(\)\.split\(['"]T['"]\)\[0\]/;
    expect(
      window,
      'BUG: agentic block uses UTC date (toISOString split) instead of local date'
    ).not.toMatch(buggyToday);

    // FIX 1: the local-date today derivation (round-18 pattern)
    const localToday = /const today\s*=\s*String\(now\.getFullYear\(\)\)/;
    expect(
      window,
      'FIX REQUIRED: agentic block must use local date String(now.getFullYear())... for today'
    ).toMatch(localToday);

    // BUG 2: per-execution UTC filter using toISOString on startedAt
    const buggyFilter = /startedAt\.toISOString\(\)\.startsWith\(today\)/;
    expect(
      window,
      'BUG: agentic filter uses startedAt.toISOString() (UTC) instead of local-date comparison'
    ).not.toMatch(buggyFilter);

    // FIX 2: per-execution local filter using getDate/getMonth/getFullYear
    const localFilter = /getDate\(\)|getMonth\(\)|getFullYear\(\)/;
    expect(
      window,
      'FIX REQUIRED: agentic filter must use local date getters (getDate/getMonth/getFullYear) on startedAt'
    ).toMatch(localFilter);
  });
});
