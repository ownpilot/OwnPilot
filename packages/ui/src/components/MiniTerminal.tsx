/**
 * MiniTerminal — Floating terminal widget for coding agent sessions
 *
 * Follows the MiniChat pattern: fixed bottom-right, resizable,
 * localStorage persistence. Hidden on /coding-agents route and mobile.
 * Positioned above MiniChat (bottom-24 instead of bottom-6).
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useGateway } from '../hooks/useWebSocket';
import { useIsMobile } from '../hooks/useMediaQuery';
import { Terminal, X, ExternalLink, Maximize2, Minimize2, StopCircle } from './icons';
import { XTerminal } from './XTerminal';
import { AutoModePanel } from './AutoModePanel';
import type { CodingAgentSession, CodingAgentSessionState } from '../api/endpoints/coding-agents';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 400;
const MIN_WIDTH = 400;
const MIN_HEIGHT = 250;
const MAX_WIDTH = 1000;
const BOTTOM_MARGIN = 90; // above MiniChat bubble area
const RIGHT_MARGIN = 24;
const TOP_RESERVED = 60;

const SIZE_KEY = 'ownpilot-mini-terminal-size';
const OPEN_KEY = 'ownpilot-mini-terminal-open';

interface TerminalSize {
  width: number;
  height: number;
}

function loadSize(): TerminalSize {
  try {
    const saved = localStorage.getItem(SIZE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as TerminalSize;
      if (parsed.width >= MIN_WIDTH && parsed.height >= MIN_HEIGHT) return parsed;
    }
  } catch {
    /* ignore */
  }
  return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
}

function saveSize(size: TerminalSize) {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(size));
  } catch {
    /* ignore */
  }
}

function maxHeight(): number {
  return window.innerHeight - BOTTOM_MARGIN - TOP_RESERVED;
}

// ---------------------------------------------------------------------------
// State badge helper
// ---------------------------------------------------------------------------

function stateBadge(state: CodingAgentSessionState) {
  switch (state) {
    case 'running':
      return 'bg-emerald-500';
    case 'starting':
      return 'bg-blue-500 animate-pulse';
    case 'waiting':
      return 'bg-yellow-500';
    case 'completed':
      return 'bg-zinc-500';
    case 'failed':
      return 'bg-red-500';
    case 'terminated':
      return 'bg-zinc-600';
    default:
      return 'bg-zinc-500';
  }
}

// ---------------------------------------------------------------------------
// MiniTerminal
// ---------------------------------------------------------------------------

