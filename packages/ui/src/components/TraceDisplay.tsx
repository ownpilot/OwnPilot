import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Check,
  XCircle,
  Clock,
  Wrench,
  Database,
  Brain,
  Zap,
  AlertTriangle,
  RefreshCw,
  Send,
  Code,
  ExternalLink,
} from './icons';
import { DebugInfoModal } from './DebugInfoModal';
import type { TraceInfo } from '../types';

interface TraceDisplayProps {
  trace: TraceInfo;
}

export function TraceDisplay({ trace }: TraceDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showModal, setShowModal] = useState(false);

  // Calculate summary stats
  const toolCallCount = trace.toolCalls.length;
  const successfulTools = trace.toolCalls.filter((t) => t.success).length;
  const totalInputTokens = trace.modelCalls.reduce((sum, m) => sum + (m.inputTokens ?? 0), 0);
  const totalOutputTokens = trace.modelCalls.reduce((sum, m) => sum + (m.outputTokens ?? 0), 0);
  const totalTokens = trace.modelCalls.reduce((sum, m) => sum + (m.tokens ?? (m.inputTokens ?? 0) + (m.outputTokens ?? 0)), 0);
  const hasErrors = trace.errors.length > 0;
  const autonomyBlocked = trace.autonomyChecks.filter((a) => !a.approved).length;
  const hasRetries = (trace.retries?.length ?? 0) > 0;

  return (
    <>
      <div className="mt-3 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50 overflow-hidden text-sm">
        {/* Header - always visible */}
        <div className="flex items-center">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex-1 flex items-center gap-3 px-3 py-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            <div className="text-text-muted dark:text-dark-text-muted">
              {isExpanded ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
            </div>

            <span className="font-medium text-text-secondary dark:text-dark-text-secondary">
              Debug Info
            </span>

            {/* Quick Stats */}
            <div className="flex items-center gap-3 ml-auto text-xs">
              <span className="flex items-center gap-1 text-text-muted dark:text-dark-text-muted">
                <Clock className="w-3 h-3" />
                {trace.duration}ms
              </span>

              {toolCallCount > 0 && (
                <span
                  className={`flex items-center gap-1 ${
                    successfulTools === toolCallCount
                      ? 'text-green-500'
                      : 'text-yellow-500'
                  }`}
                >
                  <Wrench className="w-3 h-3" />
                  {successfulTools}/{toolCallCount}
                </span>
              )}

              {totalTokens > 0 && (
                <span className="flex items-center gap-1 text-blue-500" title={`${totalInputTokens} in / ${totalOutputTokens} out`}>
                  <Brain className="w-3 h-3" />
                  {totalInputTokens} in / {totalOutputTokens} out
                </span>
              )}

              {autonomyBlocked > 0 && (
                <span className="flex items-center gap-1 text-orange-500">
                  <AlertTriangle className="w-3 h-3" />
                  {autonomyBlocked} blocked
                </span>
              )}

              {hasRetries && (
                <span className="flex items-center gap-1 text-amber-500">
                  <RefreshCw className="w-3 h-3" />
                  {trace.retries?.length} retries
                </span>
              )}

              {hasErrors && (
                <span className="flex items-center gap-1 text-red-500">
                  <XCircle className="w-3 h-3" />
                  {trace.errors.length}
                </span>
              )}
            </div>
          </button>

          {/* Open Logs Button */}
          <button
            onClick={() => setShowModal(true)}
            className="px-3 py-2 text-xs text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors flex items-center gap-1.5 border-l border-border dark:border-dark-border"
            title="Open full debug logs"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Logs</span>
          </button>
        </div>

        {/* Expanded content */}
        {isExpanded && (
          <div className="border-t border-border dark:border-dark-border divide-y divide-border dark:divide-dark-border">
            {/* Tool Calls */}
            {trace.toolCalls.length > 0 && (
              <TraceSection title="Tool Calls" icon={<Wrench className="w-4 h-4" />}>
                <div className="space-y-2">
                  {trace.toolCalls.map((tool, i) => (
                    <ToolCallItem key={i} tool={tool} />
                  ))}
                </div>
              </TraceSection>
            )}

            {/* Model Calls */}
            {trace.modelCalls.length > 0 && (
              <TraceSection title="Model Calls" icon={<Brain className="w-4 h-4" />}>
                <div className="space-y-1">
                  {trace.modelCalls.map((model, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2 py-1 rounded bg-bg-secondary dark:bg-dark-bg-secondary flex-wrap"
                    >
                      <span className="text-xs text-text-primary dark:text-dark-text-primary">
                        {model.provider}/{model.model}
                      </span>
                      {(model.inputTokens !== undefined || model.outputTokens !== undefined) ? (
                        <span className="text-xs text-blue-500">
                          {model.inputTokens ?? 0} in / {model.outputTokens ?? 0} out
                        </span>
                      ) : model.tokens !== undefined && (
                        <span className="text-xs text-blue-500">
                          {model.tokens} tokens
                        </span>
                      )}
                      {model.duration !== undefined && (
                        <span className="text-xs text-text-muted dark:text-dark-text-muted ml-auto">
                          {model.duration}ms
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </TraceSection>
            )}

            {/* Autonomy Checks */}
            {trace.autonomyChecks.length > 0 && (
              <TraceSection title="Autonomy Checks" icon={<AlertTriangle className="w-4 h-4" />}>
                <div className="space-y-1">
                  {trace.autonomyChecks.map((check, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 px-2 py-1 rounded ${
                        check.approved
                          ? 'bg-green-500/10'
                          : 'bg-red-500/10'
                      }`}
                    >
                      {check.approved ? (
                        <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
                      )}
                      <span className="font-mono text-xs text-text-primary dark:text-dark-text-primary">
                        {check.tool}
                      </span>
                      {check.reason && (
                        <span className="text-xs text-text-muted dark:text-dark-text-muted whitespace-pre-wrap break-all">
                          {check.reason}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </TraceSection>
            )}

            {/* Database & Memory Operations */}
            {(trace.dbOperations.reads > 0 ||
              trace.dbOperations.writes > 0 ||
              trace.memoryOps.adds > 0 ||
              trace.memoryOps.recalls > 0) && (
              <TraceSection title="Operations" icon={<Database className="w-4 h-4" />}>
                <div className="flex flex-wrap gap-2">
                  {trace.dbOperations.reads > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-blue-500/10 text-blue-500 rounded">
                      DB reads: {trace.dbOperations.reads}
                    </span>
                  )}
                  {trace.dbOperations.writes > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-green-500/10 text-green-500 rounded">
                      DB writes: {trace.dbOperations.writes}
                    </span>
                  )}
                  {trace.memoryOps.adds > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-purple-500/10 text-purple-500 rounded">
                      Memory adds: {trace.memoryOps.adds}
                    </span>
                  )}
                  {trace.memoryOps.recalls > 0 && (
                    <span className="px-2 py-0.5 text-xs bg-indigo-500/10 text-indigo-500 rounded">
                      Memory recalls: {trace.memoryOps.recalls}
                    </span>
                  )}
                </div>
              </TraceSection>
            )}

            {/* Triggers Fired */}
            {trace.triggersFired.length > 0 && (
              <TraceSection title="Triggers Fired" icon={<Zap className="w-4 h-4" />}>
                <div className="flex flex-wrap gap-1">
                  {trace.triggersFired.map((trigger, i) => (
                    <span
                      key={i}
                      className="px-2 py-0.5 text-xs bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 rounded"
                    >
                      {trigger}
                    </span>
                  ))}
                </div>
              </TraceSection>
            )}

            {/* Errors */}
            {trace.errors.length > 0 && (
              <TraceSection title="Errors" icon={<XCircle className="w-4 h-4 text-red-500" />}>
                <div className="space-y-1">
                  {trace.errors.map((error, i) => (
                    <div
                      key={i}
                      className="px-2 py-1 text-xs text-red-500 bg-red-500/10 rounded whitespace-pre-wrap break-all"
                    >
                      {error}
                    </div>
                  ))}
                </div>
              </TraceSection>
            )}

            {/* Request Info */}
            {trace.request && (
              <TraceSection title="Request" icon={<Send className="w-4 h-4" />}>
                <div className="space-y-1 text-xs">
                  <div className="flex gap-2 px-2 py-1 rounded bg-bg-secondary dark:bg-dark-bg-secondary">
                    <span className="text-text-muted dark:text-dark-text-muted">Provider:</span>
                    <span className="text-text-primary dark:text-dark-text-primary font-mono">
                      {trace.request.provider}
                    </span>
                  </div>
                  <div className="flex gap-2 px-2 py-1 rounded bg-bg-secondary dark:bg-dark-bg-secondary">
                    <span className="text-text-muted dark:text-dark-text-muted">Model:</span>
                    <span className="text-text-primary dark:text-dark-text-primary font-mono">
                      {trace.request.model}
                    </span>
                  </div>
                  <div className="flex gap-2 px-2 py-1 rounded bg-bg-secondary dark:bg-dark-bg-secondary">
                    <span className="text-text-muted dark:text-dark-text-muted">Endpoint:</span>
                    <span className="text-text-primary dark:text-dark-text-primary font-mono">
                      {trace.request.endpoint}
                    </span>
                  </div>
                  <div className="flex gap-2 px-2 py-1 rounded bg-bg-secondary dark:bg-dark-bg-secondary">
                    <span className="text-text-muted dark:text-dark-text-muted">Messages:</span>
                    <span className="text-text-primary dark:text-dark-text-primary">
                      {trace.request.messageCount}
                    </span>
                  </div>
                  {trace.request.tools && trace.request.tools.length > 0 && (
                    <div className="px-2 py-1 rounded bg-bg-secondary dark:bg-dark-bg-secondary">
                      <span className="text-text-muted dark:text-dark-text-muted">Tools:</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {trace.request.tools.map((tool, i) => (
                          <span
                            key={i}
                            className="px-1.5 py-0.5 bg-blue-500/10 text-blue-500 rounded font-mono"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </TraceSection>
            )}

            {/* Response Info */}
            {trace.response && (
              <TraceSection title="Response" icon={<Code className="w-4 h-4" />}>
                <div className="space-y-1 text-xs">
                  <div className="flex gap-2 px-2 py-1 rounded bg-bg-secondary dark:bg-dark-bg-secondary">
                    <span className="text-text-muted dark:text-dark-text-muted">Status:</span>
                    <span
                      className={`font-medium ${
                        trace.response.status === 'success' ? 'text-green-500' : 'text-red-500'
                      }`}
                    >
                      {trace.response.status}
                    </span>
                  </div>
                  {trace.response.finishReason && (
                    <div className="flex gap-2 px-2 py-1 rounded bg-bg-secondary dark:bg-dark-bg-secondary">
                      <span className="text-text-muted dark:text-dark-text-muted">Finish Reason:</span>
                      <span className="text-text-primary dark:text-dark-text-primary font-mono">
                        {trace.response.finishReason}
                      </span>
                    </div>
                  )}
                  {trace.response.contentLength !== undefined && (
                    <div className="flex gap-2 px-2 py-1 rounded bg-bg-secondary dark:bg-dark-bg-secondary">
                      <span className="text-text-muted dark:text-dark-text-muted">Content Length:</span>
                      <span className="text-text-primary dark:text-dark-text-primary">
                        {trace.response.contentLength} chars
                      </span>
                    </div>
                  )}
                </div>
              </TraceSection>
            )}

            {/* Retries */}
            {trace.retries && trace.retries.length > 0 && (
              <TraceSection title="Retries" icon={<RefreshCw className="w-4 h-4 text-amber-500" />}>
                <div className="space-y-1">
                  {trace.retries.map((retry, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-2 py-1 rounded bg-amber-500/10 text-xs flex-wrap"
                    >
                      <span className="text-amber-600 dark:text-amber-400 font-medium">
                        Attempt {retry.attempt}
                      </span>
                      <span className="text-text-muted dark:text-dark-text-muted">
                        delayed {retry.delayMs}ms
                      </span>
                      <span className="text-red-500 whitespace-pre-wrap break-all">
                        {retry.error}
                      </span>
                    </div>
                  ))}
                </div>
              </TraceSection>
            )}

            {/* All Events (collapsible) */}
            <EventsSection events={trace.events} toolCalls={trace.toolCalls} />
          </div>
        )}
      </div>

      {/* Debug Info Modal */}
      {showModal && (
        <DebugInfoModal trace={trace} onClose={() => setShowModal(false)} />
      )}
    </>
  );
}

interface TraceSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function TraceSection({ title, icon, children }: TraceSectionProps) {
  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2 mb-2 text-text-secondary dark:text-dark-text-secondary">
        {icon}
        <span className="text-xs font-medium">{title}</span>
      </div>
      {children}
    </div>
  );
}

interface EventsSectionProps {
  events: TraceInfo['events'];
  toolCalls?: TraceInfo['toolCalls'];
}

function EventsSection({ events, toolCalls = [] }: EventsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());

  if (events.length === 0) return null;

  const toggleEventExpanded = (index: number) => {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  // Find matching tool call data for an event
  const getToolCallDetails = (eventName: string) => {
    return toolCalls.find((tc) => tc.name === eventName);
  };

  return (
    <div className="px-3 py-2">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-text-secondary dark:text-dark-text-secondary"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span className="text-xs font-medium">All Events ({events.length})</span>
      </button>

      {isExpanded && (
        <div className="mt-2 space-y-1 overflow-y-auto">
          {events.map((event, i) => {
            const isToolCallEvent = event.type === 'tool_call' || event.type === 'tool_result';
            const toolCallData = isToolCallEvent ? getToolCallDetails(event.name) : null;
            const hasDetails = toolCallData && (toolCallData.arguments || toolCallData.result);
            const isEventExpanded = expandedEvents.has(i);

            return (
              <div
                key={i}
                className="bg-bg-secondary dark:bg-dark-bg-secondary rounded overflow-hidden"
              >
                <div
                  onClick={() => hasDetails && toggleEventExpanded(i)}
                  className={`flex items-center gap-2 px-2 py-1 text-xs ${
                    hasDetails ? 'cursor-pointer hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary' : ''
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      event.success === false
                        ? 'bg-red-500'
                        : event.success === true
                        ? 'bg-green-500'
                        : 'bg-gray-400'
                    }`}
                  />
                  <span className="px-1.5 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-text-muted dark:text-dark-text-muted">
                    {event.type}
                  </span>
                  <span className="text-text-primary dark:text-dark-text-primary break-all">
                    {event.name}
                  </span>
                  {hasDetails && (
                    <span className="text-text-muted dark:text-dark-text-muted">
                      {isEventExpanded ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronRight className="w-3 h-3" />
                      )}
                    </span>
                  )}
                  {event.duration !== undefined && (
                    <span className="text-text-muted dark:text-dark-text-muted ml-auto flex-shrink-0">
                      {event.duration}ms
                    </span>
                  )}
                </div>

                {/* Expanded tool call details */}
                {isEventExpanded && toolCallData && (
                  <div className="border-t border-border dark:border-dark-border px-2 py-2 space-y-2">
                    {toolCallData.arguments && Object.keys(toolCallData.arguments).length > 0 && (
                      <div>
                        <div className="text-xs text-text-muted dark:text-dark-text-muted mb-1">
                          Arguments:
                        </div>
                        <pre className="text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary p-2 rounded overflow-x-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-all">
                          {JSON.stringify(toolCallData.arguments, null, 2)}
                        </pre>
                      </div>
                    )}
                    {toolCallData.result && (
                      <div>
                        <div className="text-xs text-text-muted dark:text-dark-text-muted mb-1">
                          Result:
                        </div>
                        <pre className="text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary p-2 rounded overflow-x-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-all">
                          {typeof toolCallData.result === 'string'
                            ? toolCallData.result
                            : JSON.stringify(toolCallData.result, null, 2)}
                        </pre>
                      </div>
                    )}
                    {toolCallData.error && (
                      <div>
                        <div className="text-xs text-text-muted dark:text-dark-text-muted mb-1">
                          Error:
                        </div>
                        <div className="text-xs text-red-500 bg-red-500/10 p-2 rounded whitespace-pre-wrap break-all">
                          {toolCallData.error}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface ToolCallItemProps {
  tool: TraceInfo['toolCalls'][0];
}

function ToolCallItem({ tool }: ToolCallItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasDetails = tool.arguments || tool.result;

  return (
    <div className="rounded bg-bg-secondary dark:bg-dark-bg-secondary overflow-hidden">
      <button
        onClick={() => hasDetails && setIsExpanded(!isExpanded)}
        className={`w-full flex items-center gap-2 px-2 py-1.5 ${
          hasDetails ? 'cursor-pointer hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary' : 'cursor-default'
        }`}
      >
        {tool.success ? (
          <Check className="w-3 h-3 text-green-500 flex-shrink-0" />
        ) : (
          <XCircle className="w-3 h-3 text-red-500 flex-shrink-0" />
        )}
        <span className="font-mono text-xs text-text-primary dark:text-dark-text-primary">
          {tool.name}
        </span>
        {hasDetails && (
          <span className="text-text-muted dark:text-dark-text-muted">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </span>
        )}
        {tool.duration !== undefined && (
          <span className="text-xs text-text-muted dark:text-dark-text-muted ml-auto">
            {tool.duration}ms
          </span>
        )}
        {tool.error && (
          <span className="text-xs text-red-500 whitespace-pre-wrap break-all">
            {tool.error}
          </span>
        )}
      </button>

      {isExpanded && hasDetails && (
        <div className="border-t border-border dark:border-dark-border px-2 py-2 space-y-2">
          {tool.arguments && Object.keys(tool.arguments).length > 0 && (
            <div>
              <div className="text-xs text-text-muted dark:text-dark-text-muted mb-1">
                Arguments:
              </div>
              <pre className="text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary p-2 rounded overflow-x-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-all">
                {JSON.stringify(tool.arguments, null, 2)}
              </pre>
            </div>
          )}
          {tool.result && (
            <div>
              <div className="text-xs text-text-muted dark:text-dark-text-muted mb-1">
                Result:
              </div>
              <pre className="text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary p-2 rounded overflow-x-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-all">
                {tool.result}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
