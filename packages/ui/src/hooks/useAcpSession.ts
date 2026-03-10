/**
 * ACP Session Hook
 *
 * Subscribes to ACP (Agent Client Protocol) WebSocket events for a coding
 * agent session and provides structured data (tool calls, plan, messages,
 * thoughts, permission requests).
 */

import { useState, useEffect, useRef } from 'react';
import { useGateway } from './useWebSocket';
import type {
  AcpToolCall,
  AcpPlan,
  AcpToolCallContent,
} from '../api/endpoints/coding-agents';

// =============================================================================
// Types
// =============================================================================

export interface AcpMessage {
  content: unknown;
  role: 'assistant' | 'user';
  timestamp: string;
}

export interface AcpThought {
  content: unknown;
  timestamp: string;
}

export interface AcpPermissionRequest {
  toolCallId: string;
  title: string;
  options: Array<{
    optionId: string;
    name: string;
    kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
  }>;
  timestamp: string;
}

export interface AcpSessionState {
  /** Whether this session uses ACP */
  isAcp: boolean;
  /** All tool calls (accumulated) */
  toolCalls: AcpToolCall[];
  /** Current execution plan */
  plan: AcpPlan | null;
  /** Accumulated assistant messages */
  messages: AcpMessage[];
  /** Agent's thinking/reasoning */
  thoughts: AcpThought[];
  /** Current pending permission request (if any) */
  pendingPermission: AcpPermissionRequest | null;
  /** Agent's current mode */
  mode: string | null;
  /** Stop reason from last completed turn */
  stopReason: string | null;
}

// =============================================================================
// Hook
// =============================================================================

export function useAcpSession(sessionId: string | null): AcpSessionState {
  const { subscribe } = useGateway();

  const [toolCalls, setToolCalls] = useState<AcpToolCall[]>([]);
  const [plan, setPlan] = useState<AcpPlan | null>(null);
  const [messages, setMessages] = useState<AcpMessage[]>([]);
  const [thoughts, setThoughts] = useState<AcpThought[]>([]);
  const [pendingPermission, setPendingPermission] = useState<AcpPermissionRequest | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState<string | null>(null);
  const [isAcp, setIsAcp] = useState(false);

  // Use ref to track tool calls by ID for updates
  const toolCallsRef = useRef<Map<string, AcpToolCall>>(new Map());

  useEffect(() => {
    if (!sessionId) return;

    const unsubs: Array<() => void> = [];

    // Snapshot (reconnection replay)
    unsubs.push(
      subscribe<{
        sessionId: string;
        toolCalls: AcpToolCall[];
        plan: AcpPlan | null;
        acpEnabled: boolean;
      }>('coding-agent:acp:snapshot', (data) => {
        if (data.sessionId !== sessionId) return;
        setIsAcp(data.acpEnabled);
        toolCallsRef.current.clear();
        for (const tc of data.toolCalls) {
          toolCallsRef.current.set(tc.toolCallId, tc);
        }
        setToolCalls(data.toolCalls);
        setPlan(data.plan);
      })
    );

    // Tool call created
    unsubs.push(
      subscribe<{ sessionId: string; toolCall: AcpToolCall }>(
        'coding-agent:acp:tool-call',
        (data) => {
          if (data.sessionId !== sessionId) return;
          setIsAcp(true);
          toolCallsRef.current.set(data.toolCall.toolCallId, data.toolCall);
          setToolCalls(Array.from(toolCallsRef.current.values()));
        }
      )
    );

    // Tool call updated
    unsubs.push(
      subscribe<{
        sessionId: string;
        toolCallId: string;
        status?: string;
        content?: AcpToolCallContent[];
        locations?: Array<{ path: string; startLine?: number }>;
        title?: string;
      }>('coding-agent:acp:tool-update', (data) => {
        if (data.sessionId !== sessionId) return;
        const existing = toolCallsRef.current.get(data.toolCallId);
        if (existing) {
          const updated = { ...existing };
          if (data.status) updated.status = data.status;
          if (data.title) updated.title = data.title;
          if (data.content) updated.content = data.content;
          if (data.locations) updated.locations = data.locations;
          if (data.status === 'completed' || data.status === 'failed') {
            updated.completedAt = new Date().toISOString();
          }
          toolCallsRef.current.set(data.toolCallId, updated);
          setToolCalls(Array.from(toolCallsRef.current.values()));
        }
      })
    );

    // Plan update
    unsubs.push(
      subscribe<{ sessionId: string; plan: AcpPlan }>(
        'coding-agent:acp:plan',
        (data) => {
          if (data.sessionId !== sessionId) return;
          setPlan(data.plan);
        }
      )
    );

    // Agent message
    unsubs.push(
      subscribe<{ sessionId: string; content: unknown; role: 'assistant' | 'user' }>(
        'coding-agent:acp:message',
        (data) => {
          if (data.sessionId !== sessionId) return;
          setMessages((prev) => [
            ...prev,
            { content: data.content, role: data.role, timestamp: new Date().toISOString() },
          ]);
        }
      )
    );

    // Agent thought
    unsubs.push(
      subscribe<{ sessionId: string; content: unknown }>(
        'coding-agent:acp:thought',
        (data) => {
          if (data.sessionId !== sessionId) return;
          setThoughts((prev) => [
            ...prev,
            { content: data.content, timestamp: new Date().toISOString() },
          ]);
        }
      )
    );

    // Permission request
    unsubs.push(
      subscribe<{
        sessionId: string;
        toolCallId: string;
        title: string;
        options: AcpPermissionRequest['options'];
      }>('coding-agent:acp:permission-request', (data) => {
        if (data.sessionId !== sessionId) return;
        setPendingPermission({
          toolCallId: data.toolCallId,
          title: data.title,
          options: data.options,
          timestamp: new Date().toISOString(),
        });
      })
    );

    // Mode change
    unsubs.push(
      subscribe<{ sessionId: string; mode: string }>(
        'coding-agent:acp:mode-change',
        (data) => {
          if (data.sessionId !== sessionId) return;
          setMode(data.mode);
        }
      )
    );

    // Completion
    unsubs.push(
      subscribe<{ sessionId: string; stopReason: string }>(
        'coding-agent:acp:complete',
        (data) => {
          if (data.sessionId !== sessionId) return;
          setStopReason(data.stopReason);
          setPendingPermission(null);
        }
      )
    );

    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [sessionId, subscribe]);

  // Reset state when sessionId changes
  useEffect(() => {
    setToolCalls([]);
    setPlan(null);
    setMessages([]);
    setThoughts([]);
    setPendingPermission(null);
    setMode(null);
    setStopReason(null);
    setIsAcp(false);
    toolCallsRef.current.clear();
  }, [sessionId]);

  return {
    isAcp,
    toolCalls,
    plan,
    messages,
    thoughts,
    pendingPermission,
    mode,
    stopReason,
  };
}
