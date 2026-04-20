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
  File,
  BookOpen,
  Layout,
  Database,
  Globe,
  Image as ImageIcon,
  ExternalLink,
  Brain,
} from './icons';
import { ToolExecutionDisplay } from './ToolExecutionDisplay';
import { TraceDisplay } from './TraceDisplay';
import { MarkdownContent } from './MarkdownContent';
import { VoicePlayButton } from './VoicePlayButton';
import type { Message } from '../types';
import { STORAGE_KEYS } from '../constants/storage-keys';

interface MessageListProps {
  messages: Message[];
  onRetry?: () => void;
  canRetry?: boolean;
  /** Workspace ID for resolving relative image paths */
  workspaceId?: string | null;
}

export function MessageList({ messages, onRetry, canRetry, workspaceId }: MessageListProps) {
  return (
    <div className="space-y-6">
      {messages.map((message, index) => (
        <MessageBubble
          key={message.id}
          message={message}
          onRetry={onRetry}
          showRetry={canRetry && message.isError && index === messages.length - 1}
          workspaceId={workspaceId}
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
}

function MessageBubble({ message, onRetry, showRetry, workspaceId }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [toolCallsExpanded, setToolCallsExpanded] = useState(false);
  const [thinkingExpanded, setThinkingExpanded] = useState(false);
  const isUser = message.role === 'user';
  const isError = message.isError;

  // Professional Context Parsing
  const { resources: parsedResources, cleanContent } = parseAttachedContext(message.content);
  // Strip any think/thinking tags that may have been saved to message history
  const displayContent = cleanContent.replace(
    /<(?:think|thinking)>[\s\S]*?<\/(?:think|thinking)>\s*/g,
    ''
  );

  // Unified Resource Handling
  // Merge direct attachments (from DB/Upload) with parsed context resources
  const directAttachments = (message.attachments || []).map((a) => ({
    type: (a.type === 'image' ? 'image' : 'file') as ParsedResource['type'] | 'image',
    name: a.filename || 'Unnamed File',
    source: 'user' as const,
    size: a.size,
    path: a.path,
    mimeType: a.mimeType,
    previewUrl: a.previewUrl,
  }));

  const parsedItems = parsedResources.map((r) => ({
    ...r,
    source: 'ai' as const,
  }));

  // Deduplicate by name and path to avoid "double attachments"
  const galleryItems = [...directAttachments];
  for (const item of parsedItems) {
    const isDuplicate = galleryItems.some(
      (existing) => 
        existing.name === item.name || 
        ((existing as any).path && (item as any).path && (existing as any).path === (item as any).path)
    );
    if (!isDuplicate) {
      galleryItems.push(item as any);
    }
  }

  const hasResources = galleryItems.length > 0;


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
    <div className={`flex gap-4 w-full ${isUser ? 'flex-row-reverse justify-start' : 'justify-start'}`}>
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
      <div className={`group max-w-[85%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>

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

        {/* Resource Gallery Section */}
        {hasResources && (
          <div className={`mt-3 flex ${isUser ? 'justify-end' : 'justify-start'}`}>
            <div className={`grid grid-cols-1 gap-3 max-w-[600px] ${isUser ? 'justify-items-end' : ''}`}>
              {galleryItems.map((item, i) => {
                const isImage = item.type === 'image';
                const colorClass = getResourceColor(item.type as any);
                const icon = getResourceIcon(item.type as any, "w-4.5 h-4.5");
                // Construct file URL for user attachments
                const token = localStorage.getItem(STORAGE_KEYS.SESSION_TOKEN);
                const cleanPath = item.path?.replace(/^attachments[\\\/]/, '').replace(/^[\\\/]+/, '');
                const fileUrl = cleanPath 
                  ? `/api/v1/chat/attachments/${cleanPath}${token ? `?token=${token}` : ''}` 
                  : item.previewUrl;

                return (
                  <ResourceCard 
                    key={i}
                    item={item}
                    isImage={isImage}
                    fileUrl={fileUrl}
                    colorClass={colorClass}
                    icon={icon}
                  />
                );
              })}
            </div>
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

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

interface ParsedResource {
  type: 'file' | 'tool' | 'skill' | 'url' | 'artifact' | 'image' | 'other';
  name: string;
  path?: string;
}

function parseAttachedContext(content: string): { resources: ParsedResource[]; cleanContent: string } {
  if (!content) return { resources: [], cleanContent: '' };
  const parts = content.split('\n---\n[TOOL CATALOG');
  let cleanContent = (parts[0] || '').trim();
  
  // 2. Identify the [ATTACHED CONTEXT] boundary
  const contextMarker = '[ATTACHED CONTEXT';
  const markerIndex = cleanContent.indexOf(contextMarker);

  if (markerIndex === -1) return { resources: [], cleanContent };

  // Extract the context block and the message text before it
  const contextPart = cleanContent.substring(markerIndex);
  
  // Clean up the trailing "---" and spacing before the marker
  cleanContent = cleanContent.substring(0, markerIndex)
    .replace(/\s*---?\s*$/, '') // Strip trailing horizontal rule
    .trim();

  const resources: ParsedResource[] = [];

  // Pattern matchers for different resource types within the context block
  const patterns = [
    { type: 'file' as const, regex: /Attached File: (.*?) \(/g },
    { type: 'tool' as const, regex: /Tool: (.*?)(?:\n|$)/g },
    { type: 'skill' as const, regex: /Skill: (.*?)(?:\n|$)/g },
    { type: 'url' as const, regex: /Web Page: (.*?)(?:\n|$)/g },
    { type: 'artifact' as const, regex: /Previous AI Artifact: "(.*?)"/g },
  ];

  patterns.forEach(({ type, regex }) => {
    let match;
    // Reset regex index for repeated matches
    regex.lastIndex = 0;
    while ((match = regex.exec(contextPart)) !== null) {
      if (match[1]) {
        resources.push({ type, name: match[1].trim() });
      }
    }
  });

  return { resources, cleanContent };
}

function getResourceIcon(type: ParsedResource['type'], className = "w-3 h-3 opacity-60") {
  switch (type) {
    case 'image':
      return <ImageIcon className={className} />;
    case 'file':
      return <File className={className} />;
    case 'tool':
      return <Wrench className={className} />;
    case 'skill':
      return <BookOpen className={className} />;
    case 'url':
      return <Globe className={className} />;
    case 'artifact':
      return <Layout className={className} />;
    default:
      return <Database className={className} />;
  }
}

function getResourceColor(type: ParsedResource['type']): string {
  switch (type) {
    case 'image':
      return 'bg-pink-500/10 text-pink-600 dark:text-pink-400';
    case 'file':
      return 'bg-orange-500/10 text-orange-600 dark:text-orange-400';
    case 'tool':
      return 'bg-blue-500/10 text-blue-600 dark:text-blue-400';
    case 'skill':
      return 'bg-violet-500/10 text-violet-600 dark:text-violet-400';
    case 'url':
      return 'bg-sky-500/10 text-sky-600 dark:text-sky-400';
    case 'artifact':
      return 'bg-rose-500/10 text-rose-600 dark:text-rose-400';
    default:
      return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400';
  }
}

interface ResourceCardProps {
  item: any;
  isImage: boolean;
  fileUrl?: string;
  colorClass: string;
  icon: React.ReactNode;
}

function ResourceCard({ item, isImage, fileUrl, colorClass, icon }: ResourceCardProps) {
  const [imageError, setImageError] = useState(false);
  const showImage = isImage && fileUrl && !imageError;

  return (
    <div 
      className={`flex flex-col rounded-xl border border-border/80 dark:border-dark-border/80 bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-all hover:shadow-md hover:border-primary/30 group/res overflow-hidden w-full max-w-[280px]`}
    >
      {showImage && (
        <div className="aspect-video w-full overflow-hidden bg-bg-tertiary dark:bg-dark-bg-tertiary border-b border-border/50 dark:border-dark-border/50 relative">
          <img 
            src={fileUrl} 
            alt={item.name} 
            className="w-full h-full object-cover transition-transform group-hover/res:scale-105"
            loading="lazy"
            onError={() => setImageError(true)}
          />
        </div>
      )}
      
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${colorClass} shadow-sm`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div 
            className="text-sm font-bold text-text-primary dark:text-dark-text-primary truncate leading-tight" 
            title={item.name}
          >
            {item.name}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-[9px] text-text-muted dark:text-dark-text-muted font-bold uppercase tracking-wider opacity-80">
              {item.source === 'user' ? 'Attachment' : 'AI Context'}
            </span>
            {item.size && (
              <>
                <span className="w-0.5 h-0.5 rounded-full bg-text-muted opacity-30"></span>
                <span className="text-[9px] text-text-muted opacity-50 font-medium">
                  {formatFileSize(item.size)}
                </span>
              </>
            )}
          </div>
        </div>
        
        {item.path && (
          <a 
            href={fileUrl} 
            target="_blank" 
            rel="noopener noreferrer"
            className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted hover:text-primary transition-all hover:scale-110 active:scale-95 shadow-sm border border-transparent hover:border-border"
            title="View original"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </div>
    </div>
  );
}
