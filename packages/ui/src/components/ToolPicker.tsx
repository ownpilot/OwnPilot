import { useState, useEffect, useRef } from 'react';
import { Plus, Wrench, Search, X, Database, Table, Bookmark, Calendar, Users, FileText, ListChecks } from './icons';
import { toolsApi, customToolsApi, customDataApi } from '../api';

// --- Types ---

export type ResourceType = 'tool' | 'custom-tool' | 'custom-data' | 'builtin-data';
type TabId = 'tools' | 'custom-data' | 'builtin-data';

interface CustomDataTable {
  name: string;
  displayName?: string;
  description?: string;
  recordCount?: number;
}

export interface ResourceAttachment {
  name: string;
  displayName?: string;
  internalName?: string;
  type: ResourceType;
  /** Pre-built tool instruction block for LLM injection */
  toolInstructions: string;
}

interface ResourceItem {
  name: string;
  displayName?: string;
  internalName?: string;
  description: string;
  category?: string;
  type: ResourceType;
  recordCount?: number;
  /** Full JSON Schema parameters object for tools (fetched from API) */
  parameters?: Record<string, unknown>;
}

interface ToolPickerProps {
  onSelect: (attachment: ResourceAttachment) => void;
  disabled?: boolean;
}

// --- Tab definitions ---

const TABS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'tools', label: 'Tools', icon: Wrench },
  { id: 'custom-data', label: 'Custom Data', icon: Table },
  { id: 'builtin-data', label: 'Built-in Data', icon: Database },
];

// --- Hard-coded tool instructions per built-in data type ---

const BUILTIN_DATA_TOOL_INSTRUCTIONS: Record<string, string> = {
  tasks: [
    'Data source: tasks (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("list_tasks", {}) — List all tasks',
    '• use_tool("list_tasks", {"status":"pending"}) — List pending tasks',
    '• use_tool("add_task", {"title":"...", "priority":"normal"}) — Add new task',
    '• use_tool("complete_task", {"taskId":"..."}) — Mark task complete',
    '• use_tool("update_task", {"taskId":"...", "title":"...", "priority":"..."}) — Update task',
    '• use_tool("delete_task", {"taskId":"..."}) — Delete task',
  ].join('\n'),

  bookmarks: [
    'Data source: bookmarks (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("list_bookmarks", {}) — List all bookmarks',
    '• use_tool("list_bookmarks", {"search":"...", "category":"..."}) — Filter bookmarks',
    '• use_tool("add_bookmark", {"url":"...", "title":"...", "category":"..."}) — Add bookmark',
    '• use_tool("delete_bookmark", {"bookmarkId":"..."}) — Delete bookmark',
  ].join('\n'),

  notes: [
    'Data source: notes (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("list_notes", {}) — List all notes',
    '• use_tool("list_notes", {"search":"...", "category":"..."}) — Filter notes',
    '• use_tool("add_note", {"title":"...", "content":"..."}) — Create note',
    '• use_tool("update_note", {"noteId":"...", "title":"...", "content":"..."}) — Update note',
    '• use_tool("delete_note", {"noteId":"..."}) — Delete note',
  ].join('\n'),

  calendar: [
    'Data source: calendar events (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("list_calendar_events", {}) — List upcoming events',
    '• use_tool("list_calendar_events", {"startAfter":"2025-01-01", "startBefore":"2025-12-31"}) — Date range',
    '• use_tool("add_calendar_event", {"title":"...", "startTime":"2025-01-15T10:00:00"}) — Add event',
    '• use_tool("delete_calendar_event", {"eventId":"..."}) — Delete event',
  ].join('\n'),

  contacts: [
    'Data source: contacts (Built-in Personal Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("list_contacts", {}) — List all contacts',
    '• use_tool("list_contacts", {"search":"..."}) — Search contacts',
    '• use_tool("add_contact", {"name":"...", "email":"...", "phone":"..."}) — Add contact',
    '• use_tool("update_contact", {"contactId":"...", "name":"..."}) — Update contact',
    '• use_tool("delete_contact", {"contactId":"..."}) — Delete contact',
  ].join('\n'),

  memories: [
    'Data source: AI memories (Built-in AI Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("list_memories", {}) — List all memories',
    '• use_tool("recall", {"query":"..."}) — Search memories by keyword',
    '• use_tool("remember", {"key":"...", "value":"..."}) — Store a memory',
    '• use_tool("forget", {"memoryId":"..."}) — Delete a memory',
  ].join('\n'),

  goals: [
    'Data source: goals (Built-in AI Data)',
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    '• use_tool("list_goals", {}) — List all goals',
  ].join('\n'),
};

