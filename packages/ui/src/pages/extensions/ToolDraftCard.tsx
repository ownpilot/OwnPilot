import { useState } from 'react';
import { ChevronDown, ChevronRight, Trash2 } from '../../components/icons';
import type { ToolDraft } from './constants';
import { TOOL_PERMISSIONS } from './constants';

interface ToolDraftCardProps {
  tool: ToolDraft;
  index: number;
  onUpdate: (updates: Partial<ToolDraft>) => void;
  onRemove: () => void;
  onToggleExpanded: () => void;
  onTogglePermission: (perm: string) => void;
}

export function ToolDraftCard({
  tool,
  index,
  onUpdate,
  onRemove,
  onToggleExpanded,
  onTogglePermission,
}: ToolDraftCardProps) {
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!tool.expanded) {
    return (
      <button
        onClick={onToggleExpanded}
        className="w-full flex items-center justify-between p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-left hover:border-primary/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <ChevronRight className="w-4 h-4 text-text-muted shrink-0" />
          <span className="text-sm font-medium font-mono text-text-primary dark:text-dark-text-primary">
            {tool.name || `tool_${index + 1}`}
          </span>
          <span className="text-xs text-text-muted dark:text-dark-text-muted truncate">
            {tool.description || 'No description'}
          </span>
        </div>
        {tool.permissions.length > 0 && (
          <span className="px-2 py-0.5 text-xs rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400 shrink-0 ml-2">
            {tool.permissions.length} perm
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <button
          onClick={onToggleExpanded}
          className="flex items-center gap-2 text-sm font-medium text-text-primary dark:text-dark-text-primary"
        >
          <ChevronDown className="w-4 h-4 text-text-muted" />
          Tool {index + 1}
        </button>
        {!confirmRemove ? (
          <button
            onClick={() => setConfirmRemove(true)}
            className="text-xs text-text-muted hover:text-error transition-colors flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>
        ) : (
          <button
            onClick={() => {
              onRemove();
              setConfirmRemove(false);
            }}
            className="text-xs text-error font-medium flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Click again to confirm
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
          Tool Name *
        </label>
        <input
          type="text"
          value={tool.name}
          onChange={(e) =>
            onUpdate({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })
          }
          placeholder="my_tool_name"
          className="w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
          Description *
        </label>
        <textarea
          value={tool.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          rows={2}
          placeholder="What does this tool do?"
          className="w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
          Parameters (JSON Schema) *
        </label>
        <textarea
          value={tool.parameters}
          onChange={(e) => onUpdate({ parameters: e.target.value })}
          rows={6}
          className="w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
          Implementation (JavaScript) *
        </label>
        <textarea
          value={tool.code}
          onChange={(e) => onUpdate({ code: e.target.value })}
          rows={8}
          className="w-full px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
        <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
          Access arguments via{' '}
          <code className="px-1 bg-bg-secondary dark:bg-dark-bg-secondary rounded">args</code>{' '}
          object. Return{' '}
          <code className="px-1 bg-bg-secondary dark:bg-dark-bg-secondary rounded">
            {'{ content: { ... } }'}
          </code>
          .
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1.5">
          Permissions
        </label>
        <div className="flex flex-wrap gap-2">
          {TOOL_PERMISSIONS.map((perm) => (
            <button
              key={perm}
              type="button"
              onClick={() => onTogglePermission(perm)}
              className={`px-3 py-1 text-xs rounded-lg border transition-colors ${
                tool.permissions.includes(perm)
                  ? 'bg-orange-500/10 border-orange-500/50 text-orange-600 dark:text-orange-400'
                  : 'border-border dark:border-dark-border text-text-muted hover:border-primary/50'
              }`}
            >
              {perm}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id={`approval-${index}`}
          checked={tool.requiresApproval}
          onChange={(e) => onUpdate({ requiresApproval: e.target.checked })}
          className="w-4 h-4 rounded border-border dark:border-dark-border text-primary focus:ring-primary"
        />
        <label
          htmlFor={`approval-${index}`}
          className="text-xs text-text-secondary dark:text-dark-text-secondary"
        >
          Require user approval before each execution
        </label>
      </div>
    </div>
  );
}
