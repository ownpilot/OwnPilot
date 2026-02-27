/**
 * MergeConfigPanel — Config for merge/wait nodes.
 * Mode selector (waitAll vs firstCompleted), output alias.
 */

import { X, GitMerge, Trash2 } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { INPUT_CLS, OutputAliasField } from '../NodeConfigPanel';

export function MergeConfigPanel({ node, onUpdate, onDelete, onClose }: NodeConfigPanelProps) {
  const data = node.data as Record<string, unknown>;

  return (
    <div className="flex flex-col h-full border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border">
        <GitMerge className="w-4 h-4 text-teal-600 dark:text-teal-400" />
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1">
          Merge / Wait
        </h3>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Label */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Label
          </label>
          <input
            type="text"
            value={(data.label as string) ?? ''}
            onChange={(e) => onUpdate(node.id, { ...data, label: e.target.value })}
            placeholder="Merge"
            className={INPUT_CLS}
          />
        </div>

        {/* Mode */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Merge Mode
          </label>
          <select
            value={(data.mode as string) ?? 'waitAll'}
            onChange={(e) => onUpdate(node.id, { ...data, mode: e.target.value })}
            className={INPUT_CLS}
          >
            <option value="waitAll">Wait for All — collect all inputs</option>
            <option value="firstCompleted">First Completed — use first result</option>
          </select>
          <p className="text-[10px] text-text-muted">
            {(data.mode as string) === 'firstCompleted'
              ? 'Uses the result of whichever upstream node completes first'
              : 'Waits for all incoming branches and collects results into an array'}
          </p>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Description
          </label>
          <input
            type="text"
            value={(data.description as string) ?? ''}
            onChange={(e) => onUpdate(node.id, { ...data, description: e.target.value || undefined })}
            placeholder="Optional description..."
            className={INPUT_CLS}
          />
        </div>

        <OutputAliasField data={data} nodeId={node.id} onUpdate={onUpdate} />
      </div>

      <div className="p-4 border-t border-border dark:border-dark-border">
        <button
          onClick={() => onDelete(node.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 rounded-md transition-colors w-full justify-center"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Node
        </button>
      </div>
    </div>
  );
}
