import { useState } from 'react';
import { formatToolName, formatBytes } from '../utils/formatters';
import {
  Wrench,
  Check,
  XCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  File,
  AlertTriangle,
} from './icons';
import { CodeBlock } from './CodeBlock';
import { BLOCKED_IMG_PLACEHOLDER, resolveImageUrl } from './MarkdownContent.url-helpers';

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Tool output — dynamic type (string | object | number | etc.), typed as unknown */
  result?: unknown;
  status?: 'pending' | 'running' | 'success' | 'error';
  duration?: number;
  error?: string;
}

interface ToolExecutionDisplayProps {
  toolCalls: ToolCall[];
  onRerun?: (toolCall: ToolCall) => void;
  /** Workspace ID for resolving file paths to image URLs */
  workspaceId?: string | null;
}

export function ToolExecutionDisplay({
  toolCalls,
  onRerun,
  workspaceId,
}: ToolExecutionDisplayProps) {
  return (
    <div className="space-y-2 mt-3">
      {toolCalls.map((call) => (
        <ToolCallCard key={call.id} toolCall={call} onRerun={onRerun} workspaceId={workspaceId} />
      ))}
    </div>
  );
}

interface ToolCallCardProps {
  toolCall: ToolCall;
  onRerun?: (toolCall: ToolCall) => void;
  workspaceId?: string | null;
}

