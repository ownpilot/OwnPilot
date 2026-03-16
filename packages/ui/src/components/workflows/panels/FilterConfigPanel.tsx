/**
 * FilterConfigPanel — Config for filter nodes.
 * Filters an array using a condition expression with item/index variables.
 */

import { X, Filter, Trash2 } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { INPUT_CLS, OutputAliasField, RetryTimeoutFields } from '../NodeConfigPanel';
import { TemplateValidator } from '../TemplateValidator';

export function FilterConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
}: NodeConfigPanelProps) {
  const data = node.data as Record<string, unknown>;
  const arrayExpr = (data.arrayExpression as string) ?? '';

  return (
    <div className="flex flex-col h-full border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border">
        <Filter className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1">
          Filter
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
            placeholder="Filter"
            className={INPUT_CLS}
          />
        </div>

        {/* Array Expression */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Array Expression
          </label>
          <input
            type="text"
            value={arrayExpr}
            onChange={(e) => onUpdate(node.id, { ...data, arrayExpression: e.target.value })}
            placeholder="{{node_1.output.items}}"
            className={INPUT_CLS}
          />
          <TemplateValidator value={arrayExpr} upstreamNodes={upstreamNodes} />
        </div>

        {/* Condition */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Condition
          </label>
          <textarea
            value={(data.condition as string) ?? ''}
            onChange={(e) => onUpdate(node.id, { ...data, condition: e.target.value })}
            placeholder="item.status === 'active'"
            rows={3}
            className={`${INPUT_CLS} resize-y font-mono text-xs`}
          />
          <p className="text-[10px] text-text-muted">
            Use <code className="font-mono">item</code> and <code className="font-mono">index</code>{' '}
            variables
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
            onChange={(e) =>
              onUpdate(node.id, { ...data, description: e.target.value || undefined })
            }
            placeholder="Optional description..."
            className={INPUT_CLS}
          />
        </div>

        <OutputAliasField data={data} nodeId={node.id} onUpdate={onUpdate} />
        <RetryTimeoutFields data={data} nodeId={node.id} onUpdate={onUpdate} />
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
