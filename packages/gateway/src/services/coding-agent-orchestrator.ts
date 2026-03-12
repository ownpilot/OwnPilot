/**
 * Coding Agent Orchestrator
 *
 * The brain that chains CLI tool sessions together. Takes a high-level goal,
 * spawns CLI sessions (Claude Code, Codex, Gemini), analyzes their output
 * via OwnPilot's configured AI model, and decides the next step.
 *
 * Flow: Goal → CLI session → wait → analyze output → next prompt or done
 */

import { randomUUID } from 'node:crypto';
import {
  createProvider,
  type AIProvider,
  type OrchestrationStep,
  type OrchestrationAnalysis,
  type OrchestrationRunStatus,
  type StartOrchestrationInput,
  type OrchestrationRun,
} from '@ownpilot/core';
import { getCodingAgentService } from './coding-agent-service.js';
import { orchestrationRunsRepo } from '../db/repositories/orchestration-runs.js';
import { codingAgentResultsRepo } from '../db/repositories/coding-agent-results.js';
import { resolveProviderAndModel } from '../routes/settings.js';
import { NATIVE_PROVIDERS, loadProviderConfig, getProviderApiKey } from '../routes/agent-cache.js';
import { getLog } from './log.js';
import { wsGateway } from '../ws/server.js';

const log = getLog('Orchestrator');

const DEFAULT_MAX_STEPS = 10;
const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000; // 30 min
const STEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 min per step
const OUTPUT_CONTEXT_LIMIT = 12_000; // chars of output to send to analyzer

// =============================================================================
// ANALYZER — Uses OwnPilot's configured AI to analyze CLI output
// =============================================================================

const ANALYZER_SYSTEM_PROMPT = `You are an orchestration analyzer for CLI coding tools (Claude Code, Codex, Gemini CLI).

Your job: analyze the output of a CLI coding tool and decide what to do next.

You will receive:
- The overall GOAL the user wants to achieve
- The PROMPT that was sent to the CLI tool
- The OUTPUT from the CLI tool
- Previous step summaries (if any)

Respond with ONLY valid JSON (no markdown fences):
{
  "summary": "Brief summary of what the CLI tool accomplished",
  "goalComplete": true/false,
  "hasErrors": true/false,
  "errors": ["error1", "error2"],
  "nextPrompt": "The exact prompt to send to the CLI tool next" or null if done,
  "confidence": 0.0 to 1.0,
  "needsUserInput": true/false,
  "userQuestion": "Question for the user" (only if needsUserInput)
}

Rules:
- If the tool successfully completed the goal, set goalComplete=true and nextPrompt=null
- If the tool made progress but the goal isn't done, craft a nextPrompt that continues the work
- Reference specific files, errors, or test results from the output in your nextPrompt
- If there are errors, set hasErrors=true and include them
- If you're unsure about the next step, set needsUserInput=true
- Keep nextPrompt concise and action-oriented — the CLI tool understands coding instructions
- Consider previous steps to avoid repeating work
- After 2+ failed attempts at the same thing, set needsUserInput=true`;

