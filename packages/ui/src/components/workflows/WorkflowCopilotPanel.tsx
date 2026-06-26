/**
 * WorkflowCopilotPanel — AI chat panel for generating/editing workflows.
 *
 * Right-side panel that streams AI responses via SSE and lets users
 * apply generated workflow JSON directly to the canvas.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { Node, Edge } from '@xyflow/react';
import { workflowsApi } from '../../api';
import { cleanStreamingChatContent, stripChatInternalTags } from '../../utils/chat-content';
import { ignoreError } from '../../utils/ignore-error';
import { MarkdownContent } from '../MarkdownContent';
import { Sparkles, Send, StopCircle, X, Play, AlertCircle, RefreshCw } from '../icons';
import { buildWorkflowDefinition, type WorkflowDefinition } from './workflowDefinition';

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

export type { WorkflowDefinition } from './workflowDefinition';

interface WorkflowCopilotPanelProps {
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
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.nodes)) {
      if (!Array.isArray(parsed.edges)) parsed.edges = [];

      // Deduplicate trigger nodes — keep only the first one
      let triggerSeen = false;
      const droppedIds = new Set<string>();
      parsed.nodes = parsed.nodes.filter((n: Record<string, unknown>) => {
        if (n.type === 'trigger') {
          if (triggerSeen) {
            if (n.id) droppedIds.add(n.id as string);
            return false;
          }
          triggerSeen = true;
        }
        return true;
      });
      if (droppedIds.size > 0) {
        parsed.edges = parsed.edges.filter(
          (e: { source: string; target: string }) =>
            !droppedIds.has(e.source) && !droppedIds.has(e.target)
        );
      }

      return parsed as WorkflowDefinition;
    }
  } catch {
    // Invalid JSON
  }
  return null;
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
    [messages]
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
      const currentWorkflow =
        nodes.length > 0 ? buildWorkflowDefinition(workflowName, nodes, edges) : undefined;
      const response = await workflowsApi.copilot(
        {
          messages: [...apiMessages, { role: 'user', content: trimmed }],
          currentWorkflow,
          availableTools: availableToolNames.length > 0 ? availableToolNames : undefined,
        },
        { signal: abort.signal }
      );

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No stream available');

      try {
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
              setStreamingContent(cleanStreamingChatContent(accumulated));
            }

            if (event.done) {
              const rawFinalContent = event.content ?? accumulated;
              const finalContent = stripChatInternalTags(rawFinalContent);
              const workflowJson = extractWorkflowJson(rawFinalContent);
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
        if (
          accumulated &&
          !messages.some((m) => m.content === stripChatInternalTags(accumulated))
        ) {
          const finalContent = stripChatInternalTags(accumulated);
          const workflowJson = extractWorkflowJson(accumulated);
          setMessages((prev) => {
            // Only add if we haven't already added via done event
            const lastMsg = prev[prev.length - 1];
            if (lastMsg?.role === 'assistant' && lastMsg.content === finalContent) return prev;
            return [
              ...prev,
              {
                id: `msg_${Date.now()}_a`,
                role: 'assistant',
                content: finalContent,
                workflowJson,
              },
            ];
          });
          setStreamingContent('');
        }
      } finally {
        ignoreError(reader.cancel(), 'workflowCopilot:reader.cancel');
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setMessages((prev) => [
          ...prev,
          {
            id: `msg_${Date.now()}_e`,
            role: 'assistant',
            content: err instanceof Error ? err.message : 'An error occurred',
            isError: true,
          },
        ]);
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
    [handleSend]
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
          aria-label="Close"
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && !isStreaming && (
          <SuggestionsList
            onSelect={(s) => {
              setInput(s);
              inputRef.current?.focus();
            }}
          />
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
                    <MarkdownContent
                      content={stripChatInternalTags(msg.content)}
                      compact
                      className="text-sm"
                    />
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
                <MarkdownContent
                  content={cleanStreamingChatContent(streamingContent)}
                  compact
                  className="text-sm"
                />
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
  // Basic workflows
  'Create a daily weather check workflow that fetches forecast and sends a summary via Telegram',
  'Build a pipeline that fetches data from an API, filters results, and stores them in custom data',
  'Make a workflow with a condition that branches based on a numeric value',
  // HTTP & API
  'Create a workflow that monitors a website every hour and alerts me if it goes down',
  'Build a webhook-triggered workflow that receives JSON data, validates it, and stores it',
  'Make a workflow that calls an external REST API, transforms the response, and saves key metrics',
  // LLM workflows
  'Create a content pipeline: fetch RSS feed, summarize each article with an LLM, and store summaries',
  'Build a workflow that takes user input, generates an AI response, and sends it to Telegram',
  'Make a workflow that classifies incoming messages using an LLM and routes them based on category',
  // Data processing
  'Create a workflow that reads records from a custom table, processes each one, and updates them',
  'Build an ETL pipeline: extract data from HTTP, transform with code, load into custom data',
  'Make a forEach workflow that iterates over a list and performs an HTTP request for each item',
  // Scheduling & triggers
  'Create a scheduled workflow that runs every Monday at 9 AM and generates a weekly report',
  'Build a workflow triggered by new goals that automatically creates a plan for each goal',
  'Make a cron-based cleanup workflow that archives old records every night',
  // Conditional logic
  'Create a workflow with a switch node that routes requests based on priority level (low/medium/high)',
  'Build a workflow that checks stock prices and sends alerts only when price drops below a threshold',
  'Make a workflow with nested conditions: check type first, then check status, then take action',
  // Advanced features
  'Create a workflow with an approval gate that pauses for human review before sending notifications',
  'Build a workflow with an error handler that catches failures and sends a Telegram alert',
  'Make a multi-step workflow: trigger -> validate -> process -> delay 5 minutes -> confirm',
  'Create a workflow that calls a sub-workflow for each item in a batch, with max depth of 3',
  // Code & transformation
  'Build a workflow with a code node that calculates statistics from input data',
  'Make a data transformation pipeline: fetch JSON, reshape with transformer, filter with condition',
  'Create a workflow that generates a CSV report from custom data using a code node',
  // Real-world scenarios
  'Build a lead scoring workflow: receive webhook, enrich data via API, score with LLM, route by score',
  'Create an incident response workflow: detect alert, classify severity, notify team, wait for approval',
  'Make a social media automation: fetch trending topics, generate posts with LLM, schedule with delays',
  'Build a customer onboarding workflow: receive signup, send welcome message, wait 1 day, follow up',
  'Create a document processing pipeline: receive file via webhook, extract text, summarize, store results',
];

function randomIndex(maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;

  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) {
    return 0;
  }

  const sample = new Uint32Array(1);
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / maxExclusive) * maxExclusive;

  do {
    cryptoApi.getRandomValues(sample);
  } while (sample[0]! >= limit);

  return sample[0]! % maxExclusive;
}

/** Pick `count` random items from an array without repeats — Fisher-Yates shuffle */
function pickRandom<T>(arr: T[], count: number): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    const vi = result[i]!;
    const vj = result[j]!;
    result[i] = vj;
    result[j] = vi;
  }
  return result.slice(0, count);
}

const VISIBLE_COUNT = 5;

function SuggestionsList({ onSelect }: { onSelect: (s: string) => void }) {
  const [visible, setVisible] = useState(() => pickRandom(SUGGESTIONS, VISIBLE_COUNT));

  const shuffle = useCallback(() => {
    setVisible(pickRandom(SUGGESTIONS, VISIBLE_COUNT));
  }, []);

  return (
    <div className="text-center py-8">
      <Sparkles className="w-8 h-8 text-text-muted/30 mx-auto mb-3" />
      <p className="text-sm text-text-muted dark:text-dark-text-muted">
        Describe the workflow you want to build, or ask me to modify the current one.
      </p>
      <div className="mt-3 space-y-1.5">
        {visible.map((s) => (
          <button
            key={s}
            onClick={() => onSelect(s)}
            className="block w-full text-left px-3 py-1.5 text-xs text-text-secondary dark:text-dark-text-secondary bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary rounded-md transition-colors"
          >
            {s}
          </button>
        ))}
        <button
          onClick={shuffle}
          className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 text-[10px] text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          More examples
        </button>
      </div>
    </div>
  );
}
