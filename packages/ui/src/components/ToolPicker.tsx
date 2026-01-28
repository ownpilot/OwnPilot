import { useState, useEffect, useRef } from 'react';
import { Plus, Wrench, Search, X } from './icons';

interface Tool {
  name: string;
  description: string;
  category?: string;
  isCustom?: boolean;
}

interface ToolPickerProps {
  onSelect: (toolName: string) => void;
  disabled?: boolean;
}

export function ToolPicker({ onSelect, disabled }: ToolPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tools, setTools] = useState<Tool[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Fetch tools when opened
  useEffect(() => {
    if (isOpen) {
      fetchTools();
      // Focus search input when opened
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close on click outside
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

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  const fetchTools = async () => {
    setIsLoading(true);
    try {
      // Fetch custom tools
      const customResponse = await fetch('/api/v1/custom-tools?status=active');
      const customData = await customResponse.json();

      const customTools: Tool[] = (customData.data?.tools || []).map((t: any) => ({
        name: t.name,
        description: t.description,
        category: t.category || 'Custom',
        isCustom: true,
      }));

      setTools(customTools);
    } catch (error) {
      console.error('Failed to fetch tools:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelect = (tool: Tool) => {
    onSelect(tool.name);
    setIsOpen(false);
    setSearchQuery('');
  };

  // Filter tools by search query
  const filteredTools = tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tool.category?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Group tools by category
  const groupedTools = filteredTools.reduce((acc, tool) => {
    const category = tool.category || 'Other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(tool);
    return acc;
  }, {} as Record<string, Tool[]>);

  // Sort categories (Custom first)
  const sortedCategories = Object.keys(groupedTools).sort((a, b) => {
    if (a === 'Custom') return -1;
    if (b === 'Custom') return 1;
    return a.localeCompare(b);
  });

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="p-2 text-text-muted dark:text-dark-text-muted hover:text-primary dark:hover:text-primary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        title="Insert tool name"
      >
        <Plus className="w-5 h-5" />
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-80 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-lg overflow-hidden z-50">
          {/* Search header */}
          <div className="p-3 border-b border-border dark:border-dark-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tools..."
                className="w-full pl-9 pr-8 py-2 bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted border border-border dark:border-dark-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          {/* Tools list */}
          <div className="max-h-64 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-text-muted dark:text-dark-text-muted text-sm">
                Loading tools...
              </div>
            ) : filteredTools.length === 0 ? (
              <div className="p-4 text-center text-text-muted dark:text-dark-text-muted text-sm">
                {tools.length === 0
                  ? 'No custom tools available'
                  : 'No tools match your search'}
              </div>
            ) : (
              <div className="p-2">
                {sortedCategories.map((category) => (
                  <div key={category} className="mb-2 last:mb-0">
                    <div className="px-2 py-1 text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                      {category}
                    </div>
                    {groupedTools[category].map((tool) => (
                      <button
                        key={tool.name}
                        type="button"
                        onClick={() => handleSelect(tool)}
                        className="w-full flex items-start gap-3 px-2 py-2 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg text-left transition-colors group"
                      >
                        <div className="mt-0.5 p-1.5 bg-primary/10 rounded-lg group-hover:bg-primary/20 transition-colors">
                          <Wrench className="w-4 h-4 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm text-text-primary dark:text-dark-text-primary truncate">
                            {tool.name}
                          </div>
                          <div className="text-xs text-text-muted dark:text-dark-text-muted line-clamp-2">
                            {tool.description}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer hint */}
          <div className="px-3 py-2 border-t border-border dark:border-dark-border bg-bg-secondary/50 dark:bg-dark-bg-secondary/50">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Click to insert tool name into message
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
