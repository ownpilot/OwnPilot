import { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Wrench,
  Search,
  X,
  Database,
  Table,
  Bookmark,
  Calendar,
  Users,
  FileText,
  ListChecks,
  BookOpen,
  Upload,
  Link,
  Zap,
  Server,
  Layout,
  Clipboard,
} from './icons';
import { LoadingSpinner } from './LoadingSpinner';
import { toolsApi, customToolsApi, customDataApi } from '../api';
import { extensionsApi } from '../api/endpoints/extensions';
import { composioApi } from '../api/endpoints/composio';
import { mcpApi } from '../api/endpoints/mcp';
import { artifactsApi } from '../api/endpoints/artifacts';
import { chatApi } from '../api/endpoints/chat';

// --- Types ---

export type ResourceType =
  | 'tool'
  | 'custom-tool'
  | 'custom-data'
  | 'builtin-data'
  | 'skill'
  | 'file'
  | 'url'
  | 'composio-action'
  | 'mcp-tool'
  | 'artifact'
  | 'prompt';

type TabId =
  | 'tools'
  | 'custom-data'
  | 'builtin-data'
  | 'skills'
  | 'files'
  | 'url'
  | 'composio'
  | 'mcp'
  | 'artifacts'
  | 'prompts';

export interface ResourceAttachment {
  name: string;
  displayName?: string;
  internalName?: string;
  type: ResourceType;
  toolInstructions: string;
  /** For 'prompt' type — prepended to user message instead of context block */
  promptText?: string;
}

interface ResourceItem {
  name: string;
  displayName?: string;
  internalName?: string;
  description: string;
  category?: string;
  type: ResourceType;
  recordCount?: number;
  parameters?: Record<string, unknown>;
  instructions?: string;
}

interface ToolPickerProps {
  onSelect: (attachment: ResourceAttachment) => void;
  disabled?: boolean;
}

// --- Saved Prompts ---

interface SavedPrompt {
  id: string;
  title: string;
  content: string;
  createdAt: string;
}

const PROMPTS_KEY = 'ownpilot-saved-prompts';

function loadPrompts(): SavedPrompt[] {
  try {
    return JSON.parse(localStorage.getItem(PROMPTS_KEY) ?? '[]') as SavedPrompt[];
  } catch {
    return [];
  }
}

function persistPrompts(prompts: SavedPrompt[]): void {
  try {
    localStorage.setItem(PROMPTS_KEY, JSON.stringify(prompts));
  } catch {
    /* ignore */
  }
}

// --- Tab definitions ---

const TABS: {
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  activeBg: string;
}[] = [
  { id: 'tools', label: 'Tools', icon: Wrench, color: 'text-blue-500', activeBg: 'bg-blue-500/10' },
  {
    id: 'custom-data',
    label: 'Data',
    icon: Table,
    color: 'text-emerald-500',
    activeBg: 'bg-emerald-500/10',
  },
  {
    id: 'builtin-data',
    label: 'Built-in',
    icon: Database,
    color: 'text-amber-500',
    activeBg: 'bg-amber-500/10',
  },
  {
    id: 'skills',
    label: 'Skills',
    icon: BookOpen,
    color: 'text-violet-500',
    activeBg: 'bg-violet-500/10',
  },
  {
    id: 'files',
    label: 'Files',
    icon: Upload,
    color: 'text-orange-500',
    activeBg: 'bg-orange-500/10',
  },
  { id: 'url', label: 'URL', icon: Link, color: 'text-sky-500', activeBg: 'bg-sky-500/10' },
  {
    id: 'composio',
    label: 'Apps',
    icon: Zap,
    color: 'text-yellow-500',
    activeBg: 'bg-yellow-500/10',
  },
  { id: 'mcp', label: 'MCP', icon: Server, color: 'text-cyan-500', activeBg: 'bg-cyan-500/10' },
  {
    id: 'artifacts',
    label: 'Artifacts',
    icon: Layout,
    color: 'text-pink-500',
    activeBg: 'bg-pink-500/10',
  },
  {
    id: 'prompts',
    label: 'Prompts',
    icon: Clipboard,
    color: 'text-indigo-500',
    activeBg: 'bg-indigo-500/10',
  },
];

// --- Hard-coded tool instructions per built-in data type ---

