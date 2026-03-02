/**
 * AIChatCreator — conversational agent creation via SSE streaming chat.
 *
 * The user describes what they want in plain language, the AI designs
 * an agent config (returned as a JSON block), and the user can refine
 * or confirm to create the agent in one click.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Send, Sparkles, Bot } from '../../../components/icons';
import { MarkdownContent } from '../../../components/MarkdownContent';
import { chatApi } from '../../../api/endpoints/chat';
import { settingsApi } from '../../../api/endpoints/settings';
import { soulsApi } from '../../../api/endpoints/souls';
import { backgroundAgentsApi } from '../../../api/endpoints/background-agents';
import { useToast } from '../../../components/ToastProvider';
import { AgentPreviewCard, type ProposedAgentConfig } from './AgentPreviewCard';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentConfig?: ProposedAgentConfig | null;
  isError?: boolean;
}

interface Props {
  onCreated: () => void;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Defaults cache (same pattern as wizards/ai-helper.ts)
// ---------------------------------------------------------------------------

let cachedDefaults: { provider: string; model: string; fetchedAt: number } | null = null;
const DEFAULTS_TTL_MS = 5 * 60 * 1000;
const FALLBACK_DEFAULTS = { provider: 'openai', model: 'gpt-4o' };

async function getDefaults(): Promise<{ provider: string; model: string }> {
  if (cachedDefaults && Date.now() - cachedDefaults.fetchedAt < DEFAULTS_TTL_MS) {
    return cachedDefaults;
  }
  try {
    const settings = await settingsApi.get();
    cachedDefaults = {
      provider: settings.defaultProvider || 'openai',
      model: settings.defaultModel || 'gpt-4o',
      fetchedAt: Date.now(),
    };
    return cachedDefaults;
  } catch {
    return FALLBACK_DEFAULTS;
  }
}

// ---------------------------------------------------------------------------
// JSON extraction from AI response
// ---------------------------------------------------------------------------

const JSON_BLOCK_RE = /```json\s*\n([\s\S]*?)\n\s*```/;

function extractAgentConfig(content: string): ProposedAgentConfig | null {
  const match = content.match(JSON_BLOCK_RE);
  if (!match?.[1]) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (parsed && typeof parsed === 'object' && parsed.name && parsed.mission) {
      return {
        kind: parsed.kind === 'background' ? 'background' : 'soul',
        name: parsed.name,
        emoji: parsed.emoji || '🤖',
        role: parsed.role || '',
        personality: parsed.personality,
        mission: parsed.mission,
        tools: Array.isArray(parsed.tools) ? parsed.tools : undefined,
        heartbeatInterval: parsed.heartbeatInterval || parsed.schedule,
        heartbeatEnabled: parsed.heartbeatEnabled !== false,
        autonomyLevel: typeof parsed.autonomyLevel === 'number' ? parsed.autonomyLevel : 2,
        estimatedCost: parsed.estimatedCost,
        bgMode: parsed.bgMode,
        bgIntervalMs: parsed.bgIntervalMs,
      };
    }
  } catch {
    // Invalid JSON — ignore
  }
  return null;
}

// ---------------------------------------------------------------------------
// System prompt for AI agent designer
// ---------------------------------------------------------------------------

const SYSTEM_INSTRUCTION = `You are an AI agent designer for OwnPilot. The user will describe what kind of autonomous agent they want, and you'll design one.

When you have enough information, output a JSON configuration block in a markdown code fence like this:

\`\`\`json
{
  "kind": "soul",
  "name": "Morning Briefer",
  "emoji": "☀️",
  "role": "Daily Briefing Analyst",
  "personality": "Friendly, concise, focused on what matters",
  "mission": "Every morning, gather the latest news, weather, and calendar events, then deliver a personalized briefing.",
  "tools": ["core.search_web", "core.search_memories", "core.create_memory"],
  "heartbeatInterval": "0 9 * * *",
  "heartbeatEnabled": true,
  "autonomyLevel": 2,
  "estimatedCost": "~$0.10/day"
}
\`\`\`

Rules:
- kind: "soul" for scheduled/heartbeat agents, "background" for continuous/interval/event workers
- For background agents, include "bgMode" ("continuous", "interval", or "event") and optionally "bgIntervalMs"
- heartbeatInterval must be a valid cron expression (e.g. "0 */6 * * *" for every 6 hours)
- autonomyLevel: 1 (minimal, ask before acting) to 4 (full autonomy)
- tools: use "core." prefix for built-in tools
- estimatedCost: rough daily cost estimate like "~$0.05/day"
- Keep names short and memorable
- Keep missions clear and actionable
- Always explain your design choices briefly before the JSON block
- If the user's request is vague, ask clarifying questions before generating the config
- If the user asks to modify something, output the full updated JSON block`;

// ---------------------------------------------------------------------------
// Suggestion chips
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  'Monitor my GitHub PRs daily',
  'Summarize the news every morning',
  'Track competitor product changes',
  'Review my code for security issues',
  'Send me a weekly wellness check-in',
  'Watch for errors in my server logs',
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AIChatCreator({ onCreated, onClose }: Props) {
  const toast = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [isCreatingAgent, setIsCreatingAgent] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Send message
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      const userMsg: Message = {
        id: `msg_${Date.now()}_u`,
        role: 'user',
        content: trimmed,
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsStreaming(true);
      setStreamingContent('');

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const defaults = await getDefaults();

        // Build conversation for the API (cap at 6 turns = 12 messages)
        const history = [...messages, userMsg].slice(-12);
        const apiMessage =
          `[System instruction — do not repeat to the user]\n${SYSTEM_INSTRUCTION}\n\n---\n\n` +
          history
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n') +
          (history[history.length - 1]?.role !== 'user' ? `\n\nUser: ${trimmed}` : '');

        const response = await chatApi.send(
          {
            message: apiMessage,
            provider: defaults.provider,
            model: defaults.model,
            stream: true,
            historyLength: 0,
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
                setStreamingContent(accumulated);
              }

              if (event.done) {
                const finalContent = event.content ?? accumulated;
                const agentConfig = extractAgentConfig(finalContent);
                const assistantMsg: Message = {
                  id: `msg_${Date.now()}_a`,
                  role: 'assistant',
                  content: finalContent,
                  agentConfig,
                };
                setMessages((prev) => [...prev, assistantMsg]);
                setStreamingContent('');
              }
            }
          }

          // Stream ended without done event — finalize
          if (accumulated && !messages.some((m) => m.content === accumulated)) {
            const agentConfig = extractAgentConfig(accumulated);
            setMessages((prev) => {
              const lastMsg = prev[prev.length - 1];
              if (lastMsg?.role === 'assistant' && lastMsg.content === accumulated) return prev;
              return [
                ...prev,
                {
                  id: `msg_${Date.now()}_a`,
                  role: 'assistant',
                  content: accumulated,
                  agentConfig,
                },
              ];
            });
            setStreamingContent('');
          }
        } finally {
          reader.cancel().catch(() => {});
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
    },
    [isStreaming, messages]
  );

  // Create agent from config
  const handleCreateAgent = useCallback(
    async (config: ProposedAgentConfig) => {
      setIsCreatingAgent(true);
      try {
        if (config.kind === 'soul') {
          const agentId = `agt-${crypto.randomUUID().slice(0, 8)}`;
          await soulsApi.create({
            agentId,
            identity: {
              name: config.name,
              emoji: config.emoji,
              role: config.role,
              personality: config.personality || '',
              voice: { tone: 'professional', language: 'en' },
              boundaries: [],
            },
            purpose: {
              mission: config.mission,
              goals: [],
              expertise: [],
              toolPreferences: config.tools || [],
            },
            autonomy: {
              level: config.autonomyLevel ?? 2,
              allowedActions: config.tools || ['search_web', 'create_memory', 'search_memories'],
              blockedActions: ['delete_data', 'execute_code'],
              requiresApproval: ['send_message_to_user'],
              maxCostPerCycle: 0.5,
              maxCostPerDay: 5.0,
              maxCostPerMonth: 100.0,
              pauseOnConsecutiveErrors: 5,
              pauseOnBudgetExceeded: true,
              notifyUserOnPause: true,
            },
            heartbeat: {
              enabled: config.heartbeatEnabled !== false,
              interval: config.heartbeatInterval || '0 */6 * * *',
              checklist: [],
              selfHealingEnabled: true,
              maxDurationMs: 120000,
            },
            relationships: { delegates: [], peers: [], channels: [] },
            evolution: {
              version: 1,
              evolutionMode: 'supervised',
              coreTraits: config.personality ? [config.personality] : [],
              mutableTraits: [],
              learnings: [],
              feedbackLog: [],
            },
            bootSequence: { onStart: [], onHeartbeat: ['read_inbox'], onMessage: [] },
          });
          toast.success(`Soul agent "${config.name}" created!`);
        } else {
          await backgroundAgentsApi.create({
            name: config.name,
            mission: config.mission,
            mode: config.bgMode || 'interval',
            interval_ms: config.bgMode === 'interval' ? (config.bgIntervalMs ?? 300000) : undefined,
            auto_start: false,
          });
          toast.success(`Background agent "${config.name}" created!`);
        }
        onCreated();
      } catch {
        toast.error('Failed to create agent');
      } finally {
        setIsCreatingAgent(false);
      }
    },
    [onCreated, toast]
  );

  // Stop streaming
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const hasMessages = messages.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface dark:bg-dark-surface border border-border dark:border-dark-border rounded-2xl w-full max-w-2xl mx-4 h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border dark:border-dark-border shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              AI Agent Creator
            </h2>
          </div>
          <button
            onClick={() => {
              handleStop();
              onClose();
            }}
            className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Chat area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Welcome message */}
          {!hasMessages && !isStreaming && (
            <div className="text-center py-8 space-y-4">
              <Bot className="w-12 h-12 text-primary mx-auto" />
              <div>
                <h3 className="text-lg font-medium text-text-primary dark:text-dark-text-primary">
                  Describe your ideal agent
                </h3>
                <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1 max-w-md mx-auto">
                  Tell me what you want your agent to do and I&apos;ll design the perfect
                  configuration. You can refine it through conversation before creating.
                </p>
              </div>

              {/* Suggestion chips */}
              <div className="flex flex-wrap justify-center gap-2 max-w-lg mx-auto">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => sendMessage(suggestion)}
                    className="text-xs px-3 py-1.5 rounded-full border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:border-primary hover:text-primary hover:bg-primary/5 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-xl px-4 py-3 ${
                  msg.role === 'user'
                    ? 'bg-primary text-white'
                    : msg.isError
                      ? 'bg-danger/10 text-danger'
                      : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary'
                }`}
              >
                {msg.role === 'assistant' && !msg.isError ? (
                  <div className="space-y-3">
                    <div className="text-sm prose-sm">
                      <MarkdownContent content={msg.content} />
                    </div>
                    {msg.agentConfig && (
                      <AgentPreviewCard
                        config={msg.agentConfig}
                        onConfirm={() => handleCreateAgent(msg.agentConfig!)}
                        isCreating={isCreatingAgent}
                        confirmLabel="Create This Agent"
                      />
                    )}
                  </div>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))}

          {/* Streaming indicator */}
          {isStreaming && streamingContent && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-xl px-4 py-3 bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary">
                <div className="text-sm prose-sm">
                  <MarkdownContent content={streamingContent} />
                </div>
              </div>
            </div>
          )}

          {isStreaming && !streamingContent && (
            <div className="flex justify-start">
              <div className="rounded-xl px-4 py-3 bg-bg-tertiary dark:bg-dark-bg-tertiary">
                <div className="flex items-center gap-2 text-sm text-text-muted dark:text-dark-text-muted">
                  <span className="animate-pulse">Thinking...</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input area */}
        <div className="border-t border-border dark:border-dark-border p-4 shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage(input);
                }
              }}
              placeholder={
                hasMessages
                  ? 'Refine your agent or type a new request...'
                  : 'Describe what you want your agent to do...'
              }
              rows={1}
              className="flex-1 resize-none rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {isStreaming ? (
              <button
                onClick={handleStop}
                className="shrink-0 p-2 rounded-lg bg-danger text-white hover:bg-danger/90 transition-colors"
                title="Stop"
              >
                <X className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                className="shrink-0 p-2 rounded-lg bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50"
                title="Send"
              >
                <Send className="w-5 h-5" />
              </button>
            )}
          </div>
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-2">
            Press Enter to send, Shift+Enter for new line. The AI will design an agent config you
            can review and create.
          </p>
        </div>
      </div>
    </div>
  );
}