function ToolCallCard({ toolCall, onRerun, workspaceId }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showArgs, setShowArgs] = useState(false);

  const category = getToolCategory(toolCall.name);
  const status = toolCall.status ?? (toolCall.error ? 'error' : 'success');
  const localExec = isLocalExecution(toolCall.result);

  return (
    <div className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
      >
        {/* Status Icon */}
        <div
          className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
            status === 'pending'
              ? 'bg-yellow-500/10 text-yellow-500'
              : status === 'running'
                ? 'bg-blue-500/10 text-blue-500 animate-pulse'
                : status === 'success'
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-red-500/10 text-red-500'
          }`}
        >
          {status === 'pending' && <Clock className="w-4 h-4" />}
          {status === 'running' && <Wrench className="w-4 h-4 animate-spin" />}
          {status === 'success' && <Check className="w-4 h-4" />}
          {status === 'error' && <XCircle className="w-4 h-4" />}
        </div>

        {/* Tool Info */}
        <div className="flex-1 text-left">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary dark:text-dark-text-primary">
              {formatToolName(toolCall.name)}
            </span>
            <span className="px-2 py-0.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted rounded">
              {category}
            </span>
            {localExec && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded font-medium">
                <AlertTriangle className="w-3 h-3" />
                LOCAL
              </span>
            )}
          </div>
          {toolCall.duration !== undefined && (
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              Completed in {toolCall.duration}ms
            </span>
          )}
        </div>

        {/* Expand/Collapse */}
        <div className="flex-shrink-0 text-text-muted dark:text-dark-text-muted">
          {isExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </div>
      </button>

      {/* Content */}
      {isExpanded && (
        <div className="border-t border-border dark:border-dark-border">
          {/* Arguments */}
          <div className="px-4 py-3 border-b border-border dark:border-dark-border">
            <button
              onClick={() => setShowArgs(!showArgs)}
              className="flex items-center gap-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary"
            >
              {showArgs ? (
                <ChevronDown className="w-4 h-4" />
              ) : (
                <ChevronRight className="w-4 h-4" />
              )}
              <span>Arguments</span>
            </button>
            {showArgs && (
              <div className="mt-2">
                <CodeBlock
                  code={JSON.stringify(toolCall.arguments, null, 2)}
                  language="json"
                  showLineNumbers={false}
                  maxHeight="200px"
                />
              </div>
            )}
          </div>

          {/* Local Execution Warning */}
          {localExec && (
            <div className="px-4 py-2 bg-amber-500/5 border-b border-amber-500/20 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
              <span className="text-xs text-amber-600 dark:text-amber-400">
                This code ran directly on your local machine without Docker sandbox isolation.
              </span>
            </div>
          )}

          {/* Result */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                Result
              </span>
              {onRerun && (
                <button
                  onClick={() => onRerun(toolCall)}
                  className="px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
                >
                  Re-run
                </button>
              )}
            </div>

            {toolCall.error ? (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-sm text-red-500">{toolCall.error}</p>
              </div>
            ) : toolCall.result !== undefined ? (
              <ToolResultDisplay
                result={toolCall.result}
                toolName={toolCall.name}
                workspaceId={workspaceId}
              />
            ) : status === 'running' ? (
              <div className="flex items-center gap-2 text-text-muted dark:text-dark-text-muted">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm">Executing...</span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

interface ToolResultDisplayProps {
  result: unknown;
  toolName: string;
  workspaceId?: string | null;
}

interface DirectoryFileResult {
  isDirectory?: boolean;
  name?: string;
  size?: number;
}

interface SearchResultItem {
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
}

interface ToolResultRecord {
  output?: unknown;
  outputPath?: unknown;
  source?: unknown;
  content?: unknown;
  path?: unknown;
  files?: unknown;
  stdout?: unknown;
  stderr?: unknown;
  result?: unknown;
  exitCode?: unknown;
  status?: unknown;
  url?: unknown;
  metadata?: unknown;
  text?: unknown;
  body?: unknown;
  results?: unknown;
  [key: string]: unknown;
}

function isToolResultRecord(value: unknown): value is ToolResultRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ToolResultDisplay({ result, toolName, workspaceId }: ToolResultDisplayProps) {
  // Strip namespace prefix (e.g. 'core.read_file' → 'read_file') for display matching
  const baseName = toolName.includes('.')
    ? toolName.substring(toolName.lastIndexOf('.') + 1)
    : toolName;
  const record = isToolResultRecord(result) ? result : null;

  // Image tools — show inline preview
  if (isImageToolResult(baseName, result)) {
    const imagePathValue = result.output ?? result.source ?? result.outputPath;
    const imagePath = typeof imagePathValue === 'string' ? imagePathValue : undefined;
    const src = resolveWorkspaceImageUrl(imagePath, workspaceId);
    return (
      <div className="space-y-2">
        {imagePath && (
          <div className="flex items-center gap-2 text-sm text-text-muted dark:text-dark-text-muted">
            <File className="w-4 h-4" />
            <span className="font-mono text-xs truncate">{imagePath}</span>
          </div>
        )}
        {src && <ToolImagePreview src={src} alt={imagePath || 'Generated image'} />}
        <CodeBlock
          code={JSON.stringify(result, null, 2)}
          language="json"
          showLineNumbers={false}
          maxHeight="200px"
        />
      </div>
    );
  }

  // File system tools - show file content
  if (baseName === 'read_file' && record && typeof record.content === 'string') {
    const filePath = typeof record.path === 'string' ? record.path : '';
    return (
      <div className="space-y-2">
        {filePath && (
          <div className="flex items-center gap-2 text-sm text-text-muted dark:text-dark-text-muted">
            <File className="w-4 h-4" />
            <span className="font-mono">{filePath}</span>
          </div>
        )}
        <CodeBlock
          code={record.content}
          language={detectLanguage(filePath)}
          filename={filePath.split('/').pop()}
          maxHeight="300px"
        />
      </div>
    );
  }

  // Directory listing
  if (baseName === 'list_directory' && record && Array.isArray(record.files)) {
    const files = record.files as DirectoryFileResult[];
    return (
      <div className="space-y-1">
        {files.map((file, i) => (
          <div
            key={i}
            className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary rounded"
          >
            {file.isDirectory ? (
              <span className="text-blue-400">📁</span>
            ) : (
              <span className="text-gray-400">📄</span>
            )}
            <span className="flex-1 font-mono text-text-primary dark:text-dark-text-primary">
              {file.name}
            </span>
            {file.size !== undefined && (
              <span className="text-xs text-text-muted dark:text-dark-text-muted">
                {formatBytes(file.size)}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Code execution results
  if (
    (baseName.startsWith('execute_') ||
      baseName === 'compile_code' ||
      baseName === 'package_manager') &&
    record
  ) {
    const stdout = typeof record.stdout === 'string' ? record.stdout : '';
    const stderr = typeof record.stderr === 'string' ? record.stderr : '';
    const exitCode = typeof record.exitCode === 'number' ? record.exitCode : undefined;
    return (
      <div className="space-y-3">
        {stdout && (
          <div>
            <span className="text-xs text-green-500 font-medium">stdout:</span>
            <CodeBlock
              code={stdout}
              language="plaintext"
              showLineNumbers={false}
              maxHeight="200px"
            />
          </div>
        )}
        {stderr && (
          <div>
            <span className="text-xs text-red-500 font-medium">stderr:</span>
            <CodeBlock
              code={stderr}
              language="plaintext"
              showLineNumbers={false}
              maxHeight="200px"
            />
          </div>
        )}
        {record.result !== undefined && (
          <div>
            <span className="text-xs text-blue-500 font-medium">result:</span>
            <pre className="mt-1 p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-sm text-text-primary dark:text-dark-text-primary overflow-x-auto">
              {typeof record.result === 'object'
                ? JSON.stringify(record.result, null, 2)
                : String(record.result)}
            </pre>
          </div>
        )}
        {exitCode !== undefined && (
          <div className={`text-xs ${exitCode === 0 ? 'text-green-500' : 'text-red-500'}`}>
            Exit code: {exitCode}
          </div>
        )}
      </div>
    );
  }

  // Web fetch results
  if ((baseName === 'fetch_web_page' || baseName === 'http_request') && record) {
    const status = typeof record.status === 'number' ? record.status : undefined;
    const url = typeof record.url === 'string' ? record.url : undefined;
    const metadata = isToolResultRecord(record.metadata) ? record.metadata : null;
    const metadataTitle = typeof metadata?.title === 'string' ? metadata.title : undefined;
    const text = typeof record.text === 'string' ? record.text : undefined;
    const body = record.body;
    const hasObjectBody = body !== null && typeof body === 'object';
    return (
      <div className="space-y-3">
        {status && (
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-0.5 text-xs font-medium rounded ${
                status >= 200 && status < 300
                  ? 'bg-green-500/10 text-green-500'
                  : status >= 400
                    ? 'bg-red-500/10 text-red-500'
                    : 'bg-yellow-500/10 text-yellow-500'
              }`}
            >
              {status}
            </span>
            {isSafeUrl(url) && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline truncate"
              >
                {url}
              </a>
            )}
          </div>
        )}
        {metadataTitle && (
          <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            {metadataTitle}
          </p>
        )}
        {text && (
          <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded max-h-64 overflow-y-auto">
            <p className="text-sm text-text-secondary dark:text-dark-text-secondary whitespace-pre-wrap">
              {text.slice(0, 1000)}
              {text.length > 1000 && '...'}
            </p>
          </div>
        )}
        {hasObjectBody && (
          <CodeBlock code={JSON.stringify(body, null, 2)} language="json" maxHeight="300px" />
        )}
      </div>
    );
  }

  // Search results
  if (baseName === 'search_web' && record && Array.isArray(record.results)) {
    const results = record.results as SearchResultItem[];
    return (
      <div className="space-y-2">
        {results.map((item, i) => (
          <a
            key={i}
            href={isSafeUrl(item.url) ? item.url : '#'}
            target="_blank"
            rel="noopener noreferrer"
            className="block p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded hover:bg-primary/10 transition-colors"
          >
            <p className="text-sm font-medium text-primary">{item.title}</p>
            <p className="text-xs text-text-muted dark:text-dark-text-muted truncate mt-1">
              {item.url}
            </p>
            {item.snippet && (
              <p className="text-sm text-text-secondary dark:text-dark-text-secondary mt-2 line-clamp-2">
                {item.snippet}
              </p>
            )}
          </a>
        ))}
      </div>
    );
  }

  // Default display - detect JSON strings
  const isObject = typeof result === 'object';
  const resultStr = isObject ? JSON.stringify(result, null, 2) : String(result);
  const isJsonString =
    !isObject &&
    typeof result === 'string' &&
    (() => {
      const trimmed = result.trim();
      if (
        (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
        (trimmed.startsWith('[') && trimmed.endsWith(']'))
      ) {
        try {
          return JSON.stringify(JSON.parse(trimmed), null, 2);
        } catch {
          return null;
        }
      }
      return null;
    })();

  return (
    <CodeBlock
      code={isJsonString || resultStr}
      language={isObject || isJsonString ? 'json' : 'plaintext'}
      showLineNumbers={false}
      maxHeight="300px"
    />
  );
}