export function MiniTerminal() {
  const location = useLocation();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { subscribe } = useGateway();

  // Sessions tracked via WS events
  const [sessions, setSessions] = useState<CodingAgentSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Open/closed state — persisted
  const [isOpen, setIsOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Size state — persisted
  const [size, setSize] = useState<TerminalSize>(loadSize);
  const [isMaximized, setIsMaximized] = useState(false);
  const preMaxSizeRef = useRef<TerminalSize>(size);

  // Resize drag refs
  const isResizing = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const dragStartSize = useRef<TerminalSize>({ width: 0, height: 0 });

  // Persist open/closed state
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, String(isOpen));
    } catch {
      /* ignore */
    }
  }, [isOpen]);

  // Subscribe to session lifecycle events
  useEffect(() => {
    const unsubCreated = subscribe<{
      session: CodingAgentSession;
    }>('coding-agent:session:created', (payload) => {
      setSessions((prev) => {
        const exists = prev.some((s) => s.id === payload.session.id);
        if (exists) return prev;
        return [...prev, payload.session];
      });
      setActiveSessionId(payload.session.id);
      setIsOpen(true);
    });

    const unsubState = subscribe<{
      sessionId: string;
      state: CodingAgentSessionState;
    }>('coding-agent:session:state', (payload) => {
      setSessions((prev) =>
        prev.map((s) => (s.id === payload.sessionId ? { ...s, state: payload.state } : s))
      );
    });

    const unsubExit = subscribe<{
      sessionId: string;
      exitCode: number;
    }>('coding-agent:session:exit', (payload) => {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === payload.sessionId
            ? { ...s, state: 'completed' as CodingAgentSessionState, exitCode: payload.exitCode }
            : s
        )
      );
    });

    return () => {
      unsubCreated();
      unsubState();
      unsubExit();
    };
  }, [subscribe]);

  // Auto-select first active session if current selection finishes
  useEffect(() => {
    if (!activeSessionId) {
      const active = sessions.find((s) => s.state === 'running' || s.state === 'starting');
      if (active) setActiveSessionId(active.id);
    }
  }, [sessions, activeSessionId]);

  // Remove completed sessions after 60s
  useEffect(() => {
    const timer = setInterval(() => {
      setSessions((prev) => {
        const kept = prev.filter(
          (s) => s.state === 'running' || s.state === 'starting' || s.state === 'waiting'
        );
        if (kept.length === prev.length) return prev;
        // If active session was removed, reset
        if (activeSessionId && !kept.some((s) => s.id === activeSessionId)) {
          setActiveSessionId(kept[0]?.id ?? null);
        }
        return kept;
      });
    }, 60_000);
    return () => clearInterval(timer);
  }, [activeSessionId]);

  // Navigate to full page
  const handleExpand = useCallback(() => {
    setIsOpen(false);
    navigate('/coding-agents');
  }, [navigate]);

  // Maximize / restore
  const handleMaximizeToggle = useCallback(() => {
    if (isMaximized) {
      setSize(preMaxSizeRef.current);
      saveSize(preMaxSizeRef.current);
      setIsMaximized(false);
    } else {
      preMaxSizeRef.current = size;
      setIsMaximized(true);
    }
  }, [isMaximized, size]);

  // Resize drag
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isMaximized) setIsMaximized(false);

      isResizing.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      dragStartSize.current = { ...size };

      const handleMouseMove = (ev: MouseEvent) => {
        if (!isResizing.current) return;
        const deltaX = dragStart.current.x - ev.clientX;
        const deltaY = dragStart.current.y - ev.clientY;
        setSize({
          width: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, dragStartSize.current.width + deltaX)),
          height: Math.max(MIN_HEIGHT, Math.min(maxHeight(), dragStartSize.current.height + deltaY)),
        });
      };

      const handleMouseUp = () => {
        isResizing.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setSize((current) => {
          saveSize(current);
          return current;
        });
      };

      document.body.style.cursor = 'nwse-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [size, isMaximized]
  );

  // Effective size
  const effectiveSize = isMaximized
    ? {
        width: Math.min(MAX_WIDTH, window.innerWidth - RIGHT_MARGIN * 2),
        height: maxHeight(),
      }
    : size;

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeSessions = sessions.filter(
    (s) => s.state === 'running' || s.state === 'starting' || s.state === 'waiting'
  );

  // Hidden on /coding-agents and mobile
  if (location.pathname === '/coding-agents' || location.pathname.startsWith('/settings/coding-agents') || isMobile) return null;

  // Nothing to show if no sessions
  if (sessions.length === 0 && !isOpen) return null;

  // ---- Collapsed: Terminal bubble ----
  if (!isOpen) {
    if (activeSessions.length === 0) return null;
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-24 right-6 z-40 w-14 h-14 rounded-full bg-zinc-800 hover:bg-zinc-700 text-emerald-400 shadow-lg hover:shadow-xl transition-all flex items-center justify-center"
        aria-label="Open terminal"
      >
        <Terminal className="w-6 h-6" />
        {activeSessions.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full bg-emerald-500 text-white text-[10px] font-bold leading-none">
            {activeSessions.length}
          </span>
        )}
      </button>
    );
  }

  // ---- Expanded: Terminal window ----
  return (
    <div
      className="fixed bottom-24 right-6 z-40 flex flex-col bg-[#0f1117] border border-zinc-700 rounded-xl shadow-2xl animate-fade-in-up overflow-hidden"
      style={{
        width: effectiveSize.width,
        height: Math.min(effectiveSize.height, maxHeight()),
        maxWidth: `calc(100vw - ${RIGHT_MARGIN * 2}px)`,
      }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className="absolute -top-1 -left-1 w-4 h-4 cursor-nwse-resize z-10 group"
        title="Drag to resize"
      >
        <svg
          viewBox="0 0 16 16"
          className="w-full h-full text-zinc-600 group-hover:text-zinc-400 transition-colors"
        >
          <line x1="14" y1="2" x2="2" y2="14" stroke="currentColor" strokeWidth="1.5" />
          <line x1="14" y1="7" x2="7" y2="14" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 h-9 bg-zinc-900 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Terminal className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-xs font-medium text-zinc-300 truncate">
            {activeSession
              ? `${activeSession.displayName} — ${activeSession.prompt.slice(0, 40)}${activeSession.prompt.length > 40 ? '...' : ''}`
              : 'Terminal'}
          </span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {/* Maximize */}
          <button
            onClick={handleMaximizeToggle}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            aria-label={isMaximized ? 'Restore size' : 'Maximize'}
            title={isMaximized ? 'Restore size' : 'Maximize'}
          >
            {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          {/* Expand to full page */}
          <button
            onClick={handleExpand}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            aria-label="Open full page"
            title="Open full page"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          {/* Close */}
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
            aria-label="Close terminal"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Session tabs (when multiple sessions exist) */}
      {sessions.length > 1 && (
        <div className="flex items-center gap-0.5 px-2 py-1 bg-zinc-900/80 border-b border-zinc-700/50 shrink-0 overflow-x-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveSessionId(s.id)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] transition-colors whitespace-nowrap ${
                s.id === activeSessionId
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stateBadge(s.state)}`} />
              <span className="truncate max-w-[100px]">{s.displayName}</span>
              {(s.state === 'completed' || s.state === 'failed' || s.state === 'terminated') && (
                <StopCircle className="w-2.5 h-2.5 text-zinc-600" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Terminal / Auto mode content */}
      <div className="flex-1 min-h-0 relative">
        {activeSession ? (
          activeSession.mode === 'auto' ? (
            <AutoModePanel
              key={activeSession.id}
              sessionId={activeSession.id}
              session={activeSession}
            />
          ) : (
            <div className="absolute inset-0">
              <XTerminal
                key={activeSession.id}
                sessionId={activeSession.id}
                interactive={true}
              />
            </div>
          )
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
            No active session
          </div>
        )}
      </div>
    </div>
  );
}
