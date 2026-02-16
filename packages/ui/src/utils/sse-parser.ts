/**
 * SSE (Server-Sent Events) stream parser
 *
 * Extracts and parses data events from SSE stream lines.
 * Shared between useChatStore and useChat hooks.
 */

export type SSEEventType =
  | { kind: 'progress'; data: { type: string; [key: string]: unknown } }
  | { kind: 'approval'; data: { approvalId: string; category: string; description: string; code?: string; riskAnalysis?: unknown } }
  | { kind: 'delta'; data: { delta?: string; done?: boolean; id?: string; conversationId?: string; toolCalls?: unknown; usage?: unknown; finishReason?: string; trace?: unknown; session?: unknown; suggestions?: unknown } }
  | { kind: 'error'; message: string }
  | { kind: 'skip' };

/**
 * Parse a single SSE line into a typed event.
 * Returns `{ kind: 'skip' }` for non-data lines, empty data, or unparseable JSON.
 */
export function parseSSELine(line: string): SSEEventType {
  // Skip event type lines
  if (line.startsWith('event:') || !line.startsWith('data:')) {
    return { kind: 'skip' };
  }

  const dataStr = line.slice(5).trim();
  if (!dataStr) return { kind: 'skip' };

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(dataStr);
  } catch {
    // Incomplete JSON chunk — skip silently
    return { kind: 'skip' };
  }

  // Classify by data shape
  if (data.type === 'approval_required') {
    return {
      kind: 'approval',
      data: data as SSEEventType extends { kind: 'approval'; data: infer D } ? D : never,
    };
  }

  if (data.type === 'status' || data.type === 'tool_start' || data.type === 'tool_end') {
    return { kind: 'progress', data: data as { type: string } };
  }

  if (data.delta !== undefined || data.done) {
    return { kind: 'delta', data: data as SSEEventType extends { kind: 'delta'; data: infer D } ? D : never };
  }

  if (data.error) {
    return { kind: 'error', message: String(data.error) };
  }

  return { kind: 'skip' };
}
