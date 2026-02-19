/**
 * Tool Palette — left panel in the workflow editor.
 * Groups tools by source (Core, MCP, Custom, Plugin) with category sub-groups.
 * Supports both drag-to-canvas and click-to-add via "+" button.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toolsApi } from '../../api';
import type { Tool } from '../../types';
import {
  Search, ChevronDown, ChevronRight, Wrench, Plus,
  Server, Sparkles, Puzzle, X,
  Zap, Brain, GitBranch, Terminal, RefreshCw, Repeat,
} from '../icons';

// ============================================================================
// Types
// ============================================================================

type ToolSource = 'core' | 'mcp' | 'custom' | 'plugin';

interface SourceSection {
  source: ToolSource;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;       // Tailwind color classes for the section header
  badgeClass: string;   // Tailwind classes for the count badge
  categories: Map<string, Tool[]>; // category → tools
  totalCount: number;
}

interface ToolCategory {
  info: { icon: string; description: string };
  tools: Tool[];
}

interface ToolPaletteProps {
  className?: string;
  /** Called when user clicks "+" on a tool. If omitted, only drag is available. */
  onAddTool?: (toolName: string, toolDescription?: string) => void;
  /** Called when user clicks a node-type button in the palette. */
  onAddNode?: (nodeType: string) => void;
  /** Whether a trigger node already exists (disables the Trigger button). */
  hasTriggerNode?: boolean;
}

