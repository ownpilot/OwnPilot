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
 * Trust boundary: build a MappedAcpEvent whose payload is the typed event
 * spread into a plain Record. Emitters own the shape (this file is the
 * single source of truth for what the UI receives), so the spread is
 * sound at runtime. The cast localises 'as unknown as' to one helper.
 */
function toMappedEvent<T extends { type: AcpEventType }>(
  type: AcpEventType,
  event: Omit<T, 'type'>
): MappedAcpEvent {
  return { type, payload: { ...event } as unknown as Record<string, unknown> };
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
  return toMappedEvent<AcpToolCallEvent>('coding-agent:acp:tool-call', event);
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

  return toMappedEvent<AcpToolUpdateEvent>('coding-agent:acp:tool-update', event);
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
  return toMappedEvent<AcpPlanEvent>('coding-agent:acp:plan', event);
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
  return toMappedEvent<AcpMessageEvent>('coding-agent:acp:message', event);
}

function mapThought(
  update: ContentChunk,
  base: { sessionId: string; timestamp: string }
): MappedAcpEvent {
  const event: AcpThoughtEvent = {
    ...base,
    content: update.content,
  };
  return toMappedEvent<AcpThoughtEvent>('coding-agent:acp:thought', event);
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