const BUILTIN_DATA_TOOL_INSTRUCTIONS: Record<string, string> = {
  tasks: [
    'Data source: tasks (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_tasks", {}) — List all tasks',
    '• use_tool("core.list_tasks", {"status":"pending"}) — List pending tasks',
    '• use_tool("core.add_task", {"title":"...", "priority":"normal"}) — Add new task',
    '• use_tool("core.complete_task", {"taskId":"..."}) — Mark task complete',
    '• use_tool("core.update_task", {"taskId":"...", "title":"...", "priority":"..."}) — Update task',
    '• use_tool("core.delete_task", {"taskId":"..."}) — Delete task',
  ].join('\n'),

  bookmarks: [
    'Data source: bookmarks (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_bookmarks", {}) — List all bookmarks',
    '• use_tool("core.list_bookmarks", {"search":"...", "category":"..."}) — Filter bookmarks',
    '• use_tool("core.add_bookmark", {"url":"...", "title":"...", "category":"..."}) — Add bookmark',
    '• use_tool("core.delete_bookmark", {"bookmarkId":"..."}) — Delete bookmark',
  ].join('\n'),

  notes: [
    'Data source: notes (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_notes", {}) — List all notes',
    '• use_tool("core.list_notes", {"search":"...", "category":"..."}) — Filter notes',
    '• use_tool("core.add_note", {"title":"...", "content":"..."}) — Create note',
    '• use_tool("core.update_note", {"noteId":"...", "title":"...", "content":"..."}) — Update note',
    '• use_tool("core.delete_note", {"noteId":"..."}) — Delete note',
  ].join('\n'),

  calendar: [
    'Data source: calendar events (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_calendar_events", {}) — List upcoming events',
    '• use_tool("core.list_calendar_events", {"startAfter":"2025-01-01", "startBefore":"2025-12-31"}) — Date range',
    '• use_tool("core.add_calendar_event", {"title":"...", "startTime":"2025-01-15T10:00:00"}) — Add event',
    '• use_tool("core.delete_calendar_event", {"eventId":"..."}) — Delete event',
  ].join('\n'),

  contacts: [
    'Data source: contacts (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_contacts", {}) — List all contacts',
    '• use_tool("core.list_contacts", {"search":"..."}) — Search contacts',
    '• use_tool("core.add_contact", {"name":"...", "email":"...", "phone":"..."}) — Add contact',
    '• use_tool("core.update_contact", {"contactId":"...", "name":"..."}) — Update contact',
    '• use_tool("core.delete_contact", {"contactId":"..."}) — Delete contact',
  ].join('\n'),

  memories: [
    'Data source: AI memories (Built-in AI Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_memories", {}) — List all memories',
    '• use_tool("core.recall", {"query":"..."}) — Search memories by keyword',
    '• use_tool("core.remember", {"key":"...", "value":"..."}) — Store a memory',
    '• use_tool("core.forget", {"memoryId":"..."}) — Delete a memory',
  ].join('\n'),

  goals: [
    'Data source: goals (Built-in AI Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("core.list_goals", {}) — List all goals',
  ].join('\n'),
};

const BUILTIN_DATA_ITEMS: ResourceItem[] = [
  {
    name: 'tasks',
    description: 'Task management — todos, checklists, task tracking',
    category: 'Personal Data',
    type: 'builtin-data',
  },
  {
    name: 'bookmarks',
    description: 'Saved URL bookmarks and web links',
    category: 'Personal Data',
    type: 'builtin-data',
  },
  {
    name: 'notes',
    description: 'Personal notes and text snippets',
    category: 'Personal Data',
    type: 'builtin-data',
  },
  {
    name: 'calendar',
    description: 'Calendar events and scheduling',
    category: 'Personal Data',
    type: 'builtin-data',
  },
  {
    name: 'contacts',
    description: 'Contact information and address book',
    category: 'Personal Data',
    type: 'builtin-data',
  },
  {
    name: 'memories',
    description: 'AI memory and persistent knowledge',
    category: 'AI Data',
    type: 'builtin-data',
  },
  {
    name: 'goals',
    description: 'Long-term goals and objectives tracking',
    category: 'AI Data',
    type: 'builtin-data',
  },
];

// --- Instruction builders ---