function getToolCategory(name: string): string {
  // Extension and skill tools get their own categories
  if (name.startsWith('ext.')) return 'Extension';
  if (name.startsWith('skill.')) return 'Skill';
  // Strip namespace prefix for category matching
  const baseName = name.includes('.') ? name.substring(name.lastIndexOf('.') + 1) : name;
  if (
    baseName.startsWith('read_') ||
    baseName.startsWith('write_') ||
    baseName.includes('file') ||
    baseName.includes('directory')
  ) {
    return 'File System';
  }
  if (
    baseName.startsWith('execute_') ||
    baseName.includes('compile') ||
    baseName.includes('package')
  ) {
    return 'Code Execution';
  }
  if (
    baseName.includes('http') ||
    baseName.includes('web') ||
    baseName.includes('fetch') ||
    baseName.includes('api')
  ) {
    return 'Web & API';
  }
  return 'Other';
}

/**
 * Detect if a tool result indicates local (non-sandboxed) execution.
 * Checks both object and JSON string results.
 */
export function isLocalExecution(result: unknown): boolean {
  if (!result) return false;

  // Direct object with sandboxed field
  if (typeof result === 'object' && result !== null && 'sandboxed' in result) {
    return (result as { sandboxed?: unknown }).sandboxed === false;
  }

  // JSON string result — try parsing
  if (typeof result === 'string') {
    try {
      const parsed = JSON.parse(result);
      if (typeof parsed === 'object' && parsed !== null && 'sandboxed' in parsed) {
        return (parsed as { sandboxed?: unknown }).sandboxed === false;
      }
    } catch {
      /* not JSON */
    }
  }

  return false;
}

