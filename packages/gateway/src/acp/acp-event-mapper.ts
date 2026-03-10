/**
 * ACP Event Mapper
 *
 * Maps ACP session/update notifications to OwnPilot's internal event types.
 * Each SessionUpdate variant is converted to a typed OwnPilot WS event.
 *
 * The ACP SessionUpdate discriminator is `sessionUpdate` (not `type`).
 */

import type {
  SessionUpdate,
  SessionNotification,
  ToolCall,
  ToolCallUpdate,
  Plan,
  ContentChunk,
  ToolCallContent as AcpSdkToolCallContent,
  ToolCallLocation as AcpSdkToolCallLocation,
} from '@agentclientprotocol/sdk';
import type {
  AcpToolCall,
  AcpToolCallContent,
  AcpToolCallLocation,
  AcpToolCallEvent,
  AcpToolUpdateEvent,
  AcpPlanEvent,
  AcpMessageEvent,
  AcpThoughtEvent,
  AcpEventType,
  AcpPlan,
} from './types.js';

// =============================================================================
// MAPPER
// =============================================================================

export interface MappedAcpEvent {
  type: AcpEventType;
  payload: Record<string, unknown>;
}

/**
 * Map an ACP SessionNotification to zero or more OwnPilot events.
 */
export function mapSessionNotification(
  notification: SessionNotification,
  sessionId: string
): MappedAcpEvent[] {
  const update = notification.update;
  if (!update) return [];

  return mapSessionUpdate(update, sessionId, notification.sessionId);
}

/**
 * Map a single SessionUpdate to OwnPilot events.
 * The discriminator field is `sessionUpdate`.
 */
export function mapSessionUpdate(
  update: SessionUpdate,
  ownerSessionId: string,
  _acpSessionId: string
): MappedAcpEvent[] {
  const now = new Date().toISOString();
  const base = { sessionId: ownerSessionId, timestamp: now };

  // Discriminate by `sessionUpdate` field
  const kind = (update as Record<string, unknown>).sessionUpdate as string;
  if (!kind) return [];

  switch (kind) {
    case 'tool_call':
      return [mapToolCall(update as ToolCall & { sessionUpdate: 'tool_call' }, base)];

    case 'tool_call_update':
      return [
        mapToolCallUpdate(update as ToolCallUpdate & { sessionUpdate: 'tool_call_update' }, base),
      ];

    case 'plan':
      return [mapPlan(update as Plan & { sessionUpdate: 'plan' }, base)];

    case 'agent_message_chunk':
      return [
        mapMessage(
          update as ContentChunk & { sessionUpdate: 'agent_message_chunk' },
          base,
          'assistant'
        ),
      ];

    case 'user_message_chunk':
      return [
        mapMessage(update as ContentChunk & { sessionUpdate: 'user_message_chunk' }, base, 'user'),
      ];

    case 'agent_thought_chunk':
      return [mapThought(update as ContentChunk & { sessionUpdate: 'agent_thought_chunk' }, base)];

    case 'current_mode_update': {
      const modeUpdate = update as Record<string, unknown>;
      return [
        {
          type: 'coding-agent:acp:mode-change',
          payload: { ...base, mode: modeUpdate.currentMode },
        },
      ];
    }

    case 'config_option_update': {
      const configUpdate = update as Record<string, unknown>;
      return [
        {
          type: 'coding-agent:acp:config-update',
          payload: { ...base, configOptions: configUpdate.configOptions },
        },
      ];
    }

    case 'session_info_update':
      return [
        {
          type: 'coding-agent:acp:session-info',
          payload: { ...base, ...(update as Record<string, unknown>) },
        },
      ];

    default:
      return [];
  }
}

// =============================================================================
// INDIVIDUAL MAPPERS
// =============================================================================

function mapToolCall(
  update: ToolCall,
  base: { sessionId: string; timestamp: string }
): MappedAcpEvent {
  const toolCall: AcpToolCall = {
    toolCallId: update.toolCallId,
    title: update.title,
    kind: update.kind ?? 'other',
    status: update.status ?? 'pending',
    rawInput: update.rawInput as Record<string, unknown> | undefined,
    content: mapToolCallContentArray(update.content),
    locations: mapLocationArray(update.locations),
    startedAt: base.timestamp,
  };

  const event: AcpToolCallEvent = { ...base, toolCall };
  return {
    type: 'coding-agent:acp:tool-call',
    payload: event as unknown as Record<string, unknown>,
  };
}

function mapToolCallUpdate(
  update: ToolCallUpdate,
  base: { sessionId: string; timestamp: string }
): MappedAcpEvent {
  const event: AcpToolUpdateEvent = {
    ...base,
    toolCallId: update.toolCallId,
    status: update.status ?? undefined,
    content: mapToolCallContentArray(update.content),
    locations: mapLocationArray(update.locations),
    title: update.title ?? undefined,
  };

  return {
    type: 'coding-agent:acp:tool-update',
    payload: event as unknown as Record<string, unknown>,
  };
}

function mapPlan(update: Plan, base: { sessionId: string; timestamp: string }): MappedAcpEvent {
  const plan: AcpPlan = {
    entries: (update.entries ?? []).map((entry) => ({
      content: entry.content,
      status: entry.status ?? 'pending',
      priority: entry.priority ?? 'medium',
    })),
    updatedAt: base.timestamp,
  };

  const event: AcpPlanEvent = { ...base, plan };
  return { type: 'coding-agent:acp:plan', payload: event as unknown as Record<string, unknown> };
}

function mapMessage(
  update: ContentChunk,
  base: { sessionId: string; timestamp: string },
  role: 'assistant' | 'user'
): MappedAcpEvent {
  const event: AcpMessageEvent = {
    ...base,
    content: update.content,
    role,
  };
  return { type: 'coding-agent:acp:message', payload: event as unknown as Record<string, unknown> };
}

function mapThought(
  update: ContentChunk,
  base: { sessionId: string; timestamp: string }
): MappedAcpEvent {
  const event: AcpThoughtEvent = {
    ...base,
    content: update.content,
  };
  return { type: 'coding-agent:acp:thought', payload: event as unknown as Record<string, unknown> };
}

// =============================================================================
// CONTENT HELPERS
// =============================================================================

function mapToolCallContentArray(
  content: AcpSdkToolCallContent[] | undefined | null
): AcpToolCallContent[] | undefined {
  if (!content || content.length === 0) return undefined;

  return content.map((item): AcpToolCallContent => {
    switch (item.type) {
      case 'diff':
        return {
          type: 'diff',
          path: item.path,
          oldText: item.oldText ?? undefined,
          newText: item.newText,
        };
      case 'terminal':
        return {
          type: 'terminal',
          terminalId: item.terminalId,
        };
      case 'content':
        return {
          type: 'content',
          content: item.content,
        };
      default:
        return {
          type: 'text',
          text: JSON.stringify(item),
        };
    }
  });
}

function mapLocationArray(
  locations: AcpSdkToolCallLocation[] | undefined | null
): AcpToolCallLocation[] | undefined {
  if (!locations || locations.length === 0) return undefined;

  return locations.map((loc) => ({
    path: loc.path,
    startLine: loc.line ?? undefined,
  }));
}
