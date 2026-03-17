import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Audit Trail Validation Test (INTEG-06)
 * Validates orchestration-log.md contains complete audit trail.
 * Two modes:
 *   - If log exists: validates entries have required fields
 *   - If log doesn't exist: validates README documents the schema
 */
describe('audit-trail-validation', () => {
  const logPath = join('.planning/orchestration/orchestration-log.md');
  const readmePath = join('.planning/orchestration/README.md');
  const logExists = existsSync(logPath);

  it('INTEG-06: orchestration README.md exists with audit log schema', () => {
    expect(existsSync(readmePath)).toBe(true);
  });

  it('INTEG-06: README documents orchestration-log.md format', () => {
    const readme = readFileSync(readmePath, 'utf-8');
    expect(readme).toContain('orchestration-log.md');
    // Must document the required columns
    expect(readme).toContain('Timestamp');
    expect(readme).toContain('Agent');
    expect(readme).toContain('Action');
    expect(readme).toContain('Detail');
  });

  it('INTEG-06: README documents required action types', () => {
    const readme = readFileSync(readmePath, 'utf-8');
    // Coordinator must log these actions per the protocol
    expect(readme).toContain('execution_started');
    expect(readme).toContain('worker_spawned');
    expect(readme).toContain('task_completed');
    expect(readme).toContain('execution_completed');
  });

  it('INTEG-06: if orchestration-log exists, it has markdown table header', () => {
    if (!logExists) {
      // Log not created yet — skip live validation, schema-only check passes
      console.log('orchestration-log.md not yet created — schema validation via README only');
      expect(existsSync(readmePath)).toBe(true);
      return;
    }

    const log = readFileSync(logPath, 'utf-8');
    // Must have markdown table header with 4 columns
    expect(log).toMatch(/\|\s*Timestamp\s*\|\s*Agent\s*\|\s*Action\s*\|\s*Detail\s*\|/);
  });

  it('INTEG-06: if orchestration-log exists, entries have all 4 required fields', () => {
    if (!logExists) {
      console.log('orchestration-log.md not yet created — schema validation via README only');
      expect(existsSync(readmePath)).toBe(true);
      return;
    }

    const log = readFileSync(logPath, 'utf-8');
    const lines = log.split('\n');

    // Find table rows (lines with | separator, not header or divider)
    const dataRows = lines.filter(line =>
      line.trim().startsWith('|') &&
      !line.includes('---') &&
      !line.includes('Timestamp') &&
      line.trim() !== '|'
    );

    if (dataRows.length === 0) {
      // Log header exists but no entries yet — acceptable
      console.log('orchestration-log.md exists but has no data rows yet');
      return;
    }

    // Each data row must have at least 4 columns (|timestamp|agent|action|detail|)
    for (const row of dataRows) {
      const columns = row.split('|').filter(c => c.trim().length > 0);
      expect(columns.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('INTEG-06: if orchestration-log exists, execution_started is present', () => {
    if (!logExists) {
      console.log('orchestration-log.md not yet created — skipping live check');
      return;
    }

    const log = readFileSync(logPath, 'utf-8');
    // Every orchestration run must log execution_started
    expect(log).toContain('execution_started');
  });
});
