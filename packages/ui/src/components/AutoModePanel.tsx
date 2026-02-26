/**
 * AutoModePanel — Structured output view for auto mode coding agent sessions
 *
 * Replaces xterm.js for auto mode. Parses Claude Code stream-json events
 * into a structured display: tool calls, assistant text, costs, elapsed time.
 * Falls back to raw text display for Codex/Gemini.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useGateway } from '../hooks/useWebSocket';
import { codingAgentsApi } from '../api';
import {
  Folder,
  Copy,
  Check,
  StopCircle,
  Clock,
  DollarSign,
  ChevronDown,
  ChevronUp,
  Zap,
  FileText,
  Edit3,
  Terminal as TerminalIcon,
  Search,
  Globe,
} from './icons';
import type { CodingAgentSession, CodingAgentSessionState } from '../api/endpoints/coding-agents';

// =============================================================================
// Types
// =============================================================================

interface AutoModePanelProps {
  sessionId: string;
  session: CodingAgentSession;
  onTerminate?: () => void;
}

/** Parsed output entry */
type OutputEntry =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string; status: 'running' | 'done'; summary: string }
  | { kind: 'error'; text: string }
  | { kind: 'status'; text: string };

// =============================================================================
// Constants
// =============================================================================

const PROVIDER_BADGE: Record<string, { icon: string; color: string }> = {
  'claude-code': { icon: 'C', color: 'bg-orange-500/20 text-orange-400' },
  codex: { icon: 'O', color: 'bg-green-500/20 text-green-400' },
  'gemini-cli': { icon: 'G', color: 'bg-blue-500/20 text-blue-400' },
};

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

const TOOL_ICONS: Record<string, typeof FileText> = {
  Read: FileText,
  Edit: Edit3,
  Write: Edit3,
  Bash: TerminalIcon,
  Glob: Search,
  Grep: Search,
  WebSearch: Globe,
  WebFetch: Globe,
};

const REST_FALLBACK_DELAY_MS = 3000;
const REST_POLL_INTERVAL_MS = 2000;

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

/** Extract tool display name from a tool call name */
function toolDisplayName(name: string): string {
  // Strip namespace prefixes like "mcp__plugin_..." or "core."
  const base = name.includes('__') ? name.split('__').pop()! : name.replace(/^[a-z]+\./, '');
  return base;
}

// =============================================================================
// Stream JSON parser
// =============================================================================

/** Parse Claude Code stream-json event into output entries */
function parseStreamJsonEvent(json: Record<string, unknown>): OutputEntry[] {
  const type = json.type as string;

  switch (type) {
    case 'assistant': {
      // Extract text from message content
      const msg = json.message as Record<string, unknown> | undefined;
      const content = (msg?.content ?? json.content) as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(content)) {
        const texts: string[] = [];
        for (const item of content) {
          if (item.type === 'text' && typeof item.text === 'string') {
            texts.push(item.text);
          } else if (item.type === 'tool_use') {
            const name = toolDisplayName(String(item.name ?? 'tool'));
            const input = item.input as Record<string, unknown> | undefined;
            const summary = input?.file_path
              ? String(input.file_path)
              : input?.command
                ? String(input.command).slice(0, 60)
                : input?.pattern
                  ? String(input.pattern)
                  : '';
            return [{ kind: 'tool', name, status: 'running', summary }];
          }
        }
        if (texts.length > 0) {
          return [{ kind: 'text', text: texts.join('') }];
        }
      }
      return [];
    }

    case 'tool_use': {
      const data = (json.data ?? json) as Record<string, unknown>;
      const name = toolDisplayName(String(data.name ?? 'tool'));
      const input = data.input as Record<string, unknown> | undefined;
      const summary = input?.file_path
        ? String(input.file_path)
        : input?.command
          ? String(input.command).slice(0, 60)
          : '';
      return [{ kind: 'tool', name, status: 'running', summary }];
    }

    case 'tool_result': {
      return []; // Tool results are usually verbose — skip display
    }

    case 'result': {
      // Cost is extracted in processChunk; text was already streamed via assistant events
      return [];
    }

    case 'system': {
      // Skip init events (very verbose)
      return [];
    }

    default:
      return [];
  }
}

// =============================================================================
// Component
// =============================================================================

