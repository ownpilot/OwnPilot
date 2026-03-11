/**
 * Reflection Service (H7) — Self-Reflection & Quality Assurance Loop
 *
 * After GSD execution, runs QualityGate checks. If any fail, spawns a CC
 * troubleshoot agent to fix issues. Retries up to maxAttempts times.
 *
 * Pipeline: trigger → QualityGate.run() → [CC fix → retry]* → passed|failed
 */

import { randomUUID } from 'node:crypto';
import { QualityGate } from './quality-gate.ts';
import { claudeManager } from './claude-manager.ts';
import { eventBus } from './event-bus.ts';
import { logger } from './utils/logger.ts';
import type { ReflectState, ReflectAttempt, QualityGateResult } from './types.ts';

const DEFAULT_MAX_ATTEMPTS = Number(process.env.REFLECT_MAX_ATTEMPTS) || 3;

export class ReflectionService {
  private readonly sessions = new Map<string, ReflectState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxAttempts: number;
  private readonly gate: QualityGate;

  constructor(options?: { maxAttempts?: number; gate?: QualityGate }) {
    this.maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.gate = options?.gate ?? new QualityGate();
    this.cleanupTimer = setInterval(() => this.cleanup(), 10 * 60 * 1_000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  cleanup(): void {
    const retention = Number(process.env.REFLECT_RETENTION_MS) || 3_600_000;
    const now = Date.now();
    for (const [id, s] of this.sessions) {
      if (s.status === 'pending' || s.status === 'running') continue;
      const t = s.completedAt ? new Date(s.completedAt).getTime() : null;
      if (t !== null && now - t > retention) this.sessions.delete(id);
    }
  }

  shutdown(): void {
    if (this.cleanupTimer) { clearInterval(this.cleanupTimer); this.cleanupTimer = null; }
  }

  async trigger(projectDir: string, scopeIn?: string): Promise<ReflectState> {
    const reflectId = 'reflect-' + randomUUID();
    const state: ReflectState = {
      reflectId, projectDir, scopeIn,
      status: 'pending', attempts: [],
      startedAt: new Date().toISOString(),
    };
    this.sessions.set(reflectId, state);
    setImmediate(() => { void this.run(reflectId); });
    return state;
  }

  getById(reflectId: string): ReflectState | undefined {
    return this.sessions.get(reflectId);
  }

  listByProject(projectDir: string): ReflectState[] {
    return [...this.sessions.values()].filter((s) => s.projectDir === projectDir);
  }

  private async run(reflectId: string): Promise<void> {
    const state = this.sessions.get(reflectId);
    if (!state) return;
    const log = logger.child({ reflectId, projectDir: state.projectDir });
    state.status = 'running';

    eventBus.emit('reflect.started', {
      type: 'reflect.started',
      reflectId, projectDir: state.projectDir, scopeIn: state.scopeIn,
      timestamp: state.startedAt,
    });

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const result = await this.gate.run(state.projectDir, state.scopeIn);

      // Emit per-check events
      for (const check of result.checks) {
        eventBus.emit('reflect.check_completed', {
          type: 'reflect.check_completed',
          reflectId, projectDir: state.projectDir,
          attempt, checkName: check.name, passed: check.passed,
          timestamp: new Date().toISOString(),
        });
      }

      const attemptRecord: ReflectAttempt = { attempt, result, fixApplied: false };

      if (result.passed) {
        state.attempts.push(attemptRecord);
        state.finalResult = result;
        state.status = 'passed';
        state.completedAt = new Date().toISOString();
        log.info({ attemptsUsed: attempt }, 'Reflection passed');
        eventBus.emit('reflect.passed', {
          type: 'reflect.passed',
          reflectId, projectDir: state.projectDir,
          attemptsUsed: attempt, timestamp: state.completedAt,
        });
        return;
      }

      // Gate failed — apply CC fix if not last attempt
      if (attempt < this.maxAttempts) {
        const convId = `reflect-fix-${reflectId}-attempt${attempt}-${Date.now()}`;
        attemptRecord.fixApplied = true;
        attemptRecord.fixConversationId = convId;
        state.attempts.push(attemptRecord);

        eventBus.emit('reflect.fix_started', {
          type: 'reflect.fix_started',
          reflectId, projectDir: state.projectDir,
          attempt, conversationId: convId, timestamp: new Date().toISOString(),
        });

        const prompt = this.buildFixPrompt(state.projectDir, result, state.scopeIn);
        log.info({ attempt, convId }, 'Spawning fix CC');
        try {
          const stream = claudeManager.send(convId, prompt, state.projectDir);
          for await (const _ of stream) { /* drain */ }
        } catch (err) {
          log.warn({ err }, 'Fix CC failed — continuing to next attempt');
        }
      } else {
        state.attempts.push(attemptRecord);
      }
    }

    // All attempts exhausted
    state.finalResult = state.attempts[state.attempts.length - 1].result;
    state.status = 'failed';
    state.completedAt = new Date().toISOString();
    log.warn({ attemptsUsed: this.maxAttempts }, 'Reflection failed after max attempts');
    eventBus.emit('reflect.failed', {
      type: 'reflect.failed',
      reflectId, projectDir: state.projectDir,
      attemptsUsed: this.maxAttempts, timestamp: state.completedAt,
    });
  }

  private buildFixPrompt(projectDir: string, result: QualityGateResult, scopeIn?: string): string {
    const issues = result.checks
      .filter((c) => !c.passed)
      .flatMap((c) => [c.details, ...(c.issues ?? [])]);

    return [
      `Quality gate failed in ${projectDir}. Please fix these issues:`,
      ...issues.map((i) => `  - ${i}`),
      scopeIn ? `\nOnly modify files within: ${scopeIn}` : '',
      '\nRun tests to verify your fix before finishing.',
    ].join('\n');
  }
}

export const reflectionService = new ReflectionService();
