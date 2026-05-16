/**
 * Claw Delegation Executors
 *
 * Tools that let a claw coordinate with other claws:
 *  - claw_spawn_subclaw       — create + start a child claw
 *  - claw_list_subclaws       — list this claw's children with live state
 *  - claw_stop_subclaw        — stop a child claw
 *  - claw_send_agent_message  — deliver a message to another claw's inbox
 */

import { getErrorMessage, generateId, MAX_CLAW_DEPTH } from '@ownpilot/core';
import { getClawContext } from '../../services/claw-context.js';

type ExecResult = { success: boolean; result?: unknown; error?: string };

export async function executeSpawnSubclaw(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const name = args.name as string;
  const mission = args.mission as string;
  const mode = (args.mode as string) ?? 'single-shot';

  if (!name || !mission) {
    return { success: false, error: 'Both name and mission are required' };
  }

  // Depth check
  const newDepth = ctx.depth + 1;
  if (newDepth > MAX_CLAW_DEPTH) {
    return {
      success: false,
      error: `Maximum claw nesting depth (${MAX_CLAW_DEPTH}) exceeded. Current depth: ${ctx.depth}`,
    };
  }

  // Lazy import to avoid circular dependency
  const { getClawManager } = await import('../../services/claw-manager.js');
  const manager = getClawManager();

  const { getClawsRepository } = await import('../../db/repositories/claws.js');
  const repo = getClawsRepository();
  const parentConfig = await repo.getById(ctx.clawId, userId);
  if (parentConfig?.autonomyPolicy?.allowSubclaws === false) {
    return { success: false, error: 'Sub-claws are disabled by this claw autonomy policy' };
  }

  const subclawId = generateId('claw');

  // Inherit from parent if not explicitly overridden.
  // Tool allowlist, skills, sandbox, coding-agent, and mission contract are
  // carried through so a subclaw operates within the same guardrails as its
  // parent unless the caller overrides them.
  const inheritedProvider = (args.provider as string) ?? parentConfig?.provider;
  const inheritedModel = (args.model as string) ?? parentConfig?.model;
  const inheritedAllowedTools = parentConfig?.allowedTools?.length ? parentConfig.allowedTools : [];
  const inheritedAutonomyPolicy = parentConfig?.autonomyPolicy ?? undefined;
  const inheritedSkills = parentConfig?.skills?.length ? parentConfig.skills : undefined;
  const inheritedSandbox = parentConfig?.sandbox ?? 'auto';
  const inheritedCodingAgent = parentConfig?.codingAgentProvider;
  const inheritedMissionContract = parentConfig?.missionContract;

  // Auto-start: single-shot awaits, so no need to pre-start; cyclic modes should start immediately
  const shouldAutoStart = mode !== 'single-shot';

  const config = await repo.create({
    id: subclawId,
    userId,
    name,
    mission,
    mode: mode as 'continuous' | 'interval' | 'event' | 'single-shot',
    allowedTools: inheritedAllowedTools,
    provider: inheritedProvider,
    model: inheritedModel,
    limits: {
      maxTurnsPerCycle: 15,
      maxToolCallsPerCycle: 50,
      maxCyclesPerHour: 10,
      cycleTimeoutMs: 180_000,
    },
    autoStart: shouldAutoStart,
    depth: newDepth,
    sandbox: inheritedSandbox,
    parentClawId: ctx.clawId,
    createdBy: 'claw',
    autonomyPolicy: inheritedAutonomyPolicy,
    skills: inheritedSkills,
    codingAgentProvider: inheritedCodingAgent,
    missionContract: inheritedMissionContract,
  });

  if (mode === 'single-shot') {
    // startClaw awaits the cycle for single-shot mode, so session reflects final state
    const session = await manager.startClaw(config.id, userId);
    return {
      success: !session.lastCycleError,
      result: {
        subclawId: config.id,
        mode: 'single-shot',
        state: session.state,
        cyclesCompleted: session.cyclesCompleted,
        totalToolCalls: session.totalToolCalls,
        costUsd: session.totalCostUsd,
        artifacts: session.artifacts,
        output: session.lastCycleError
          ? `Failed: ${session.lastCycleError}`
          : 'Subclaw completed successfully.',
      },
      error: session.lastCycleError ?? undefined,
    };
  }

  // Cyclic mode — start and return ID
  await manager.startClaw(config.id, userId);
  return {
    success: true,
    result: {
      subclawId: config.id,
      mode: 'continuous',
      message: `Subclaw "${name}" started. It will run autonomously.`,
    },
  };
}

