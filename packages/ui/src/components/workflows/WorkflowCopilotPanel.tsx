/**
 * WorkflowCopilotPanel — AI chat panel for generating/editing workflows.
 *
 * Right-side panel that streams AI responses via SSE and lets users
 * apply generated workflow JSON directly to the canvas.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { workflowsApi } from '../../api';
import { MarkdownContent } from '../MarkdownContent';
import { Sparkles, Send, StopCircle, X, Play, AlertCircle } from '../icons';

// ============================================================================
// Types
// ============================================================================

interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Extracted workflow JSON from code blocks (if any) */
  workflowJson?: WorkflowDefinition | null;
  isError?: boolean;
}

export interface WorkflowDefinition {
  name: string;
  nodes: Record<string, unknown>[];
  edges: Array<{ source: string; target: string; sourceHandle?: string; targetHandle?: string }>;
}

export interface WorkflowCopilotPanelProps {
  workflowName: string;
  nodes: Node[];
  edges: Edge[];
  availableToolNames: string[];
  onApplyWorkflow: (definition: WorkflowDefinition) => void;
  onClose: () => void;
}

// ============================================================================
// JSON extraction
// ============================================================================

const JSON_BLOCK_RE = /```json\s*\n([\s\S]*?)\n\s*```/;

function extractWorkflowJson(content: string): WorkflowDefinition | null {
  const match = content.match(JSON_BLOCK_RE);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) {
      return parsed as WorkflowDefinition;
    }
  } catch {
    // Invalid JSON
  }
  return null;
}

// ============================================================================
// Build current workflow context (same format as WorkflowSourceModal export)
// ============================================================================

function buildCurrentWorkflow(name: string, nodes: Node[], edges: Edge[]) {
  if (nodes.length === 0) return undefined;
  return {
    name,
    nodes: nodes.map((n) => {
      const base: Record<string, unknown> = {
        id: n.id,
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
      };
      const d = n.data as Record<string, unknown>;

      if (n.type === 'triggerNode') {
        return { ...base, type: 'trigger', triggerType: d.triggerType ?? 'manual', label: d.label ?? 'Trigger', ...pickDefined(d, ['cron', 'eventType', 'condition', 'threshold', 'webhookPath']) };
      }
      if (n.type === 'llmNode') {
        return { ...base, type: 'llm', label: d.label, provider: d.provider, model: d.model, ...pickDefined(d, ['systemPrompt', 'userMessage', 'temperature', 'maxTokens']) };
      }
      if (n.type === 'conditionNode') {
        return { ...base, type: 'condition', label: d.label, expression: d.expression, ...pickDefined(d, ['description']) };
      }
      if (n.type === 'codeNode') {
        return { ...base, type: 'code', label: d.label, language: d.language, code: d.code, ...pickDefined(d, ['description']) };
      }
      if (n.type === 'transformerNode') {
        return { ...base, type: 'transformer', label: d.label, expression: d.expression, ...pickDefined(d, ['description']) };
      }
      if (n.type === 'forEachNode') {
        return { ...base, type: 'forEach', label: d.label, arrayExpression: d.arrayExpression, ...pickDefined(d, ['itemVariable', 'maxIterations', 'onError', 'description']) };
      }
      // Tool node
      return { ...base, tool: d.toolName, label: d.label, ...pickDefined(d, ['description']), ...(d.toolArgs && typeof d.toolArgs === 'object' && Object.keys(d.toolArgs as object).length > 0 ? { args: d.toolArgs } : {}) };
    }),
    edges: edges.map((e) => {
      const edge: Record<string, string> = { source: e.source, target: e.target };
      if (e.sourceHandle) edge.sourceHandle = e.sourceHandle;
      return edge;
    }),
  };
}

function pickDefined(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    if (obj[key] != null && obj[key] !== '') result[key] = obj[key];
  }
  return result;
}

// ============================================================================
// Component
// ============================================================================

