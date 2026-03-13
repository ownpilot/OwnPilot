/**
 * Crew Coordination Tools — Executor
 *
 * Provides tools for soul agents to interact with their crew:
 *   - get_crew_members   — list crew members with roles and IDs
 *   - delegate_task      — send a structured task to another crew member
 *   - broadcast_to_crew  — send a message to all crew members at once
 *   - claim_task         — pull a task from the crew task queue
 *   - submit_result      — submit result for a claimed task
 *   - request_review     — ask a crew member to review work
 *   - share_knowledge    — post to crew shared memory
 *   - get_crew_memory    — search/list crew shared memory
 *   - coordinate         — propose decisions or get queue status
 *
 * Relies on HeartbeatExecutionContext (AsyncLocalStorage) to resolve the
 * current agent's ID and crew ID without requiring interface changes.
 */

import { generateId, getErrorMessage } from '@ownpilot/core';
import type { ToolDefinition, AgentMessage } from '@ownpilot/core';
import { getCrewsRepository } from '../db/repositories/crews.js';
import { getSoulsRepository } from '../db/repositories/souls.js';
import { getAgentMessagesRepository } from '../db/repositories/agent-messages.js';
import { getCrewMemoryRepository } from '../db/repositories/crew-memory.js';
import { getCrewTasksRepository } from '../db/repositories/crew-tasks.js';
import { getHeartbeatContext } from '../services/heartbeat-context.js';
import type { ToolExecutionResult } from '../services/tool-executor.js';

// ============================================================
// Tool Definitions
// ============================================================

export const CREW_TOOLS: ToolDefinition[] = [
  {
    name: 'get_crew_members',
    description:
      'Get a list of all agents in your crew — their names, roles, and agent IDs. Use this to know who to delegate tasks to or collaborate with.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'delegate_task',
    description:
      'Delegate a specific task to another crew member. Creates a structured task delegation message in their inbox with context and expected output.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {
        to_agent: {
          type: 'string',
          description: 'Name or agent ID of the crew member to delegate to',
        },
        task_name: {
          type: 'string',
          description: 'Brief descriptive name for the task',
        },
        task_description: {
          type: 'string',
          description: 'Detailed description of what needs to be done',
        },
        context: {
          type: 'string',
          description: 'Background context, findings, or data to share with the assignee',
        },
        expected_output: {
          type: 'string',
          description: 'What output or result you expect back',
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'urgent'],
          description: 'Task priority (default: normal)',
        },
        deadline_hours: {
          type: 'number',
          description: 'Hours until deadline (optional)',
        },
      },
      required: ['to_agent', 'task_name', 'task_description'],
    },
  },
  {
    name: 'broadcast_to_crew',
    description:
      'Send a message to all members of your crew simultaneously. Use for status updates, alerts, knowledge sharing, or coordination announcements.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['knowledge_share', 'alert', 'status_update', 'coordination'],
          description: 'Type of broadcast message',
        },
        subject: {
          type: 'string',
          description: 'Message subject line',
        },
        content: {
          type: 'string',
          description: 'Message content to broadcast to all crew members',
        },
      },
      required: ['type', 'subject', 'content'],
    },
  },
  {
    name: 'claim_task',
    description:
      'Claim a task from the crew task queue. If no task_id is provided, claims the highest-priority pending task. Use this to pull work from the shared queue.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'Specific task ID to claim (optional — omit to auto-claim highest priority)',
        },
      },
      required: [],
    },
  },
  {
    name: 'submit_result',
    description:
      'Submit the result for a task you claimed from the crew queue. Marks the task as completed or failed.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {
        task_id: {
          type: 'string',
          description: 'ID of the task to submit result for',
        },
        result: {
          type: 'string',
          description: 'The result or output of the completed task',
        },
        status: {
          type: 'string',
          enum: ['completed', 'failed'],
          description: 'Whether the task was completed successfully or failed',
        },
      },
      required: ['task_id', 'result', 'status'],
    },
  },
  {
    name: 'request_review',
    description:
      'Ask a crew member to review your work. Creates a review request message in their inbox.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {
        reviewer: {
          type: 'string',
          description: 'Name or agent ID of the reviewer',
        },
        subject: {
          type: 'string',
          description: 'What needs to be reviewed',
        },
        content: {
          type: 'string',
          description: 'The work to review — findings, analysis, output, etc.',
        },
        task_id: {
          type: 'string',
          description: 'Related task ID (optional)',
        },
      },
      required: ['reviewer', 'subject', 'content'],
    },
  },
  {
    name: 'share_knowledge',
    description:
      'Share knowledge with your crew by saving it to the crew shared memory. Use categories to organize: "findings", "decisions", "resources", etc.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Knowledge category: "findings", "decisions", "resources", "general", etc.',
        },
        title: {
          type: 'string',
          description: 'Brief title for this knowledge entry',
        },
        content: {
          type: 'string',
          description: 'The knowledge content to share',
        },
      },
      required: ['category', 'title', 'content'],
    },
  },
  {
    name: 'get_crew_memory',
    description:
      'Search or list knowledge from your crew shared memory. Use to recall decisions, findings, or resources shared by crew members.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category (optional)',
        },
        query: {
          type: 'string',
          description: 'Search query to find specific entries (optional)',
        },
        limit: {
          type: 'number',
          description: 'Max entries to return (default: 10)',
        },
      },
      required: [],
    },
  },
  {
    name: 'coordinate',
    description:
      'Coordinate with your crew: propose a decision/action (broadcasts to all members), or check the status of the crew task queue.',
    category: 'agent_communication',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['propose', 'status'],
          description: '"propose" broadcasts a proposal; "status" returns task queue summary',
        },
        subject: {
          type: 'string',
          description: 'Subject of the proposal or status query',
        },
        content: {
          type: 'string',
          description: 'Proposal details (required for "propose" action)',
        },
      },
      required: ['action', 'subject'],
    },
  },
];