// Built-in data items shown in the picker
const BUILTIN_DATA_ITEMS: ResourceItem[] = [
  { name: 'tasks', description: 'Task management - todos, checklists, and task tracking', category: 'Personal Data', type: 'builtin-data' },
  { name: 'bookmarks', description: 'Saved URL bookmarks and web links', category: 'Personal Data', type: 'builtin-data' },
  { name: 'notes', description: 'Personal notes and text snippets', category: 'Personal Data', type: 'builtin-data' },
  { name: 'calendar', description: 'Calendar events and scheduling', category: 'Personal Data', type: 'builtin-data' },
  { name: 'contacts', description: 'Contact information and address book', category: 'Personal Data', type: 'builtin-data' },
  { name: 'memories', description: 'AI memory and persistent knowledge', category: 'AI Data', type: 'builtin-data' },
  { name: 'goals', description: 'Long-term goals and objectives tracking', category: 'AI Data', type: 'builtin-data' },
];

// --- Build tool instruction for a custom data table ---

function buildCustomDataInstructions(displayName: string, internalName: string): string {
  return [
    `Data source: Custom Data Table "${displayName}" (internal table name: ${internalName})`,
    'Available tools — call directly with use_tool, DO NOT use search_tools:',
    `• use_tool("list_custom_records", {"table_name":"${internalName}"}) — List all records`,
    `• use_tool("search_custom_records", {"table_name":"${internalName}", "query":"..."}) — Search records`,
    `• use_tool("add_custom_record", {"table_name":"${internalName}", "data":{...}}) — Add record`,
    `• use_tool("get_custom_record", {"record_id":"..."}) — Get single record`,
    `• use_tool("update_custom_record", {"record_id":"...", "data":{...}}) — Update record`,
    `• use_tool("delete_custom_record", {"record_id":"..."}) — Delete record`,
    `• use_tool("describe_custom_table", {"table_name":"${internalName}"}) — Get table schema/columns`,
    '',
    'TIP: Call describe_custom_table first if you need to know the column names before adding/searching records.',
  ].join('\n');
}

// --- Build tool instruction for a specific tool (with full parameter docs) ---

function buildToolInstructions(toolName: string, description: string, parameters?: Record<string, unknown>): string {
  const lines: string[] = [
    `Tool: ${toolName}`,
    `Description: ${description}`,
    `IMPORTANT: This tool is registered directly. Call it by name "${toolName}" — do NOT use use_tool or search_tools.`,
    '',
  ];

  const props = (parameters?.properties || {}) as Record<string, Record<string, unknown>>;
  const requiredSet = new Set<string>((parameters?.required as string[]) || []);
  const propEntries = Object.entries(props);

  if (propEntries.length > 0) {
    lines.push('Parameters:');
    for (const [paramName, paramDef] of propEntries) {
      const isRequired = requiredSet.has(paramName);
      const typeStr = paramDef.enum && Array.isArray(paramDef.enum)
        ? (paramDef.enum as string[]).map((v) => JSON.stringify(v)).join(' | ')
        : String(paramDef.type || 'any');
      const reqStr = isRequired ? ' (REQUIRED)' : ' (optional)';
      const descStr = paramDef.description ? ` — ${paramDef.description}` : '';
      const defaultStr = paramDef.default !== undefined ? ` [default: ${JSON.stringify(paramDef.default)}]` : '';
      lines.push(`  • ${paramName}: ${typeStr}${reqStr}${descStr}${defaultStr}`);
    }
    lines.push('');

    // Build example direct call with required params filled
    const exampleArgs: Record<string, unknown> = {};
    for (const [paramName, paramDef] of propEntries) {
      if (requiredSet.has(paramName)) {
        exampleArgs[paramName] = paramDef.enum && Array.isArray(paramDef.enum)
          ? paramDef.enum[0]
          : paramDef.type === 'number' || paramDef.type === 'integer' ? 0
          : paramDef.type === 'boolean' ? true
          : paramDef.type === 'array' ? []
          : paramDef.type === 'object' ? {}
          : '...';
      }
    }
    lines.push(`Example: ${toolName}(${JSON.stringify(exampleArgs)})`);
  } else {
    lines.push(`Example: ${toolName}({})`);
  }

  return lines.join('\n');
}

