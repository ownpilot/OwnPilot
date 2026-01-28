import { useState } from 'react';
import { User, Bot, Copy, Check, RefreshCw } from './icons';
import { ToolExecutionDisplay } from './ToolExecutionDisplay';
import { TraceDisplay } from './TraceDisplay';
import { CodeBlock } from './CodeBlock';
import type { Message } from '../types';

interface MessageListProps {
  messages: Message[];
  onRetry?: () => void;
  canRetry?: boolean;
}

export function MessageList({ messages, onRetry, canRetry }: MessageListProps) {
  return (
    <div className="space-y-6">
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          onRetry={onRetry}
          showRetry={canRetry && message.isError && index === messages.length - 1}
        />
      ))}
    </div>
  );
}

interface MessageBubbleProps {
  message: Message;
  onRetry?: () => void;
  showRetry?: boolean;
}

function MessageBubble({ message, onRetry, showRetry }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const isUser = message.role === 'user';
  const isError = message.isError;

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Parse markdown-like code blocks
  const renderContent = (content: string) => {
    // Match code blocks with optional language
    // Handles: ```javascript\n, ```javascript \n, ```\n, ``` (no newline)
    // [ \t]* = optional spaces/tabs after language (but not newlines)
    // \r?\n? = optional Windows or Unix newline
    const codeBlockRegex = /```(\w*)[ \t]*\r?\n?([\s\S]*?)```/g;
    const parts: React.ReactElement[] = [];
    let lastIndex = 0;
    let match;
    let key = 0;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Add text before the code block
      if (match.index > lastIndex) {
        const textBefore = content.slice(lastIndex, match.index);
        parts.push(
          <span key={key++} className="whitespace-pre-wrap break-words">
            {renderInlineElements(textBefore)}
          </span>
        );
      }

      // Add the code block
      const language = match[1] || 'plaintext';
      const code = match[2].trim();
      parts.push(
        <div key={key++} className="my-3">
          <CodeBlock
            code={code}
            language={language}
            showLineNumbers={code.split('\n').length > 3}
            maxHeight="300px"
          />
        </div>
      );

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      parts.push(
        <span key={key++} className="whitespace-pre-wrap break-words">
          {renderInlineElements(content.slice(lastIndex))}
        </span>
      );
    }

    return parts.length > 0 ? parts : <span className="whitespace-pre-wrap break-words">{content}</span>;
  };

  // Render inline elements (bold, italic, inline code, links)
  const renderInlineElements = (text: string): (string | React.ReactElement)[] => {
    const elements: (string | React.ReactElement)[] = [];
    let remaining = text;
    let key = 0;

    while (remaining.length > 0) {
      // Inline code
      const inlineCodeMatch = remaining.match(/^`([^`]+)`/);
      if (inlineCodeMatch) {
        elements.push(
          <code key={key++} className="px-1.5 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary text-primary rounded font-mono text-sm">
            {inlineCodeMatch[1]}
          </code>
        );
        remaining = remaining.slice(inlineCodeMatch[0].length);
        continue;
      }

      // Bold
      const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
      if (boldMatch) {
        elements.push(<strong key={key++}>{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch[0].length);
        continue;
      }

      // Italic
      const italicMatch = remaining.match(/^\*([^*]+)\*/);
      if (italicMatch) {
        elements.push(<em key={key++}>{italicMatch[1]}</em>);
        remaining = remaining.slice(italicMatch[0].length);
        continue;
      }

      // Links
      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        elements.push(
          <a
            key={key++}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {linkMatch[1]}
          </a>
        );
        remaining = remaining.slice(linkMatch[0].length);
        continue;
      }

      // No match, add next character
      const nextSpecial = remaining.search(/[`*\[]/);
      if (nextSpecial === -1) {
        elements.push(remaining);
        break;
      } else if (nextSpecial === 0) {
        elements.push(remaining[0]);
        remaining = remaining.slice(1);
      } else {
        elements.push(remaining.slice(0, nextSpecial));
        remaining = remaining.slice(nextSpecial);
      }
    }

    return elements;
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
        {/* Message Bubble */}
        {(() => {
          const hasCodeBlock = /```[\s\S]*?```/.test(message.content);
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
              {renderContent(message.content)}
            </div>
          );
        })()}

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
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Tool calls - Enhanced Display with results from trace */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className={`mt-3 ${isUser ? 'text-left' : ''}`}>
            <ToolExecutionDisplay
              toolCalls={message.toolCalls.map((call) => {
                // Find matching trace info for this tool call (has arguments and result)
                const traceInfo = message.trace?.toolCalls?.find(tc => tc.name === call.name);
                const args = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments;

                return {
                  id: call.id,
                  name: call.name,
                  arguments: traceInfo?.arguments || args,
                  result: call.result || traceInfo?.result,
                  status: traceInfo?.success === false ? 'error' :
                          (call.result !== undefined || traceInfo?.result !== undefined) ? 'success' : 'pending',
                  duration: traceInfo?.duration,
                  error: traceInfo?.error,
                };
              })}
            />
          </div>
        )}

        {/* Show trace tool calls even if no toolCalls in message (for tool results from orchestration) */}
        {!message.toolCalls?.length && message.trace?.toolCalls && message.trace.toolCalls.length > 0 && (
          <div className={`mt-3 ${isUser ? 'text-left' : ''}`}>
            <ToolExecutionDisplay
              toolCalls={message.trace.toolCalls.map((tc, idx) => ({
                id: `trace-${idx}`,
                name: tc.name,
                arguments: tc.arguments || {},
                result: tc.result,
                status: tc.success === false ? 'error' : tc.result !== undefined ? 'success' : 'pending',
                duration: tc.duration,
                error: tc.error,
              }))}
            />
          </div>
        )}

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
