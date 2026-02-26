/**
 * XTerminal — xterm.js terminal with direct keyboard capture
 *
 * Renders PTY output via xterm.js. Keyboard input is captured DIRECTLY
 * on the container div (onKeyDown) and sent to the PTY via REST + WS.
 * This bypasses xterm.js's broken hidden-textarea focus mechanism.
 *
 * REST fallback: if no WS output arrives within 3s, polls
 * GET /sessions/:id/output for the ring buffer.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useGateway } from '../hooks/useWebSocket';
import { codingAgentsApi } from '../api';

// =============================================================================
// Props
// =============================================================================

interface XTerminalProps {
  sessionId: string;
  interactive?: boolean;
  onReady?: () => void;
  className?: string;
}

// =============================================================================
// Theme
// =============================================================================

const TERMINAL_THEME = {
  background: '#0f1117',
  foreground: '#e4e4e7',
  cursor: '#a1a1aa',
  cursorAccent: '#0f1117',
  selectionBackground: '#3f3f46',
  selectionForeground: '#fafafa',
  black: '#09090b',
  red: '#ef4444',
  green: '#22c55e',
  yellow: '#eab308',
  blue: '#3b82f6',
  magenta: '#a855f7',
  cyan: '#06b6d4',
  white: '#e4e4e7',
  brightBlack: '#52525b',
  brightRed: '#f87171',
  brightGreen: '#4ade80',
  brightYellow: '#facc15',
  brightBlue: '#60a5fa',
  brightMagenta: '#c084fc',
  brightCyan: '#22d3ee',
  brightWhite: '#fafafa',
};

const REST_FALLBACK_DELAY_MS = 3000;
const REST_POLL_INTERVAL_MS = 2000;

// =============================================================================
// Key → ANSI escape sequence mapping
// =============================================================================

function keyToAnsi(e: React.KeyboardEvent): string | null {
  // Ctrl combos
  if (e.ctrlKey) {
    if (e.key === 'c') return '\x03';
    if (e.key === 'd') return '\x04';
    if (e.key === 'z') return '\x1a';
    if (e.key === 'l') return '\x0c';
    if (e.key === 'a') return '\x01';
    if (e.key === 'e') return '\x05';
    if (e.key === 'u') return '\x15';
    if (e.key === 'k') return '\x0b';
    if (e.key === 'w') return '\x17';
    return null; // Don't capture other Ctrl combos (browser shortcuts)
  }

  // Special keys
  switch (e.key) {
    case 'Enter':
      return '\r';
    case 'Backspace':
      return '\x7f';
    case 'Tab':
      return '\t';
    case 'Escape':
      return '\x1b';
    case 'ArrowUp':
      return '\x1b[A';
    case 'ArrowDown':
      return '\x1b[B';
    case 'ArrowRight':
      return '\x1b[C';
    case 'ArrowLeft':
      return '\x1b[D';
    case 'Home':
      return '\x1b[H';
    case 'End':
      return '\x1b[F';
    case 'Delete':
      return '\x1b[3~';
    case 'PageUp':
      return '\x1b[5~';
    case 'PageDown':
      return '\x1b[6~';
    case 'Insert':
      return '\x1b[2~';
    case 'F1':
      return '\x1bOP';
    case 'F2':
      return '\x1bOQ';
    case 'F3':
      return '\x1bOR';
    case 'F4':
      return '\x1bOS';
    default:
      break;
  }

  // Printable characters (single char)
  if (e.key.length === 1) {
    return e.key;
  }

  return null; // Ignore Shift, Alt, Meta, CapsLock etc.
}

// =============================================================================
// Component
// =============================================================================

export function XTerminal({ sessionId, interactive = false, onReady, className }: XTerminalProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const { send, subscribe, status } = useGateway();
  const hasReceivedOutput = useRef(false);
  const [inputText, setInputText] = useState('');
  const [inputError, setInputError] = useState('');
  const [sendFlash, setSendFlash] = useState(false);

  // Send raw data to PTY via REST (reliable, has error responses).
  // WS is only used for output streaming — input goes through REST to avoid
  // silent message drops and double-input issues.
  const sendToPty = useCallback(
    (data: string) => {
      // Visual feedback: brief flash
      setSendFlash(true);
      setTimeout(() => setSendFlash(false), 150);

      codingAgentsApi.sendInput(sessionId, data).catch((err) => {
        const msg = err instanceof Error ? err.message : 'Send failed';
        console.error('[XTerminal] sendInput failed:', msg);
        setInputError(msg);
        setTimeout(() => setInputError(''), 4000);
      });
    },
    [sessionId]
  );

  // Fit terminal to container
  const fitTerminal = useCallback(() => {
    if (fitAddonRef.current) {
      try {
        fitAddonRef.current.fit();
      } catch {
        /* not visible */
      }
    }
  }, []);

  // ---- Direct keyboard capture on the wrapper div ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const ansi = keyToAnsi(e);
      if (ansi !== null) {
        e.preventDefault();
        e.stopPropagation();
        sendToPty(ansi);
      }
    },
    [sendToPty]
  );

  // Initialize terminal (display only — input handled via onKeyDown above)
  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      theme: TERMINAL_THEME,
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: interactive ? 'block' : 'underline',
      scrollback: 10000,
      convertEol: true,
      disableStdin: true, // We handle input ourselves via onKeyDown
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(containerRef.current);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    hasReceivedOutput.current = false;

    requestAnimationFrame(() => {
      fitAddon.fit();
      terminal.write('\x1b[90mConnecting to session...\x1b[0m\r\n');
      onReady?.();
    });

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => fitAddon.fit());
    });
    observer.observe(containerRef.current);

    // Send resize events
    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      send('coding-agent:resize', { sessionId, cols, rows });
    });

    return () => {
      resizeDisposable.dispose();
      observer.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, interactive, onReady, send]);

  // Subscribe to WS output + REST fallback
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

    const writeOutput = (data: string) => {
      if (!terminalRef.current || cancelled) return;
      if (!hasReceivedOutput.current) {
        hasReceivedOutput.current = true;
        terminalRef.current.clear();
      }
      terminalRef.current.write(data);
    };

    const unsubOutput = subscribe<{ sessionId: string; data: string }>(
      'coding-agent:session:output',
      (payload) => {
        if (payload.sessionId === sessionId) {
          writeOutput(payload.data);
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
        if (payload.sessionId !== sessionId || !terminalRef.current || cancelled) return;
        const labels: Record<string, [string, string]> = {
          completed: ['32', 'completed'],
          failed: ['31', 'failed'],
          terminated: ['33', 'terminated'],
        };
        const entry = labels[payload.state];
        if (entry) {
          terminalRef.current.write(`\r\n\x1b[${entry[0]}m--- Session ${entry[1]} ---\x1b[0m\r\n`);
        }
      }
    );

    const unsubError = subscribe<{ sessionId: string; error: string }>(
      'coding-agent:session:error',
      (payload) => {
        if (payload.sessionId === sessionId && terminalRef.current && !cancelled) {
          terminalRef.current.write(`\r\n\x1b[31mError: ${payload.error}\x1b[0m\r\n`);
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
            writeOutput(result.output.slice(restOutputOffset));
            restOutputOffset = result.output.length;
          }

          if (['completed', 'failed', 'terminated'].includes(result.state)) {
            const color =
              result.state === 'completed' ? '32' : result.state === 'failed' ? '31' : '33';
            terminalRef.current?.write(
              `\r\n\x1b[${color}m--- Session ${result.state} ---\x1b[0m\r\n`
            );
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
  }, [sessionId, send, subscribe, status]);

  useEffect(() => {
    fitTerminal();
  }, [className, fitTerminal]);

  // Auto-focus the wrapper on mount so keyboard capture works immediately
  useEffect(() => {
    wrapperRef.current?.focus();
  }, [sessionId]);

  // ---- Input bar handlers ----
  const handleInputSubmit = () => {
    if (inputText) {
      sendToPty(inputText + '\r');
    } else {
      sendToPty('\r');
    }
    setInputText('');
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleInputSubmit();
    } else if (e.key === 'ArrowUp' && !inputText) {
      e.preventDefault();
      sendToPty('\x1b[A');
    } else if (e.key === 'ArrowDown' && !inputText) {
      e.preventDefault();
      sendToPty('\x1b[B');
    }
  };

  return (
    <div
      ref={wrapperRef}
      className={`flex flex-col w-full h-full min-h-0 outline-none ${className ?? ''}`}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
      style={{ backgroundColor: TERMINAL_THEME.background }}
    >
      {/* Terminal display */}
      <div ref={containerRef} className="flex-1 min-h-0" />

      {/* Input bar — only shown in interactive mode */}
      {interactive ? (
        <div
          className="flex items-center gap-1 px-2 py-1.5 shrink-0"
          style={{ backgroundColor: '#1a1b26', borderTop: '1px solid #2a2b3a' }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Type here + Enter (↑↓ arrows work)"
            className="flex-1 bg-transparent text-zinc-200 text-sm px-2 py-1 rounded border border-zinc-700 focus:border-zinc-500 focus:outline-none placeholder-zinc-600 font-mono"
          />
          <button
            onClick={() => sendToPty('\x1b[A')}
            className="px-1.5 py-1 text-xs font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
            title="Arrow Up"
          >
            ↑
          </button>
          <button
            onClick={() => sendToPty('\x1b[B')}
            className="px-1.5 py-1 text-xs font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
            title="Arrow Down"
          >
            ↓
          </button>
          <button
            onClick={() => sendToPty('\r')}
            className="px-2 py-1 text-xs font-mono text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
            title="Enter"
          >
            ↵
          </button>
          <button
            onClick={() => sendToPty('\x03')}
            className="px-2 py-1 text-xs font-mono text-red-400 hover:text-red-300 hover:bg-zinc-700 rounded"
            title="Ctrl+C"
          >
            ^C
          </button>
          <button
            onClick={() => {
              sendToPty('y\r');
            }}
            className="px-2 py-1 text-xs font-mono text-green-400 hover:text-green-300 hover:bg-zinc-700 rounded"
            title="Yes + Enter"
          >
            y↵
          </button>
          {sendFlash && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />}
          {inputError && (
            <span className="text-xs text-red-400 ml-1 truncate max-w-[160px]">{inputError}</span>
          )}
        </div>
      ) : (
        /* Auto mode: minimal status bar — output only */
        <div
          className="flex items-center gap-2 px-3 py-1.5 shrink-0 text-xs text-zinc-500"
          style={{ backgroundColor: '#1a1b26', borderTop: '1px solid #2a2b3a' }}
        >
          <span className="flex-1">Auto mode — output only</span>
          <button
            onClick={() => sendToPty('\x03')}
            className="px-2 py-0.5 text-xs font-mono text-red-400 hover:text-red-300 hover:bg-zinc-700 rounded"
            title="Send Ctrl+C to interrupt"
          >
            ^C Stop
          </button>
        </div>
      )}
    </div>
  );
}