// --- Icon mapping ---

function getItemIcon(item: ResourceItem) {
  if (item.type === 'builtin-data') {
    switch (item.name) {
      case 'tasks': return <ListChecks className="w-4 h-4" />;
      case 'bookmarks': return <Bookmark className="w-4 h-4" />;
      case 'notes': return <FileText className="w-4 h-4" />;
      case 'calendar': return <Calendar className="w-4 h-4" />;
      case 'contacts': return <Users className="w-4 h-4" />;
      case 'memories': return <Database className="w-4 h-4" />;
      case 'goals': return <Wrench className="w-4 h-4" />;
    }
  }
  if (item.type === 'custom-data') {
    return <Table className="w-4 h-4" />;
  }
  return <Wrench className="w-4 h-4" />;
}

function getIconColor(type: ResourceType): string {
  switch (type) {
    case 'tool': return 'text-blue-500';
    case 'custom-tool': return 'text-primary';
    case 'custom-data': return 'text-emerald-500';
    case 'builtin-data': return 'text-amber-500';
  }
}

function getIconBg(type: ResourceType): string {
  switch (type) {
    case 'tool': return 'bg-blue-500/10 group-hover:bg-blue-500/20';
    case 'custom-tool': return 'bg-primary/10 group-hover:bg-primary/20';
    case 'custom-data': return 'bg-emerald-500/10 group-hover:bg-emerald-500/20';
    case 'builtin-data': return 'bg-amber-500/10 group-hover:bg-amber-500/20';
  }
}

// --- Search logic ---

function matchesSearch(item: ResourceItem, query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed || trimmed === 'all' || trimmed === '*') return true;

  const nameWords = item.name.toLowerCase().replace(/[_\-]/g, ' ');
  const displayWords = (item.displayName || '').toLowerCase().replace(/[_\-]/g, ' ');
  const internalWords = (item.internalName || '').toLowerCase().replace(/[_\-]/g, ' ');
  const descWords = item.description.toLowerCase();
  const catWords = (item.category || '').toLowerCase();

  const searchBlob = `${nameWords} ${displayWords} ${internalWords} ${descWords} ${catWords}`;

  const queryWords = trimmed.split(/\s+/).filter(Boolean);
  return queryWords.every((word) => searchBlob.includes(word));
}

// --- Main Component ---