export const CREW_TOOL_NAMES = CREW_TOOLS.map((t) => t.name);

// ============================================================
// Executor
// ============================================================

export async function executeCrewTool(
  toolName: string,
  args: Record<string, unknown>,
  userId?: string
): Promise<ToolExecutionResult> {
  // Prefer heartbeat context for agent identity (correct soul agent ID)
  const hbCtx = getHeartbeatContext();
  const agentId = hbCtx?.agentId ?? userId ?? 'unknown';
  const crewId = hbCtx?.crewId;

  try {
    switch (toolName) {
      case 'get_crew_members':
        return await handleGetCrewMembers(agentId, crewId);
      case 'delegate_task':
        return await handleDelegateTask(args, agentId, crewId);
      case 'broadcast_to_crew':
        return await handleBroadcastToCrew(args, agentId, crewId);
      case 'claim_task':
        return await handleClaimTask(args, agentId, crewId);
      case 'submit_result':
        return await handleSubmitResult(args, agentId);
      case 'request_review':
        return await handleRequestReview(args, agentId, crewId);
      case 'share_knowledge':
        return await handleShareKnowledge(args, agentId, crewId);
      case 'get_crew_memory':
        return await handleGetCrewMemory(args, crewId);
      case 'coordinate':
        return await handleCoordinate(args, agentId, crewId);
      default:
        return { success: false, error: `Unknown crew tool: ${toolName}` };
    }
  } catch (err) {
    return { success: false, error: getErrorMessage(err) };
  }
}

// ============================================================
// Handlers
// ============================================================

async function handleGetCrewMembers(
  agentId: string,
  crewId: string | undefined
): Promise<ToolExecutionResult> {
  if (!crewId) {
    return {
      success: false,
      error:
        'You are not currently part of a crew. Use send_agent_message to communicate with specific agents directly.',
    };
  }

  const crewRepo = getCrewsRepository();
  const soulsRepo = getSoulsRepository();

  const [crew, members] = await Promise.all([
    crewRepo.getById(crewId),
    crewRepo.getMembers(crewId),
  ]);

  if (!crew) {
    return { success: false, error: 'Crew not found' };
  }

  const memberDetails = await Promise.all(
    members.map(async (m) => {
      const soul = await soulsRepo.getByAgentId(m.agentId);
      return {
        agentId: m.agentId,
        name: soul?.identity.name ?? m.agentId,
        emoji: soul?.identity.emoji ?? '🤖',
        role: m.role,
        heartbeatEnabled: soul?.heartbeat.enabled ?? false,
        isCurrentAgent: m.agentId === agentId,
      };
    })
  );

  return {
    success: true,
    result: {
      crew: {
        id: crew.id,
        name: crew.name,
        coordinationPattern: crew.coordinationPattern,
        status: crew.status,
      },
      members: memberDetails,
      tip: 'Use the agentId when calling delegate_task or send_agent_message.',
    },
  };
}

