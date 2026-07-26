import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle, Shield } from '../components/icons';
import { MarkdownContent } from './MarkdownContent';
import { cleanStreamingChatContent } from '../utils/chat-content';

interface ProgressEvent {
  type: string;
  message?: string;
  tool?: { name: string; reason?: string };
  toolCall?: { name?: string };
  result?: { success?: boolean; durationMs?: number; preview?: string; sandboxed?: boolean };
  reason?: string;
}

interface StreamingResponseAreaProps {
  isLoading: boolean;
  streamingContent: string | null;
  thinkingContent: string | null;
  isThinking: boolean;
  progressEvents: ProgressEvent[];
}

export function StreamingResponseArea({
  isLoading,
  streamingContent,
  thinkingContent,
  isThinking,
  progressEvents,
}: StreamingResponseAreaProps) {
  const [thinkingExpanded, setThinkingExpanded] = useState(false);

  if (!isLoading) return null;

  return (
    <div className="mt-4 p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
      {/* Security block banner */}
      {progressEvents.some(
        (e) =>
          e.type === 'tool_blocked' ||
          (e.type === 'tool_end' && e.result?.preview?.includes('blocked in Execution Security'))
      ) && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <Shield className="w-4 h-4 text-red-500 flex-shrink-0" />
          <span className="text-xs text-red-600 dark:text-red-400">
            Tool execution was blocked by Execution Security settings. Adjust permissions in the
            security panel above.
          </span>
        </div>
      )}

      {/* Local execution warning banner */}
      {progressEvents.some((e) => e.type === 'tool_end' && e.result?.sandboxed === false) && (
        <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Code is executing directly on your local machine without Docker sandbox.
          </span>
        </div>
      )}

      {/* Progress events */}
      {progressEvents.length > 0 && (
        <div className="mb-3 space-y-1">
          {progressEvents.slice(-5).map((event, idx) => (
            <div
              key={`progress-${event.type}-${idx}`}
              className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted"
            >
              {event.type === 'status' && (
                <>
                  <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                  <span>{event.message}</span>
                </>
              )}
              {event.type === 'tool_start' && (
                <>
                  <span className="w-2 h-2 bg-warning rounded-full animate-pulse" />
                  <span>
                    🔧 Running <strong>{event.tool?.name}</strong>
                    {event.tool?.reason && (
                      <span className="ml-1.5 text-text-secondary dark:text-dark-text-secondary">
                        — {event.tool.reason}
                      </span>
                    )}
                    ...
                  </span>
                </>
              )}
              {event.type === 'tool_end' && (
                <>
                  <span
                    className={`w-2 h-2 ${event.result?.success ? 'bg-success' : 'bg-error'} rounded-full`}
                  />
                  <span>
                    {event.result?.success ? '✓' : '✗'} {event.tool?.name}
                    <span className="opacity-60 ml-1">({event.result?.durationMs}ms)</span>
                    {event.tool?.reason && (
                      <span className="ml-1.5 text-text-secondary dark:text-dark-text-secondary">
                        — {event.tool.reason}
                      </span>
                    )}
                  </span>
                  {event.result?.preview?.includes('blocked in Execution Security') ? (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-[10px] bg-red-500/15 text-red-600 dark:text-red-400 rounded font-semibold leading-4">
                      <Shield className="w-3 h-3" />
                      BLOCKED
                    </span>
                  ) : (
                    event.result?.sandboxed === false && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded font-semibold leading-4">
                        LOCAL
                      </span>
                    )
                  )}
                </>
              )}
              {event.type === 'tool_blocked' && (
                <>
                  <span className="w-2 h-2 bg-error rounded-full" />
                  <span>
                    Blocked <strong>{event.toolCall?.name ?? 'tool'}</strong>
                    {event.reason && (
                      <span className="ml-1.5 text-text-secondary dark:text-dark-text-secondary">
                        - {event.reason}
                      </span>
                    )}
                  </span>
                  <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-[10px] bg-red-500/15 text-red-600 dark:text-red-400 rounded font-semibold leading-4">
                    <Shield className="w-3 h-3" />
                    BLOCKED
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Thinking section (collapsible, shows streaming thinking content) */}
      {(isThinking || thinkingContent) && (
        <div className="rounded-lg border border-border dark:border-dark-border bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50 overflow-hidden text-sm">
          <button
            onClick={() => setThinkingExpanded(!thinkingExpanded)}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            <div className="text-text-muted dark:text-dark-text-muted">
              {thinkingExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-secondary dark:text-dark-text-secondary font-medium">
                Thinking
              </span>
              {isThinking && (
                <div className="flex gap-1">
                  <span
                    className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <span
                    className="w-1.5 h-1.5 bg-primary rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
              )}
            </div>
          </button>
          {thinkingExpanded && thinkingContent && (
            <div className="border-t border-border dark:border-dark-border px-3 py-2 max-h-64 overflow-y-auto">
              <div className="whitespace-pre-wrap text-text-muted dark:text-dark-text-muted text-xs leading-relaxed">
                {thinkingContent}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Streaming text */}
      {streamingContent && (
        <div>
          <MarkdownContent content={cleanStreamingChatContent(streamingContent)} />
          <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />
        </div>
      )}

      {/* Loading indicator when no content yet */}
      {!streamingContent && !isThinking && progressEvents.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-text-muted dark:text-dark-text-muted">
          <div className="flex gap-1">
            <span
              className="w-2 h-2 bg-primary rounded-full animate-bounce"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-2 h-2 bg-primary rounded-full animate-bounce"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="w-2 h-2 bg-primary rounded-full animate-bounce"
              style={{ animationDelay: '300ms' }}
            />
          </div>
          <span>Thinking...</span>
        </div>
      )}
    </div>
  );
}