export function AutoModePanel({ sessionId, session, onTerminate }: AutoModePanelProps) {
  const { send, subscribe, status } = useGateway();
  const [entries, setEntries] = useState<OutputEntry[]>([]);
  const [rawBuffer, setRawBuffer] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [currentActivity, setCurrentActivity] = useState<string | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const hasReceivedOutput = useRef(false);
  const lineBuffer = useRef(''); // Accumulates partial lines for JSON parsing
  const isClaudeCode = session.provider === 'claude-code';

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
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [entries, rawBuffer]);

  // Process incoming data chunk
  const processChunk = useCallback(
    (data: string) => {
      hasReceivedOutput.current = true;

      if (!isClaudeCode) {
        // Non-Claude providers: raw text display
        setRawBuffer((prev) => prev + data);
        return;
      }

      // Claude Code stream-json: accumulate and parse complete JSON lines
      lineBuffer.current += data;
      const lines = lineBuffer.current.split('\n');
      lineBuffer.current = lines.pop() ?? ''; // Keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const json = JSON.parse(trimmed) as Record<string, unknown>;

          // Extract cost from result event
          if (json.type === 'result' && typeof json.total_cost_usd === 'number') {
            setCostUsd(json.total_cost_usd);
          }

          const newEntries = parseStreamJsonEvent(json);
          if (newEntries.length > 0) {
            setEntries((prev) => [...prev, ...newEntries]);

            // Update current activity for the activity line
            const lastTool = newEntries.find((e) => e.kind === 'tool');
            if (lastTool && lastTool.kind === 'tool') {
              setCurrentActivity(`${lastTool.name} ${lastTool.summary}`);
            }
            const lastText = newEntries.find((e) => e.kind === 'text');
            if (lastText) {
              setCurrentActivity(null);
            }
          }
        } catch {
          // Not valid JSON — display as raw text (fallback)
          if (trimmed) {
            setEntries((prev) => [...prev, { kind: 'text', text: trimmed }]);
          }
        }
      }
    },
    [isClaudeCode]
  );

  // WS subscription
  useEffect(() => {
    let cancelled = false;
    let restPollTimer: ReturnType<typeof setTimeout> | null = null;
    let restFallbackActive = false;
    let restOutputOffset = 0;

    const trySendSubscribe = () => {
      if (cancelled) return;
      send('coding-agent:subscribe', { sessionId });
    };

    trySendSubscribe();
    const resubTimer = setTimeout(trySendSubscribe, 500);

    const unsubOutput = subscribe<{ sessionId: string; data: string }>(
      'coding-agent:session:output',
      (payload) => {
        if (payload.sessionId === sessionId) {
          processChunk(payload.data);
          restFallbackActive = false;
          if (restPollTimer) {
            clearTimeout(restPollTimer);
            restPollTimer = null;
          }
        }
      }
    );

    const unsubState = subscribe<{ sessionId: string; state: string }>(
      'coding-agent:session:state',
      (payload) => {
        if (payload.sessionId !== sessionId || cancelled) return;
        const labels: Record<string, string> = {
          completed: 'Session completed',
          failed: 'Session failed',
          terminated: 'Session terminated',
        };
        const label = labels[payload.state];
        if (label) {
          setEntries((prev) => [...prev, { kind: 'status', text: label }]);
          setCurrentActivity(null);
        }
      }
    );

    const unsubError = subscribe<{ sessionId: string; error: string }>(
      'coding-agent:session:error',
      (payload) => {
        if (payload.sessionId === sessionId && !cancelled) {
          setEntries((prev) => [...prev, { kind: 'error', text: payload.error }]);
          setCurrentActivity(null);
        }
      }
    );

    // REST fallback
    const fallbackTimer = setTimeout(() => {
      if (cancelled || hasReceivedOutput.current) return;
      restFallbackActive = true;

      const pollRest = async () => {
        if (cancelled || !restFallbackActive) return;
        try {
          const result = await codingAgentsApi.getOutput(sessionId);
          if (cancelled || !restFallbackActive) return;

          if (result.hasOutput && result.output.length > restOutputOffset) {
            processChunk(result.output.slice(restOutputOffset));
            restOutputOffset = result.output.length;
          }

          if (['completed', 'failed', 'terminated'].includes(result.state)) {
            restFallbackActive = false;
            return;
          }
        } catch {
          restFallbackActive = false;
          return;
        }
        if (restFallbackActive && !cancelled) {
          restPollTimer = setTimeout(pollRest, REST_POLL_INTERVAL_MS);
        }
      };

      pollRest();
    }, REST_FALLBACK_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(resubTimer);
      clearTimeout(fallbackTimer);
      if (restPollTimer) clearTimeout(restPollTimer);
      unsubOutput();
      unsubState();
      unsubError();
    };
  }, [sessionId, send, subscribe, status, processChunk]);

  // Copy output text
  const handleCopy = useCallback(() => {
    const text = isClaudeCode
      ? entries
          .filter((e) => e.kind === 'text')
          .map((e) => (e as { text: string }).text)
          .join('\n')
      : rawBuffer;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [entries, rawBuffer, isClaudeCode]);

  // Derived state
  const badge = PROVIDER_BADGE[session.provider] ?? { icon: '?', color: 'bg-zinc-500/20 text-zinc-400' };
  const isActive = session.state === 'running' || session.state === 'starting' || session.state === 'waiting';
  const promptLong = session.prompt.length > 100;

  return (
    <div className="flex flex-col h-full bg-zinc-900 text-zinc-300">
      {/* ---- Header ---- */}
      <div className="px-4 py-3 border-b border-zinc-700/50 space-y-2 shrink-0">
        {/* Row 1: provider + name + elapsed + copy */}
        <div className="flex items-center gap-3">
          <div className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 ${badge.color}`}>
            {badge.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-zinc-100 truncate">
              {session.displayName}
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
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Prompt (collapsible) */}
        {promptLong ? (
          <button
            onClick={() => setPromptExpanded(!promptExpanded)}
            className="w-full text-left text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
          >
            <span className="line-clamp-2">
              {promptExpanded ? session.prompt : session.prompt.slice(0, 100) + '...'}
            </span>
            {promptExpanded ? (
              <ChevronUp className="w-3 h-3 inline ml-1 opacity-50" />
            ) : (
              <ChevronDown className="w-3 h-3 inline ml-1 opacity-50" />
            )}
          </button>
        ) : (
          <div className="text-xs text-zinc-400">{session.prompt}</div>
        )}

        {/* Metadata row */}
        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <span className="truncate">
            <Folder className="w-3 h-3 inline mr-1 opacity-50" />
            {truncatePath(session.cwd)}
          </span>
          {session.model && (
            <span className="shrink-0">
              {session.model}
            </span>
          )}
        </div>
      </div>

      {/* ---- Activity line ---- */}
      {isActive && currentActivity && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-zinc-800/50 border-b border-zinc-700/30 text-xs text-zinc-400 shrink-0">
          <Zap className="w-3 h-3 text-amber-400 shrink-0 animate-pulse" />
          <span className="truncate font-mono">{currentActivity}</span>
        </div>
      )}

      {/* ---- Output area ---- */}
      <div
        ref={outputRef}
        className="flex-1 overflow-y-auto px-4 py-3 min-h-0 scroll-smooth"
      >
        {!hasReceivedOutput.current && isActive && (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-4">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Waiting for output...
          </div>
        )}

        {isClaudeCode ? (
          // Structured view for Claude Code
          <div className="space-y-1">
            {entries.map((entry, i) => (
              <OutputEntryView key={i} entry={entry} />
            ))}
          </div>
        ) : (
          // Raw text for other providers
          <pre className="font-mono text-xs text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">
            {rawBuffer || (hasReceivedOutput.current ? '' : null)}
          </pre>
        )}
      </div>

      {/* ---- Status bar ---- */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-zinc-700/50 bg-zinc-800/30 shrink-0">
        <div className="flex items-center gap-3">
          {/* State dot + label */}
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${STATE_DOT[session.state]}`} />
            <span className="text-xs text-zinc-400">
              {STATE_LABEL[session.state]}
            </span>
          </div>

          {/* Duration */}
          <span className="text-xs text-zinc-500 font-mono tabular-nums">
            {formatDuration(elapsedMs)}
          </span>

          {/* Cost */}
          {costUsd !== null && (
            <span className="text-xs text-zinc-500">
              <DollarSign className="w-3 h-3 inline opacity-50" />
              {costUsd < 0.01 ? '<$0.01' : `$${costUsd.toFixed(2)}`}
            </span>
          )}

          {/* Exit code */}
          {session.exitCode !== undefined && !isActive && (
            <span className={`text-xs font-mono ${session.exitCode === 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              exit {session.exitCode}
            </span>
          )}
        </div>

        {/* Stop button */}
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
// Output entry renderer
// =============================================================================

function OutputEntryView({ entry }: { entry: OutputEntry }) {
  switch (entry.kind) {
    case 'text':
      return (
        <div className="font-mono text-xs text-zinc-200 whitespace-pre-wrap break-words leading-relaxed py-0.5">
          {entry.text}
        </div>
      );

    case 'tool': {
      const Icon = TOOL_ICONS[entry.name] ?? Zap;
      return (
        <div className="flex items-center gap-2 py-1 text-xs text-zinc-500">
          <Icon className="w-3 h-3 shrink-0 text-zinc-500" />
          <span className="font-medium text-zinc-400">{entry.name}</span>
          {entry.summary && (
            <span className="font-mono text-zinc-600 truncate">{entry.summary}</span>
          )}
        </div>
      );
    }

    case 'error':
      return (
        <div className="font-mono text-xs text-red-400 whitespace-pre-wrap py-1">
          {entry.text}
        </div>
      );

    case 'status':
      return (
        <div className="flex items-center gap-2 py-2 text-xs text-zinc-500 border-t border-zinc-700/30 mt-2">
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
          {entry.text}
        </div>
      );
  }
}