export async function executeListSubclaws(_userId: string): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  try {
    const { getClawsRepository } = await import('../../db/repositories/claws.js');
    const repo = getClawsRepository();
    const children = await repo.getChildClaws(ctx.clawId);

    const { getClawManager } = await import('../../services/claw-manager.js');
    const manager = getClawManager();

    const subclaws = children.map((c) => {
      const session = manager.getSession(c.id);
      return {
        id: c.id,
        name: c.name,
        mode: c.mode,
        state: session?.state ?? 'stopped',
        cycles: session?.cyclesCompleted ?? 0,
        depth: c.depth,
      };
    });

    return { success: true, result: { subclaws, total: subclaws.length } };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}

export async function executeStopSubclaw(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const subclawId = args.subclaw_id as string;
  if (!subclawId) return { success: false, error: 'subclaw_id is required' };

  try {
    // Verify it's actually a child of this claw and belongs to the same user
    const { getClawsRepository } = await import('../../db/repositories/claws.js');
    const repo = getClawsRepository();
    const subclaw = await repo.getById(subclawId, userId);
    if (!subclaw || subclaw.parentClawId !== ctx.clawId) {
      return { success: false, error: 'Subclaw not found or not a child of this claw' };
    }

    const { getClawManager } = await import('../../services/claw-manager.js');
    const stopped = await getClawManager().stopClaw(subclawId, userId);
    return {
      success: true,
      result: { stopped, message: stopped ? 'Subclaw stopped' : 'Subclaw was not running' },
    };
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}

export async function executeSendAgentMessage(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const targetClawId = args.target_claw_id as string;
  const subject = args.subject as string;
  const content = args.content as string;
  const messageType = (args.message_type as string) ?? 'coordination';

  if (!targetClawId || !subject || !content) {
    return { success: false, error: 'target_claw_id, subject, and content are required' };
  }

  // Cap subject + content so a runaway claw can't fill another claw's inbox
  // with megabyte-sized messages (which would then evict legitimate messages
  // when trimInbox runs on the receiver).
  if (subject.length > 200) {
    return { success: false, error: 'subject exceeds 200 character limit' };
  }
  if (content.length > 10_000) {
    return { success: false, error: 'content exceeds 10,000 character limit' };
  }

  // Prevent claws from messaging themselves (no useful semantic, can cause loops)
  if (targetClawId === ctx.clawId) {
    return { success: false, error: 'Cannot send a message to yourself' };
  }

  try {
    // Verify target claw exists and belongs to the same user — claws must not
    // be able to deliver messages into another user's inbox.
    const { getClawsRepository } = await import('../../db/repositories/claws.js');
    const repo = getClawsRepository();
    const target = await repo.getByIdAnyUser(targetClawId);
    if (!target) {
      return { success: false, error: `Target claw ${targetClawId} not found` };
    }
    if (target.userId !== userId) {
      return {
        success: false,
        error: `Target claw ${targetClawId} belongs to a different user — cross-user messaging is not permitted`,
      };
    }

    // Try to deliver to running claw's inbox
    const { getClawManager } = await import('../../services/claw-manager.js');
    const manager = getClawManager();

    const formattedMsg = `[${messageType.toUpperCase()}] From claw:${ctx.clawId} — ${subject}\n\n${content}`;
    const sent = await manager.sendMessage(targetClawId, formattedMsg);

    if (!sent) {
      // Claw not running — append to DB inbox
      await repo.appendToInbox(targetClawId, formattedMsg);
    }

    return {
      success: true,
      result: {
        delivered: sent ? 'live' : 'inbox',
        targetClawId,
        subject,
        message: sent
          ? `Message delivered to running claw ${targetClawId}`
          : `Message queued in inbox of claw ${targetClawId} (not currently running)`,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to send message: ${getErrorMessage(err)}` };
  }
}
