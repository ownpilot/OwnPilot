/**
 * NodeSearchPalette — Ctrl+K quick-add modal for workflow nodes.
 * Fuzzy-searches NODE_TYPES and available tools, adds to canvas on select.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Search, X, Zap, Brain, GitBranch, Terminal, RefreshCw, Repeat, Globe, Clock, Shuffle, ShieldAlert, ShieldCheck, StickyNote, Bell, Columns, GitMerge, Wrench } from '../icons';

export interface SearchableItem {
  type: 'node' | 'tool';
  nodeType?: string;
  toolName?: string;
  label: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

// Built-in node types for search
const NODE_ITEMS: SearchableItem[] = [
  { type: 'node', nodeType: 'triggerNode', label: 'Trigger', icon: Zap, color: 'text-violet-500' },
  { type: 'node', nodeType: 'llmNode', label: 'LLM', icon: Brain, color: 'text-indigo-500' },
  { type: 'node', nodeType: 'conditionNode', label: 'If/Else Condition', icon: GitBranch, color: 'text-emerald-500' },
  { type: 'node', nodeType: 'codeNode', label: 'Code', icon: Terminal, color: 'text-teal-500' },
  { type: 'node', nodeType: 'transformerNode', label: 'Transform', icon: RefreshCw, color: 'text-amber-500' },
  { type: 'node', nodeType: 'forEachNode', label: 'ForEach Loop', icon: Repeat, color: 'text-sky-500' },
  { type: 'node', nodeType: 'httpRequestNode', label: 'HTTP Request', icon: Globe, color: 'text-orange-500' },
  { type: 'node', nodeType: 'delayNode', label: 'Delay', icon: Clock, color: 'text-rose-500' },
  { type: 'node', nodeType: 'switchNode', label: 'Switch', icon: Shuffle, color: 'text-fuchsia-500' },
  { type: 'node', nodeType: 'errorHandlerNode', label: 'Error Handler', icon: ShieldAlert, color: 'text-red-500' },
  { type: 'node', nodeType: 'subWorkflowNode', label: 'Sub-Workflow', icon: GitBranch, color: 'text-indigo-500' },
  { type: 'node', nodeType: 'approvalNode', label: 'Approval Gate', icon: ShieldCheck, color: 'text-amber-500' },
  { type: 'node', nodeType: 'stickyNoteNode', label: 'Sticky Note', icon: StickyNote, color: 'text-yellow-500' },
  { type: 'node', nodeType: 'notificationNode', label: 'Notification', icon: Bell, color: 'text-purple-500' },
  { type: 'node', nodeType: 'parallelNode', label: 'Parallel Branches', icon: Columns, color: 'text-teal-500' },
  { type: 'node', nodeType: 'mergeNode', label: 'Merge / Wait', icon: GitMerge, color: 'text-teal-500' },
];

interface NodeSearchPaletteProps {
  toolNames: string[];
  onAddNode: (nodeType: string) => void;
  onAddTool: (toolName: string) => void;
  onClose: () => void;
  hasTriggerNode?: boolean;
}

export function NodeSearchPalette({
  toolNames,
  onAddNode,
  onAddTool,
  onClose,
  hasTriggerNode,
}: NodeSearchPaletteProps) {
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Build full search list: node types + tools
  const allItems = useMemo(() => {
    const items: SearchableItem[] = [...NODE_ITEMS];
    for (const name of toolNames) {
      // Format tool name for display
      const baseName = name.includes('.') ? name.split('.').pop()! : name;
      const label = baseName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      items.push({
        type: 'tool',
        toolName: name,
        label,
        description: name,
        icon: Wrench,
        color: 'text-blue-500',
      });
    }
    return items;
  }, [toolNames]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!search) return allItems.slice(0, 20); // Show top 20 by default
    const lower = search.toLowerCase();
    return allItems
      .filter(
        (item) =>
          item.label.toLowerCase().includes(lower) ||
          item.toolName?.toLowerCase().includes(lower) ||
          item.nodeType?.toLowerCase().includes(lower) ||
          item.description?.toLowerCase().includes(lower)
      )
      .slice(0, 20);
  }, [allItems, search]);

  // Clamp selected index
  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered, selectedIndex]);

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Scroll selected item into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (item: SearchableItem) => {
      if (item.type === 'node' && item.nodeType) {
        if (item.nodeType === 'triggerNode' && hasTriggerNode) return;
        onAddNode(item.nodeType);
      } else if (item.type === 'tool' && item.toolName) {
        onAddTool(item.toolName);
      }
      onClose();
    },
    [onAddNode, onAddTool, onClose, hasTriggerNode]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = filtered[selectedIndex];
        if (item) handleSelect(item);
      } else if (e.key === 'Escape') {
        onClose();
      }
    },
    [filtered, selectedIndex, handleSelect, onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" />

      {/* Modal */}
      <div
        className="relative w-full max-w-md bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border">
          <Search className="w-4 h-4 text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search nodes and tools..."
            className="flex-1 bg-transparent text-sm text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none"
          />
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-sm text-text-muted text-center">No results found</p>
          ) : (
            filtered.map((item, i) => {
              const Icon = item.icon;
              const disabled =
                item.type === 'node' && item.nodeType === 'triggerNode' && hasTriggerNode;
              return (
                <button
                  key={item.nodeType ?? item.toolName ?? i}
                  onClick={() => !disabled && handleSelect(item)}
                  disabled={disabled}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                    i === selectedIndex
                      ? 'bg-primary/10 dark:bg-primary/20'
                      : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                  } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${item.color}`} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-text-primary dark:text-dark-text-primary block truncate">
                      {item.label}
                    </span>
                    {item.type === 'tool' && item.toolName && (
                      <span className="text-[10px] text-text-muted truncate block">
                        {item.toolName}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted shrink-0 uppercase">
                    {item.type}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border dark:border-dark-border text-[10px] text-text-muted flex items-center gap-3">
          <span>
            <kbd className="px-1 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-[9px]">
              ↑↓
            </kbd>{' '}
            Navigate
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-[9px]">
              Enter
            </kbd>{' '}
            Add
          </span>
          <span>
            <kbd className="px-1 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-[9px]">
              Esc
            </kbd>{' '}
            Close
          </span>
        </div>
      </div>
    </div>
  );
}
