import { useState, useEffect } from 'react';
import { Wrench } from '../components/icons';
import type { Tool, ApiResponse } from '../types';

interface CategoryInfo {
  icon: string;
  description: string;
}

interface GroupedTools {
  categories: Record<string, {
    info: CategoryInfo;
    tools: Tool[];
  }>;
  totalTools: number;
}

// Category display order
const CATEGORY_ORDER = [
  'core', 'filesystem', 'memory', 'goals',
  'tasks', 'bookmarks', 'notes', 'calendar', 'contacts',
  'customData', 'textUtils', 'dateTime', 'conversion',
  'generation', 'extraction', 'validation', 'listOps', 'mathStats',
  'plugins', 'other'
];

// Category display names
const CATEGORY_NAMES: Record<string, string> = {
  core: 'Core',
  filesystem: 'File System',
  memory: 'Memory',
  goals: 'Goals',
  tasks: 'Tasks',
  bookmarks: 'Bookmarks',
  notes: 'Notes',
  calendar: 'Calendar',
  contacts: 'Contacts',
  customData: 'Custom Data',
  textUtils: 'Text Utilities',
  dateTime: 'Date & Time',
  conversion: 'Conversion',
  generation: 'Generation',
  extraction: 'Extraction',
  validation: 'Validation',
  listOps: 'List Operations',
  mathStats: 'Math & Stats',
  plugins: 'Plugins',
  other: 'Other',
};

export function ToolsPage() {
  const [groupedTools, setGroupedTools] = useState<GroupedTools | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(CATEGORY_ORDER));
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchTools();
  }, []);

  const fetchTools = async () => {
    try {
      const response = await fetch('/api/v1/tools?grouped=true');
      const data: ApiResponse<GroupedTools> = await response.json();
      if (data.success && data.data) {
        setGroupedTools(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch tools:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const expandAll = () => setExpandedCategories(new Set(CATEGORY_ORDER));
  const collapseAll = () => setExpandedCategories(new Set());

  // Filter tools by search
  const filterTools = (tools: Tool[]) => {
    if (!searchQuery) return tools;
    const query = searchQuery.toLowerCase();
    return tools.filter(t =>
      t.name.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query)
    );
  };

  // Sort categories by defined order
  const sortedCategories = groupedTools
    ? Object.entries(groupedTools.categories).sort(([a], [b]) => {
        const aIndex = CATEGORY_ORDER.indexOf(a);
        const bIndex = CATEGORY_ORDER.indexOf(b);
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      })
    : [];

  // Count total filtered tools
  const filteredTotal = sortedCategories.reduce((sum, [, cat]) =>
    sum + filterTools(cat.tools).length, 0
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Tools
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {groupedTools ? `${groupedTools.totalTools} tools in ${Object.keys(groupedTools.categories).length} categories` : 'Loading...'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Search */}
          <input
            type="text"
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 w-48"
          />
          {/* Expand/Collapse */}
          <button
            onClick={expandAll}
            className="px-3 py-1.5 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-1.5 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Collapse All
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted dark:text-dark-text-muted">Loading tools...</p>
          </div>
        ) : !groupedTools || filteredTotal === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Wrench className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
            <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
              {searchQuery ? 'No tools match your search' : 'No tools available'}
            </h3>
            <p className="text-text-muted dark:text-dark-text-muted">
              {searchQuery ? 'Try a different search term.' : 'Tools will appear here when configured.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {sortedCategories.map(([categoryId, category]) => {
              const filteredTools = filterTools(category.tools);
              if (filteredTools.length === 0) return null;

              const isExpanded = expandedCategories.has(categoryId);

              return (
                <div
                  key={categoryId}
                  className="border border-border dark:border-dark-border rounded-xl overflow-hidden"
                >
                  {/* Category Header */}
                  <button
                    onClick={() => toggleCategory(categoryId)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-bg-secondary dark:bg-dark-bg-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{category.info.icon}</span>
                      <div className="text-left">
                        <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
                          {CATEGORY_NAMES[categoryId] || categoryId}
                        </h3>
                        <p className="text-xs text-text-muted dark:text-dark-text-muted">
                          {category.info.description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded-full">
                        {filteredTools.length} tools
                      </span>
                      <svg
                        className={`w-5 h-5 text-text-muted transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Category Tools */}
                  {isExpanded && (
                    <div className="p-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3 bg-bg-primary dark:bg-dark-bg-primary">
                      {filteredTools.map((tool) => (
                        <ToolCard
                          key={tool.name}
                          tool={tool}
                          onClick={() => setSelectedTool(tool)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Tool Detail Modal */}
      {selectedTool && (
        <ToolDetailModal tool={selectedTool} onClose={() => setSelectedTool(null)} />
      )}
    </div>
  );
}

interface ToolCardProps {
  tool: Tool;
  onClick: () => void;
}

function ToolCard({ tool, onClick }: ToolCardProps) {
  return (
    <button
      onClick={onClick}
      className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg text-left hover:border-primary transition-colors"
    >
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Wrench className="w-4 h-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate">
            {tool.name}
          </h4>
          <p className="text-xs text-text-muted dark:text-dark-text-muted line-clamp-2 mt-0.5">
            {tool.description}
          </p>
        </div>
      </div>
    </button>
  );
}

interface ToolDetailModalProps {
  tool: Tool;
  onClose: () => void;
}

function ToolDetailModal({ tool, onClose }: ToolDetailModalProps) {
  const [testInput, setTestInput] = useState('');
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);

    try {
      let args: Record<string, unknown> = {};
      try {
        args = testInput ? JSON.parse(testInput) : {};
      } catch {
        setTestResult('Error: Invalid JSON input');
        return;
      }

      const response = await fetch(`/api/v1/tools/${tool.name}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arguments: args }),
      });

      const data = await response.json();
      setTestResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setTestResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            {tool.name}
          </h3>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
            {tool.description}
          </p>
          {tool.category && (
            <span className="inline-block mt-2 px-2 py-0.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary rounded">
              {CATEGORY_NAMES[tool.category] || tool.category}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Parameters */}
          <div>
            <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
              Parameters
            </h4>
            <pre className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-sm text-text-primary dark:text-dark-text-primary overflow-x-auto">
              {JSON.stringify(tool.parameters, null, 2)}
            </pre>
          </div>

          {/* Test Tool */}
          <div>
            <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
              Test Tool
            </h4>
            <textarea
              value={testInput}
              onChange={(e) => setTestInput(e.target.value)}
              placeholder='{"expression": "2 + 2"}'
              rows={3}
              className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            />
            <button
              onClick={handleTest}
              disabled={isTesting}
              className="mt-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isTesting ? 'Running...' : 'Run Tool'}
            </button>

            {testResult && (
              <pre className="mt-4 p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-sm text-text-primary dark:text-dark-text-primary overflow-x-auto">
                {testResult}
              </pre>
            )}
          </div>
        </div>

        <div className="p-4 border-t border-border dark:border-dark-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
