/**
 * Crew Coordination Tools — Executor
 *
 * Provides three tools for soul agents to interact with their crew:
 *   - get_crew_members   — list crew members with roles and IDs
 *   - delegate_task      — send a structured task to another crew member
 *   - broadcast_to_crew  — send a message to all crew members at once
 *
 * Relies on HeartbeatExecutionContext (AsyncLocalStorage) to resolve the
 * current agent's ID and crew ID without requiring interface changes.
 */

import { generateId, getErrorMessage } from '@ownpilot/core';
import type { ToolDefinition, AgentMessage } from '@ownpilot/core';
import { getCrewsRepository } from '../db/repositories/crews.js';
import { getSoulsRepository } from '../db/repositories/souls.js';
import { getAgentMessagesRepository } from '../db/repositories/agent-messages.js';
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
