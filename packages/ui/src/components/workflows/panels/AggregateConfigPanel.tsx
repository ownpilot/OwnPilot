/**
 * AggregateConfigPanel — Config for aggregate nodes.
 * Performs aggregate operations (sum, count, avg, etc.) on arrays.
 */

import { X, BarChart, Trash2 } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { INPUT_CLS, OutputAliasField } from '../NodeConfigPanel';
import { TemplateValidator } from '../TemplateValidator';

const AGGREGATE_OPS = [
  'sum',
  'count',
  'avg',
  'min',
  'max',
  'groupBy',
  'flatten',
  'unique',
] as const;

export function AggregateConfigPanel({
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
        <BarChart className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1">
          Aggregate
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
            placeholder="Aggregate"
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

        {/* Operation */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Operation
          </label>
          <select
            value={(data.operation as string) ?? 'sum'}
            onChange={(e) => onUpdate(node.id, { ...data, operation: e.target.value })}
            className={INPUT_CLS}
          >
            {AGGREGATE_OPS.map((op) => (
              <option key={op} value={op}>
                {op.charAt(0).toUpperCase() + op.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Field */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Field
          </label>
          <input
            type="text"
            value={(data.field as string) ?? ''}
            onChange={(e) => onUpdate(node.id, { ...data, field: e.target.value || undefined })}
            placeholder="e.g. price, name"
            className={INPUT_CLS}
          />
          <p className="text-[10px] text-text-muted">Object field to operate on</p>
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