function buildCustomDataInstructions(displayName: string, internalName: string): string {
  return [
    `Data source: Custom Data Table "${displayName}" (internal table name: ${internalName})`,
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    `• use_tool("core.list_custom_records", {"table_name":"${internalName}"}) — List all records`,
    `• use_tool("core.search_custom_records", {"table_name":"${internalName}", "query":"..."}) — Search records`,
    `• use_tool("core.add_custom_record", {"table_name":"${internalName}", "data":{...}}) — Add record`,
    `• use_tool("core.get_custom_record", {"record_id":"..."}) — Get single record`,
    `• use_tool("core.update_custom_record", {"record_id":"...", "data":{...}}) — Update record`,
    `• use_tool("core.delete_custom_record", {"record_id":"..."}) — Delete record`,
    `• use_tool("core.describe_custom_table", {"table_name":"${internalName}"}) — Get table schema/columns`,
    '',
    'TIP: Call core.describe_custom_table first to learn the column names.',
  ].join('\n');
}

function buildToolInstructions(
  toolName: string,
  description: string,
  parameters?: Record<string, unknown>
): string {
  const lines: string[] = [
    `Tool: ${toolName}`,
    `Description: ${description}`,
    `IMPORTANT: Call it by name "${toolName}" directly — do NOT use use_tool or search_tools.`,
    '',
  ];

  const props = (parameters?.properties || {}) as Record<string, Record<string, unknown>>;
  const requiredSet = new Set<string>((parameters?.required as string[]) || []);
  const propEntries = Object.entries(props);

  if (propEntries.length > 0) {
    lines.push('Parameters:');
    for (const [paramName, paramDef] of propEntries) {
      const isRequired = requiredSet.has(paramName);
      const typeStr =
        paramDef.enum && Array.isArray(paramDef.enum)
          ? (paramDef.enum as string[]).map((v) => JSON.stringify(v)).join(' | ')
          : String(paramDef.type || 'any');
      lines.push(
        `  • ${paramName}: ${typeStr}${isRequired ? ' (REQUIRED)' : ''}${paramDef.description ? ` — ${paramDef.description}` : ''}`
      );
    }
    lines.push('');
    const ex: Record<string, unknown> = {};
    for (const [p, d] of propEntries) {
      if (requiredSet.has(p)) {
        ex[p] =
          d.enum && Array.isArray(d.enum)
            ? d.enum[0]
            : d.type === 'number' || d.type === 'integer'
              ? 0
              : d.type === 'boolean'
                ? true
                : d.type === 'array'
                  ? []
                  : d.type === 'object'
                    ? {}
                    : '...';
      }
    }
    lines.push(`Example: ${toolName}(${JSON.stringify(ex)})`);
  } else {
    lines.push(`Example: ${toolName}({})`);
  }
  return lines.join('\n');
}

function buildSkillInstructions(name: string, instructions: string): string {
  return [`Skill: ${name}`, 'Follow these skill instructions carefully:', '', instructions].join(
    '\n'
  );
}

function buildFileInstructions(name: string, content: string): string {
  return [
    `Attached File: ${name} (${content.length.toLocaleString()} chars)`,
    '--- BEGIN FILE CONTENT ---',
    content,
    '--- END FILE CONTENT ---',
  ].join('\n');
}

function buildUrlInstructions(url: string, title: string, text: string): string {
  return [
    `Web Page: ${url}`,
    `Title: ${title}`,
    '--- BEGIN PAGE CONTENT ---',
    text,
    '--- END PAGE CONTENT ---',
  ].join('\n');
}

function buildComposioInstructions(action: string, appName: string, description: string): string {
  return [
    `Connected App Action: ${action} (${appName})`,
    `Description: ${description}`,
    `To execute: use_tool("composio_execute", {"action": "${action}", "params": {...}})`,
    'IMPORTANT: Use composio_execute to run this action, NOT search_tools.',
  ].join('\n');
}

function buildMcpToolInstructions(
  toolName: string,
  serverName: string,
  description: string,
  inputSchema?: Record<string, unknown>
): string {
  const lines = [
    `MCP Tool: ${toolName} (from MCP server: ${serverName})`,
    `Description: ${description || 'No description'}`,
    `Call it directly by name: ${toolName}({...}) — do NOT use use_tool() or search_tools().`,
  ];
  const props = (inputSchema?.properties || {}) as Record<string, Record<string, unknown>>;
  const entries = Object.entries(props);
  if (entries.length > 0) {
    lines.push('');
    lines.push('Parameters:');
    const required = new Set<string>((inputSchema?.required as string[]) || []);
    for (const [p, d] of entries) {
      lines.push(
        `  • ${p}: ${String(d.type || 'any')}${required.has(p) ? ' (REQUIRED)' : ''} — ${String(d.description || '')}`
      );
    }
  }
  return lines.join('\n');
}

