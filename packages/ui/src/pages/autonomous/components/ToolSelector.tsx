/**
 * ToolSelector — Improved tool selection with clear status indicators
 *
 * Features:
 * - Visual badges for Allowed/Blocked/Neutral status
 * - Quick filter tabs (All, Selected, Blocked, Neutral)
 * - Category grouping (Core, MCP, Custom)
 * - Provider display
 * - Bulk actions
 */

import { useState, useMemo } from 'react';
import {
  Search,
  Component,
  Puzzle,
  Check,
  Ban,
  Minus,
  Layers,
  X,
  Wrench,
  Settings,
} from '../../../components/icons';

export interface Tool {
  name: string;
  description?: string;
  category: string;
  provider?: string;
}

interface Props {
  availableTools: Tool[];
  allowedTools: string[];
  blockedTools: string[];
  onChange: (allowed: string[], blocked: string[]) => void;
  readOnly?: boolean;
}

type FilterTab = 'all' | 'allowed' | 'blocked' | 'neutral';
type CategoryTab = 'all' | 'core' | 'mcp' | 'custom' | 'skill' | 'config';

const CATEGORY_INFO: Record<string, { label: string; icon: typeof Component; color: string }> = {
  core: { label: 'Core', icon: Component, color: 'text-primary' },
  mcp: { label: 'MCP', icon: Puzzle, color: 'text-purple-500' },
  custom: { label: 'Custom', icon: Layers, color: 'text-orange-500' },
  skill: { label: 'Skills', icon: Wrench, color: 'text-green-500' },
  config: { label: 'Config', icon: Settings, color: 'text-cyan-500' },
};

