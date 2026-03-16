/**
 * SchemaValidatorConfigPanel — Config for schema validation nodes.
 * Validates data against a JSON schema with optional strict mode.
 */

import { useState } from 'react';
import { X, Shield, Trash2 } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { INPUT_CLS, OutputAliasField, RetryTimeoutFields } from '../NodeConfigPanel';

export function SchemaValidatorConfigPanel({
  node,
  upstreamNodes: _upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
}: NodeConfigPanelProps) {
  const data = node.data as Record<string, unknown>;
  const schema = (data.schema as string) ?? '';
  const [parseError, setParseError] = useState<string | null>(null);

  const handleSchemaChange = (value: string) => {
    onUpdate(node.id, { ...data, schema: value });
    if (!value.trim()) {
      setParseError(null);
      return;
    }
    try {
      JSON.parse(value);
      setParseError(null);
    } catch {
      setParseError('Invalid JSON');
    }
  };

  return (
    <div className="flex flex-col h-full border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border">
        <Shield className="w-4 h-4 text-orange-600 dark:text-orange-400" />
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1">
          Schema Validator
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
            placeholder="Schema Validator"
            className={INPUT_CLS}
          />
        </div>

        {/* Schema */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Schema (JSON)
          </label>
          <textarea
            value={schema}
            onChange={(e) => handleSchemaChange(e.target.value)}
            placeholder='{"type": "object", "properties": {...}}'
            rows={6}
            className={`${INPUT_CLS} resize-y font-mono text-xs`}
          />
          {parseError && <p className="text-[10px] text-error">{parseError}</p>}
        </div>

        {/* Strict Mode */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="strictMode"
            checked={(data.strictMode as boolean) ?? false}
            onChange={(e) =>
              onUpdate(node.id, { ...data, strictMode: e.target.checked || undefined })
            }
            className="rounded border-border dark:border-dark-border"
          />
          <label
            htmlFor="strictMode"
            className="text-xs font-medium text-text-muted dark:text-dark-text-muted"
          >
            Strict Mode
          </label>
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
