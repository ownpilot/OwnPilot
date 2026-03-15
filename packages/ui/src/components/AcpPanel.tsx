/**
 * AcpPanel — Structured ACP (Agent Client Protocol) view for coding agent sessions
 *
 * Renders real-time tool calls, execution plan, agent messages, thoughts,
 * and permission request dialogs sourced from the useAcpSession hook.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAcpSession } from '../hooks/useAcpSession';
import { codingAgentsApi } from '../api';
import type { CodingAgentSession } from '../api/endpoints/coding-agents';
import type { AcpPermissionRequest } from '../hooks/useAcpSession';
import {
  Zap,
  FileText,
  Edit3,
  Terminal,
  Search,
  Globe,
  Clock,
  Check,
  Copy,
  StopCircle,
  ChevronDown,
  ChevronRight,
  ListChecks,
  MessageSquare,
  Brain,
  Shield,
  Send,
  Folder,
  Sparkles,
  Activity,
  AlertCircle,
  Code,
  Eye,
  Bot,
} from './icons';

// =============================================================================
// Types
// =============================================================================

interface AcpPanelProps {
  sessionId: string;
  session: CodingAgentSession;
  onTerminate?: () => void;
}

type CodingAgentSessionState =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'terminated';

// =============================================================================
// Constants
// =============================================================================

const STATE_DOT: Record<CodingAgentSessionState, string> = {
  starting: 'bg-yellow-500 animate-pulse',
  running: 'bg-emerald-500 animate-pulse',
  waiting: 'bg-yellow-500',
  completed: 'bg-zinc-500',
  failed: 'bg-red-500',
  terminated: 'bg-zinc-600',
};

const STATE_LABEL: Record<CodingAgentSessionState, string> = {
  starting: 'Starting',
  running: 'Running',
  waiting: 'Waiting',
  completed: 'Completed',
  failed: 'Failed',
  terminated: 'Terminated',
};

const PROVIDER_BADGE: Record<string, { icon: string; color: string }> = {
  'claude-code': { icon: 'C', color: 'bg-orange-500/20 text-orange-400' },
  codex: { icon: 'O', color: 'bg-green-500/20 text-green-400' },
  'gemini-cli': { icon: 'G', color: 'bg-blue-500/20 text-blue-400' },
};

const TOOL_KIND_ICONS: Record<string, typeof FileText> = {
  read: FileText,
  edit: Edit3,
  write: Edit3,
  bash: Terminal,
  glob: Search,
  grep: Search,
  web_search: Globe,
  web_fetch: Globe,
  agent: Sparkles,
  notebook: Code,
};

const PLAN_STATUS_STYLE: Record<string, string> = {
  pending: 'text-zinc-500',
  'in-progress': 'text-amber-400',
  in_progress: 'text-amber-400',
  completed: 'text-emerald-400',
  done: 'text-emerald-400',
  failed: 'text-red-400',
  skipped: 'text-zinc-600',
};

// =============================================================================
// Helpers
// =============================================================================

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hrs = Math.floor(min / 60);
  if (hrs > 0) return `${hrs}h ${min % 60}m ${sec % 60}s`;
  if (min > 0) return `${min}m ${sec % 60}s`;
  return `${sec}s`;
}

function truncatePath(p: string, max = 50): string {
  if (p.length <= max) return p;
  const parts = p.replace(/\\/g, '/').split('/');
  if (parts.length <= 2) return '...' + p.slice(-max + 3);
  return parts[0] + '/.../' + parts.slice(-2).join('/');
}

function toolKindIcon(kind: string): typeof FileText {
  const lower = kind.toLowerCase();
  return TOOL_KIND_ICONS[lower] ?? Zap;
}

function formatToolStatus(status: string): { label: string; color: string } {
  switch (status) {
    case 'running':
    case 'in_progress':
      return { label: 'Running', color: 'text-amber-400' };
    case 'completed':
    case 'done':
      return { label: 'Done', color: 'text-emerald-400' };
    case 'failed':
    case 'error':
      return { label: 'Failed', color: 'text-red-400' };
    default:
      return { label: status, color: 'text-zinc-500' };
  }
}

// =============================================================================
// Component
// =============================================================================

export function AcpPanel({ sessionId, session, onTerminate }: AcpPanelProps) {
  const acp = useAcpSession(sessionId);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [copied, setCopied] = useState(false);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'activity' | 'plan' | 'messages' | 'thoughts'>(
    'activity'
  );
  const [promptText, setPromptText] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Elapsed time counter
  useEffect(() => {
    const start = new Date(session.startedAt).getTime();
    const update = () => {
      const end = session.completedAt ? new Date(session.completedAt).getTime() : Date.now();
      setElapsedMs(end - start);
    };
    update();
    if (!session.completedAt) {
      const timer = setInterval(update, 1000);
      return () => clearInterval(timer);
    }
  }, [session.startedAt, session.completedAt]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [acp.toolCalls, acp.messages, acp.thoughts]);

  const toggleToolExpand = useCallback((id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSendPrompt = useCallback(async () => {
    if (!promptText.trim() || sending) return;
    setSending(true);
    try {
      await codingAgentsApi.promptAcpSession(sessionId, promptText.trim());
      setPromptText('');
    } catch {
      // Error will be visible via WS events
    } finally {
      setSending(false);
    }
  }, [sessionId, promptText, sending]);

  const handleCopy = useCallback(() => {
    const text = acp.messages
      .filter((m) => m.role === 'assistant')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      .join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [acp.messages]);

  const badge = PROVIDER_BADGE[session.provider] ?? {
    icon: '?',
    color: 'bg-zinc-500/20 text-zinc-400',
  };
  const isActive =
    session.state === 'running' || session.state === 'starting' || session.state === 'waiting';
  const runningTools = acp.toolCalls.filter(
    (tc) => tc.status === 'running' || tc.status === 'in_progress'
  );

  // Tab counts
  const planCount = acp.plan?.entries.length ?? 0;
  const msgCount = acp.messages.length;
  const thoughtCount = acp.thoughts.length;

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-300">
      {/* ---- Header ---- */}
      <div className="px-4 py-3 border-b border-zinc-700/50 space-y-2 shrink-0">
        <div className="flex items-center gap-3">
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${badge.color}`}
          >
            {badge.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-zinc-100 truncate">
              {session.displayName}
              <span className="ml-2 text-[10px] font-normal px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400">
                ACP
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-zinc-500 font-mono tabular-nums">
              <Clock className="w-3 h-3 inline mr-1 opacity-50" />
              {formatDuration(elapsedMs)}
            </span>
            <button
              onClick={handleCopy}
              className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
              title="Copy output"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Metadata row */}
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="truncate">
            <Folder className="w-3 h-3 inline mr-1 opacity-50" />
            {truncatePath(session.cwd)}
          </span>
          {session.model && <span className="shrink-0">{session.model}</span>}
          {acp.mode && (
            <span className="shrink-0 px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
              {acp.mode}
            </span>
          )}
        </div>
      </div>

      {/* ---- Activity indicator ---- */}
      {isActive && runningTools.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-800/50 border-b border-zinc-700/30 text-xs text-zinc-400 shrink-0">
          <Zap className="w-3 h-3 text-amber-400 shrink-0 animate-pulse" />
          <span className="truncate font-mono">{runningTools[runningTools.length - 1]?.title}</span>
        </div>
      )}

      {/* ---- Permission request banner ---- */}
      {acp.pendingPermission && (
        <PermissionBanner permission={acp.pendingPermission} sessionId={sessionId} />
      )}

      {/* ---- Tabs ---- */}
      <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-zinc-700/30 bg-zinc-800/30 shrink-0">
        <TabButton
          active={activeTab === 'activity'}
          onClick={() => setActiveTab('activity')}
          icon={<Activity className="w-3 h-3" />}
          label="Activity"
          count={acp.toolCalls.length}
        />
        <TabButton
          active={activeTab === 'plan'}
          onClick={() => setActiveTab('plan')}
          icon={<ListChecks className="w-3 h-3" />}
          label="Plan"
          count={planCount}
        />
        <TabButton
          active={activeTab === 'messages'}
          onClick={() => setActiveTab('messages')}
          icon={<MessageSquare className="w-3 h-3" />}
          label="Messages"
          count={msgCount}
        />
        <TabButton
          active={activeTab === 'thoughts'}
          onClick={() => setActiveTab('thoughts')}
          icon={<Brain className="w-3 h-3" />}
          label="Thoughts"
          count={thoughtCount}
        />
      </div>

      {/* ---- Content area ---- */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 min-h-0 scroll-smooth">
        {activeTab === 'activity' && (
          <ToolCallList
            toolCalls={acp.toolCalls}
            expandedTools={expandedTools}
            onToggle={toggleToolExpand}
          />
        )}
        {activeTab === 'plan' && <PlanView plan={acp.plan} />}
        {activeTab === 'messages' && <MessageList messages={acp.messages} />}
        {activeTab === 'thoughts' && <ThoughtList thoughts={acp.thoughts} />}
      </div>

      {/* ---- Prompt input (ACP follow-up) ---- */}
      {isActive && (
        <div className="flex items-center gap-1.5 px-3 py-2 border-t border-zinc-700/50 bg-zinc-800/60 shrink-0">
          <input
            type="text"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSendPrompt();
              }
            }}
            placeholder="Send follow-up prompt..."
            className="flex-1 bg-zinc-900 text-zinc-200 text-xs px-2.5 py-1.5 rounded border border-zinc-700 focus:border-zinc-500 focus:outline-none placeholder-zinc-600 font-mono"
          />
          <button
            onClick={handleSendPrompt}
            disabled={!promptText.trim() || sending}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors disabled:opacity-40"
            title="Send prompt"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => {
              codingAgentsApi.cancelAcpSession(sessionId).catch(() => {});
            }}
            className="px-2 py-1 text-xs font-mono text-red-400 hover:text-red-300 hover:bg-zinc-700 rounded"
            title="Cancel current turn"
          >
            Cancel
          </button>
        </div>
      )}

      {/* ---- Status bar ---- */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-700/50 bg-zinc-800/30 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-2 h-2 rounded-full ${STATE_DOT[session.state as CodingAgentSessionState]}`}
            />
            <span className="text-xs text-zinc-400">
              {STATE_LABEL[session.state as CodingAgentSessionState]}
            </span>
          </div>
          <span className="text-xs text-zinc-500 font-mono tabular-nums">
            {formatDuration(elapsedMs)}
          </span>
          <span className="text-xs text-zinc-600">{acp.toolCalls.length} tool calls</span>
          {acp.stopReason && (
            <span className="text-xs text-zinc-500 font-mono">stop: {acp.stopReason}</span>
          )}
        </div>

        {isActive && onTerminate && (
          <button
            onClick={onTerminate}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium text-red-400 hover:text-red-300 hover:bg-zinc-700 transition-colors"
          >
            <StopCircle className="w-3.5 h-3.5" />
            Stop
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
        active ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
      }`}
    >
      {icon}
      {label}
      {count > 0 && (
        <span
          className={`text-[10px] px-1 rounded-full ${
            active ? 'bg-zinc-600 text-zinc-300' : 'bg-zinc-800 text-zinc-500'
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// -----------------------------------------------------------------------------
// Tool call list
// -----------------------------------------------------------------------------

function ToolCallList({
  toolCalls,
  expandedTools,
  onToggle,
}: {
  toolCalls: import('../api/endpoints/coding-agents').AcpToolCall[];
  expandedTools: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (toolCalls.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
        <Activity className="w-8 h-8 mb-2 opacity-30" />
        <span className="text-sm">No tool calls yet</span>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {toolCalls.map((tc) => {
        const expanded = expandedTools.has(tc.toolCallId);
        const Icon = toolKindIcon(tc.kind);
        const statusInfo = formatToolStatus(tc.status);

        return (
          <div key={tc.toolCallId} className="group">
            <button
              onClick={() => onToggle(tc.toolCallId)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-zinc-800/50 transition-colors text-left"
            >
              {expanded ? (
                <ChevronDown className="w-3 h-3 text-zinc-600 shrink-0" />
              ) : (
                <ChevronRight className="w-3 h-3 text-zinc-600 shrink-0" />
              )}
              <Icon className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
              <span className="text-xs font-medium text-zinc-300 truncate flex-1">{tc.title}</span>
              <span className={`text-[10px] font-medium shrink-0 ${statusInfo.color}`}>
                {tc.status === 'running' || tc.status === 'in_progress' ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    {statusInfo.label}
                  </span>
                ) : (
                  statusInfo.label
                )}
              </span>
            </button>

            {expanded && (
              <div className="ml-8 mr-2 mb-2 p-2 rounded bg-zinc-800/40 border border-zinc-700/30 text-xs space-y-1.5">
                {/* Locations */}
                {tc.locations && tc.locations.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tc.locations.map((loc) => (
                      <span
                        key={`${loc.path}:${loc.startLine ?? 0}`}
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-700/50 text-zinc-400 font-mono text-[10px]"
                      >
                        <FileText className="w-2.5 h-2.5" />
                        {truncatePath(loc.path, 40)}
                        {loc.startLine != null && `:${loc.startLine}`}
                      </span>
                    ))}
                  </div>
                )}

                {/* Content */}
                {tc.content && tc.content.length > 0 && (
                  <div className="space-y-1">
                    {tc.content.map((item, i) => (
                      <ToolContentView key={`${tc.toolCallId}-content-${i}`} item={item} />
                    ))}
                  </div>
                )}

                {/* Raw input (if no content) */}
                {(!tc.content || tc.content.length === 0) && tc.rawInput && (
                  <pre className="text-[10px] text-zinc-500 font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
                    {JSON.stringify(tc.rawInput, null, 2)}
                  </pre>
                )}

                {/* Timing */}
                {tc.startedAt && (
                  <div className="text-[10px] text-zinc-600">
                    Started: {new Date(tc.startedAt).toLocaleTimeString()}
                    {tc.completedAt && (
                      <>
                        {' '}
                        — Completed: {new Date(tc.completedAt).toLocaleTimeString()} (
                        {formatDuration(
                          new Date(tc.completedAt).getTime() - new Date(tc.startedAt).getTime()
                        )}
                        )
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ToolContentView({
  item,
}: {
  item: import('../api/endpoints/coding-agents').AcpToolCallContent;
}) {
  switch (item.type) {
    case 'text':
      return (
        <pre className="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
          {item.text}
        </pre>
      );

    case 'diff':
      return (
        <div className="space-y-0.5">
          {item.path && (
            <div className="text-[10px] text-zinc-500 font-mono">{truncatePath(item.path)}</div>
          )}
          {item.oldText && (
            <pre className="text-[10px] text-red-400/70 font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto bg-red-500/5 rounded px-1.5 py-1">
              {item.oldText}
            </pre>
          )}
          {item.newText && (
            <pre className="text-[10px] text-emerald-400/70 font-mono whitespace-pre-wrap break-words max-h-24 overflow-y-auto bg-emerald-500/5 rounded px-1.5 py-1">
              {item.newText}
            </pre>
          )}
        </div>
      );

    case 'terminal':
      return (
        <pre className="text-[11px] text-zinc-400 font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto bg-black/30 rounded px-2 py-1.5">
          {item.text ?? '(terminal output)'}
        </pre>
      );

    case 'content':
      return (
        <pre className="text-[10px] text-zinc-500 font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto">
          {typeof item.content === 'string' ? item.content : JSON.stringify(item.content, null, 2)}
        </pre>
      );

    default:
      return null;
  }
}

// -----------------------------------------------------------------------------
// Plan view
// -----------------------------------------------------------------------------

function PlanView({ plan }: { plan: import('../api/endpoints/coding-agents').AcpPlan | null }) {
  if (!plan || plan.entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
        <ListChecks className="w-8 h-8 mb-2 opacity-30" />
        <span className="text-sm">No plan yet</span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="text-[10px] text-zinc-600 mb-2">
        Updated: {new Date(plan.updatedAt).toLocaleTimeString()}
      </div>
      {plan.entries.map((entry, i) => {
        const statusStyle = PLAN_STATUS_STYLE[entry.status] ?? 'text-zinc-500';
        return (
          <div key={`plan-${i}-${entry.status}`} className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-zinc-800/30">
            <div className="mt-0.5 shrink-0">
              {entry.status === 'completed' || entry.status === 'done' ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : entry.status === 'in-progress' || entry.status === 'in_progress' ? (
                <span className="w-3.5 h-3.5 flex items-center justify-center">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                </span>
              ) : entry.status === 'failed' ? (
                <AlertCircle className="w-3.5 h-3.5 text-red-400" />
              ) : (
                <span className="w-3.5 h-3.5 flex items-center justify-center">
                  <span className="w-2 h-2 rounded-full border border-zinc-600" />
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <span className={`text-xs ${statusStyle}`}>{entry.content}</span>
            </div>
            <span className="text-[9px] text-zinc-600 shrink-0 uppercase">{entry.priority}</span>
          </div>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Message list
// -----------------------------------------------------------------------------

function MessageList({ messages }: { messages: import('../hooks/useAcpSession').AcpMessage[] }) {
  if (messages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
        <MessageSquare className="w-8 h-8 mb-2 opacity-30" />
        <span className="text-sm">No messages yet</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {messages.map((msg, i) => (
        <div
          key={`msg-${i}-${msg.role}`}
          className={`px-3 py-2 rounded-lg text-xs ${
            msg.role === 'assistant'
              ? 'bg-zinc-800/50 border border-zinc-700/30'
              : 'bg-blue-500/10 border border-blue-500/20'
          }`}
        >
          <div className="flex items-center gap-2 mb-1">
            {msg.role === 'assistant' ? (
              <Bot className="w-3 h-3 text-zinc-500" />
            ) : (
              <Eye className="w-3 h-3 text-blue-400" />
            )}
            <span className="text-[10px] text-zinc-500 font-medium uppercase">{msg.role}</span>
            <span className="text-[10px] text-zinc-600 ml-auto">
              {new Date(msg.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <div className="text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">
            {typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content, null, 2)}
          </div>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Thought list
// -----------------------------------------------------------------------------

function ThoughtList({ thoughts }: { thoughts: import('../hooks/useAcpSession').AcpThought[] }) {
  if (thoughts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-600">
        <Brain className="w-8 h-8 mb-2 opacity-30" />
        <span className="text-sm">No thoughts yet</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {thoughts.map((thought) => (
        <div
          key={thought.timestamp}
          className="px-3 py-2 rounded-lg bg-purple-500/5 border border-purple-500/10 text-xs"
        >
          <div className="flex items-center gap-2 mb-1">
            <Brain className="w-3 h-3 text-purple-400/60" />
            <span className="text-[10px] text-purple-400/60 font-medium">Thinking</span>
            <span className="text-[10px] text-zinc-600 ml-auto">
              {new Date(thought.timestamp).toLocaleTimeString()}
            </span>
          </div>
          <div className="text-zinc-400 whitespace-pre-wrap break-words leading-relaxed italic">
            {typeof thought.content === 'string'
              ? thought.content
              : JSON.stringify(thought.content, null, 2)}
          </div>
        </div>
      ))}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Permission request banner
// -----------------------------------------------------------------------------

function PermissionBanner({
  permission,
  sessionId,
}: {
  permission: AcpPermissionRequest;
  sessionId: string;
}) {
  const [responding, setResponding] = useState(false);

  const handleRespond = async (optionId: string) => {
    setResponding(true);
    try {
      await codingAgentsApi.sendInput(sessionId, optionId);
    } catch {
      // Permission response failed
    } finally {
      setResponding(false);
    }
  };

  return (
    <div className="px-4 py-3 bg-amber-500/10 border-b border-amber-500/20 shrink-0">
      <div className="flex items-start gap-2">
        <Shield className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-amber-300 mb-1.5">Permission Required</div>
          <div className="text-xs text-zinc-300 mb-2">{permission.title}</div>
          <div className="flex flex-wrap gap-1.5">
            {permission.options.map((opt) => {
              const isAllow = opt.kind.startsWith('allow');
              return (
                <button
                  key={opt.optionId}
                  onClick={() => handleRespond(opt.optionId)}
                  disabled={responding}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors disabled:opacity-50 ${
                    isAllow
                      ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                      : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                  }`}
                >
                  {opt.name}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