export function ToolSelector({
  availableTools,
  allowedTools,
  blockedTools,
  onChange,
  readOnly = false,
}: Props) {
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterTab>('all');
  const [activeCategory, setActiveCategory] = useState<CategoryTab>('all');

  const stats = useMemo(() => {
    return {
      total: availableTools.length,
      allowed: allowedTools.length,
      blocked: blockedTools.length,
      neutral: availableTools.length - allowedTools.length - blockedTools.length,
    };
  }, [availableTools, allowedTools, blockedTools]);

  const filteredTools = useMemo(() => {
    return availableTools.filter((tool) => {
      // Search filter
      if (search) {
        const q = search.toLowerCase();
        if (!tool.name.toLowerCase().includes(q) && !tool.description?.toLowerCase().includes(q)) {
          return false;
        }
      }

      // Status filter
      const isAllowed = allowedTools.includes(tool.name);
      const isBlocked = blockedTools.includes(tool.name);

      if (activeFilter === 'allowed' && !isAllowed) return false;
      if (activeFilter === 'blocked' && !isBlocked) return false;
      if (activeFilter === 'neutral' && (isAllowed || isBlocked)) return false;

      // Category filter
      if (activeCategory !== 'all' && tool.category !== activeCategory) return false;

      return true;
    });
  }, [availableTools, allowedTools, blockedTools, search, activeFilter, activeCategory]);

  const getToolStatus = (toolName: string): 'allowed' | 'blocked' | 'neutral' => {
    if (blockedTools.includes(toolName)) return 'blocked';
    if (allowedTools.includes(toolName)) return 'allowed';
    return 'neutral';
  };

  const allowTool = (toolName: string) => {
    if (readOnly) return;
    if (!allowedTools.includes(toolName)) {
      onChange(
        [...allowedTools, toolName],
        blockedTools.filter((t) => t !== toolName)
      );
    }
  };

  const blockTool = (toolName: string) => {
    if (readOnly) return;
    if (!blockedTools.includes(toolName)) {
      onChange(
        allowedTools.filter((t) => t !== toolName),
        [...blockedTools, toolName]
      );
    }
  };

  const neutralTool = (toolName: string) => {
    if (readOnly) return;
    onChange(
      allowedTools.filter((t) => t !== toolName),
      blockedTools.filter((t) => t !== toolName)
    );
  };

  const allowAll = () => {
    if (readOnly) return;
    const visibleToolNames = filteredTools.map((t) => t.name);
    const newAllowed = [...new Set([...allowedTools, ...visibleToolNames])];
    const newBlocked = blockedTools.filter((t) => !visibleToolNames.includes(t));
    onChange(newAllowed, newBlocked);
  };

  const blockAll = () => {
    if (readOnly) return;
    const visibleToolNames = filteredTools.map((t) => t.name);
    const newAllowed = allowedTools.filter((t) => !visibleToolNames.includes(t));
    const newBlocked = [...new Set([...blockedTools, ...visibleToolNames])];
    onChange(newAllowed, newBlocked);
  };

  const resetAll = () => {
    if (readOnly) return;
    const visibleToolNames = filteredTools.map((t) => t.name);
    onChange(
      allowedTools.filter((t) => !visibleToolNames.includes(t)),
      blockedTools.filter((t) => !visibleToolNames.includes(t))
    );
  };

  return (
    <div className="space-y-4 w-full">
      {/* Stats Summary */}
      <div className="grid grid-cols-4 gap-2">
        <StatCard
          label="Total"
          value={stats.total}
          active={activeFilter === 'all'}
          onClick={() => setActiveFilter('all')}
        />
        <StatCard
          label="Allowed"
          value={stats.allowed}
          color="text-success border-success/30 bg-success/5"
          active={activeFilter === 'allowed'}
          onClick={() => setActiveFilter('allowed')}
        />
        <StatCard
          label="Blocked"
          value={stats.blocked}
          color="text-danger border-danger/30 bg-danger/5"
          active={activeFilter === 'blocked'}
          onClick={() => setActiveFilter('blocked')}
        />
        <StatCard
          label="Neutral"
          value={stats.neutral}
          color="text-text-muted border-border"
          active={activeFilter === 'neutral'}
          onClick={() => setActiveFilter('neutral')}
        />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tools by name or description..."
          className="w-full pl-10 pr-4 py-2 text-sm rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary"
        />
        {search && (
          <button
            onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Category filters */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted">Category:</span>
        <div className="flex flex-wrap gap-1">
          <CategoryPill
            label="All"
            active={activeCategory === 'all'}
            onClick={() => setActiveCategory('all')}
          />
          <CategoryPill
            label="Core"
            icon={Component}
            active={activeCategory === 'core'}
            onClick={() => setActiveCategory('core')}
            color="text-primary"
          />
          <CategoryPill
            label="MCP"
            icon={Puzzle}
            active={activeCategory === 'mcp'}
            onClick={() => setActiveCategory('mcp')}
            color="text-purple-500"
          />
          <CategoryPill
            label="Custom"
            icon={Layers}
            active={activeCategory === 'custom'}
            onClick={() => setActiveCategory('custom')}
            color="text-orange-500"
          />
          <CategoryPill
            label="Skills"
            icon={Wrench}
            active={activeCategory === 'skill'}
            onClick={() => setActiveCategory('skill')}
            color="text-green-500"
          />
          <CategoryPill
            label="Config"
            icon={Settings}
            active={activeCategory === 'config'}
            onClick={() => setActiveCategory('config')}
            color="text-cyan-500"
          />
        </div>
      </div>

      {/* Bulk actions */}
      {!readOnly && filteredTools.length > 0 && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-text-muted">Bulk:</span>
          <button
            onClick={allowAll}
            className="px-2 py-1 rounded bg-success/10 text-success hover:bg-success/20 transition-colors"
          >
            Allow All Shown
          </button>
          <button
            onClick={blockAll}
            className="px-2 py-1 rounded bg-danger/10 text-danger hover:bg-danger/20 transition-colors"
          >
            Block All Shown
          </button>
          <button
            onClick={resetAll}
            className="px-2 py-1 rounded bg-bg-tertiary text-text-muted hover:bg-bg-secondary transition-colors"
          >
            Reset Shown
          </button>
        </div>
      )}

      {/* Tools list */}
      <div className="border border-border dark:border-dark-border rounded-lg overflow-hidden">
        <div className="max-h-[400px] overflow-y-auto">
          {filteredTools.length === 0 ? (
            <div className="p-8 text-center text-text-muted">
              <Layers className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No tools match your filters.</p>
            </div>
          ) : (
            <div className="divide-y divide-border dark:divide-dark-border">
              {filteredTools.map((tool) => {
                const status = getToolStatus(tool.name);
                const CategoryIcon = CATEGORY_INFO[tool.category]?.icon || Layers;
                const categoryColor = CATEGORY_INFO[tool.category]?.color || 'text-text-muted';

                return (
                  <div
                    key={tool.name}
                    className={`p-3 flex items-start gap-3 transition-colors ${
                      status === 'blocked'
                        ? 'bg-danger/5'
                        : status === 'allowed'
                          ? 'bg-success/5'
                          : 'hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                    }`}
                  >
                    {/* Status indicator */}
                    <div className="mt-0.5">
                      {status === 'allowed' && (
                        <div className="w-6 h-6 rounded-full bg-success/20 flex items-center justify-center">
                          <Check className="w-4 h-4 text-success" />
                        </div>
                      )}
                      {status === 'blocked' && (
                        <div className="w-6 h-6 rounded-full bg-danger/20 flex items-center justify-center">
                          <Ban className="w-4 h-4 text-danger" />
                        </div>
                      )}
                      {status === 'neutral' && (
                        <div className="w-6 h-6 rounded-full border-2 border-border dark:border-dark-border" />
                      )}
                    </div>

                    {/* Tool info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-text-primary dark:text-dark-text-primary">
                          {tool.name}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded flex items-center gap-1 ${categoryColor} bg-bg-tertiary dark:bg-dark-bg-tertiary`}
                        >
                          <CategoryIcon className="w-3 h-3" />
                          {tool.category}
                        </span>
                        {tool.provider && (
                          <span className="text-xs text-text-muted">• {tool.provider}</span>
                        )}
                      </div>
                      {tool.description && (
                        <p className="text-xs text-text-muted mt-0.5 line-clamp-2">
                          {tool.description}
                        </p>
                      )}
                    </div>

                    {/* Action buttons */}
                    {!readOnly && (
                      <div className="flex items-center gap-1">
                        <ActionButton
                          active={status === 'allowed'}
                          onClick={() => allowTool(tool.name)}
                          title="Allow this tool"
                          color="success"
                          icon={Check}
                        />
                        <ActionButton
                          active={status === 'neutral'}
                          onClick={() => neutralTool(tool.name)}
                          title="Reset to neutral"
                          color="muted"
                          icon={Minus}
                        />
                        <ActionButton
                          active={status === 'blocked'}
                          onClick={() => blockTool(tool.name)}
                          title="Block this tool"
                          color="danger"
                          icon={Ban}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-text-muted pt-2 border-t border-border dark:border-dark-border">
        <span className="flex items-center gap-1">
          <Check className="w-3 h-3 text-success" />
          Allowed: Tool is explicitly permitted
        </span>
        <span className="flex items-center gap-1">
          <Minus className="w-3 h-3 text-text-muted" />
          Neutral: Follows default behavior
        </span>
        <span className="flex items-center gap-1">
          <Ban className="w-3 h-3 text-danger" />
          Blocked: Tool is restricted
        </span>
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function StatCard({
  label,
  value,
  color,
  active,
  onClick,
}: {
  label: string;
  value: number;
  color?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`p-3 rounded-lg border text-center transition-all ${
        active
          ? color || 'border-primary bg-primary/5'
          : 'border-border dark:border-dark-border hover:border-primary/50'
      }`}
    >
      <div className={`text-xl font-bold ${color?.split(' ')[0] || 'text-text-primary'}`}>
        {value}
      </div>
      <div className="text-xs text-text-muted">{label}</div>
    </button>
  );
}

function CategoryPill({
  label,
  icon: Icon,
  active,
  onClick,
  color,
}: {
  label: string;
  icon?: typeof Component;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full transition-colors flex items-center gap-1 ${
        active
          ? 'bg-primary text-white'
          : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary hover:bg-bg-secondary'
      }`}
    >
      {Icon && <Icon className={`w-3 h-3 ${active ? '' : color}`} />}
      {label}
    </button>
  );
}

function ActionButton({
  active,
  onClick,
  title,
  color,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  color: 'success' | 'danger' | 'muted';
  icon: typeof Check;
}) {
  const colorClasses = {
    success: active ? 'bg-success text-white' : 'text-success hover:bg-success/10',
    danger: active ? 'bg-danger text-white' : 'text-danger hover:bg-danger/10',
    muted: active ? 'bg-text-muted text-white' : 'text-text-muted hover:bg-bg-tertiary',
  };

  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${colorClasses[color]}`}
    >
      <Icon className="w-4 h-4" />
    </button>
  );
}