export function ToolPicker({ onSelect, disabled }: ToolPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('tools');
  const [items, setItems] = useState<ResourceItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      fetchItems(activeTab);
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen, activeTab]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const fetchItems = async (tab: TabId) => {
    setIsLoading(true);
    try {
      if (tab === 'tools') {
        const [toolGroups, customData] = await Promise.all([
          toolsApi.listGrouped(),
          customToolsApi.list('active'),
        ]);

        const builtinTools: ResourceItem[] = [];
        for (const group of toolGroups) {
          for (const t of group.tools) {
            builtinTools.push({
              name: t.name,
              description: t.description || '',
              category: group.category,
              type: 'tool',
              parameters: t.parameters,
            });
          }
        }
        const customTools: ResourceItem[] = (customData.tools || []).map((t) => ({
          name: t.name, description: t.description || '', category: t.category || 'Custom', type: 'custom-tool' as ResourceType,
        }));
        setItems([...customTools, ...builtinTools]);

      } else if (tab === 'custom-data') {
        const tables = await customDataApi.tables();
        const tableItems: ResourceItem[] = ((Array.isArray(tables) ? tables : []) as unknown as CustomDataTable[]).map((t) => ({
          name: t.displayName || t.name,
          displayName: t.displayName || t.name,
          internalName: t.name,
          description: t.description || `${t.recordCount ?? 0} records`,
          category: 'Custom Tables',
          type: 'custom-data' as ResourceType,
          recordCount: t.recordCount,
        }));
        setItems(tableItems);

      } else if (tab === 'builtin-data') {
        setItems(BUILTIN_DATA_ITEMS);
      }
    } catch (error) {
      console.error('Failed to fetch resources:', error);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (item: ResourceItem) => {
    // Build the appropriate tool instruction block
    let toolInstructions: string;

    if (item.type === 'builtin-data') {
      toolInstructions = BUILTIN_DATA_TOOL_INSTRUCTIONS[item.name] || `Data source: ${item.name}`;
    } else if (item.type === 'custom-data') {
      const display = item.displayName || item.name;
      const internal = item.internalName || item.name;
      toolInstructions = buildCustomDataInstructions(display, internal);
    } else {
      // tool or custom-tool — embed full parameter schema
      toolInstructions = buildToolInstructions(item.name, item.description, item.parameters as Record<string, unknown> | undefined);
    }

    onSelect({
      name: item.name,
      displayName: item.displayName,
      internalName: item.internalName,
      type: item.type,
      toolInstructions,
    });
    setIsOpen(false);
    setSearchQuery('');
  };

  const filteredItems = items.filter((item) => matchesSearch(item, searchQuery));

  const groupedItems = filteredItems.reduce((acc, item) => {
    const category = item.category || 'Other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, ResourceItem[]>);

  const sortedCategories = Object.keys(groupedItems).sort((a, b) => {
    if (a === 'Custom') return -1;
    if (b === 'Custom') return 1;
    return a.localeCompare(b);
  });

  const emptyMessage = () => {
    if (items.length === 0) {
      switch (activeTab) {
        case 'tools': return 'No tools available';
        case 'custom-data': return 'No custom tables created yet';
        case 'builtin-data': return 'No built-in data available';
      }
    }
    return 'No results match your search';
  };

  const footerHint = () => {
    const q = searchQuery.trim().toLowerCase();
    if (q === 'all' || q === '*') return `Showing all ${filteredItems.length} items`;
    switch (activeTab) {
      case 'tools': return 'Search: "email send" finds send_email. Type "all" for everything.';
      case 'custom-data': return 'Click to attach a custom data table to your message';
      case 'builtin-data': return 'Click to attach built-in data with ready-to-use tool instructions';
    }
  };

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
        <div className="absolute bottom-full left-0 mb-2 w-96 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-lg overflow-hidden z-50">
          {/* Tab header */}
          <div className="flex border-b border-border dark:border-dark-border">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => { setActiveTab(tab.id); setSearchQuery(''); }}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors ${
                    isActive
                      ? 'text-primary border-b-2 border-primary bg-primary/5'
                      : 'text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary hover:bg-bg-secondary/50 dark:hover:bg-dark-bg-secondary/50'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Search */}
          <div className="p-3 border-b border-border dark:border-dark-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={activeTab === 'tools' ? 'Search tools... ("email send" or "all")' : `Search ${TABS.find(t => t.id === activeTab)?.label.toLowerCase()}...`}
                className="w-full pl-9 pr-8 py-2 bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted border border-border dark:border-dark-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {searchQuery && (
                <button type="button" onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Items list */}
          <div className="max-h-72 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-text-muted dark:text-dark-text-muted text-sm">Loading...</div>
            ) : filteredItems.length === 0 ? (
              <div className="p-4 text-center text-text-muted dark:text-dark-text-muted text-sm">{emptyMessage()}</div>
            ) : (
              <div className="p-2">
                {sortedCategories.map((category) => (
                  <div key={category} className="mb-2 last:mb-0">
                    <div className="px-2 py-1 text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                      {category}
                    </div>
                    {groupedItems[category].map((item) => (
                      <button
                        key={`${item.type}-${item.internalName || item.name}`}
                        type="button"
                        onClick={() => handleSelect(item)}
                        className="w-full flex items-start gap-3 px-2 py-2 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg text-left transition-colors group"
                      >
                        <div className={`mt-0.5 p-1.5 rounded-lg transition-colors ${getIconBg(item.type)}`}>
                          <span className={getIconColor(item.type)}>{getItemIcon(item)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate">
                              {item.displayName || item.name}
                            </span>
                            {item.type === 'custom-tool' && (
                              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full">custom</span>
                            )}
                            {item.recordCount !== undefined && (
                              <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-full">
                                {item.recordCount} records
                              </span>
                            )}
                          </div>
                          {item.type === 'custom-data' && item.internalName && item.internalName !== item.displayName && (
                            <div className="text-[11px] text-text-muted/70 dark:text-dark-text-muted/70 font-mono">{item.internalName}</div>
                          )}
                          <div className="text-xs text-text-muted dark:text-dark-text-muted line-clamp-1">{item.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-2 border-t border-border dark:border-dark-border bg-bg-secondary/50 dark:bg-dark-bg-secondary/50">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">{footerHint()}</p>
          </div>
        </div>
      )}
    </div>
  );
}