function buildArtifactInstructions(title: string, type: string, content: string): string {
  const truncated = content.length > 8000 ? content.slice(0, 8000) + '\n...[truncated]' : content;
  return [
    `Previous AI Artifact: "${title}" (type: ${type})`,
    '--- BEGIN ARTIFACT CONTENT ---',
    truncated,
    '--- END ARTIFACT CONTENT ---',
  ].join('\n');
}

// --- Icon helpers ---

function getItemIcon(item: ResourceItem) {
  if (item.type === 'builtin-data') {
    switch (item.name) {
      case 'tasks':
        return <ListChecks className="w-4 h-4" />;
      case 'bookmarks':
        return <Bookmark className="w-4 h-4" />;
      case 'notes':
        return <FileText className="w-4 h-4" />;
      case 'calendar':
        return <Calendar className="w-4 h-4" />;
      case 'contacts':
        return <Users className="w-4 h-4" />;
      case 'memories':
        return <Database className="w-4 h-4" />;
      case 'goals':
        return <Wrench className="w-4 h-4" />;
    }
  }
  if (item.type === 'custom-data') return <Table className="w-4 h-4" />;
  if (item.type === 'skill') return <BookOpen className="w-4 h-4" />;
  if (item.type === 'composio-action') return <Zap className="w-4 h-4" />;
  if (item.type === 'mcp-tool') return <Server className="w-4 h-4" />;
  if (item.type === 'artifact') return <Layout className="w-4 h-4" />;
  if (item.type === 'prompt') return <Clipboard className="w-4 h-4" />;
  return <Wrench className="w-4 h-4" />;
}

function getIconColor(type: ResourceType): string {
  switch (type) {
    case 'tool':
      return 'text-blue-500';
    case 'custom-tool':
      return 'text-primary';
    case 'custom-data':
      return 'text-emerald-500';
    case 'builtin-data':
      return 'text-amber-500';
    case 'skill':
      return 'text-violet-500';
    case 'composio-action':
      return 'text-yellow-500';
    case 'mcp-tool':
      return 'text-cyan-500';
    case 'artifact':
      return 'text-pink-500';
    case 'prompt':
      return 'text-indigo-500';
    default:
      return 'text-text-muted';
  }
}

function getIconBg(type: ResourceType): string {
  switch (type) {
    case 'tool':
      return 'bg-blue-500/10 group-hover:bg-blue-500/20';
    case 'custom-tool':
      return 'bg-primary/10 group-hover:bg-primary/20';
    case 'custom-data':
      return 'bg-emerald-500/10 group-hover:bg-emerald-500/20';
    case 'builtin-data':
      return 'bg-amber-500/10 group-hover:bg-amber-500/20';
    case 'skill':
      return 'bg-violet-500/10 group-hover:bg-violet-500/20';
    case 'composio-action':
      return 'bg-yellow-500/10 group-hover:bg-yellow-500/20';
    case 'mcp-tool':
      return 'bg-cyan-500/10 group-hover:bg-cyan-500/20';
    case 'artifact':
      return 'bg-pink-500/10 group-hover:bg-pink-500/20';
    case 'prompt':
      return 'bg-indigo-500/10 group-hover:bg-indigo-500/20';
    default:
      return 'bg-bg-secondary group-hover:bg-bg-tertiary';
  }
}

function matchesSearch(item: ResourceItem, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed || trimmed === 'all' || trimmed === '*') return true;
  const blob = [
    item.name,
    item.displayName || '',
    item.internalName || '',
    item.description,
    item.category || '',
  ]
    .join(' ')
    .toLowerCase()
    .replace(/[_-]/g, ' ');
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => blob.includes(w));
}

const CUSTOM_PANEL_TABS: TabId[] = ['files', 'url', 'prompts'];

// =============================================================================
// Main Component
// =============================================================================

