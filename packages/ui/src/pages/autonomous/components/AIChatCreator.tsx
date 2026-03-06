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
import { agentsApi } from '../../../api/endpoints/agents';
import { extensionsApi } from '../../../api/endpoints/extensions';
import type { ExtensionInfo } from '../../../api/types';
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
    if (!parsed || typeof parsed !== 'object') return null;

    // Required field validation
    const requiredFields = ['name', 'mission', 'role', 'personality', 'kind'];
    const missingFields = requiredFields.filter((f) => !parsed[f]);
    if (missingFields.length > 0) {
      console.warn('[AIChatCreator] Missing required fields:', missingFields);
      return null;
    }

    // Validate kind
    const kind = parsed.kind === 'background' ? 'background' : 'soul';

    // Validate autonomy level (1-4)
    let autonomyLevel = typeof parsed.autonomyLevel === 'number' ? parsed.autonomyLevel : 2;
    autonomyLevel = Math.max(1, Math.min(4, autonomyLevel));

    // Validate background agent fields
    let bgMode: 'continuous' | 'interval' | 'event' | undefined;
    let bgIntervalMs: number | undefined;
    if (kind === 'background') {
      const validModes = ['continuous', 'interval', 'event'];
      bgMode = validModes.includes(parsed.bgMode) ? parsed.bgMode : 'interval';
      bgIntervalMs = typeof parsed.bgIntervalMs === 'number' ? parsed.bgIntervalMs : 300000; // 5 min default
    }

    // Validate provider/model (use defaults if missing)
    const provider = parsed.provider || 'openai';
    const model = parsed.model || 'gpt-4o';

    return {
      kind,
      name: String(parsed.name).trim(),
      emoji: parsed.emoji || '🤖',
      role: String(parsed.role).trim(),
      personality: String(parsed.personality).trim(),
      mission: String(parsed.mission).trim(),
      tools: Array.isArray(parsed.tools) ? parsed.tools : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      heartbeatInterval: parsed.heartbeatInterval || '0 */6 * * *',
      heartbeatEnabled: kind === 'soul' ? parsed.heartbeatEnabled !== false : false,
      autonomyLevel,
      estimatedCost: parsed.estimatedCost || '~$0.50/day',
      bgMode,
      bgIntervalMs,
      provider,
      model,
    };
  } catch (err) {
    console.warn('[AIChatCreator] Failed to parse agent config:', err);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Available skills cache
// ---------------------------------------------------------------------------

let cachedSkills: ExtensionInfo[] | null = null;
let cachedSkillsAt = 0;
const SKILLS_CACHE_TTL_MS = 60 * 1000; // 1 minute

async function getAvailableSkills(): Promise<ExtensionInfo[]> {
  if (cachedSkills && Date.now() - cachedSkillsAt < SKILLS_CACHE_TTL_MS) {
    return cachedSkills;
  }
  try {
    const skills = await extensionsApi.list();
    cachedSkills = skills.filter((s) => s.status === 'enabled');
    cachedSkillsAt = Date.now();
    return cachedSkills;
  } catch {
    return [];
  }
}

function formatSkillsForPrompt(skills: ExtensionInfo[]): string {
  if (skills.length === 0) return 'No skills currently installed.';
  return skills
    .map(
      (s) =>
        `- ${s.id}: ${s.name}${s.description ? ` - ${s.description}` : ''}${s.toolCount > 0 ? ` (${s.toolCount} tools)` : ''}`
    )
    .join('\n');
}

// ---------------------------------------------------------------------------
// System prompt for AI agent designer
// ---------------------------------------------------------------------------

function buildSystemInstruction(
  skills: ExtensionInfo[],
  defaults: { provider: string; model: string }
): string {
  return `You are an expert AI agent designer for OwnPilot. Your job is to design complete, production-ready autonomous agents based on user requirements.

## Agent Configuration Schema

When you have enough information, output a COMPLETE JSON configuration block in a markdown code fence. All fields must be filled:

\`\`\`json
{
  "kind": "soul",
  "name": "Agent Name",
  "emoji": "🤖",
  "role": "Agent's Role Title",
  "personality": "Detailed personality description affecting how the agent communicates",
  "mission": "Clear, actionable mission statement",
  "tools": ["tool1", "tool2"],
  "skills": ["skill-id-1", "skill-id-2"],
  "heartbeatInterval": "0 */6 * * *",
  "heartbeatEnabled": true,
  "autonomyLevel": 2,
  "estimatedCost": "~$0.50/day",
  "provider": "${defaults.provider}",
  "model": "${defaults.model}"
}
\`\`\`

## Field Requirements

### Required Fields (MUST include):
- **kind**: "soul" for scheduled agents, "background" for workers
- **name**: Short, memorable, unique name (2-4 words max)
- **emoji**: Single relevant emoji representing the agent
- **role**: Professional role title (e.g., "Research Analyst", "Security Monitor")
- **personality**: 1-2 sentences describing communication style, tone, approach
- **mission**: 2-3 sentences describing what the agent does, when, and how
- **tools**: Array of tool names (use "core." prefix for built-in tools)
- **skills**: Array of skill IDs from the INSTALLED SKILLS list below (use exact IDs)
- **heartbeatInterval**: Valid cron expression for soul agents (omit for background/event agents)
- **heartbeatEnabled**: boolean (true for soul agents with schedules)
- **autonomyLevel**: 1-4 (1=ask permission, 2=notify, 3=log only, 4=full autonomy)
- **estimatedCost**: Daily cost estimate (e.g., "~$0.50/day", "~$2-5/day")
- **provider**: AI provider ID (use "${defaults.provider}")
- **model**: AI model ID (use "${defaults.model}")

### Background Agent Fields (when kind="background"):
- **bgMode**: "continuous" | "interval" | "event"
- **bgIntervalMs**: number (milliseconds between runs, for interval mode)

### Tool Selection Guidelines:
Commonly useful tools:
- "core.search_web" - for web research
- "core.search_memories" - for recalling past information
- "core.create_memory" - for storing findings
- "core.create_note" - for creating documents
- "core.read_url" - for reading web pages
- "core.send_message_to_user" - for notifying user

## INSTALLED SKILLS (Use these exact IDs in the skills array):
${formatSkillsForPrompt(skills)}

## CRITICAL RULES:

1. **ALWAYS** include ALL required fields in the JSON
2. **ALWAYS** select relevant skills from the INSTALLED SKILLS list above
3. **ALWAYS** use valid cron expressions (test with: https://crontab.guru)
4. **ALWAYS** set appropriate autonomyLevel based on risk:
   - Level 1: High-risk actions (sending emails, posting content, spending money)
   - Level 2: Medium-risk (research, monitoring, data collection)
   - Level 3: Low-risk (internal organization, logging)
   - Level 4: Fully trusted agents only
5. **ALWAYS** estimate realistic daily costs based on expected usage
6. **NEVER** invent skill IDs - only use IDs from the INSTALLED SKILLS list
7. **NEVER** leave fields empty or undefined

## Design Process:

1. Ask clarifying questions if the request is vague
2. Once clear, design a COMPLETE agent configuration
3. Explain your design choices briefly in natural language
4. Output the FULL JSON configuration in a markdown code block
5. If user requests changes, output the complete updated JSON

## Common Agent Patterns:

**News/Research Agent:**
- tools: ["core.search_web", "core.read_url", "core.create_memory", "core.create_note"]
- skills: Look for news, web-search, or RSS skills
- autonomyLevel: 2

**Monitoring Agent:**
- tools: ["core.read_url", "core.create_memory", "core.send_message_to_user"]
- skills: Look for monitoring, alerting, or webhook skills
- autonomyLevel: 2-3

**Content Creation Agent:**
- tools: ["core.search_memories", "core.create_note", "core.create_memory"]
- skills: Look for content, social-media, or writing skills
- autonomyLevel: 1-2 (usually requires approval)

**Data Processing Agent:**
- tools: ["core.search_memories", "core.create_memory", "core.list_custom_records"]
- skills: Look for data, analysis, or calculation skills
- autonomyLevel: 2-3`;
}

// ---------------------------------------------------------------------------
// Dedicated agent for the designer (avoids BASE_SYSTEM_PROMPT contamination)
// ---------------------------------------------------------------------------

const DESIGNER_AGENT_NAME = '__ai_agent_designer';

async function ensureDesignerAgent(
  provider: string,
  model: string,
  systemInstruction: string
): Promise<string> {
  const agents = await agentsApi.list();
  const existing = agents.find((a) => a.name === DESIGNER_AGENT_NAME);
  if (existing) {
    // Keep the system prompt in sync if instruction changed between deploys
    await agentsApi.update(existing.id, { systemPrompt: systemInstruction }).catch(() => {});
    return existing.id;
  }
  const created = await agentsApi.create({
    name: DESIGNER_AGENT_NAME,
    systemPrompt: systemInstruction,
    provider,
    model,
    tools: [],
    maxTokens: 4096,
  });
  return created.id;
}

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
  const [designerAgentId, setDesignerAgentId] = useState<string | null>(null);
  const [systemInstruction, setSystemInstruction] = useState<string>('');
  const [defaults, setDefaults] = useState<{ provider: string; model: string }>(FALLBACK_DEFAULTS);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  // Focus input on mount + bootstrap designer agent with skills
  useEffect(() => {
    inputRef.current?.focus();

    Promise.all([getDefaults(), getAvailableSkills()]).then(([defaults, skills]) => {
      setDefaults(defaults);
      const instruction = buildSystemInstruction(skills, defaults);
      setSystemInstruction(instruction);
      ensureDesignerAgent(defaults.provider, defaults.model, instruction)
        .then(setDesignerAgentId)
        .catch(() => {});
    });
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
        // Build conversation for the API (cap at 6 turns = 12 messages)
        const history = [...messages, userMsg].slice(-12);
        let apiMessage: string;
        if (designerAgentId) {
          // System instruction lives in the agent's systemPrompt — just send conversation
          apiMessage = history
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n');
        } else {
          // Fallback: embed instruction in message (when agent bootstrap failed)
          apiMessage =
            `[System instruction — do not repeat to the user]\n${systemInstruction}\n\n---\n\n` +
            history
              .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
              .join('\n\n') +
            (history[history.length - 1]?.role !== 'user' ? `\n\nUser: ${trimmed}` : '');
        }

        const response = await chatApi.send(
          {
            message: apiMessage,
            provider: defaults.provider,
            model: defaults.model,
            stream: true,
            historyLength: 0,
            agentId: designerAgentId || undefined,
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
    [isStreaming, messages, designerAgentId, defaults, systemInstruction]
  );

  // Validate config before deployment
  const validateConfig = (config: ProposedAgentConfig): string[] => {
    const errors: string[] = [];
    if (!config.name?.trim()) errors.push('Name is required');
    if (!config.mission?.trim()) errors.push('Mission is required');
    if (!config.role?.trim()) errors.push('Role is required');
    if (!config.personality?.trim()) errors.push('Personality is required');
    if (config.kind === 'background') {
      const validModes = ['continuous', 'interval', 'event'];
      if (!validModes.includes(config.bgMode || '')) {
        errors.push('Background agent mode must be: continuous, interval, or event');
      }
    }
    return errors;
  };

  // Create agent from config
  const handleCreateAgent = useCallback(
    async (config: ProposedAgentConfig) => {
      // Pre-deployment validation
      const validationErrors = validateConfig(config);
      if (validationErrors.length > 0) {
        toast.error(`Invalid configuration: ${validationErrors.join(', ')}`);
        return;
      }

      setIsCreatingAgent(true);
      try {
        // Use AI-suggested provider/model or fall back to defaults
        const provider = config.provider || defaults.provider;
        const model = config.model || defaults.model;

        if (config.kind === 'soul') {
          await soulsApi.deploy({
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
              requiresApproval: (config.autonomyLevel ?? 2) <= 1 ? ['send_message_to_user'] : [],
              maxCostPerCycle: 0.5,
              maxCostPerDay: 5.0,
              maxCostPerMonth: 100.0,
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
              evolutionMode: 'supervised',
              coreTraits: config.personality ? [config.personality] : [],
              mutableTraits: [],
            },
            bootSequence: { onStart: [], onHeartbeat: ['read_inbox'], onMessage: [] },
            skillAccess: {
              allowed: config.skills || [],
              blocked: [],
            },
            provider,
            model,
          });
          toast.success(`Soul agent "${config.name}" created!`);
        } else {
          await backgroundAgentsApi.create({
            name: config.name,
            mission: config.mission,
            mode: config.bgMode || 'interval',
            interval_ms: config.bgMode === 'interval' ? (config.bgIntervalMs ?? 300000) : undefined,
            auto_start: false,
            allowed_tools: config.tools || [],
            skills: config.skills || [],
            provider,
            model,
          });
          toast.success(`Background agent "${config.name}" created!`);
        }
        onCreated();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to create agent';
        toast.error(msg);
      } finally {
        setIsCreatingAgent(false);
      }
    },
    [onCreated, toast, defaults]
  );

  // Stop streaming
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const hasMessages = messages.length > 0;

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleStop();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleStop, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleStop();
          onClose();
        }
      }}
    >
      <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-2xl w-full max-w-2xl mx-4 h-[85vh] flex flex-col">
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
            aria-label="Close creator"
            className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
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
                aria-label="Stop generating"
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
