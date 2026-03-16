/**
 * DataStoreConfigPanel — Config for data store nodes.
 * Key-value operations: get, set, delete, list, has.
 */

import { X, Database, Trash2 } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { INPUT_CLS, OutputAliasField } from '../NodeConfigPanel';

const OPERATIONS = ['get', 'set', 'delete', 'list', 'has'] as const;

export function DataStoreConfigPanel({
  node,
  upstreamNodes: _upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
}: NodeConfigPanelProps) {
  const data = node.data as Record<string, unknown>;
  const operation = (data.operation as string) ?? 'get';

  return (
    <div className="flex flex-col h-full border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border">
        <Database className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1">
          Data Store
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
            placeholder="Data Store"
            className={INPUT_CLS}
          />
        </div>

        {/* Operation */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Operation
          </label>
          <select
            value={operation}
            onChange={(e) => onUpdate(node.id, { ...data, operation: e.target.value })}
            className={INPUT_CLS}
          >
            {OPERATIONS.map((op) => (
              <option key={op} value={op}>
                {op.charAt(0).toUpperCase() + op.slice(1)}
              </option>
            ))}
          </select>
        </div>

        {/* Key */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Key
          </label>
          <input
            type="text"
            value={(data.key as string) ?? ''}
            onChange={(e) => onUpdate(node.id, { ...data, key: e.target.value })}
            placeholder="my_key or {{node_1.output.id}}"
            className={INPUT_CLS}
          />
          <p className="text-[10px] text-text-muted">{'Supports {{template}} expressions'}</p>
        </div>

        {/* Value — only for set */}
        {operation === 'set' && (
          <div className="space-y-1">
            <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
              Value
            </label>
            <textarea
              value={(data.value as string) ?? ''}
              onChange={(e) => onUpdate(node.id, { ...data, value: e.target.value })}
              placeholder="Value to store... Supports {{template}} expressions"
              rows={3}
              className={`${INPUT_CLS} resize-y`}
            />
          </div>
        )}

        {/* Namespace */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Namespace
          </label>
          <input
            type="text"
            value={(data.namespace as string) ?? ''}
            onChange={(e) => onUpdate(node.id, { ...data, namespace: e.target.value || undefined })}
            placeholder="default"
            className={INPUT_CLS}
          />
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