async function handleDelegateTask(
  args: Record<string, unknown>,
  agentId: string,
  crewId: string | undefined
): Promise<ToolExecutionResult> {
  const toAgent = String(args.to_agent ?? '').trim();
  const taskName = String(args.task_name ?? '').trim();
  const taskDescription = String(args.task_description ?? '').trim();
  const context = args.context ? String(args.context) : '';
  const expectedOutput = args.expected_output ? String(args.expected_output) : '';
  const priority = (args.priority as AgentMessage['priority']) ?? 'normal';
  const deadlineHours = args.deadline_hours ? Number(args.deadline_hours) : undefined;

  if (!toAgent || !taskName || !taskDescription) {
    return { success: false, error: 'to_agent, task_name, and task_description are required' };
  }

  // Resolve agent name → ID when in a crew
  let resolvedAgentId = toAgent;
  if (crewId && !toAgent.startsWith('agent_') && !toAgent.match(/^[a-z]{3}_[a-z0-9]+$/)) {
    const crewRepo = getCrewsRepository();
    const soulsRepo = getSoulsRepository();
    const members = await crewRepo.getMembers(crewId);
    for (const m of members) {
      const soul = await soulsRepo.getByAgentId(m.agentId);
      if (soul?.identity.name.toLowerCase() === toAgent.toLowerCase()) {
        resolvedAgentId = m.agentId;
        break;
      }
    }
  }

  // Build structured delegation content
  const parts: string[] = [`## Task: ${taskName}`, '', taskDescription];
  if (context) parts.push('', '## Context', context);
  if (expectedOutput) parts.push('', '## Expected Output', expectedOutput);
  if (deadlineHours !== undefined) {
    const deadline = new Date(Date.now() + deadlineHours * 3600 * 1000);
    parts.push('', `## Deadline`, `${deadline.toISOString()} (${deadlineHours}h from now)`);
  }

  const msgId = generateId('msg');
  const threadId = generateId('thread');

  const message: AgentMessage = {
    id: msgId,
    from: agentId,
    to: resolvedAgentId,
    type: 'task_delegation',
    subject: `[Task] ${taskName}`,
    content: parts.join('\n'),
    attachments: [],
    priority,
    threadId,
    requiresResponse: true,
    status: 'sent',
    crewId: crewId ?? undefined,
    createdAt: new Date(),
  };

  const msgRepo = getAgentMessagesRepository();
  await msgRepo.create(message);

  return {
    success: true,
    result: {
      messageId: msgId,
      threadId,
      delegatedTo: resolvedAgentId,
      taskName,
      status: 'delegated',
    },
  };
}

async function handleBroadcastToCrew(
  args: Record<string, unknown>,
  agentId: string,
  crewId: string | undefined
): Promise<ToolExecutionResult> {
  if (!crewId) {
    return {
      success: false,
      error:
        'You are not currently part of a crew. Use send_agent_message for direct communication.',
    };
  }

  const type = (args.type as AgentMessage['type']) ?? 'coordination';
  const subject = String(args.subject ?? '').trim();
  const content = String(args.content ?? '').trim();

  if (!subject || !content) {
    return { success: false, error: 'subject and content are required' };
  }

  // Dynamically import to avoid circular dependency with soul-heartbeat-service
  const { getCommunicationBus } = await import('../services/soul-heartbeat-service.js');
  const bus = getCommunicationBus();

  const result = await bus.broadcast(crewId, {
    from: agentId,
    type,
    subject,
    content,
    attachments: [],
    priority: 'normal',
    requiresResponse: false,
  });

  return {
    success: true,
    result: {
      delivered: result.delivered,
      failed: result.failed,
      deliveredCount: result.delivered.length,
    },
  };
}

// ============================================================
// New Crew Tools — Task Queue, Knowledge, Coordination
// ============================================================

