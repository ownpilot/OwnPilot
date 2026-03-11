/**
 * Orchestration Service (v4.0)
 *
 * Manages orchestration pipeline lifecycle: research → devil_advocate → execute → verify.
 * Each pipeline runs entirely in bridge's Node.js process via ClaudeManager CC spawns.
 * Fire-and-forget pattern: trigger() returns pending state immediately.
 */

import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { claudeManager } from './claude-manager.ts';
import { eventBus } from './event-bus.ts';
import { logger } from './utils/logger.ts';
import { generatePlans, writePlanFiles } from './plan-generator.ts';
import { gsdOrchestration } from './gsd-orchestration.ts';
import type {
  OrchestrationState,
  OrchestrationRequest,
  OrchestrationStage,
  PlanGenerationInput,
  GeneratedPlan,
} from './types.ts';

const MAX_CONCURRENT_PER_PROJECT = 3;
const execFileAsync = promisify(execFile);

export class OrchestrationService {
  private readonly sessions = new Map<string, OrchestrationState>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), 10 * 60 * 1000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  /**
   * Remove completed/failed sessions older than the retention window.
   * Retention configured via ORCH_SESSION_RETENTION_MS env var (default 1 hour).
   */
  cleanup(): void {
    const retention = Number(process.env.ORCH_SESSION_RETENTION_MS) || 3_600_000;
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.status !== 'completed' && session.status !== 'failed') continue;
      const completedAt = session.completedAt ? new Date(session.completedAt).getTime() : null;
      if (completedAt !== null && (now - completedAt) > retention) {
        this.sessions.delete(id);
      }
    }
  }

  /** Stop the cleanup interval. Call on server shutdown. */
  shutdown(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /**
   * Trigger a new orchestration pipeline.
   *
   * Returns pending state immediately (fire-and-forget pattern).
   * Pipeline runs asynchronously via setImmediate.
   */
  async trigger(projectDir: string, req: OrchestrationRequest): Promise<OrchestrationState> {
    // STEP A — Synchronous quota pre-check
    const activeSessions = this.listActive(projectDir);
    if (activeSessions.length >= MAX_CONCURRENT_PER_PROJECT) {
      throw Object.assign(
        new Error(`PROJECT_CONCURRENT_LIMIT: too many active orchestrations for ${projectDir} (${activeSessions.length}/${MAX_CONCURRENT_PER_PROJECT})`),
        { code: 'PROJECT_CONCURRENT_LIMIT' }
      );
    }

    // STEP B — Create state
    const orchestrationId = 'orch-' + randomUUID();

    const state: OrchestrationState = {
      orchestrationId,
      projectDir,
      message: req.message,
      scope_in: req.scope_in,
      scope_out: req.scope_out,
      status: 'pending',
      currentStage: null,
      startedAt: new Date().toISOString(),
      stageProgress: {},
    };
    this.sessions.set(orchestrationId, state);

    const log = logger.child({ orchestrationId, projectDir });
    log.info('Orchestration created');

    // STEP C — Fire-and-forget pipeline
    setImmediate(() => {
      void this.runPipeline(orchestrationId, projectDir, req);
    });

    return state;
  }

  listActive(projectDir?: string): OrchestrationState[] {
    const active: OrchestrationState[] = [];
    for (const session of this.sessions.values()) {
      if (session.status !== 'pending' && session.status !== 'running') continue;
      if (projectDir !== undefined && session.projectDir !== projectDir) continue;
      active.push(session);
    }
    return active;
  }

  getById(orchestrationId: string): OrchestrationState | undefined {
    return this.sessions.get(orchestrationId);
  }

  private async runPipeline(
    orchestrationId: string,
    projectDir: string,
    req: OrchestrationRequest,
  ): Promise<void> {
    const state = this.sessions.get(orchestrationId);
    if (!state) return;

    const log = logger.child({ orchestrationId, projectDir });
    state.status = 'running';
    log.info('Orchestration running');

    let errorMessage: string | undefined;
    let failedStage: OrchestrationStage | null = null;

    try {
      // Stage 1: Research
      const findings = await this.runResearchWave(orchestrationId, projectDir, req);

      // Stage 2: Devil's Advocate
      const highestRisk = await this.runDevilAdvocateWave(orchestrationId, projectDir, req, findings);

      // Stage 3: Plan Generation
      const plan = await this.runPlanGeneration(orchestrationId, projectDir, req, findings, highestRisk);

      // Stage 4: Execute (GSD delegation)
      await this.runExecute(orchestrationId, projectDir, req, findings, highestRisk);

      // Stage 5: Verify (optional)
      if (req.verify !== false) {
        await this.runVerify(orchestrationId, projectDir);
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      log.error({ err }, 'Orchestration pipeline failed');
    }

    // Transition to completed or failed
    const completedAt = new Date().toISOString();
    if (errorMessage !== undefined) {
      state.status = 'failed';
      state.error = errorMessage;
      state.completedAt = completedAt;
      log.warn({ error: errorMessage }, 'Orchestration failed');
      eventBus.emit('orch.failed', {
        type: 'orch.failed',
        orchestrationId,
        projectDir,
        error: errorMessage,
        stage: failedStage,
        timestamp: completedAt,
      });
    } else {
      state.status = 'completed';
      state.completedAt = completedAt;
      log.info('Orchestration completed');
      eventBus.emit('orch.completed', {
        type: 'orch.completed',
        orchestrationId,
        projectDir,
        startedAt: state.startedAt,
        completedAt,
      });
    }
  }

  private async runResearchWave(
    orchestrationId: string,
    projectDir: string,
    req: OrchestrationRequest,
  ): Promise<string[]> {
    const agentCount = req.research_agents ?? 5;
    const state = this.sessions.get(orchestrationId);

    if (state) {
      state.currentStage = 'research';
      state.stageProgress['research'] = { completed: 0, total: agentCount };
    }

    eventBus.emit('orch.stage_started', {
      type: 'orch.stage_started',
      orchestrationId,
      projectDir,
      stage: 'research',
      agentCount,
      timestamp: new Date().toISOString(),
    });

    const scopeBlock = `## SCOPE SINIRI\nİÇİNDE: ${req.scope_in}\nDIŞINDA: ${req.scope_out}`;
    const researchAngles = [
      'Analyze technical requirements and constraints',
      'Identify potential risks and edge cases',
      'Research existing patterns and best practices',
      'Evaluate dependencies and integration points',
      'Assess performance and scalability implications',
    ];

    const promises = Array.from({ length: agentCount }, async (_, i) => {
      const convId = `orch-${orchestrationId}-research-${i}-${Date.now()}`;
      const angle = researchAngles[i % researchAngles.length];
      const prompt = `${angle} for task: ${req.message}\n\n${scopeBlock}`;
      let text = '';
      const stream = claudeManager.send(convId, prompt, projectDir);
      for await (const chunk of stream) {
        if (chunk.type === 'text') text += chunk.text;
      }
      if (state) {
        const progress = state.stageProgress['research'];
        if (progress) progress.completed = (progress.completed ?? 0) + 1;
      }
      return text;
    });

    const findings = await Promise.all(promises);

    eventBus.emit('orch.stage_completed', {
      type: 'orch.stage_completed',
      orchestrationId,
      projectDir,
      stage: 'research',
      data: { findingCount: findings.length },
      timestamp: new Date().toISOString(),
    });

    return findings;
  }

  private async runDevilAdvocateWave(
    orchestrationId: string,
    projectDir: string,
    req: OrchestrationRequest,
    findings: string[],
  ): Promise<number> {
    const agentCount = req.da_agents ?? 3;
    const state = this.sessions.get(orchestrationId);

    if (state) {
      state.currentStage = 'devil_advocate';
      state.stageProgress['devil_advocate'] = { completed: 0, total: agentCount };
    }

    eventBus.emit('orch.stage_started', {
      type: 'orch.stage_started',
      orchestrationId,
      projectDir,
      stage: 'devil_advocate',
      agentCount,
      timestamp: new Date().toISOString(),
    });

    const promises = Array.from({ length: agentCount }, async (_, i) => {
      const convId = `orch-${orchestrationId}-da-${i}-${Date.now()}`;
      const prompt = `Rate risk 1-10 as JSON: {"risk": N, "reason": "..."} for task: ${req.message}`;
      let text = '';
      const stream = claudeManager.send(convId, prompt, projectDir);
      for await (const chunk of stream) {
        if (chunk.type === 'text') text += chunk.text;
      }
      if (state) {
        const progress = state.stageProgress['devil_advocate'];
        if (progress) progress.completed = (progress.completed ?? 0) + 1;
      }
      // Parse risk score from response
      const jsonMatch = text.match(/\{"risk":\s*(\d+)/);
      if (jsonMatch) return Number(jsonMatch[1]);
      const numMatch = text.match(/\b([1-9]|10)\b/);
      if (numMatch) return Number(numMatch[1]);
      return 5; // default middle risk
    });

    const riskScores = await Promise.all(promises);
    const highestRisk = Math.max(...riskScores);

    if (state) {
      const progress = state.stageProgress['devil_advocate'];
      if (progress) progress.highestRisk = highestRisk;
    }

    eventBus.emit('orch.stage_completed', {
      type: 'orch.stage_completed',
      orchestrationId,
      projectDir,
      stage: 'devil_advocate',
      data: { highestRisk },
      timestamp: new Date().toISOString(),
    });

    if (req.da_strict && highestRisk >= 8) {
      throw new Error(`DA_RISK_THRESHOLD exceeded: highest risk score ${highestRisk}/10`);
    }

    return highestRisk;
  }

  private async runPlanGeneration(
    orchestrationId: string,
    projectDir: string,
    req: OrchestrationRequest,
    findings: string[],
    highestRisk: number,
  ): Promise<GeneratedPlan> {
    const state = this.sessions.get(orchestrationId);
    if (state) {
      state.currentStage = 'plan_generation';
      state.stageProgress['plan_generation'] = { completed: 0, total: 1 };
    }

    eventBus.emit('orch.stage_started', {
      type: 'orch.stage_started',
      orchestrationId,
      projectDir,
      stage: 'plan_generation',
      agentCount: 1,
      timestamp: new Date().toISOString(),
    });

    const input: PlanGenerationInput = {
      message: req.message,
      scopeIn: req.scope_in,
      scopeOut: req.scope_out,
      researchFindings: findings,
      daRiskScore: highestRisk,
      projectDir,
    };

    const plan = await generatePlans(input);
    await writePlanFiles(projectDir, plan, req.scope_in, req.scope_out);

    if (state) {
      const progress = state.stageProgress['plan_generation'];
      if (progress) progress.completed = 1;
    }

    eventBus.emit('orch.stage_completed', {
      type: 'orch.stage_completed',
      orchestrationId,
      projectDir,
      stage: 'plan_generation',
      data: { planCount: plan.plans.length },
      timestamp: new Date().toISOString(),
    });

    return plan;
  }

  private async runExecute(
    orchestrationId: string,
    projectDir: string,
    _req: OrchestrationRequest,
    _findings: string[],
    _highestRisk: number,
  ): Promise<void> {
    const state = this.sessions.get(orchestrationId);
    if (state) {
      state.currentStage = 'execute';
      state.stageProgress['execute'] = { completed: 0, total: 1 };
    }

    eventBus.emit('orch.stage_started', {
      type: 'orch.stage_started',
      orchestrationId,
      projectDir,
      stage: 'execute',
      agentCount: 1,
      timestamp: new Date().toISOString(),
    });

    // Trigger GSD execution
    const gsdState = await gsdOrchestration.trigger(projectDir, {
      command: 'execute-phase',
    });

    // Poll GSD status until completed or failed
    const timeoutMs = Number(process.env.ORCH_GSD_TIMEOUT_MS) || 30 * 60 * 1000;
    const pollIntervalMs = Number(process.env.ORCH_GSD_POLL_MS) || 5000;
    const startTime = Date.now();

    await new Promise<void>((resolve, reject) => {
      const poll = () => {
        const status = gsdOrchestration.getStatus(gsdState.gsdSessionId);
        if (!status) {
          reject(new Error('GSD session lost — not found after trigger'));
          return;
        }
        if (status.status === 'completed') {
          resolve();
          return;
        }
        if (status.status === 'failed') {
          reject(new Error(`GSD execution failed: ${status.error ?? 'unknown error'}`));
          return;
        }
        if (Date.now() - startTime > timeoutMs) {
          reject(new Error(`GSD execution timed out after ${timeoutMs}ms`));
          return;
        }
        setTimeout(poll, pollIntervalMs);
      };
      poll();
    });

    if (state) {
      const progress = state.stageProgress['execute'];
      if (progress) progress.completed = 1;
    }

    eventBus.emit('orch.stage_completed', {
      type: 'orch.stage_completed',
      orchestrationId,
      projectDir,
      stage: 'execute',
      timestamp: new Date().toISOString(),
    });
  }

  private async runVerify(
    orchestrationId: string,
    projectDir: string,
  ): Promise<{ passed: boolean }> {
    const state = this.sessions.get(orchestrationId);
    if (state) {
      state.currentStage = 'verify';
      state.stageProgress['verify'] = { completed: 0, total: 1 };
    }

    eventBus.emit('orch.stage_started', {
      type: 'orch.stage_started',
      orchestrationId,
      projectDir,
      stage: 'verify',
      timestamp: new Date().toISOString(),
    });

    let passed = false;
    try {
      const { stdout } = await execFileAsync('npx', ['vitest', 'run'], {
        cwd: projectDir,
        timeout: 120_000,
      });
      passed = /\d+ passed/.test(stdout) && !/\d+ failed/.test(stdout);
    } catch {
      passed = false;
    }

    if (state) {
      const progress = state.stageProgress['verify'];
      if (progress) {
        progress.completed = 1;
        progress.passed = passed;
      }
    }

    eventBus.emit('orch.stage_completed', {
      type: 'orch.stage_completed',
      orchestrationId,
      projectDir,
      stage: 'verify',
      data: { passed },
      timestamp: new Date().toISOString(),
    });

    return { passed };
  }
}

export const orchestrationService = new OrchestrationService();
