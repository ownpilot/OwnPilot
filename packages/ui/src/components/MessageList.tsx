import { useState } from 'react';
import {
  User,
  Bot,
  Copy,
  Check,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Wrench,
  Brain,
  FileText,
  Image,
} from './icons';
import { ToolExecutionDisplay } from './ToolExecutionDisplay';
import { TraceDisplay } from './TraceDisplay';
import { MarkdownContent } from './MarkdownContent';
import { ChatMessageWidget } from './ChatMessageWidget';
import { SuggestionChips } from './SuggestionChips';
import { VoicePlayButton } from './VoicePlayButton';
import {
  stripChatInternalTags,
  parseMarkers,
  type ParsedMarkerWidget,
} from '../utils/chat-content';
import type { Message, MessageAttachment } from '../types';

interface MessageListProps {
  messages: Message[];
  onRetry?: () => void;
  canRetry?: boolean;
  /** Workspace ID for resolving relative image paths */
  workspaceId?: string | null;
  /** Called when user clicks a suggestion chip from marker-based suggestions */
  onSuggestionSelect?: (title: string, detail: string) => void;
}

export function MessageList({
  messages,
  onRetry,
  canRetry,
  workspaceId,
  onSuggestionSelect,
}: MessageListProps) {
  return (
    <div className="space-y-6">
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          onRetry={onRetry}
          showRetry={canRetry && message.isError && index === messages.length - 1}
          workspaceId={workspaceId}
          onSuggestionSelect={onSuggestionSelect}
        />
      ))}
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  onRetry?: () => void;
  showRetry?: boolean;
  workspaceId?: string | null;
  onSuggestionSelect?: (title: string, detail: string) => void;
}

