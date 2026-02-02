import { useState, useEffect } from 'react';
import { Wrench } from '../../components/icons';
import { toolsApi } from '../../api';
import type { GroupedTools, ToolItem } from './types';
import { CATEGORY_ORDER, CATEGORY_NAMES } from './constants';
import { ToolCard } from './ToolCard';
import { ToolDetailModal } from './ToolDetailModal';

export function ToolsPage() {
  const [groupedTools, setGroupedTools] = useState<GroupedTools | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTool, setSelectedTool] = useState<ToolItem | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(CATEGORY_ORDER));
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const fetchTools = async () => {
      try {
        const data = await toolsApi.listGrouped();
        setGroupedTools(data as unknown as GroupedTools);
      } catch {
        // API client handles error reporting
      } finally {
        setIsLoading(false);
      }
    };
    fetchTools();
  }, []);

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const expandAll = () => setExpandedCategories(new Set(CATEGORY_ORDER));
  const collapseAll = () => setExpandedCategories(new Set());

  const filterTools = (tools: ToolItem[]) => {
    if (!searchQuery) return tools;
    const query = searchQuery.toLowerCase();
    return tools.filter(t =>
      t.name.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query)
    );
  };

  const sortedCategories = groupedTools
    ? Object.entries(groupedTools.categories).sort(([a], [b]) => {
        const aIndex = CATEGORY_ORDER.indexOf(a);
        const bIndex = CATEGORY_ORDER.indexOf(b);
        return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
      })
    : [];

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
          <input
            type="text"
            placeholder="Search tools..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="px-3 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 w-48"
          />
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

      {selectedTool && (
        <ToolDetailModal tool={selectedTool} onClose={() => setSelectedTool(null)} />
      )}
    </div>
  );
}