async function handleClaimTask(
  args: Record<string, unknown>,
  agentId: string,
  crewId: string | undefined
): Promise<ToolExecutionResult> {
  if (!crewId) {
    return { success: false, error: 'You are not currently part of a crew.' };
  }

  const taskRepo = getCrewTasksRepository();
  const taskId = args.task_id ? String(args.task_id).trim() : undefined;

  const task = taskId
    ? await taskRepo.claim(taskId, agentId)
    : await taskRepo.claimHighestPriority(crewId, agentId);

  if (!task) {
    return {
      success: false,
      error: taskId
        ? `Task ${taskId} not found or already claimed`
        : 'No pending tasks in the crew queue',
    };
  }

  return {
    success: true,
    result: {
      taskId: task.id,
      taskName: task.taskName,
      description: task.description,
      context: task.context,
      expectedOutput: task.expectedOutput,
      priority: task.priority,
      createdBy: task.createdBy,
      deadline: task.deadline?.toISOString() ?? null,
      tip: 'Use submit_result when done.',
    },
  };
}

async function handleSubmitResult(
  args: Record<string, unknown>,
  agentId: string
): Promise<ToolExecutionResult> {
  const taskId = String(args.task_id ?? '').trim();
  const result = String(args.result ?? '').trim();
  const status = String(args.status ?? 'completed').trim();

  if (!taskId || !result) {
    return { success: false, error: 'task_id and result are required' };
  }

  const taskRepo = getCrewTasksRepository();

  const task =
    status === 'failed'
      ? await taskRepo.fail(taskId, agentId, result)
      : await taskRepo.complete(taskId, agentId, result);

  if (!task) {
    return { success: false, error: `Task ${taskId} not found or not claimed by you` };
  }

  // Notify the task creator via inbox
  const msgRepo = getAgentMessagesRepository();
  await msgRepo.create({
    id: generateId('msg'),
    from: agentId,
    to: task.createdBy,
    type: 'task_result',
    subject: `[Result] ${task.taskName}`,
    content: `## Task: ${task.taskName}\n**Status:** ${status}\n\n${result}`,
    attachments: [],
    priority: 'normal',
    threadId: generateId('thread'),
    requiresResponse: false,
    status: 'sent',
    crewId: task.crewId,
    createdAt: new Date(),
  });

  return {
    success: true,
    result: {
      taskId: task.id,
      taskName: task.taskName,
      status: task.status,
      notifiedCreator: task.createdBy,
    },
  };
}

async function handleRequestReview(
  args: Record<string, unknown>,
  agentId: string,
  crewId: string | undefined
): Promise<ToolExecutionResult> {
  const reviewer = String(args.reviewer ?? '').trim();
  const subject = String(args.subject ?? '').trim();
  const content = String(args.content ?? '').trim();
  const taskId = args.task_id ? String(args.task_id) : undefined;

  if (!reviewer || !subject || !content) {
    return { success: false, error: 'reviewer, subject, and content are required' };
  }

  // Resolve reviewer name → ID
  let resolvedReviewerId = reviewer;
  if (crewId && !reviewer.startsWith('agent_') && !reviewer.match(/^[a-z]{3}_[a-z0-9]+$/)) {
    const crewRepo = getCrewsRepository();
    const soulsRepo = getSoulsRepository();
    const members = await crewRepo.getMembers(crewId);
    for (const m of members) {
      const soul = await soulsRepo.getByAgentId(m.agentId);
      if (soul?.identity.name.toLowerCase() === reviewer.toLowerCase()) {
        resolvedReviewerId = m.agentId;
        break;
      }
    }
  }

  const msgId = generateId('msg');
  const message: AgentMessage = {
    id: msgId,
    from: agentId,
    to: resolvedReviewerId,
    type: 'feedback',
    subject: `[Review Request] ${subject}`,
    content: taskId
      ? `## Review Request\n**Task:** ${taskId}\n**Subject:** ${subject}\n\n${content}`
      : `## Review Request\n**Subject:** ${subject}\n\n${content}`,
    attachments: [],
    priority: 'normal',
    threadId: generateId('thread'),
    requiresResponse: true,
    status: 'sent',
    crewId: crewId ?? undefined,
    createdAt: new Date(),
  };

  const msgRepo = getAgentMessagesRepository();
  await msgRepo.create(message);

  return {
    success: true,
    result: {
      messageId: msgId,
      sentTo: resolvedReviewerId,
      subject,
    },
  };
}