/** Only allow http/https URLs to prevent javascript: XSS */
function isSafeUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    json: 'json',
    html: 'html',
    css: 'css',
    md: 'markdown',
    sh: 'bash',
    bash: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
  };
  return langMap[ext] || 'plaintext';
}

// =============================================================================
// Image tool result helpers
// =============================================================================

const IMAGE_TOOLS = new Set([
  'resize_image',
  'generate_image',
  'edit_image',
  'image_variation',
  'analyze_image',
]);

/** Narrowed type for image tool results after isImageToolResult guard */
type ImageToolResult = { output?: unknown; outputPath?: unknown; source?: unknown };

function isImageToolResult(baseName: string, result: unknown): result is ImageToolResult {
  if (!IMAGE_TOOLS.has(baseName)) return false;
  if (typeof result !== 'object' || result === null) return false;
  const r = result as ImageToolResult;
  return !!(r.output || r.outputPath || r.source);
}

export function resolveWorkspaceImageUrl(
  path: string | undefined,
  workspaceId?: string | null
): string | null {
  if (!path) return null;
  const resolved = resolveImageUrl(path, workspaceId);
  if (resolved === BLOCKED_IMG_PLACEHOLDER) return null;
  if (!workspaceId && resolved === path && !/^https?:\/\//i.test(path) && !path.startsWith('//')) {
    return null;
  }
  return resolved;
}

function ToolImagePreview({ src, alt }: { src: string; alt: string }) {
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);

  if (error) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-text-muted dark:text-dark-text-muted">
        [Image: {alt || src}]
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded(true)}
        aria-label={alt ? `Expand image: ${alt}` : 'Expand image'}
        className="block rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
      >
        <img
          src={src}
          alt={alt}
          onError={() => setError(true)}
          className="max-w-sm max-h-64 rounded-lg border border-border dark:border-dark-border"
          loading="lazy"
        />
      </button>
      {expanded && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Expanded image"
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setExpanded(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 cursor-pointer outline-none"
          onClick={() => setExpanded(false)}
        >
          <img src={src} alt={alt} className="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl" />
        </div>
      )}
    </>
  );
}
