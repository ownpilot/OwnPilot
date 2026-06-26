/**
 * Workflow Executor — Claw Node
 *
 * Creates an ephemeral Claw agent for a workflow step, optionally waits for
 * completion, and cleans up the claw config + workspace on both success and
 * error paths. Cyclic modes use EventBus push-based subscription instead of
 * 2-second polling until the claw reaches a terminal state or is cancelled.
 */

import type { WorkflowNode, NodeResult } from '../../../db/repositories/workflows/index.js';
import { getErrorMessage } from '../../../utils/common.js';
import { resolveTemplates } from '../template-resolver.js';
import { nodeDataRecord } from '../node-data.js';
import { log } from './utils.js';
import { getEventSystem } from '@ownpilot/core/events';

export async function executeClawNode(
  node: WorkflowNode,
  nodeOutputs: Record<string, NodeResult>,
  variables: Record<string, unknown>,
  userId: string,
  signal?: AbortSignal
): Promise<NodeResult> {
  const startTime = Date.now();
  let createdClawId: string | null = null;
  let getClawServiceRef: (typeof import('../../claw/service.js'))['getClawService'] | null = null;
  try {
    const data = nodeDataRecord(node);

    const resolved = resolveTemplates(
      {
        name: data.name as string,
        mission: data.mission as string,
      },
      nodeOutputs,
      variables
    );

    const name = resolved.name as string;
    const mission = resolved.mission as string;
    const mode = (data.mode as string) ?? 'single-shot';
    const sandbox = (data.sandbox as string) ?? 'auto';
    const waitForCompletion = (data.waitForCompletion as boolean) ?? mode === 'single-shot';
    const timeoutMs = (data.timeoutMs as number) ?? 600_000; // 10 min default

    if (!name || !mission) {
      return {
        nodeId: node.id,
        status: 'error',
        error: 'Claw node requires name and mission',
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    const { getClawService } = await import('../../claw/service.js');
    getClawServiceRef = getClawService;
    const service = getClawService();

    const config = await service.createClaw({
      userId,
      name,
      mission,
      mode: mode as 'single-shot' | 'continuous' | 'interval' | 'event',
      sandbox: sandbox as 'auto' | 'docker' | 'local',
      provider: data.provider as string | undefined,
      model: data.model as string | undefined,
      codingAgentProvider: data.codingAgentProvider as string | undefined,
      skills: data.skills as string[] | undefined,
    });

    // Track the created claw id so the outer catch can clean up if anything
    // downstream throws — startClaw failure (concurrent-limit hit, workspace
    // creation error, "currently starting" race), polling errors, or the
    // history fetch all happen AFTER the row exists. Without this, a failed
    // workflow run permanently leaks a claw config (and possibly its
    // workspace) on every error.
    createdClawId = config.id;

    const session = await service.startClaw(config.id, userId);

    if (!waitForCompletion) {
      return {
        nodeId: node.id,
        status: 'success',
        output: {
          clawId: config.id,
          clawName: name,
          state: session.state,
          mode,
          waitedForCompletion: false,
          message: `Claw "${name}" started (${mode} mode)`,
        },
        resolvedArgs: { name, mission, mode, sandbox },
        durationMs: Date.now() - startTime,
        startedAt: new Date(startTime).toISOString(),
        completedAt: new Date().toISOString(),
      };
    }

    // For single-shot, ClawManager.startClaw awaits the cycle and stops the
    // claw before returning, so we can read history immediately. For cyclic
    // modes (continuous/interval/event) we use EventBus push-based subscription
    // instead of polling every 2s.
    let finalState = session.state;
    if (mode !== 'single-shot') {
      finalState = await waitForClawTerminal({
        clawId: config.id,
        userId,
        timeoutMs,
        signal,
      });
    }

    const { entries } = await service.getHistory(config.id, userId, 1, 0);
    const lastEntry = entries[0];

    const cycleSucceeded = lastEntry?.success ?? false;
    const reportedState =
      mode === 'single-shot' ? (cycleSucceeded ? 'completed' : 'failed') : finalState;

    try {
      await service.stopClaw(config.id, userId);
      await service.deleteClaw(config.id, userId);
    } catch (cleanupErr) {
      log.warn(
        `[executeClawNode] Failed to cleanup ephemeral claw ${config.id}: ${getErrorMessage(cleanupErr)}`
      );
    }

    const originalLength = lastEntry?.outputMessage?.length ?? 0;
    const truncated = originalLength > 2000;

    const isError = reportedState === 'failed' || reportedState === 'stopped' || !cycleSucceeded;

    return {
      nodeId: node.id,
      status: isError ? 'error' : 'success',
      output: {
        clawId: config.id,
        clawName: name,
        state: reportedState,
        waitedForCompletion: true,
        success: cycleSucceeded,
        cyclesCompleted: lastEntry?.cycleNumber ?? 0,
        lastOutput: lastEntry?.outputMessage?.slice(0, 2000) ?? '',
        cost: lastEntry?.costUsd ?? 0,
        truncated,
        originalLength,
      },
      resolvedArgs: { name, mission, mode, sandbox },
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      ...(isError && lastEntry?.error ? { error: lastEntry.error } : {}),
    };
  } catch (error) {
    // Clean up the leaked claw config if createClaw succeeded but a later
    // step (startClaw, polling, history fetch) threw. Without this, every
    // failed workflow run leaves an orphan row in the claws table.
    if (createdClawId && getClawServiceRef) {
      try {
        const service = getClawServiceRef();
        if (service.getSession(createdClawId, userId)) {
          await service.stopClaw(createdClawId, userId);
        }
        await service.deleteClaw(createdClawId, userId);
      } catch (cleanupErr) {
        log.warn(
          `[executeClawNode] Failed to clean up leaked claw ${createdClawId} after error: ${getErrorMessage(cleanupErr)}`
        );
      }
    }
    return {
      nodeId: node.id,
      status: 'error',
      error: getErrorMessage(error, 'Claw node execution failed'),
      durationMs: Date.now() - startTime,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
    };
  }
}

// ============================================================================
// waitForClawTerminal — EventBus push-based claw terminal state listener
// ============================================================================

type ClawState =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'escalation_pending';

interface WaitForClawTerminalOptions {
  clawId: string;
  userId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

/**
 * Listens for claw.update events and resolves when the claw reaches a terminal
 * state (completed | stopped | failed) or the AbortSignal is aborted or the
 * timeout is reached. Uses EventBus push instead of 2-second polling.
 */
async function waitForClawTerminal({
  clawId,
  timeoutMs,
  signal,
}: WaitForClawTerminalOptions): Promise<ClawState> {
  const deadline = Date.now() + timeoutMs;
  const terminalStates = new Set<ClawState>(['completed', 'stopped', 'failed']);

  return new Promise<ClawState>((_resolve) => {
    let resolved = false;
    let state: ClawState = 'running';

    const resolveOnce = (s: ClawState) => {
      if (resolved) return;
      resolved = true;
      state = s;
    };

    // AbortSignal: race the EventBus listener against cancellation
    const onAbort = () => resolveOnce('stopped');
    signal?.addEventListener('abort', onAbort, { once: true });

    // Timeout: hard deadline
    const onTimeout = setTimeout(() => resolveOnce(state), timeoutMs);

    // EventBus: push-based notification instead of 2-second polling
    const off = getEventSystem().onAny('claw.update', (event) => {
      const data = event.data as { clawId: string; state: ClawState } | undefined;
      if (!data || data.clawId !== clawId) return;
      if (terminalStates.has(data.state)) {
        clearTimeout(onTimeout);
        off();
        signal?.removeEventListener('abort', onAbort);
        resolveOnce(data.state);
      }
    });

    // If already past deadline, clean up and return current state
    if (Date.now() >= deadline) {
      clearTimeout(onTimeout);
      off();
      signal?.removeEventListener('abort', onAbort);
      resolveOnce(state);
    }
  });
}