function formatAttachmentSize(size: number | undefined): string | null {
  if (!size || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function AttachmentChip({ attachment }: { attachment: MessageAttachment }) {
  const label =
    attachment.filename || (attachment.type === 'image' ? 'Attached image' : 'Attached file');
  const size = formatAttachmentSize(attachment.size);
  const Icon = attachment.type === 'image' ? Image : FileText;

  return (
    <div className="inline-flex max-w-[240px] items-center gap-2 rounded-lg border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text-secondary dark:border-dark-border dark:bg-dark-bg-secondary dark:text-dark-text-secondary">
      <Icon className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="truncate">{label}</span>
      {size && (
        <span className="flex-shrink-0 text-text-muted dark:text-dark-text-muted">{size}</span>
      )}
    </div>
  );
}

function resolveAttachmentImageSrc(
  attachment: MessageAttachment,
  workspaceId?: string | null
): string | undefined {
  if (attachment.data) {
    return `data:${attachment.mimeType || 'image/png'};base64,${attachment.data}`;
  }

  if (!attachment.path) return undefined;
  const cleanPath = attachment.path.replace(/^[/\\]+/, '');
  if (workspaceId) {
    return `/api/v1/file-workspaces/${encodeURIComponent(workspaceId)}/file/${cleanPath}?raw=true`;
  }

  return `/api/v1/files/workspace/${cleanPath}`;
}

function MessageBubble({
  message,
  onRetry,
  showRetry,
  workspaceId,
  onSuggestionSelect,
}: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [toolCallsExpanded, setToolCallsExpanded] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const isUser = message.role === 'user';
  const isError = message.isError;

  // Strip hidden context blocks from display (attached context + tool catalog)
  const hasAttachedContext =
    isUser &&
    (message.content.includes('\n---\n[ATTACHED CONTEXT') ||
      message.content.includes('\n---\n[TOOL CATALOG'));
  const strippedContent = hasAttachedContext
    ? message.content
        .replace(/\n---\n\[ATTACHED CONTEXT[\s\S]*$/, '')
        .replace(/\n---\n\[TOOL CATALOG[\s\S]*$/, '')
        .trim()
    : message.content;

  // Parse markers from assistant messages — extract interactive widgets and suggestions
  const { widgets, suggestions } = !isUser
    ? parseMarkers(strippedContent)
    : { widgets: [], suggestions: [] };
  const displayContent = isUser ? strippedContent : stripChatInternalTags(strippedContent);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(displayContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may be unavailable in some browsers/contexts
    }
  };

  return (
    <div className={`flex gap-4 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center ${
          isUser
            ? 'bg-gradient-to-br from-primary to-primary-dark text-white'
            : 'bg-gradient-to-br from-purple-500 to-indigo-600 text-white'
        }`}
      >
        {isUser ? <User className="w-5 h-5" /> : <Bot className="w-5 h-5" />}
      </div>

      {/* Content */}
      <div className={`group flex-1 max-w-[85%] ${isUser ? 'text-right' : 'text-left'}`}>
        {/* User attachments */}
        {isUser && message.attachments && message.attachments.length > 0 && (
          <div className={`flex gap-2 mb-2 ${isUser ? 'justify-end' : ''} flex-wrap`}>
            {message.attachments.map((att, i) => {
              if (att.type === 'image') {
                const src = resolveAttachmentImageSrc(att, workspaceId);
                if (src) {
                  return (
                    <a
                      key={i}
                      href={src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block"
                    >
                      <img
                        src={src}
                        alt={att.filename || 'Attached image'}
                        className="max-w-[200px] max-h-[200px] rounded-xl border border-border dark:border-dark-border object-cover hover:opacity-90 transition-opacity"
                      />
                    </a>
                  );
                }
              }

              return <AttachmentChip key={i} attachment={att} />;
            })}
          </div>
        )}

        {/* Message Bubble */}
        {(() => {
          const hasCodeBlock = /```[\s\S]*?```/.test(displayContent);
          return (
            <div
              className={`${hasCodeBlock ? 'block w-full' : 'inline-block'} px-4 py-3 rounded-2xl ${
                isUser
                  ? 'bg-primary text-white rounded-tr-md'
                  : isError
                    ? 'bg-error/10 text-error border border-error/30 rounded-tl-md'
                    : 'bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary rounded-tl-md border border-border dark:border-dark-border'
              }`}
            >
              <MarkdownContent content={displayContent} workspaceId={workspaceId} />
            </div>
          );
        })()}

        {/* Render marker-based widgets inline after the message bubble */}
        {!isUser && widgets.length > 0 && (
          <div className="mt-3 space-y-2">
            {widgets.map((widget: ParsedMarkerWidget) => (
              <ChatMessageWidget key={widget.id} name={widget.name} data={widget.data} />
            ))}
          </div>
        )}

        {/* Render marker-based suggestions as clickable chips */}
        {!isUser && suggestions.length > 0 && onSuggestionSelect && (
          <div className="mt-2">
            {suggestions.map((s, i) => (
              <SuggestionChips
                key={i}
                suggestions={s.items}
                onSelect={(item) => onSuggestionSelect(item.title, item.detail)}
              />
            ))}
          </div>
        )}

        {/* Attached context indicator */}
        {hasAttachedContext && (
          <div
            className={`mt-1 text-[11px] text-text-muted/60 dark:text-dark-text-muted/60 ${isUser ? 'text-right' : ''}`}
          >
            + context attached
          </div>
        )}

        {/* Retry Button - only for error messages */}
        {showRetry && onRetry && (
          <div className="mt-3">
            <button
              onClick={async () => {
                setIsRetrying(true);
                try {
                  await onRetry();
                } finally {
                  setIsRetrying(false);
                }
              }}
              disabled={isRetrying}
              className="inline-flex items-center gap-2 px-4 py-2 bg-error/10 hover:bg-error/20 text-error border border-error/30 rounded-lg transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isRetrying ? 'animate-spin' : ''}`} />
              {isRetrying ? 'Retrying...' : 'Retry Message'}
            </button>
          </div>
        )}

        {/* Actions */}
        <div
          className={`mt-2 flex items-center gap-3 opacity-0 group-hover:opacity-100 transition-opacity ${
            isUser ? 'justify-end' : 'justify-start'
          }`}
        >
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded transition-colors"
            title={copied ? 'Copied!' : 'Copy message'}
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-green-500" />
                <span className="text-green-500">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
          {!isUser && displayContent && <VoicePlayButton text={displayContent} />}
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            {new Date(message.timestamp).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        </div>

        {/* Thinking Content - Collapsible (for messages with thinking/reasoning) */}
        {!isUser && message.thinkingContent && (
          <div className="mt-3">
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
                <Brain className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
                <span className="font-medium text-text-secondary dark:text-dark-text-secondary">
                  Thought Process
                </span>
              </button>
              {thinkingExpanded && (
                <div className="border-t border-border dark:border-dark-border px-3 py-2 max-h-64 overflow-y-auto">
                  <div className="whitespace-pre-wrap text-text-muted dark:text-dark-text-muted text-xs leading-relaxed">
                    {message.thinkingContent}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tool Calls - Collapsible container */}
        {(() => {
          // Merge tool calls from message.toolCalls and trace
          const toolCallItems = message.toolCalls?.length
            ? message.toolCalls.map((call) => {
                const traceInfo = message.trace?.toolCalls?.find((tc) => tc.name === call.name);
                let args: Record<string, unknown>;
                try {
                  args =
                    typeof call.arguments === 'string'
                      ? JSON.parse(call.arguments)
                      : (call.arguments ?? {});
                } catch {
                  args = {};
                }
                return {
                  id: call.id,
                  name: call.name,
                  arguments: traceInfo?.arguments || args,
                  result: call.result || traceInfo?.result,
                  status: (traceInfo?.success === false
                    ? 'error'
                    : call.result !== undefined || traceInfo?.result !== undefined
                      ? 'success'
                      : 'pending') as 'error' | 'success' | 'pending',
                  duration: traceInfo?.duration,
                  error: traceInfo?.error,
                };
              })
            : message.trace?.toolCalls?.length
              ? message.trace.toolCalls.map((tc, idx) => ({
                  id: `trace-${idx}`,
                  name: tc.name,
                  arguments: tc.arguments || {},
                  result: tc.result,
                  status: (tc.success === false
                    ? 'error'
                    : tc.result !== undefined
                      ? 'success'
                      : 'pending') as 'error' | 'success' | 'pending',
                  duration: tc.duration,
                  error: tc.error,
                }))
              : [];

          if (toolCallItems.length === 0) return null;

          const successCount = toolCallItems.filter((t) => t.status === 'success').length;
          const errorCount = toolCallItems.filter((t) => t.status === 'error').length;

          return (
            <div className={`mt-3 ${isUser ? 'text-left' : ''}`}>
              <div className="rounded-lg border border-border dark:border-dark-border bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50 overflow-hidden text-sm">
                <button
                  onClick={() => setToolCallsExpanded(!toolCallsExpanded)}
                  className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                >
                  <div className="text-text-muted dark:text-dark-text-muted">
                    {toolCallsExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                  </div>
                  <Wrench className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
                  <span className="font-medium text-text-secondary dark:text-dark-text-secondary">
                    Tool Calls
                  </span>
                  <div className="flex items-center gap-2 ml-auto text-xs">
                    <span className={`${errorCount > 0 ? 'text-yellow-500' : 'text-green-500'}`}>
                      {successCount}/{toolCallItems.length}
                    </span>
                    {errorCount > 0 && <span className="text-red-500">{errorCount} failed</span>}
                  </div>
                </button>

                {toolCallsExpanded && (
                  <div className="border-t border-border dark:border-dark-border p-2">
                    <ToolExecutionDisplay toolCalls={toolCallItems} workspaceId={workspaceId} />
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        {/* Debug/Trace Info - only for assistant messages */}
        {!isUser && message.trace && (
          <div className="mt-3">
            <TraceDisplay trace={message.trace} />
          </div>
        )}
      </div>
    </div>
  );
}