// Node type buttons shown at the top of the palette
const NODE_TYPES: Array<{
  type: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  bg: string;
  text: string;
  border: string;
}> = [
  { type: 'triggerNode',     label: 'Trigger',   icon: Zap,       bg: 'bg-violet-100 dark:bg-violet-900/30', text: 'text-violet-700 dark:text-violet-300',   border: 'border-violet-300 dark:border-violet-700' },
  { type: 'llmNode',         label: 'LLM',       icon: Brain,     bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-300',   border: 'border-indigo-300 dark:border-indigo-700' },
  { type: 'conditionNode',   label: 'If/Else',   icon: GitBranch, bg: 'bg-emerald-100 dark:bg-emerald-900/30', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-300 dark:border-emerald-700' },
  { type: 'codeNode',        label: 'Code',      icon: Terminal,  bg: 'bg-teal-100 dark:bg-teal-900/30',    text: 'text-teal-700 dark:text-teal-300',       border: 'border-teal-300 dark:border-teal-700' },
  { type: 'transformerNode', label: 'Transform',  icon: RefreshCw, bg: 'bg-amber-100 dark:bg-amber-900/30',  text: 'text-amber-700 dark:text-amber-300',     border: 'border-amber-300 dark:border-amber-700' },
  { type: 'forEachNode',     label: 'ForEach',   icon: Repeat,    bg: 'bg-sky-100 dark:bg-sky-900/30',      text: 'text-sky-700 dark:text-sky-300',         border: 'border-sky-300 dark:border-sky-700' },
];

// ============================================================================
// Source detection from namespace prefix
// ============================================================================

function getToolSource(name: string): ToolSource {
  if (name.startsWith('mcp.')) return 'mcp';
  if (name.startsWith('custom.')) return 'custom';
  if (name.startsWith('plugin.')) return 'plugin';
  return 'core'; // core.*, gateway tools, unprefixed meta-tools
}

/** Extract the middle part of a namespaced tool: mcp.serverName.tool → serverName */
function getNamespaceMiddle(name: string): string | undefined {
  const parts = name.split('.');
  return parts.length >= 3 ? parts[1] : undefined;
}

const SOURCE_ORDER: ToolSource[] = ['core', 'mcp', 'custom', 'plugin'];

// Tools excluded from the workflow palette — meta-tools, management tools, and
// tools that create recursion (plan/trigger/workflow management).
const WORKFLOW_EXCLUDED_TOOLS = new Set([
  // Meta-tools (LLM native API, not useful as workflow nodes)
  'search_tools', 'get_tool_help', 'use_tool', 'batch_use_tool',
  // Dynamic tool management
  'create_tool', 'list_custom_tools', 'delete_custom_tool', 'toggle_custom_tool',
  'inspect_tool_source', 'update_custom_tool',
  // Trigger management (workflows already have trigger nodes)
  'create_trigger', 'list_triggers', 'enable_trigger', 'fire_trigger',
  'delete_trigger', 'trigger_stats',
  // Plan management (workflows ARE plans — recursive)
  'create_plan', 'add_plan_step', 'list_plans', 'get_plan_details',
  'execute_plan', 'pause_plan', 'delete_plan',
  // Extension management
  'list_extensions', 'toggle_extension', 'get_extension_info',
  // Heartbeat management (use trigger node instead)
  'create_heartbeat', 'list_heartbeats', 'update_heartbeat', 'delete_heartbeat',
  // Scheduler (use trigger node instead)
  'create_scheduled_task', 'list_scheduled_tasks', 'update_scheduled_task',
  'delete_scheduled_task', 'get_task_history', 'trigger_task',
]);

/** Extract base name from namespaced tool: 'core.get_time' → 'get_time' */
function getToolBaseName(name: string): string {
  return name.includes('.') ? name.split('.').pop()! : name;
}

const SOURCE_CONFIG: Record<ToolSource, {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  badgeClass: string;
}> = {
  core: {
    label: 'Built-in',
    icon: Wrench,
    accent: 'text-blue-600 dark:text-blue-400',
    badgeClass: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
  },
  mcp: {
    label: 'MCP Servers',
    icon: Server,
    accent: 'text-emerald-600 dark:text-emerald-400',
    badgeClass: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  },
  custom: {
    label: 'Custom Tools',
    icon: Sparkles,
    accent: 'text-amber-600 dark:text-amber-400',
    badgeClass: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  },
  plugin: {
    label: 'Plugins',
    icon: Puzzle,
    accent: 'text-purple-600 dark:text-purple-400',
    badgeClass: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
  },
};

// ============================================================================
// Category display names
// ============================================================================

const CATEGORY_NAMES: Record<string, string> = {
  core: 'General',
  filesystem: 'File System',
  tasks: 'Tasks',
  bookmarks: 'Bookmarks',
  notes: 'Notes',
  calendar: 'Calendar',
  contacts: 'Contacts',
  customData: 'Custom Data',
  memory: 'Memory',
  goals: 'Goals',
  textUtils: 'Text Utils',
  dateTime: 'Date & Time',
  conversion: 'Conversion',
  generation: 'Generation',
  extraction: 'Extraction',
  validation: 'Validation',
  listOps: 'List Operations',
  mathStats: 'Math & Stats',
  codeExecution: 'Code Execution',
  webFetch: 'Web',
  email: 'Email',
  weather: 'Weather',
  git: 'Git',
  image: 'Image',
  audio: 'Audio',
  pdf: 'PDF',
  translation: 'Translation',
  vectorSearch: 'Vector Search',
  dataExtraction: 'Data Extraction',
  customTools: 'Custom',
  plugins: 'Plugins',
  automation: 'Automation',
  MCP: 'MCP',
  Custom: 'Custom',
  other: 'Other',
};

function getCategoryLabel(cat: string): string {
  return CATEGORY_NAMES[cat] ?? cat.replace(/([A-Z])/g, ' $1').trim();
}

/** Label for a sub-group — category name for core, server/plugin name for MCP/plugin */
function getSubGroupLabel(subKey: string, source: ToolSource): string {
  if (source === 'core' || source === 'custom') {
    return getCategoryLabel(subKey);
  }
  // MCP server name or plugin ID — title-case it
  return subKey
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================================
// Component
// ============================================================================

export function ToolPalette({ className = '', onAddTool, onAddNode, hasTriggerNode }: ToolPaletteProps) {
  const [groupedData, setGroupedData] = useState<Record<string, ToolCategory>>({});
  const [search, setSearch] = useState('');
  const [openSources, setOpenSources] = useState<Set<ToolSource>>(new Set(['core']));
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);

  // Fetch tools grouped by category (includes all sources)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await toolsApi.listGrouped();
        if (!cancelled) {
          setGroupedData(data.categories);
          // Auto-open first few core categories
          const keys = Object.keys(data.categories).slice(0, 3).map((k) => `core:${k}`);
          setOpenCategories(new Set(keys));
        }
      } catch {
        // Non-critical
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Build source-based sections from category-grouped data
  const sections = useMemo(() => {
    // Flatten all tools from categories, excluding non-workflow tools
    const allTools: (Tool & { categoryKey: string })[] = [];
    for (const [catKey, cat] of Object.entries(groupedData)) {
      for (const tool of cat.tools) {
        if (!WORKFLOW_EXCLUDED_TOOLS.has(getToolBaseName(tool.name))) {
          allTools.push({ ...tool, categoryKey: catKey });
        }
      }
    }

    // Group by source → sub-group
    // Core tools: sub-grouped by category (filesystem, memory, etc.)
    // MCP tools: sub-grouped by server name (mcp.{serverName}.tool)
    // Plugin tools: sub-grouped by plugin ID (plugin.{pluginId}.tool)
    // Custom tools: sub-grouped by category
    const sourceMap = new Map<ToolSource, Map<string, Tool[]>>();
    for (const tool of allTools) {
      const src = getToolSource(tool.name);
      if (!sourceMap.has(src)) sourceMap.set(src, new Map());
      const subMap = sourceMap.get(src)!;

      // Determine sub-group key
      let subKey: string;
      if (src === 'mcp' || src === 'plugin') {
        // Extract server/plugin name from namespace: mcp.serverName.tool → serverName
        subKey = getNamespaceMiddle(tool.name) ?? tool.categoryKey;
      } else {
        subKey = tool.categoryKey;
      }

      if (!subMap.has(subKey)) subMap.set(subKey, []);
      subMap.get(subKey)!.push(tool);
    }

    // Build sections in order
    const result: SourceSection[] = [];
    for (const src of SOURCE_ORDER) {
      const categories = sourceMap.get(src);
      if (!categories || categories.size === 0) continue;

      let totalCount = 0;
      for (const tools of categories.values()) totalCount += tools.length;

      const config = SOURCE_CONFIG[src];
      result.push({
        source: src,
        label: config.label,
        icon: config.icon,
        accent: config.accent,
        badgeClass: config.badgeClass,
        categories,
        totalCount,
      });
    }

    return result;
  }, [groupedData]);

  // Filter by search
  const filteredSections = useMemo(() => {
    if (!search) return sections;

    const lowerSearch = search.toLowerCase();
    return sections.reduce<SourceSection[]>((acc, section) => {
      const filteredCategories = new Map<string, Tool[]>();
      let totalCount = 0;

      for (const [catKey, tools] of section.categories) {
        const filtered = tools.filter(
          (t) =>
            formatToolName(t.name).toLowerCase().includes(lowerSearch) ||
            t.name.toLowerCase().includes(lowerSearch) ||
            t.description?.toLowerCase().includes(lowerSearch),
        );
        if (filtered.length > 0) {
          filteredCategories.set(catKey, filtered);
          totalCount += filtered.length;
        }
      }

      if (totalCount > 0) {
        acc.push({ ...section, categories: filteredCategories, totalCount });
      }
      return acc;
    }, []);
  }, [sections, search]);

  // Toggle helpers
  const toggleSource = useCallback((src: ToolSource) => {
    setOpenSources((prev) => {
      const next = new Set(prev);
      if (next.has(src)) next.delete(src);
      else next.add(src);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((key: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Drag start handler
  const onDragStart = useCallback((e: React.DragEvent, toolName: string, toolDescription?: string) => {
    e.dataTransfer.setData('application/reactflow', JSON.stringify({ toolName, toolDescription }));
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  // Total tool count
  const totalTools = sections.reduce((sum, s) => sum + s.totalCount, 0);

  return (
    <div className={`flex flex-col border-r border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}>
      {/* Header */}
      <div className="p-3 border-b border-border dark:border-dark-border">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            Tools
          </h3>
          {!isLoading && (
            <span className="text-[10px] text-text-muted">{totalTools} available</span>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools..."
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-primary"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Node type buttons */}
      {onAddNode && (
        <div className="px-3 py-2.5 border-b border-border dark:border-dark-border">
          <p className="text-[10px] font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider mb-2">
            Nodes
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {NODE_TYPES.map((nt) => {
              const Icon = nt.icon;
              const disabled = nt.type === 'triggerNode' && hasTriggerNode;
              return (
                <button
                  key={nt.type}
                  onClick={() => onAddNode(nt.type)}
                  disabled={disabled}
                  className={`flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium rounded-md border transition-colors ${nt.bg} ${nt.text} ${nt.border} hover:opacity-80 disabled:opacity-40`}
                  title={disabled ? 'Trigger node already exists' : `Add ${nt.label} node`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {nt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tool list by source */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded animate-pulse" />
            ))}
          </div>
        ) : filteredSections.length === 0 ? (
          <p className="text-xs text-text-muted dark:text-dark-text-muted text-center py-8">
            {search ? 'No tools match your search' : 'No tools available'}
          </p>
        ) : (
          <div className="py-1">
            {filteredSections.map((section) => {
              const isSourceOpen = openSources.has(section.source) || !!search;
              const SrcIcon = section.icon;

              return (
                <div key={section.source}>
                  {/* Source header */}
                  <button
                    onClick={() => toggleSource(section.source)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                  >
                    {isSourceOpen ? (
                      <ChevronDown className="w-3 h-3 text-text-muted shrink-0" />
                    ) : (
                      <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
                    )}
                    <SrcIcon className={`w-3.5 h-3.5 shrink-0 ${section.accent}`} />
                    <span className={section.accent}>{section.label}</span>
                    <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full font-medium ${section.badgeClass}`}>
                      {section.totalCount}
                    </span>
                  </button>

                  {/* Categories within source */}
                  {isSourceOpen && (
                    <div className="pb-1">
                      {section.categories.size > 1 || (section.categories.size === 1 && section.source === 'core') ? (
                        /* Show collapsible sub-groups */
                        [...section.categories.entries()]
                          .sort(([a], [b]) => getSubGroupLabel(a, section.source).localeCompare(getSubGroupLabel(b, section.source)))
                          .map(([subKey, tools]) => {
                            const isCatOpen = openCategories.has(`${section.source}:${subKey}`) || !!search;
                            const subLabel = getSubGroupLabel(subKey, section.source);
                            return (
                              <div key={subKey}>
                                <button
                                  onClick={() => toggleCategory(`${section.source}:${subKey}`)}
                                  className="w-full flex items-center gap-1.5 pl-8 pr-3 py-1 text-[11px] font-medium text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                                >
                                  {isCatOpen ? (
                                    <ChevronDown className="w-2.5 h-2.5 shrink-0" />
                                  ) : (
                                    <ChevronRight className="w-2.5 h-2.5 shrink-0" />
                                  )}
                                  <span className="truncate">{subLabel}</span>
                                  <span className="ml-auto text-text-muted text-[10px]">{tools.length}</span>
                                </button>
                                {isCatOpen && (
                                  <div className="ml-6">
                                    {tools.map((tool) => (
                                      <ToolItem
                                        key={tool.name}
                                        tool={tool}
                                        onDragStart={onDragStart}
                                        onAddTool={onAddTool}
                                      />
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })
                      ) : (
                        /* Single sub-group or few tools — flat list */
                        <div className="ml-4">
                          {[...section.categories.values()]
                            .flat()
                            .sort((a, b) => formatToolName(a.name).localeCompare(formatToolName(b.name)))
                            .map((tool) => (
                              <ToolItem
                                key={tool.name}
                                tool={tool}
                                onDragStart={onDragStart}
                                onAddTool={onAddTool}
                              />
                            ))}
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

      {/* Footer */}
      <div className="p-3 border-t border-border dark:border-dark-border">
        <p className="text-[10px] text-text-muted dark:text-dark-text-muted leading-relaxed">
          Drag tools onto the canvas or click <Plus className="w-2.5 h-2.5 inline" /> to add.
          Connect nodes by drawing edges between handles.
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Tool Item — individual tool row
// ============================================================================

function ToolItem({
  tool,
  onDragStart,
  onAddTool,
}: {
  tool: Tool;
  onDragStart: (e: React.DragEvent, name: string, desc?: string) => void;
  onAddTool?: (name: string, desc?: string) => void;
}) {
  const displayName = formatToolName(tool.name);

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, tool.name, tool.description)}
      className="flex items-center gap-1.5 pl-3 pr-1.5 py-1.5 text-xs rounded cursor-grab active:cursor-grabbing hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors group"
      title={tool.description || tool.name}
    >
      <Wrench className="w-3 h-3 text-text-muted shrink-0 group-hover:text-primary transition-colors" />
      <div className="flex-1 min-w-0">
        <span className="text-text-primary dark:text-dark-text-primary truncate block leading-tight">
          {displayName}
        </span>
      </div>
      {onAddTool && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAddTool(tool.name, tool.description);
          }}
          className="p-1 rounded opacity-0 group-hover:opacity-100 text-text-muted hover:text-primary hover:bg-primary/10 transition-all shrink-0"
          title={`Add ${displayName} to canvas`}
        >
          <Plus className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ============================================================================
// Helpers
// ============================================================================

/** Strip namespace prefix (e.g. 'core.get_time' → 'Get Time') and title-case */
function formatToolName(name: string): string {
  const base = name.includes('.') ? name.split('.').pop()! : name;
  return base
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

