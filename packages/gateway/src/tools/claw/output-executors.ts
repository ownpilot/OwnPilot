/**
 * Claw Output Executors
 *
 * Tools that emit claw results to the rest of the system:
 *  - claw_publish_artifact    — store a persistent artifact (markdown/html/svg/…)
 *  - claw_send_output         — incremental update via Telegram + WS + chat
 *  - claw_complete_report     — final deliverable (artifact + notification + chat)
 *  - claw_request_escalation  — pause for human approval of a privilege upgrade
 *  - claw_emit_event          — emit a custom event onto the EventBus
 */

import { getErrorMessage, generateId } from '@ownpilot/core';
import { getClawContext } from '../../services/claw-context.js';

type ExecResult = { success: boolean; result?: unknown; error?: string };

const ARTIFACT_TYPES = ['html', 'svg', 'markdown', 'chart', 'form', 'react'] as const;
type ArtifactType = (typeof ARTIFACT_TYPES)[number];

export async function executePublishArtifact(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const title = args.title as string;
  const content = args.content as string;
  const type = (args.type as string) ?? 'markdown';

  if (!title || !content) {
    return { success: false, error: 'Both title and content are required' };
  }

  // Title cap so artifact lists, DB rows, and UI notifications stay sane.
  if (title.length > 200) {
    return { success: false, error: 'title exceeds 200 character limit' };
  }

  if (content.length > 500_000) {
    return { success: false, error: 'Content exceeds 500KB limit' };
  }

  // Runtime-validate type instead of trusting the LLM; the prior cast meant
  // any string ("xyz", "image/exe", ...) would land in the DB and likely
  // break UI rendering when fetched.
  if (!ARTIFACT_TYPES.includes(type as ArtifactType)) {
    return {
      success: false,
      error: `Invalid type "${type}". Allowed: ${ARTIFACT_TYPES.join(', ')}`,
    };
  }

  // Per-claw lifetime artifact cap. Tracked via session.artifacts so a
  // runaway claw can't publish a million 500KB artifacts and quietly fill
  // the artifact table. 1000 is generous for any legitimate claw — daily
  // reports for years still fit. Beyond that, almost certainly a bug.
  const MAX_ARTIFACTS_PER_CLAW = 1000;
  try {
    const { getClawManager } = await import('../../services/claw-manager.js');
    const session = getClawManager().getSession(ctx.clawId);
    if (session && session.artifacts.length >= MAX_ARTIFACTS_PER_CLAW) {
      return {
        success: false,
        error: `Claw has reached the ${MAX_ARTIFACTS_PER_CLAW} artifact limit. Delete old artifacts via the UI or reduce publish frequency.`,
      };
    }
  } catch {
    // Manager may not be available in tests — allow through
  }

  const { getArtifactService } = await import('../../services/artifact-service.js');
  const artifactService = getArtifactService();

  const artifact = await artifactService.createArtifact(userId, {
    title,
    content,
    type: type as ArtifactType,
    tags: ['claw', `claw:${ctx.clawId}`],
  });

  // Track artifact in session so UI Overview tab can show it
  try {
    const { getClawManager } = await import('../../services/claw-manager.js');
    getClawManager().addArtifact(ctx.clawId, artifact.id);
  } catch {
    // Manager may not be available in test environments
  }

  return {
    success: true,
    result: {
      artifactId: artifact.id,
      title: artifact.title,
      type: artifact.type,
    },
  };
}

export async function executeRequestEscalation(args: Record<string, unknown>): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const type = args.type as string;
  const reason = args.reason as string;
  const details = args.details as Record<string, unknown> | undefined;

  if (!type || !reason) {
    return { success: false, error: 'Both type and reason are required' };
  }

  const validTypes = ['sandbox_upgrade', 'network_access', 'budget_increase', 'permission_grant'];
  if (!validTypes.includes(type)) {
    return {
      success: false,
      error: `Invalid escalation type: ${type}. Valid: ${validTypes.join(', ')}`,
    };
  }

  const escalationId = generateId('esc');

  const { getClawManager } = await import('../../services/claw-manager.js');
  const manager = getClawManager();

  await manager.requestEscalation(ctx.clawId, {
    id: escalationId,
    type,
    reason,
    details,
    requestedAt: new Date(),
  });

  return {
    success: true,
    result: {
      escalationId,
      type,
      reason,
      message: 'Escalation requested. Execution will pause until approved.',
    },
  };
}

export async function executeSendOutput(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const message = args.message as string;
  const urgency = (args.urgency as string) ?? 'medium';

  if (!message?.trim()) {
    return { success: false, error: 'Message is required' };
  }

  // Cap output to 10K chars. Telegram itself caps at ~4096, but UI feed and
  // conversation row can take more — 10K is generous for human-readable
  // updates while bounding DB row growth and WebSocket fanout cost.
  if (message.length > 10_000) {
    return {
      success: false,
      error: `Message exceeds 10,000 character limit (got ${message.length}). Use claw_publish_artifact for larger payloads and reference the artifact id here.`,
    };
  }

  const deliveries: string[] = [];

  // 1. Send via Telegram
  try {
    const { sendTelegramMessage } = await import('../notification-tools.js');
    const emoji = urgency === 'high' ? '⚠️' : urgency === 'medium' ? '🤖' : '📤';
    const telegramText = `${emoji} *Claw Output*\n\n${message}`;
    const sent = await sendTelegramMessage(userId, telegramText);
    if (sent) deliveries.push('telegram');
  } catch {
    // Telegram not available
  }

  // 2. Emit WS event for live UI feed
  try {
    const { getEventSystem } = await import('@ownpilot/core');
    getEventSystem().emit('claw.output' as never, 'claw-tools', {
      clawId: ctx.clawId,
      message,
      urgency,
      timestamp: new Date().toISOString(),
    } as never);
    deliveries.push('websocket');
  } catch {
    // Event system may not be initialized
  }

  // 3. Store in conversation as assistant message (so user sees it in chat history)
  try {
    const { createMessagesRepository } = await import('../../db/repositories/messages.js');
    const msgRepo = createMessagesRepository();
    await msgRepo.create({
      id: generateId('msg'),
      conversationId: `claw-${ctx.clawId}`,
      role: 'assistant',
      content: `**[Claw Output]** ${message}`,
    });
    deliveries.push('conversation');
  } catch {
    // Messages repo may fail
  }

  return {
    success: true,
    result: {
      delivered: deliveries,
      message:
        deliveries.length > 0
          ? `Output sent via ${deliveries.join(', ')}`
          : 'No delivery channels available',
    },
  };
}