async function handleShareKnowledge(
  args: Record<string, unknown>,
  agentId: string,
  crewId: string | undefined
): Promise<ToolExecutionResult> {
  if (!crewId) {
    return { success: false, error: 'You are not currently part of a crew.' };
  }

  const category = String(args.category ?? 'general').trim();
  const title = String(args.title ?? '').trim();
  const content = String(args.content ?? '').trim();

  if (!title || !content) {
    return { success: false, error: 'title and content are required' };
  }

  const memRepo = getCrewMemoryRepository();
  const entry = await memRepo.create(crewId, agentId, category, title, content);

  return {
    success: true,
    result: {
      id: entry.id,
      category: entry.category,
      title: entry.title,
      status: 'saved to crew memory',
    },
  };
}

async function handleGetCrewMemory(
  args: Record<string, unknown>,
  crewId: string | undefined
): Promise<ToolExecutionResult> {
  if (!crewId) {
    return { success: false, error: 'You are not currently part of a crew.' };
  }

  const category = args.category ? String(args.category).trim() : undefined;
  const query = args.query ? String(args.query).trim() : undefined;
  const limit = args.limit ? Number(args.limit) : 10;

  const memRepo = getCrewMemoryRepository();

  if (query) {
    const entries = await memRepo.search(crewId, query, limit);
    return {
      success: true,
      result: {
        query,
        count: entries.length,
        entries: entries.map((e) => ({
          id: e.id,
          category: e.category,
          title: e.title,
          content: e.content,
          author: e.agentId,
          createdAt: e.createdAt.toISOString(),
        })),
      },
    };
  }

  const { entries, total } = await memRepo.list(crewId, category, limit);
  return {
    success: true,
    result: {
      category: category ?? 'all',
      total,
      count: entries.length,
      entries: entries.map((e) => ({
        id: e.id,
        category: e.category,
        title: e.title,
        content: e.content,
        author: e.agentId,
        createdAt: e.createdAt.toISOString(),
      })),
    },
  };
}

async function handleCoordinate(
  args: Record<string, unknown>,
  agentId: string,
  crewId: string | undefined
): Promise<ToolExecutionResult> {
  if (!crewId) {
    return { success: false, error: 'You are not currently part of a crew.' };
  }

  const action = String(args.action ?? '').trim();
  const subject = String(args.subject ?? '').trim();

  if (!subject) {
    return { success: false, error: 'subject is required' };
  }

  if (action === 'propose') {
    const content = String(args.content ?? '').trim();
    if (!content) {
      return { success: false, error: 'content is required for proposals' };
    }

    // Broadcast the proposal to all crew members
    const { getCommunicationBus } = await import('../services/soul-heartbeat-service.js');
    const bus = getCommunicationBus();

    const result = await bus.broadcast(crewId, {
      from: agentId,
      type: 'coordination',
      subject: `[Proposal] ${subject}`,
      content,
      attachments: [],
      priority: 'normal',
      requiresResponse: true,
    });

    return {
      success: true,
      result: {
        action: 'propose',
        subject,
        deliveredTo: result.delivered.length,
      },
    };
  }

  if (action === 'status') {
    const taskRepo = getCrewTasksRepository();
    const pendingTasks = await taskRepo.listPending(crewId, 50);
    const inProgressResult = await taskRepo.listByCrew(crewId, 'in_progress', 50);

    return {
      success: true,
      result: {
        action: 'status',
        pendingTasks: pendingTasks.length,
        inProgressTasks: inProgressResult.tasks.length,
        pending: pendingTasks.map((t) => ({
          id: t.id,
          name: t.taskName,
          priority: t.priority,
          createdBy: t.createdBy,
        })),
        inProgress: inProgressResult.tasks.map((t) => ({
          id: t.id,
          name: t.taskName,
          claimedBy: t.claimedBy,
          priority: t.priority,
        })),
      },
    };
  }

  return { success: false, error: `Unknown action: ${action}. Use "propose" or "status".` };
}