async function analyzeOutput(
  goal: string,
  prompt: string,
  output: string,
  previousSteps: OrchestrationStep[]
): Promise<OrchestrationAnalysis> {
  try {
    const { provider, model } = await resolveProviderAndModel('default', 'default');
    if (!provider || !model) {
      throw new Error('No AI provider configured. Set a default provider in Settings.');
    }

    const apiKey = await getProviderApiKey(provider);
    if (!apiKey) {
      throw new Error(
        `No API key configured for provider "${provider}". Set it in Settings → API Keys.`
      );
    }

    // Resolve provider type and baseUrl (same logic as chat system)
    const providerConfig = loadProviderConfig(provider);
    const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';

    log.info(`Analyzing output with provider=${provider} (type=${providerType}), model=${model}`);
    const instance = createProvider({
      provider: providerType as AIProvider,
      apiKey,
      baseUrl: providerConfig?.baseUrl,
    });

    // Build context from previous steps
    const prevContext = previousSteps
      .filter((s) => s.status === 'completed' && s.outputSummary)
      .map((s, i) => `Step ${i + 1}: ${s.outputSummary}`)
      .join('\n');

    const truncatedOutput =
      output.length > OUTPUT_CONTEXT_LIMIT
        ? output.slice(-OUTPUT_CONTEXT_LIMIT) + '\n...(truncated)'
        : output;

    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const dateStr = `${days[now.getDay()]} ${now.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}`;

    const userMessage = [
      `Current date: ${dateStr}`,
      `\nGOAL: ${goal}`,
      prevContext ? `\nPREVIOUS STEPS:\n${prevContext}` : '',
      `\nPROMPT SENT: ${prompt}`,
      `\nCLI OUTPUT:\n${truncatedOutput}`,
    ].join('\n');

    const result = await instance.complete({
      model: { model, maxTokens: 1024, temperature: 0.3 },
      messages: [
        { role: 'system' as const, content: ANALYZER_SYSTEM_PROMPT },
        { role: 'user' as const, content: userMessage },
      ],
    });

    if (!result.ok) {
      throw new Error(result.error?.message ?? 'AI analysis failed');
    }

    const text = result.value.content.trim();
    // Strip markdown fences if present
    const jsonText = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(jsonText) as OrchestrationAnalysis;

    return {
      summary: parsed.summary ?? 'No summary',
      goalComplete: !!parsed.goalComplete,
      hasErrors: !!parsed.hasErrors,
      errors: parsed.errors ?? [],
      nextPrompt: parsed.nextPrompt ?? null,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      needsUserInput: !!parsed.needsUserInput,
      userQuestion: parsed.userQuestion,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown analysis error';
    log.warn(`Analysis failed: ${errMsg}`);
    return {
      summary: `Analysis failed — ${errMsg}`,
      goalComplete: false,
      hasErrors: true,
      errors: [errMsg],
      nextPrompt: null,
      confidence: 0,
      needsUserInput: true,
      userQuestion: `Analysis failed: ${errMsg}. Check your default AI provider in Settings.`,
    };
  }
}

// =============================================================================
// ORCHESTRATOR
// =============================================================================

/** In-memory tracker for active runs (avoids double-execution) */
const activeRuns = new Map<string, { abort: boolean }>();

function broadcast(event: string, data: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wsGateway.broadcast(event as any, data as any);
}

/**
 * Start an orchestration run.
 * Returns immediately with the run record. Steps execute asynchronously.
 */
export async function startOrchestration(
  input: StartOrchestrationInput,
  userId: string
): Promise<OrchestrationRun> {
  const runId = `orch_${randomUUID().slice(0, 12)}`;

  const record = await orchestrationRunsRepo.create({
    id: runId,
    userId,
    goal: input.goal,
    provider: input.provider,
    cwd: input.cwd,
    model: input.model,
    maxSteps: input.maxSteps ?? DEFAULT_MAX_STEPS,
    autoMode: input.autoMode ?? false,
    enableAnalysis: input.enableAnalysis ?? true,
    skillIds: input.skillIds,
    permissions: input.permissions,
  });

  const run = recordToRun(record);

  // Start the loop asynchronously
  activeRuns.set(runId, { abort: false });
  runOrchestrationLoop(run, userId).catch((err) => {
    log.error(`Orchestration ${runId} crashed`, err);
    activeRuns.delete(runId);
  });

  broadcast('orchestration:created', { id: runId, goal: input.goal });
  return run;
}

/**
 * Continue an orchestration that is waiting for user input.
 */
export async function continueOrchestration(
  runId: string,
  userId: string,
  userResponse: string
): Promise<OrchestrationRun | null> {
  const record = await orchestrationRunsRepo.getById(runId, userId);
  if (!record || record.status !== 'waiting_user') return null;

  const run = recordToRun(record);

  // User's response becomes the next prompt
  const step: OrchestrationStep = {
    index: run.steps.length,
    prompt: userResponse,
    status: 'pending',
  };
  run.steps.push(step);
  run.status = 'running';
  run.currentStep = step.index;

  await orchestrationRunsRepo.updateStatus(runId, userId, 'running');
  await orchestrationRunsRepo.updateSteps(runId, userId, run.steps, run.currentStep);

  // Resume the loop
  activeRuns.set(runId, { abort: false });
  runOrchestrationLoop(run, userId).catch((err) => {
    log.error(`Orchestration ${runId} crashed on continue`, err);
    activeRuns.delete(runId);
  });

  broadcast('orchestration:continued', { id: runId });
  return run;
}

/**
 * Cancel/stop an orchestration run.
 */
export async function cancelOrchestration(runId: string, userId: string): Promise<boolean> {
  const ctrl = activeRuns.get(runId);
  if (ctrl) ctrl.abort = true;

  const record = await orchestrationRunsRepo.getById(runId, userId);
  if (!record) return false;

  await orchestrationRunsRepo.updateStatus(runId, userId, 'cancelled', {
    completedAt: new Date().toISOString(),
  });

  broadcast('orchestration:cancelled', { id: runId });
  return true;
}

/**
 * Get an orchestration run by ID.
 */
export async function getOrchestration(
  runId: string,
  userId: string
): Promise<OrchestrationRun | null> {
  const record = await orchestrationRunsRepo.getById(runId, userId);
  return record ? recordToRun(record) : null;
}

/**
 * List orchestration runs for a user.
 */
export async function listOrchestrations(
  userId: string,
  limit = 20,
  offset = 0
): Promise<OrchestrationRun[]> {
  const records = await orchestrationRunsRepo.list(userId, limit, offset);
  return records.map(recordToRun);
}

/**
 * Count total orchestration runs for a user (for pagination).
 */
export async function countOrchestrations(userId: string): Promise<number> {
  return orchestrationRunsRepo.count(userId);
}

// =============================================================================
// THE LOOP — The core orchestration engine
// =============================================================================

async function runOrchestrationLoop(run: OrchestrationRun, userId: string): Promise<void> {
  const ctrl = activeRuns.get(run.id);
  const startTime = Date.now();
  const maxDuration = DEFAULT_MAX_DURATION_MS;
  const service = getCodingAgentService();

  // Determine the starting prompt
  let currentPrompt: string;
  const lastStep = run.steps.length > 0 ? run.steps[run.steps.length - 1] : undefined;

  if (lastStep && lastStep.status === 'pending') {
    // Continuing from a user-provided prompt
    currentPrompt = lastStep.prompt;
  } else {
    // First step — use the goal directly
    currentPrompt = run.goal;
  }

  await orchestrationRunsRepo.updateStatus(run.id, userId, 'running');
  broadcast('orchestration:status', { id: run.id, status: 'running' });

  while (run.currentStep < run.maxSteps) {
    // Check abort
    if (ctrl?.abort) {
      log.info(`Orchestration ${run.id} aborted by user`);
      break;
    }

    // Check time limit
    if (Date.now() - startTime > maxDuration) {
      log.warn(`Orchestration ${run.id} hit time limit`);
      await finishRun(run, userId, 'failed', startTime);
      return;
    }

    // --- STEP: Spawn CLI session ---
    const pendingLast = run.steps.length > 0 ? run.steps[run.steps.length - 1] : undefined;
    const stepIndex = pendingLast?.status === 'pending' ? run.steps.length - 1 : run.steps.length;

    const step: OrchestrationStep = run.steps[stepIndex] ?? {
      index: stepIndex,
      prompt: currentPrompt,
      status: 'pending',
    };

    if (stepIndex >= run.steps.length) run.steps.push(step);

    step.status = 'running';
    step.startedAt = new Date().toISOString();
    run.currentStep = stepIndex;

    await orchestrationRunsRepo.updateSteps(run.id, userId, run.steps, run.currentStep);
    broadcast('orchestration:step:started', {
      id: run.id,
      stepIndex,
      prompt: currentPrompt,
    });

    log.info(`Orchestration ${run.id} step ${stepIndex}: "${currentPrompt.slice(0, 80)}..."`);

    try {
      // Create a session via the existing CodingAgentService
      const session = await service.createSession(
        {
          provider: run.provider,
          prompt: currentPrompt,
          cwd: run.cwd,
          model: run.model,
          mode: 'auto',
          source: 'ai-tool',
          skillIds: run.skillIds,
          permissions: run.permissions,
        },
        userId
      );

      step.sessionId = session.id;

      // Notify UI of the sessionId so it can subscribe to output
      broadcast('orchestration:step:started', {
        id: run.id,
        stepIndex,
        prompt: currentPrompt,
        sessionId: session.id,
      });

      // Wait for the CLI tool to finish
      const completed = await service.waitForCompletion(session.id, userId, STEP_TIMEOUT_MS);

      step.exitCode = completed.exitCode;
      step.completedAt = new Date().toISOString();
      step.durationMs = step.startedAt ? Date.now() - new Date(step.startedAt).getTime() : 0;

      // Get the full output
      const output = service.getOutputBuffer(session.id, userId) ?? '';

      // Look up persisted result for the result ID
      const result = await codingAgentResultsRepo.getBySessionId(session.id, userId);
      if (result) step.resultId = result.id;

      step.status = 'completed';

      await orchestrationRunsRepo.updateSteps(run.id, userId, run.steps, run.currentStep);
      broadcast('orchestration:step:completed', {
        id: run.id,
        stepIndex,
        exitCode: step.exitCode,
      });

      // --- ANALYZE (optional) ---
      if (run.enableAnalysis) {
        const analysis = await analyzeOutput(
          run.goal,
          currentPrompt,
          output,
          run.steps.slice(0, -1)
        );

        step.analysis = analysis;
        step.outputSummary = analysis.summary;

        await orchestrationRunsRepo.updateSteps(run.id, userId, run.steps, run.currentStep);
        broadcast('orchestration:step:analyzed', {
          id: run.id,
          stepIndex,
          analysis,
        });

        // --- DECIDE: What to do next? ---
        if (analysis.goalComplete && analysis.confidence >= 0.7) {
          log.info(`Orchestration ${run.id} goal complete (confidence: ${analysis.confidence})`);
          await finishRun(run, userId, 'completed', startTime);
          return;
        }

        if (analysis.needsUserInput || !run.autoMode) {
          run.status = 'waiting_user';
          await orchestrationRunsRepo.updateStatus(run.id, userId, 'waiting_user');
          broadcast('orchestration:waiting', {
            id: run.id,
            question: analysis.userQuestion ?? analysis.summary,
            analysis,
          });
          activeRuns.delete(run.id);
          return;
        }

        if (analysis.nextPrompt) {
          currentPrompt = analysis.nextPrompt;
        } else {
          run.status = 'waiting_user';
          await orchestrationRunsRepo.updateStatus(run.id, userId, 'waiting_user');
          broadcast('orchestration:waiting', {
            id: run.id,
            question: 'The analyzer could not determine the next step. What should we do?',
            analysis,
          });
          activeRuns.delete(run.id);
          return;
        }
      } else {
        // No analysis — single step, mark complete
        step.outputSummary = output.length > 200 ? output.slice(-200) + '...' : output;
        await orchestrationRunsRepo.updateSteps(run.id, userId, run.steps, run.currentStep);
        broadcast('orchestration:step:analyzed', { id: run.id, stepIndex });
        await finishRun(run, userId, 'completed', startTime);
        return;
      }
    } catch (err) {
      step.status = 'failed';
      step.completedAt = new Date().toISOString();
      step.analysis = {
        summary: `Step failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        goalComplete: false,
        hasErrors: true,
        errors: [err instanceof Error ? err.message : 'Unknown error'],
        nextPrompt: null,
        confidence: 0,
        needsUserInput: true,
        userQuestion: `Step ${stepIndex} failed: ${err instanceof Error ? err.message : 'Unknown error'}. Continue?`,
      };

      await orchestrationRunsRepo.updateSteps(run.id, userId, run.steps, run.currentStep);

      // Pause on error
      run.status = 'waiting_user';
      await orchestrationRunsRepo.updateStatus(run.id, userId, 'waiting_user');
      broadcast('orchestration:error', {
        id: run.id,
        stepIndex,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      activeRuns.delete(run.id);
      return;
    }
  }

  // Hit max steps
  log.warn(`Orchestration ${run.id} hit max steps (${run.maxSteps})`);
  await finishRun(run, userId, 'completed', startTime);
}

async function finishRun(
  run: OrchestrationRun,
  userId: string,
  status: OrchestrationRunStatus,
  startTime: number
): Promise<void> {
  const totalDuration = Date.now() - startTime;
  await orchestrationRunsRepo.updateStatus(run.id, userId, status, {
    completedAt: new Date().toISOString(),
    totalDurationMs: totalDuration,
  });
  activeRuns.delete(run.id);
  broadcast('orchestration:finished', { id: run.id, status, totalDurationMs: totalDuration });
}

// =============================================================================
// HELPERS
// =============================================================================

function recordToRun(
  r: import('../db/repositories/orchestration-runs.js').OrchestrationRunRecord
): OrchestrationRun {
  return {
    id: r.id,
    userId: r.userId,
    goal: r.goal,
    provider: r.provider as OrchestrationRun['provider'],
    cwd: r.cwd,
    model: r.model,
    status: r.status,
    steps: r.steps,
    currentStep: r.currentStep,
    maxSteps: r.maxSteps,
    autoMode: r.autoMode,
    enableAnalysis: r.enableAnalysis ?? true,
    skillIds: r.skillIds,
    permissions: r.permissions,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    completedAt: r.completedAt,
    totalDurationMs: r.totalDurationMs,
  };
}