export async function executeCompleteReport(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const title = args.title as string;
  const report = args.report as string;
  const summary = args.summary as string;

  if (!title || !report || !summary) {
    return { success: false, error: 'title, report, and summary are all required' };
  }

  if (title.length > 200) {
    return { success: false, error: 'title exceeds 200 character limit' };
  }
  if (summary.length > 2000) {
    return { success: false, error: 'summary exceeds 2000 character limit' };
  }
  if (report.length > 500_000) {
    return { success: false, error: 'Report exceeds 500KB limit' };
  }

  const results: Record<string, unknown> = {};

  // 1. Publish as artifact
  try {
    const { getArtifactService } = await import('../../services/artifact-service.js');
    const artifact = await getArtifactService().createArtifact(userId, {
      title,
      content: report,
      type: 'markdown',
      tags: ['claw', `claw:${ctx.clawId}`, 'report'],
    });
    results.artifactId = artifact.id;

    // Track artifact in session
    try {
      const { getClawManager } = await import('../../services/claw-manager.js');
      getClawManager().addArtifact(ctx.clawId, artifact.id);
    } catch {
      // Best-effort
    }
  } catch (err) {
    results.artifactError = getErrorMessage(err);
  }

  // 2. Send summary notification via Telegram
  try {
    const { sendTelegramMessage } = await import('../notification-tools.js');
    const telegramText = `📊 *${title}*\n\n${summary.slice(0, 500)}${results.artifactId ? '\n\n_Full report saved as artifact._' : ''}`;
    const sent = await sendTelegramMessage(userId, telegramText);
    results.telegramSent = sent;
  } catch {
    results.telegramSent = false;
  }

  // 3. Emit WS notification
  try {
    const { getEventSystem } = await import('@ownpilot/core');
    getEventSystem().emit('claw.output' as never, 'claw-tools', {
      clawId: ctx.clawId,
      type: 'report',
      title,
      summary,
      artifactId: results.artifactId,
      timestamp: new Date().toISOString(),
    } as never);
    results.websocketSent = true;
  } catch {
    results.websocketSent = false;
  }

  // 4. Store summary in conversation
  try {
    const { createMessagesRepository } = await import('../../db/repositories/messages.js');
    const msgRepo = createMessagesRepository();
    await msgRepo.create({
      id: generateId('msg'),
      conversationId: `claw-${ctx.clawId}`,
      role: 'assistant',
      content: `**[Claw Report: ${title}]**\n\n${summary}\n\n---\n\n${report}`,
    });
    results.conversationStored = true;
  } catch {
    results.conversationStored = false;
  }

  return {
    success: true,
    result: {
      ...results,
      message: 'Report published, notification sent, conversation updated',
    },
  };
}

/**
 * Reserved event-type prefixes that claws MUST NOT emit. These are owned by
 * core systems (lifecycle, data hooks, multi-agent coordination, workflow,
 * soul). Allowing claws to spoof them would let a misbehaving claw disrupt
 * other systems by impersonating their internal events.
 */
const RESERVED_EVENT_PREFIXES = [
  'claw.',
  'claw:',
  'data:',
  'crew:',
  'crew.',
  'subagent:',
  'subagent.',
  'fleet:',
  'fleet.',
  'workflow:',
  'workflow.',
  'soul.',
  'soul:',
  'system.',
  'system:',
];

export async function executeEmitEvent(args: Record<string, unknown>): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const eventType = args.event_type as string;
  const payload = (args.payload as Record<string, unknown>) ?? {};

  if (!eventType?.trim()) {
    return { success: false, error: 'event_type is required' };
  }

  const normalized = eventType.trim().toLowerCase();
  const reserved = RESERVED_EVENT_PREFIXES.find((p) => normalized.startsWith(p));
  if (reserved) {
    return {
      success: false,
      error: `event_type "${eventType}" uses reserved prefix "${reserved}" — these are owned by core systems and cannot be emitted by claws. Use a custom prefix like "app.", "user.", or "${ctx.clawId}." instead.`,
    };
  }

  try {
    const { getEventSystem } = await import('@ownpilot/core');
    getEventSystem().emit(eventType as never, `claw:${ctx.clawId}`, {
      ...payload,
      _clawId: ctx.clawId,
      _timestamp: new Date().toISOString(),
    } as never);

    return {
      success: true,
      result: {
        eventType,
        emittedBy: ctx.clawId,
        message: `Event "${eventType}" emitted to EventBus`,
      },
    };
  } catch (err) {
    return { success: false, error: `Failed to emit event: ${getErrorMessage(err)}` };
  }
}
