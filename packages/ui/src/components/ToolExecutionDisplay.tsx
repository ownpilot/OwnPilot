import { useState } from 'react';
import {
  Wrench,
  Check,
  XCircle,
  ChevronDown,
  ChevronRight,
  Clock,
  File,
  Globe,
  Terminal,
} from './icons';
import { CodeBlock } from './CodeBlock';

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  result?: any;
  status?: 'pending' | 'running' | 'success' | 'error';
  duration?: number;
  error?: string;
}

interface ToolExecutionDisplayProps {
  toolCalls: ToolCall[];
  onRerun?: (toolCall: ToolCall) => void;
}

export function ToolExecutionDisplay({ toolCalls, onRerun }: ToolExecutionDisplayProps) {
  return (
    <div className="space-y-2 mt-3">
      {toolCalls.map((call) => (
        <ToolCallCard key={call.id} toolCall={call} onRerun={onRerun} />
      ))}
    </div>
  );
}

interface ToolCallCardProps {
  toolCall: ToolCall;
  onRerun?: (toolCall: ToolCall) => void;
}

function ToolCallCard({ toolCall, onRerun }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showArgs, setShowArgs] = useState(false);

  // Note: getToolIcon is available for future use
  const category = getToolCategory(toolCall.name);
  const status = toolCall.status ?? (toolCall.error ? 'error' : 'success');

  return (
    <div className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
      >
        {/* Status Icon */}
        <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          status === 'pending' ? 'bg-yellow-500/10 text-yellow-500' :
          status === 'running' ? 'bg-blue-500/10 text-blue-500 animate-pulse' :
          status === 'success' ? 'bg-green-500/10 text-green-500' :
          'bg-red-500/10 text-red-500'
        }`}>
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
          </div>
          {toolCall.duration !== undefined && (
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              Completed in {toolCall.duration}ms
            </span>
          )}
        </div>

        {/* Expand/Collapse */}
        <div className="flex-shrink-0 text-text-muted dark:text-dark-text-muted">
          {isExpanded ? (
            <ChevronDown className="w-5 h-5" />
          ) : (
            <ChevronRight className="w-5 h-5" />
          )}
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
              {showArgs ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
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
              <ToolResultDisplay result={toolCall.result} toolName={toolCall.name} />
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
  result: any;
  toolName: string;
}

function ToolResultDisplay({ result, toolName }: ToolResultDisplayProps) {
  // File system tools - show file content
  if (toolName === 'read_file' && typeof result === 'object' && result.content) {
    return (
      <div className="space-y-2">
        {result.path && (
          <div className="flex items-center gap-2 text-sm text-text-muted dark:text-dark-text-muted">
            <File className="w-4 h-4" />
            <span className="font-mono">{result.path}</span>
          </div>
        )}
        <CodeBlock
          code={result.content}
          language={detectLanguage(result.path || '')}
          filename={result.path?.split('/').pop()}
          maxHeight="300px"
        />
      </div>
    );
  }

  // Directory listing
  if (toolName === 'list_directory' && typeof result === 'object' && result.files) {
    return (
      <div className="space-y-1">
        {result.files.map((file: any, i: number) => (
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
                {formatFileSize(file.size)}
              </span>
            )}
          </div>
        ))}
      </div>
    );
  }

  // Code execution results
  if ((toolName.startsWith('execute_') || toolName === 'compile_code') && typeof result === 'object') {
    return (
      <div className="space-y-3">
        {result.stdout && (
          <div>
            <span className="text-xs text-green-500 font-medium">stdout:</span>
            <CodeBlock
              code={result.stdout}
              language="plaintext"
              showLineNumbers={false}
              maxHeight="200px"
            />
          </div>
        )}
        {result.stderr && (
          <div>
            <span className="text-xs text-red-500 font-medium">stderr:</span>
            <CodeBlock
              code={result.stderr}
              language="plaintext"
              showLineNumbers={false}
              maxHeight="200px"
            />
          </div>
        )}
        {result.result !== undefined && (
          <div>
            <span className="text-xs text-blue-500 font-medium">result:</span>
            <pre className="mt-1 p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-sm text-text-primary dark:text-dark-text-primary overflow-x-auto">
              {typeof result.result === 'object'
                ? JSON.stringify(result.result, null, 2)
                : String(result.result)}
            </pre>
          </div>
        )}
        {result.exitCode !== undefined && (
          <div className={`text-xs ${result.exitCode === 0 ? 'text-green-500' : 'text-red-500'}`}>
            Exit code: {result.exitCode}
          </div>
        )}
      </div>
    );
  }

  // Web fetch results
  if ((toolName === 'fetch_web_page' || toolName === 'http_request') && typeof result === 'object') {
    return (
      <div className="space-y-3">
        {result.status && (
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 text-xs font-medium rounded ${
              result.status >= 200 && result.status < 300 ? 'bg-green-500/10 text-green-500' :
              result.status >= 400 ? 'bg-red-500/10 text-red-500' :
              'bg-yellow-500/10 text-yellow-500'
            }`}>
              {result.status}
            </span>
            {result.url && (
              <a
                href={result.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline truncate"
              >
                {result.url}
              </a>
            )}
          </div>
        )}
        {result.metadata?.title && (
          <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            {result.metadata.title}
          </p>
        )}
        {result.text && (
          <div className="p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded max-h-64 overflow-y-auto">
            <p className="text-sm text-text-secondary dark:text-dark-text-secondary whitespace-pre-wrap">
              {result.text.slice(0, 1000)}
              {result.text.length > 1000 && '...'}
            </p>
          </div>
        )}
        {result.body && typeof result.body === 'object' && (
          <CodeBlock
            code={JSON.stringify(result.body, null, 2)}
            language="json"
            maxHeight="300px"
          />
        )}
      </div>
    );
  }

  // Search results
  if (toolName === 'search_web' && typeof result === 'object' && result.results) {
    return (
      <div className="space-y-2">
        {result.results.map((item: any, i: number) => (
          <a
            key={i}
            href={item.url}
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
  const isJsonString = !isObject && typeof result === 'string' && (() => {
    const trimmed = result.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { return JSON.stringify(JSON.parse(trimmed), null, 2); } catch { return null; }
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

// Helper functions - exported for potential reuse
export function getToolIcon(name: string) {
  if (name.startsWith('read_') || name.startsWith('write_') || name.includes('file') || name.includes('directory')) {
    return File;
  }
  if (name.startsWith('execute_') || name.includes('compile') || name.includes('package')) {
    return Terminal;
  }
  if (name.includes('http') || name.includes('web') || name.includes('fetch') || name.includes('api')) {
    return Globe;
  }
  return Wrench;
}

function getToolCategory(name: string): string {
  if (name.startsWith('read_') || name.startsWith('write_') || name.includes('file') || name.includes('directory')) {
    return 'File System';
  }
  if (name.startsWith('execute_') || name.includes('compile') || name.includes('package')) {
    return 'Code Execution';
  }
  if (name.includes('http') || name.includes('web') || name.includes('fetch') || name.includes('api')) {
    return 'Web & API';
  }
  return 'Other';
}

function formatToolName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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
