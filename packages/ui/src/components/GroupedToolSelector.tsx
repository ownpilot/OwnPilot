/**
 * Grouped Tool Selector
 *
 * Displays tools organized by category with group-level select/deselect.
 * Users can select an entire category at once, then deselect individual tools.
 */

import { useState, useEffect, useMemo } from 'react';
import { toolsApi } from '../api';
import { LoadingSpinner } from './LoadingSpinner';
import type { Tool } from '../types';

interface CategoryData {
  info: { icon: string; description: string };
  tools: Tool[];
}

export interface GroupedToolSelectorProps {
  selectedTools: string[];
  onSelectionChange: (tools: string[]) => void;
}

export function GroupedToolSelector({ selectedTools, onSelectionChange }: GroupedToolSelectorProps) {
  const [categories, setCategories] = useState<Record<string, CategoryData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  useEffect(() => {
    const fetchGroupedTools = async () => {
      try {
        const data = await toolsApi.listGrouped();
        setCategories(data.categories);
      } catch {
        // API client handles error reporting
      } finally {
        setIsLoading(false);
      }
    };
    fetchGroupedTools();
  }, []);

  const toggleTool = (toolName: string) => {
    onSelectionChange(
      selectedTools.includes(toolName)
        ? selectedTools.filter((t) => t !== toolName)
        : [...selectedTools, toolName]
    );
  };

  const toggleCategory = (categoryTools: Tool[]) => {
    const toolNames = categoryTools.map((t) => t.name);
    const allSelected = toolNames.every((name) => selectedTools.includes(name));

    if (allSelected) {
      // Deselect all tools in this category
      onSelectionChange(selectedTools.filter((t) => !toolNames.includes(t)));
    } else {
      // Select all tools in this category
      const newTools = toolNames.filter((name) => !selectedTools.includes(name));
      onSelectionChange([...selectedTools, ...newTools]);
    }
  };

  const toggleCollapse = (category: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const selectAll = () => {
    const allTools = Object.values(categories).flatMap((cat) => cat.tools.map((t) => t.name));
    onSelectionChange(allTools);
  };

  const deselectAll = () => {
    onSelectionChange([]);
  };

  // Filter categories and tools by search query
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;

    const query = searchQuery.toLowerCase();
    const result: Record<string, CategoryData> = {};

    for (const [key, category] of Object.entries(categories)) {
      const matchingTools = category.tools.filter(
        (tool) =>
          tool.name.toLowerCase().includes(query) ||
          tool.description.toLowerCase().includes(query)
      );
      if (matchingTools.length > 0) {
        result[key] = { ...category, tools: matchingTools };
      }
    }

    return result;
  }, [categories, searchQuery]);

  const totalTools = useMemo(
    () => Object.values(categories).reduce((sum, cat) => sum + cat.tools.length, 0),
    [categories]
  );

  if (isLoading) {
    return <LoadingSpinner size="sm" message="Loading tools..." />;
  }

  if (Object.keys(categories).length === 0) {
    return (
      <p className="text-text-muted dark:text-dark-text-muted text-center py-8">
        No tools available.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 pl-8 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            placeholder="Search tools..."
          />
          <svg
            className="absolute left-2.5 top-2.5 w-4 h-4 text-text-muted dark:text-dark-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted dark:text-dark-text-muted whitespace-nowrap">
            {selectedTools.length}/{totalTools}
          </span>
          <button
            onClick={selectAll}
            className="px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded transition-colors"
          >
            Select All
          </button>
          <button
            onClick={deselectAll}
            className="px-2 py-1 text-xs text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Category groups */}
      <div className="space-y-3">
        {Object.entries(filteredCategories).map(([categoryKey, category]) => {
          const toolNames = category.tools.map((t) => t.name);
          const selectedCount = toolNames.filter((name) => selectedTools.includes(name)).length;
          const allSelected = selectedCount === toolNames.length;
          const someSelected = selectedCount > 0 && !allSelected;
          const isCollapsed = collapsedCategories.has(categoryKey);

          return (
            <div
              key={categoryKey}
              className="border border-border dark:border-dark-border rounded-lg overflow-hidden"
            >
              {/* Category header */}
              <div className="flex items-center gap-2 px-3 py-2.5 bg-bg-secondary dark:bg-dark-bg-secondary">
                <button
                  onClick={() => toggleCollapse(categoryKey)}
                  className="flex items-center gap-2 flex-1 text-left"
                >
                  <svg
                    className={`w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted transition-transform ${
                      isCollapsed ? '' : 'rotate-90'
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                  <span className="text-base" role="img" aria-label={categoryKey}>
                    {category.info.icon}
                  </span>
                  <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary capitalize">
                    {categoryKey}
                  </span>
                  <span className="text-xs text-text-muted dark:text-dark-text-muted">
                    — {category.info.description}
                  </span>
                </button>

                <span className="text-xs text-text-muted dark:text-dark-text-muted mr-2">
                  {selectedCount}/{toolNames.length}
                </span>

                {/* Category toggle button */}
                <button
                  onClick={() => toggleCategory(category.tools)}
                  className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                    allSelected
                      ? 'bg-primary/10 text-primary hover:bg-primary/20'
                      : someSelected
                        ? 'bg-primary/5 text-primary hover:bg-primary/10'
                        : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
                  }`}
                >
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              {/* Tools list */}
              {!isCollapsed && (
                <div className="divide-y divide-border dark:divide-dark-border">
                  {category.tools.map((tool) => {
                    const isSelected = selectedTools.includes(tool.name);
                    return (
                      <button
                        key={tool.name}
                        onClick={() => toggleTool(tool.name)}
                        className={`w-full px-3 py-2 text-left flex items-center gap-3 transition-colors ${
                          isSelected
                            ? 'bg-primary/5'
                            : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                        }`}
                      >
                        {/* Checkbox indicator */}
                        <div
                          className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-colors ${
                            isSelected
                              ? 'bg-primary border-primary'
                              : 'border-border dark:border-dark-border'
                          }`}
                        >
                          {isSelected && (
                            <svg
                              className="w-3 h-3 text-white"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={3}
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                            {tool.name}
                          </span>
                          <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                            {tool.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
