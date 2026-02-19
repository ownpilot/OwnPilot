/**
 * JsonTreeView — reusable interactive JSON tree viewer.
 * Renders any JSON value as a collapsible tree with type badges and copy buttons.
 * Used by OutputTreeBrowser (with template insert) and Results tab (read-only browse).
 */

import { useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Copy, Check } from '../icons';

export const typeColors: Record<string, string> = {
  string: 'bg-green-500/10 text-green-500',
  number: 'bg-blue-500/10 text-blue-500',
  boolean: 'bg-amber-500/10 text-amber-500',
  array: 'bg-cyan-500/10 text-cyan-500',
  object: 'bg-orange-500/10 text-orange-500',
  null: 'bg-gray-500/10 text-gray-500',
};

export function detectType(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function truncateValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  return str.length > 30 ? str.slice(0, 28) + '\u2026' : str;
}

/** Try to parse a JSON string into an object/array. Returns null if not JSON. */
function tryParseJson(value: unknown): Record<string, unknown> | unknown[] | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if ((!trimmed.startsWith('{') || !trimmed.endsWith('}')) &&
      (!trimmed.startsWith('[') || !trimmed.endsWith(']'))) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed === 'object' && parsed !== null) return parsed;
  } catch { /* not JSON */ }
  return null;
}

interface JsonTreeViewProps {
  data: unknown;
  /** Optional — if provided, clicking a leaf calls this with the dot-path string */
  onClickPath?: (path: string) => void;
  /** Optional prefix for paths (e.g. "node_1.output") */
  pathPrefix?: string;
  /** Max depth to render (default 6) */
  maxDepth?: number;
}

export function JsonTreeView({ data, onClickPath, pathPrefix, maxDepth = 6 }: JsonTreeViewProps) {
  if (data === undefined || data === null) {
    return <span className="text-[10px] text-text-muted italic">null</span>;
  }

  // Auto-parse JSON strings at root level
  const parsed = tryParseJson(data);
  const resolved = parsed ?? data;
  const type = detectType(resolved);

  if (type === 'object' && !Array.isArray(resolved)) {
    return <TreeObject value={resolved as Record<string, unknown>} path={[]} depth={0} onClickPath={onClickPath} pathPrefix={pathPrefix} maxDepth={maxDepth} />;
  }
  if (type === 'array') {
    return <TreeArray value={resolved as unknown[]} path={[]} depth={0} onClickPath={onClickPath} pathPrefix={pathPrefix} maxDepth={maxDepth} />;
  }

  // Primitive root value
  return (
    <TreeLeaf
      keyName={pathPrefix?.split('.').pop() ?? 'value'}
      value={resolved}
      path={[]}
      depth={0}
      onClickPath={onClickPath}
      pathPrefix={pathPrefix}
      maxDepth={maxDepth}
    />
  );
}

interface TreeCtx {
  onClickPath?: (path: string) => void;
  pathPrefix?: string;
  maxDepth: number;
}

interface TreeNodeProps extends TreeCtx {
  path: string[];
  depth: number;
}

function buildFullPath(prefix: string | undefined, path: string[]): string {
  const parts = prefix ? [prefix, ...path] : path;
  return parts.join('.');
}

function TreeObject({ value, path, depth, ...ctx }: TreeNodeProps & { value: Record<string, unknown> }) {
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return <span className="text-[10px] text-text-muted pl-2">{'{}'}</span>;
  }
  return (
    <div>
      {keys.map((key) => (
        <TreeValue key={key} keyName={key} value={value[key]} path={[...path, key]} depth={depth} {...ctx} />
      ))}
    </div>
  );
}

function TreeArray({ value, path, depth, ...ctx }: TreeNodeProps & { value: unknown[] }) {
  if (value.length === 0) {
    return <span className="text-[10px] text-text-muted pl-2">{'[]'}</span>;
  }
  return (
    <div>
      {value.map((item, i) => (
        <TreeValue key={i} keyName={`[${i}]`} value={item} path={[...path, String(i)]} depth={depth} {...ctx} />
      ))}
    </div>
  );
}