export function ToolPicker({ onSelect, disabled }: ToolPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('tools');
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // URL panel
  const [urlInput, setUrlInput] = useState('');
  const [urlFetching, setUrlFetching] = useState(false);
  const [urlResult, setUrlResult] = useState<{
    url: string;
    title: string;
    text: string;
    charCount: number;
  } | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);

  // Files panel
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prompts panel
  const [prompts, setPrompts] = useState<SavedPrompt[]>([]);
  const [showNewPromptForm, setShowNewPromptForm] = useState(false);
  const [newPromptTitle, setNewPromptTitle] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');

  useEffect(() => {
    if (isOpen) {
      fetchItems(activeTab);
      if (!CUSTOM_PANEL_TABS.includes(activeTab)) {
        setTimeout(() => searchInputRef.current?.focus(), 80);
      }
    }
  }, [isOpen, activeTab]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setIsOpen(false);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, [isOpen]);

  // ---- Data loading ----

  const fetchItems = async (tab: TabId) => {
    if (tab === 'files' || tab === 'url') return;
    if (tab === 'prompts') {
      setPrompts(loadPrompts());
      return;
    }

    setIsLoading(true);
    setItems([]);
    try {
      if (tab === 'tools') {
        const [toolGroupsResponse, customData] = await Promise.all([
          toolsApi.listGrouped(),
          customToolsApi.list('active'),
        ]);
        const builtins: ResourceItem[] = [];
        for (const [category, group] of Object.entries(toolGroupsResponse.categories)) {
          for (const t of group.tools)
            builtins.push({
              name: t.name,
              description: t.description || '',
              category,
              type: 'tool',
              parameters: t.parameters,
            });
        }
        const customs: ResourceItem[] = (customData.tools || []).map((t) => ({
          name: t.name,
          description: t.description || '',
          category: t.category || 'Custom',
          type: 'custom-tool' as ResourceType,
        }));
        setItems([...customs, ...builtins]);
      } else if (tab === 'custom-data') {
        const tables = await customDataApi.tables();
        setItems(
          (Array.isArray(tables) ? tables : []).map((t) => ({
            name: t.displayName || t.name,
            displayName: t.displayName || t.name,
            internalName: t.name,
            description: t.description || `${t.recordCount ?? 0} records`,
            category: 'Custom Tables',
            type: 'custom-data' as ResourceType,
            recordCount: t.recordCount,
          }))
        );
      } else if (tab === 'builtin-data') {
        setItems(BUILTIN_DATA_ITEMS);
      } else if (tab === 'skills') {
        const skills = await extensionsApi.list({ format: 'agentskills', status: 'enabled' });
        setItems(
          (Array.isArray(skills) ? skills : []).map((s) => ({
            name: s.name,
            description: s.description || s.manifest.description || 'No description',
            category: s.category || 'Skills',
            type: 'skill' as ResourceType,
            instructions: s.manifest.instructions || s.manifest.system_prompt || '',
          }))
        );
      } else if (tab === 'composio') {
        const res = await composioApi.searchActions('');
        setItems(
          (res.actions || []).map((a) => ({
            name: a.slug,
            displayName: a.name,
            description: a.description || a.appName,
            category: a.appName,
            type: 'composio-action' as ResourceType,
          }))
        );
      } else if (tab === 'mcp') {
        const { servers } = await mcpApi.list();
        const connected = servers.filter((s) => s.status === 'connected' || s.connected);
        const groups = await Promise.all(
          connected.map(async (server) => {
            try {
              const { tools } = await mcpApi.tools(server.id);
              return tools.map((t) => ({
                name: t.name,
                description: t.description || 'No description',
                category: server.displayName || server.name,
                type: 'mcp-tool' as ResourceType,
                parameters: t.inputSchema,
                instructions: server.name,
              }));
            } catch {
              return [];
            }
          })
        );
        setItems(groups.flat());
      } else if (tab === 'artifacts') {
        const { artifacts } = await artifactsApi.list({ limit: 20 });
        setItems(
          (artifacts || []).map((a) => ({
            name: a.id,
            displayName: a.title || 'Untitled',
            description: `${a.type} · ${new Date(a.createdAt).toLocaleDateString()}`,
            category: a.type,
            type: 'artifact' as ResourceType,
            instructions: a.content,
          }))
        );
      }
    } catch {
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  // ---- Selection ----

  const handleSelect = (item: ResourceItem) => {
    let toolInstructions: string;
    let promptText: string | undefined;

    if (item.type === 'skill') {
      toolInstructions = buildSkillInstructions(item.name, item.instructions || '');
    } else if (item.type === 'builtin-data') {
      toolInstructions = BUILTIN_DATA_TOOL_INSTRUCTIONS[item.name] || `Data source: ${item.name}`;
    } else if (item.type === 'custom-data') {
      toolInstructions = buildCustomDataInstructions(
        item.displayName || item.name,
        item.internalName || item.name
      );
    } else if (item.type === 'composio-action') {
      toolInstructions = buildComposioInstructions(
        item.name,
        item.category || '',
        item.description
      );
    } else if (item.type === 'mcp-tool') {
      toolInstructions = buildMcpToolInstructions(
        item.name,
        item.instructions || item.category || '',
        item.description,
        item.parameters
      );
    } else if (item.type === 'artifact') {
      toolInstructions = buildArtifactInstructions(
        item.displayName || item.name,
        item.category || 'unknown',
        item.instructions || ''
      );
    } else if (item.type === 'prompt') {
      toolInstructions = '';
      promptText = item.instructions || '';
    } else {
      toolInstructions = buildToolInstructions(item.name, item.description, item.parameters);
    }

    onSelect({
      name: item.displayName || item.name,
      displayName: item.displayName,
      internalName: item.internalName,
      type: item.type,
      toolInstructions,
      promptText,
    });
    setIsOpen(false);
    setSearchQuery('');
  };

  // ---- URL panel ----

  const handleFetchUrl = async () => {
    const url = urlInput.trim();
    if (!url) return;
    setUrlFetching(true);
    setUrlError(null);
    setUrlResult(null);
    try {
      const res = await chatApi.fetchUrl(url);
      setUrlResult(res);
    } catch (err) {
      setUrlError(err instanceof Error ? err.message : 'Failed to fetch URL');
    } finally {
      setUrlFetching(false);
    }
  };

  const handleSelectUrl = () => {
    if (!urlResult) return;
    onSelect({
      name: urlResult.url,
      displayName: urlResult.title || urlResult.url,
      type: 'url',
      toolInstructions: buildUrlInstructions(urlResult.url, urlResult.title, urlResult.text),
    });
    setIsOpen(false);
    setUrlInput('');
    setUrlResult(null);
  };

  // ---- Files panel ----

  const processTextFile = async (file: File) => {
    if (file.size > 1024 * 1024) {
      alert(`"${file.name}" is too large (max 1 MB)`);
      return;
    }
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsText(file);
    });
    onSelect({
      name: file.name,
      displayName: file.name,
      type: 'file',
      toolInstructions: buildFileInstructions(file.name, text),
    });
    setIsOpen(false);
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) await processTextFile(file);
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) await processTextFile(file);
    e.target.value = '';
  };

  // ---- Prompts panel ----

  const handleSavePrompt = () => {
    if (!newPromptTitle.trim() || !newPromptContent.trim()) return;
    const updated = [
      ...prompts,
      {
        id: crypto.randomUUID(),
        title: newPromptTitle.trim(),
        content: newPromptContent.trim(),
        createdAt: new Date().toISOString(),
      },
    ];
    setPrompts(updated);
    persistPrompts(updated);
    setNewPromptTitle('');
    setNewPromptContent('');
    setShowNewPromptForm(false);
  };

  const handleDeletePrompt = (id: string) => {
    const updated = prompts.filter((p) => p.id !== id);
    setPrompts(updated);
    persistPrompts(updated);
  };

  const handleSelectPrompt = (prompt: SavedPrompt) => {
    onSelect({
      name: prompt.title,
      displayName: prompt.title,
      type: 'prompt',
      toolInstructions: '',
      promptText: prompt.content,
    });
    setIsOpen(false);
  };

  // ---- Derived state ----

  const filteredItems = items.filter((item) => matchesSearch(item, searchQuery));

  const groupedItems = filteredItems.reduce(
    (acc, item) => {
      const cat = item.category || 'Other';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    },
    {} as Record<string, ResourceItem[]>
  );

  const sortedCategories = Object.keys(groupedItems).sort((a, b) => {
    if (a === 'Custom') return -1;
    if (b === 'Custom') return 1;
    return a.localeCompare(b);
  });

  const emptyMessage = () => {
    if (items.length === 0) {
      switch (activeTab) {
        case 'tools':
          return 'No tools available';
        case 'custom-data':
          return 'No custom data tables yet';
        case 'builtin-data':
          return 'No built-in data available';
        case 'skills':
          return 'No skills installed yet';
        case 'composio':
          return 'No Composio actions — check Composio is configured';
        case 'mcp':
          return 'No MCP tools — connect an MCP server first';
        case 'artifacts':
          return 'No artifacts yet — AI outputs will appear here';
      }
    }
    return 'No results match your search';
  };

  const activeTabDef = TABS.find((t) => t.id === activeTab)!;
  const isCustomPanel = CUSTOM_PANEL_TABS.includes(activeTab);

  // =============================================================================
  // Render
  // =============================================================================

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="p-2 text-text-muted dark:text-dark-text-muted hover:text-primary dark:hover:text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Attach context to message"
      >
        <Plus className="w-5 h-5" />
      </button>

      {isOpen && (
        <div
          className="absolute bottom-full left-0 mb-2 w-[32rem] bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl overflow-hidden z-50 flex"
          style={{ height: '22rem' }}
        >
          {/* ── Left sidebar: vertical tab list ── */}
          <div className="w-28 flex-shrink-0 border-r border-border dark:border-dark-border bg-bg-secondary/40 dark:bg-dark-bg-secondary/40 flex flex-col overflow-y-auto py-1">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    setSearchQuery('');
                  }}
                  className={`flex items-center gap-2 w-full px-3 py-2 text-xs font-medium transition-colors text-left border-r-2 ${
                    isActive
                      ? `${tab.color} ${tab.activeBg} border-current`
                      : 'text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary border-transparent'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* ── Right: content panel ── */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Panel header */}
            <div
              className={`flex items-center gap-2 px-3 py-2.5 border-b border-border dark:border-dark-border ${activeTabDef.activeBg}`}
            >
              <activeTabDef.icon className={`w-3.5 h-3.5 flex-shrink-0 ${activeTabDef.color}`} />
              <span className={`text-xs font-semibold ${activeTabDef.color}`}>
                {activeTabDef.label}
              </span>
            </div>

            {/* ── URL panel ── */}
            {activeTab === 'url' && (
              <div className="flex flex-col gap-3 p-3 flex-1 overflow-y-auto">
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleFetchUrl();
                    }}
                    placeholder="https://example.com/page"
                    autoFocus
                    className="flex-1 px-3 py-1.5 text-sm bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/60"
                  />
                  <button
                    type="button"
                    onClick={handleFetchUrl}
                    disabled={urlFetching || !urlInput.trim()}
                    className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
                  >
                    {urlFetching ? (
                      <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <Link className="w-3.5 h-3.5" />
                    )}
                    Fetch
                  </button>
                </div>
                {urlError && <p className="text-xs text-error">{urlError}</p>}
                {urlResult ? (
                  <div className="flex flex-col gap-2">
                    <div className="p-2.5 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
                      <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary line-clamp-1">
                        {urlResult.title}
                      </p>
                      <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 line-clamp-2">
                        {urlResult.text.slice(0, 180)}
                      </p>
                      <p className="text-[11px] text-text-muted/60 mt-1">
                        {urlResult.charCount.toLocaleString()} chars
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleSelectUrl}
                      className="w-full py-2 text-sm bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors font-medium"
                    >
                      Attach to message
                    </button>
                  </div>
                ) : (
                  !urlError && (
                    <p className="text-xs text-text-muted dark:text-dark-text-muted">
                      Fetches the page, strips HTML, and injects the extracted text as context.
                    </p>
                  )
                )}
              </div>
            )}

            {/* ── Files panel ── */}
            {activeTab === 'files' && (
              <div className="p-3 flex-1 flex flex-col justify-center">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl py-8 px-4 text-center cursor-pointer transition-colors ${
                    isDragOver
                      ? 'border-primary bg-primary/5'
                      : 'border-border dark:border-dark-border hover:border-primary/50 hover:bg-bg-secondary/50 dark:hover:bg-dark-bg-secondary/50'
                  }`}
                >
                  <Upload className="w-7 h-7 mx-auto mb-2.5 text-text-muted dark:text-dark-text-muted" />
                  <p className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                    Drop a file or click to browse
                  </p>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                    .txt .md .json .ts .js .py .yaml .csv .xml — max 1 MB
                  </p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.yaml,.yml,.csv,.xml,.html,.css,.sh,.env,.toml,.ini,.cfg,.log"
                  onChange={handleFileInputChange}
                  className="hidden"
                />
              </div>
            )}

            {/* ── Prompts panel ── */}
            {activeTab === 'prompts' && (
              <div className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto">
                  {prompts.length === 0 && !showNewPromptForm ? (
                    <div className="p-4 text-center text-text-muted dark:text-dark-text-muted text-sm">
                      No saved prompts yet.
                    </div>
                  ) : (
                    <div className="p-2 flex flex-col gap-0.5">
                      {prompts.map((prompt) => (
                        <div
                          key={prompt.id}
                          className="flex items-start gap-1 px-2 py-2 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg group"
                        >
                          <button
                            type="button"
                            onClick={() => handleSelectPrompt(prompt)}
                            className="flex-1 text-left min-w-0"
                          >
                            <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                              {prompt.title}
                            </p>
                            <p className="text-xs text-text-muted dark:text-dark-text-muted line-clamp-1 mt-0.5">
                              {prompt.content}
                            </p>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeletePrompt(prompt.id)}
                            className="flex-shrink-0 p-1 text-text-muted hover:text-error opacity-0 group-hover:opacity-100 transition-opacity rounded"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {showNewPromptForm ? (
                  <div className="p-3 border-t border-border dark:border-dark-border flex flex-col gap-2">
                    <input
                      type="text"
                      value={newPromptTitle}
                      onChange={(e) => setNewPromptTitle(e.target.value)}
                      placeholder="Prompt title"
                      autoFocus
                      className="w-full px-2.5 py-1.5 text-sm bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/60"
                    />
                    <textarea
                      value={newPromptContent}
                      onChange={(e) => setNewPromptContent(e.target.value)}
                      placeholder="Prompt text…"
                      rows={2}
                      className="w-full px-2.5 py-1.5 text-sm bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/60 resize-none"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowNewPromptForm(false)}
                        className="flex-1 py-1.5 text-xs text-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleSavePrompt}
                        disabled={!newPromptTitle.trim() || !newPromptContent.trim()}
                        className="flex-1 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="p-2 border-t border-border dark:border-dark-border">
                    <button
                      type="button"
                      onClick={() => setShowNewPromptForm(true)}
                      className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-primary hover:bg-primary/5 rounded-lg transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Add prompt template
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* ── Standard search + list panel ── */}
            {!isCustomPanel && (
              <>
                <div className="px-3 py-2 border-b border-border dark:border-dark-border">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
                    <input
                      ref={searchInputRef}
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={
                        activeTab === 'tools'
                          ? 'Search… ("all" for everything)'
                          : `Search ${activeTabDef.label.toLowerCase()}…`
                      }
                      className="w-full pl-8 pr-7 py-1.5 bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted border border-border dark:border-dark-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                  {isLoading ? (
                    <div className="p-4">
                      <LoadingSpinner size="sm" message="Loading…" />
                    </div>
                  ) : filteredItems.length === 0 ? (
                    <div className="p-4 text-center text-text-muted dark:text-dark-text-muted text-sm">
                      {emptyMessage()}
                    </div>
                  ) : (
                    <div className="p-2">
                      {sortedCategories.map((category) => (
                        <div key={category} className="mb-2 last:mb-0">
                          <div className="px-2 py-1 text-[10px] font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                            {category}
                          </div>
                          {groupedItems[category]!.map((item) => (
                            <button
                              key={`${item.type}-${item.internalName || item.name}`}
                              type="button"
                              onClick={() => handleSelect(item)}
                              className="w-full flex items-start gap-2.5 px-2 py-1.5 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg text-left transition-colors group"
                            >
                              <div
                                className={`mt-0.5 p-1.5 rounded-md transition-colors flex-shrink-0 ${getIconBg(item.type)}`}
                              >
                                <span className={getIconColor(item.type)}>{getItemIcon(item)}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate">
                                    {item.displayName || item.name}
                                  </span>
                                  {item.type === 'custom-tool' && (
                                    <span className="flex-shrink-0 text-[9px] px-1 py-0.5 bg-primary/10 text-primary rounded-full">
                                      custom
                                    </span>
                                  )}
                                  {item.recordCount !== undefined && (
                                    <span className="flex-shrink-0 text-[9px] px-1 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full">
                                      {item.recordCount}
                                    </span>
                                  )}
                                </div>
                                {item.type === 'custom-data' &&
                                  item.internalName &&
                                  item.internalName !== item.displayName && (
                                    <div className="text-[10px] text-text-muted/70 font-mono truncate">
                                      {item.internalName}
                                    </div>
                                  )}
                                <div className="text-xs text-text-muted dark:text-dark-text-muted line-clamp-1">
                                  {item.description}
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