export function WorkflowCopilotPanel({
  workflowName,
  nodes,
  edges,
  availableToolNames,
  onApplyWorkflow,
  onClose,
}: WorkflowCopilotPanelProps) {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Build serialized conversation for the API (exclude workflowJson, errors)
  const apiMessages = useMemo(
    () => messages.filter((m) => !m.isError).map((m) => ({ role: m.role, content: m.content })),
    [messages],
  );

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;

    const userMsg: CopilotMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: trimmed,
    };

    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput('');
    setIsStreaming(true);
    setStreamingContent('');

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const currentWorkflow = buildCurrentWorkflow(workflowName, nodes, edges);
      const response = await workflowsApi.copilot(
        {
          messages: [...apiMessages, { role: 'user', content: trimmed }],
          currentWorkflow,
          availableTools: availableToolNames.length > 0 ? availableToolNames : undefined,
        },
        { signal: abort.signal },
      );

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream available');

      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data:')) continue;
          const dataStr = line.slice(5).trim();
          if (!dataStr) continue;

          let event: { delta?: string; done?: boolean; content?: string; error?: string };
          try {
            event = JSON.parse(dataStr);
          } catch {
            continue;
          }

          if (event.error) {
            throw new Error(event.error);
          }

          if (event.delta) {
            accumulated += event.delta;
            setStreamingContent(accumulated);
          }

          if (event.done) {
            const finalContent = event.content ?? accumulated;
            const workflowJson = extractWorkflowJson(finalContent);
            const assistantMsg: CopilotMessage = {
              id: `msg_${Date.now()}_a`,
              role: 'assistant',
              content: finalContent,
              workflowJson,
            };
            setMessages((prev) => [...prev, assistantMsg]);
            setStreamingContent('');
          }
        }
      }

      // If stream ended without a done event, add whatever we accumulated
      if (accumulated && !messages.some((m) => m.content === accumulated)) {
        const workflowJson = extractWorkflowJson(accumulated);
        setMessages((prev) => {
          // Only add if we haven't already added via done event
          const lastMsg = prev[prev.length - 1];
          if (lastMsg?.role === 'assistant' && lastMsg.content === accumulated) return prev;
          return [...prev, {
            id: `msg_${Date.now()}_a`,
            role: 'assistant',
            content: accumulated,
            workflowJson,
          }];
        });
        setStreamingContent('');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) => [...prev, {
          id: `msg_${Date.now()}_e`,
          role: 'assistant',
          content: err instanceof Error ? err.message : 'An error occurred',
          isError: true,
        }]);
        setStreamingContent('');
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [input, isStreaming, messages, apiMessages, workflowName, nodes, edges, availableToolNames]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // Cleanup abort on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return (
    <div className="w-96 shrink-0 flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            Copilot
          </h3>
        </div>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !isStreaming && (
          <div className="text-center py-8">
            <Sparkles className="w-8 h-8 text-text-muted/30 mx-auto mb-3" />
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Describe the workflow you want to build, or ask me to modify the current one.
            </p>
            <div className="mt-3 space-y-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => { setInput(s); inputRef.current?.focus(); }}
                  className="block w-full text-left px-3 py-1.5 text-xs text-text-secondary dark:text-dark-text-secondary bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary rounded-md transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.role === 'user' ? (
              <div className="flex justify-end">
                <div className="max-w-[85%] px-3 py-2 rounded-lg bg-primary text-white text-sm">
                  {msg.content}
                </div>
              </div>
            ) : (
              <div className="max-w-full">
                {msg.isError ? (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-error/10 border border-error/20">
                    <AlertCircle className="w-4 h-4 text-error shrink-0 mt-0.5" />
                    <p className="text-sm text-error">{msg.content}</p>
                  </div>
                ) : (
                  <div className="px-3 py-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
                    <MarkdownContent content={msg.content} compact className="text-sm" />
                    {msg.workflowJson && (
                      <button
                        onClick={() => onApplyWorkflow(msg.workflowJson!)}
                        className="mt-2 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary/90 rounded-md transition-colors"
                      >
                        <Play className="w-3 h-3" />
                        Apply to Canvas
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Streaming indicator */}
        {isStreaming && (
          <div className="max-w-full">
            <div className="px-3 py-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
              {streamingContent ? (
                <MarkdownContent content={streamingContent} compact className="text-sm" />
              ) : (
                <div className="flex items-center gap-2 text-sm text-text-muted">
                  <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
                  Thinking...
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 py-2.5 border-t border-border dark:border-dark-border">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe your workflow..."
            rows={1}
            className="flex-1 resize-none rounded-md border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm px-3 py-2 placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-primary max-h-[120px]"
            style={{ minHeight: '36px' }}
          />
          {isStreaming ? (
            <button
              onClick={handleCancel}
              className="shrink-0 p-2 rounded-md bg-error text-white hover:bg-error/90 transition-colors"
              title="Stop"
            >
              <StopCircle className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="shrink-0 p-2 rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-40 transition-colors"
              title="Send"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Suggestions
// ============================================================================

const SUGGESTIONS = [
  'Create a workflow that checks weather daily and sends an email summary',
  'Build a pipeline that fetches data, filters results, and stores them',
  'Make a workflow with a condition that branches based on a value',
];

// ============================================================================
// Node conversion (AI JSON → ReactFlow nodes)
// ============================================================================

/**
 * Convert AI-generated workflow definition into ReactFlow nodes and edges.
 * This is the reverse of `buildWorkflowDefinition` in WorkflowSourceModal.
 */
export function convertDefinitionToReactFlow(
  definition: WorkflowDefinition,
  availableToolNames?: string[],
): { nodes: Node[]; edges: Edge[] } {
  // Build lookup for resolving AI-generated tool names that may be missing dots
  const resolveToolName = buildToolNameResolver(availableToolNames);

  const nodes: Node[] = definition.nodes.map((def) => {
    const id = (def.id as string) || `node_${Math.random().toString(36).slice(2, 8)}`;
    const position = (def.position as { x: number; y: number }) || { x: 300, y: 100 };

    if (def.type === 'trigger') {
      return {
        id,
        type: 'triggerNode',
        position,
        data: {
          triggerType: def.triggerType ?? 'manual',
          label: def.label ?? 'Trigger',
          ...(def.cron != null ? { cron: def.cron } : {}),
          ...(def.eventType != null ? { eventType: def.eventType } : {}),
          ...(def.condition != null ? { condition: def.condition } : {}),
          ...(def.threshold != null ? { threshold: def.threshold } : {}),
          ...(def.webhookPath != null ? { webhookPath: def.webhookPath } : {}),
        },
      };
    }

    if (def.type === 'llm') {
      return {
        id,
        type: 'llmNode',
        position,
        data: {
          label: def.label ?? 'LLM',
          provider: def.provider ?? '',
          model: def.model ?? '',
          ...(def.systemPrompt != null ? { systemPrompt: def.systemPrompt } : {}),
          ...(def.userMessage != null ? { userMessage: def.userMessage } : {}),
          ...(def.temperature != null ? { temperature: def.temperature } : {}),
          ...(def.maxTokens != null ? { maxTokens: def.maxTokens } : {}),
        },
      };
    }

    if (def.type === 'condition') {
      return {
        id,
        type: 'conditionNode',
        position,
        data: {
          label: def.label ?? 'Condition',
          expression: def.expression ?? '',
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'code') {
      return {
        id,
        type: 'codeNode',
        position,
        data: {
          label: def.label ?? 'Code',
          language: def.language ?? 'javascript',
          code: def.code ?? '',
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'transformer') {
      return {
        id,
        type: 'transformerNode',
        position,
        data: {
          label: def.label ?? 'Transform',
          expression: def.expression ?? '',
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    if (def.type === 'forEach') {
      return {
        id,
        type: 'forEachNode',
        position,
        data: {
          label: def.label ?? 'ForEach',
          arrayExpression: def.arrayExpression ?? '',
          ...(def.itemVariable != null ? { itemVariable: def.itemVariable } : {}),
          ...(def.maxIterations != null ? { maxIterations: def.maxIterations } : {}),
          ...(def.onError != null ? { onError: def.onError } : {}),
          ...(def.description != null ? { description: def.description } : {}),
        },
      };
    }

    // Default: tool node (no type field, has "tool" field)
    const rawToolName = (def.tool as string) || 'unknown_tool';
    const toolName = resolveToolName(rawToolName);
    return {
      id,
      type: 'toolNode',
      position,
      data: {
        toolName,
        toolArgs: (def.args as Record<string, unknown>) ?? {},
        label: (def.label as string) || formatToolName(toolName),
        ...(def.description != null ? { description: def.description } : {}),
      },
    };
  });

  const rfEdges: Edge[] = definition.edges.map((e, i) => ({
    id: `edge_${e.source}_${e.target}_${i}`,
    source: e.source,
    target: e.target,
    ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}),
    ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}),
  }));

  return { nodes, edges: rfEdges };
}

/** Strip namespace prefix and title-case */
function formatToolName(name: string): string {
  const base = name.includes('.') ? name.split('.').pop()! : name;
  return base
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build a tool name resolver that fixes AI-generated names with missing dots.
 * e.g. "mcpgithublist_repositories" → "mcp.github.list_repositories"
 */
function buildToolNameResolver(
  availableToolNames?: string[],
): (name: string) => string {
  if (!availableToolNames || availableToolNames.length === 0) {
    return (name) => name;
  }

  // Build a lookup: normalized (dots removed, lowercased) → original name
  const normalizedMap = new Map<string, string>();
  for (const toolName of availableToolNames) {
    const normalized = toolName.replace(/\./g, '').toLowerCase();
    normalizedMap.set(normalized, toolName);
  }

  // Also index by base name (last segment after dot) for partial matches
  const baseNameMap = new Map<string, string>();
  for (const toolName of availableToolNames) {
    const dot = toolName.lastIndexOf('.');
    const baseName = dot >= 0 ? toolName.substring(dot + 1) : toolName;
    // Only use base name if unambiguous (no duplicates)
    if (baseNameMap.has(baseName)) {
      baseNameMap.set(baseName, ''); // Mark as ambiguous
    } else {
      baseNameMap.set(baseName, toolName);
    }
  }

  return (name: string): string => {
    // Exact match — name is already correct
    if (availableToolNames.includes(name)) return name;

    // Try normalized match (removes dots and lowercases)
    const normalized = name.replace(/\./g, '').toLowerCase();
    const match = normalizedMap.get(normalized);
    if (match) return match;

    // Try base name match (e.g. "list_repositories" → "mcp.github.list_repositories")
    const baseMatch = baseNameMap.get(name);
    if (baseMatch) return baseMatch;

    // No resolution found — return as-is
    return name;
  };
}