function TreeValue({ keyName, value, path, depth, ...ctx }: TreeNodeProps & { keyName: string; value: unknown }) {
  if (depth > ctx.maxDepth) return null;

  // Auto-parse nested JSON strings into expandable trees
  const parsed = tryParseJson(value);
  const resolved = parsed ?? value;
  const type = detectType(resolved);
  const isExpandable = (type === 'object' || type === 'array') && resolved !== null;

  if (isExpandable) {
    return <CollapsibleNode keyName={keyName} value={resolved} type={type} path={path} depth={depth} {...ctx} />;
  }

  return <TreeLeaf keyName={keyName} value={resolved} path={path} depth={depth} {...ctx} />;
}

function CollapsibleNode({
  keyName,
  value,
  type,
  path,
  depth,
  onClickPath,
  pathPrefix,
  maxDepth,
}: TreeNodeProps & { keyName: string; value: unknown; type: string }) {
  const [isOpen, setIsOpen] = useState(depth < 2);
  const fullPath = buildFullPath(pathPrefix, path);
  const childCount = Array.isArray(value) ? value.length : Object.keys(value as Record<string, unknown>).length;
  const clickable = !!onClickPath;

  return (
    <div style={{ paddingLeft: depth * 12 }}>
      <div className="group flex items-center gap-1 px-1 py-0.5 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary">
        <button onClick={() => setIsOpen(!isOpen)} className="shrink-0 p-0.5">
          {isOpen ? <ChevronDown className="w-2.5 h-2.5 text-text-muted" /> : <ChevronRight className="w-2.5 h-2.5 text-text-muted" />}
        </button>
        <span
          className={`text-[11px] font-mono text-text-primary dark:text-dark-text-primary ${clickable ? 'cursor-pointer hover:text-primary' : ''}`}
          onClick={clickable ? () => onClickPath!(`{{${fullPath}}}`) : undefined}
        >
          {keyName}
        </span>
        <span className={`px-1 py-0 text-[9px] font-medium rounded font-mono ${typeColors[type] ?? typeColors.null}`}>
          {type}
        </span>
        <span className="text-[9px] text-text-muted">{childCount} items</span>
        <CopyBtn text={fullPath ? `{{${fullPath}}}` : JSON.stringify(value)} className="ml-auto" />
      </div>
      {isOpen && (
        type === 'array'
          ? <TreeArray value={value as unknown[]} path={path} depth={depth + 1} onClickPath={onClickPath} pathPrefix={pathPrefix} maxDepth={maxDepth} />
          : <TreeObject value={value as Record<string, unknown>} path={path} depth={depth + 1} onClickPath={onClickPath} pathPrefix={pathPrefix} maxDepth={maxDepth} />
      )}
    </div>
  );
}

function TreeLeaf({
  keyName,
  value,
  path,
  depth,
  onClickPath,
  pathPrefix,
}: TreeNodeProps & { keyName: string; value: unknown }) {
  const type = detectType(value);
  const fullPath = buildFullPath(pathPrefix, path);
  const clickable = !!onClickPath;
  const copyText = fullPath ? `{{${fullPath}}}` : String(value);

  return (
    <div
      style={{ paddingLeft: depth * 12 + 16 }}
      className={`group flex items-center gap-1 px-1 py-0.5 rounded transition-colors ${
        clickable ? 'cursor-pointer hover:bg-primary/10' : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
      }`}
      onClick={clickable ? () => onClickPath!(`{{${fullPath}}}`) : undefined}
      title={clickable ? `Insert {{${fullPath}}}` : String(value)}
    >
      <span className="text-[11px] font-mono text-text-primary dark:text-dark-text-primary">{keyName}</span>
      <span className={`px-1 py-0 text-[9px] font-medium rounded font-mono ${typeColors[type] ?? typeColors.null}`}>
        {type}
      </span>
      <span className="text-[10px] text-text-muted dark:text-dark-text-muted truncate flex-1">
        {truncateValue(value)}
      </span>
      <CopyBtn text={copyText} className="ml-auto" />
    </div>
  );
}

function CopyBtn({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`opacity-0 group-hover:opacity-100 p-0.5 transition-opacity ${className}`}
      title={copied ? 'Copied!' : 'Copy'}
    >
      {copied ? (
        <Check className="w-2.5 h-2.5 text-green-400" />
      ) : (
        <Copy className="w-2.5 h-2.5 text-text-muted" />
      )}
    </button>
  );
}
