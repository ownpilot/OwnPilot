/**
 * Variables Panel — key-value editor for workflow variables.
 * Supports string, number, boolean, and JSON value types.
 * Variables are accessible in templates as {{variables.key}}.
 */

import { useState, useCallback } from 'react';
import { Plus, Trash2, X, Eye, EyeOff } from '../icons';

interface VariablesPanelProps {
  variables: Record<string, unknown>;
  onChange: (variables: Record<string, unknown>) => void;
  onClose: () => void;
  className?: string;
}

type VarType = 'string' | 'number' | 'boolean' | 'json';

function detectType(value: unknown): VarType {
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'object' && value !== null) return 'json';
  return 'string';
}

function parseValue(raw: string, type: VarType): unknown {
  switch (type) {
    case 'number':
      return Number(raw) || 0;
    case 'boolean':
      return raw === 'true';
    case 'json':
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    default:
      return raw;
  }
}

function formatValue(value: unknown): string {
  if (typeof value === 'object' && value !== null) return JSON.stringify(value, null, 2);
  return String(value ?? '');
}

const INPUT_CLS =
  'w-full px-2.5 py-1.5 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function VariablesPanel({
  variables,
  onChange,
  onClose,
  className = '',
}: VariablesPanelProps) {
  const [newKey, setNewKey] = useState('');
  const [maskedKeys, setMaskedKeys] = useState<Set<string>>(new Set());

  const entries = Object.entries(variables);

  const handleAdd = useCallback(() => {
    const key = newKey.trim();
    if (!key || key in variables) return;
    onChange({ ...variables, [key]: '' });
    setNewKey('');
  }, [newKey, variables, onChange]);

  const handleDelete = useCallback(
    (key: string) => {
      const next = { ...variables };
      delete next[key];
      onChange(next);
      setMaskedKeys((prev) => {
        const s = new Set(prev);
        s.delete(key);
        return s;
      });
    },
    [variables, onChange]
  );

  const handleValueChange = useCallback(
    (key: string, raw: string, type: VarType) => {
      onChange({ ...variables, [key]: parseValue(raw, type) });
    },
    [variables, onChange]
  );

  const handleTypeChange = useCallback(
    (key: string, newType: VarType) => {
      const current = variables[key];
      const converted = parseValue(formatValue(current), newType);
      onChange({ ...variables, [key]: converted });
    },
    [variables, onChange]
  );

  const toggleMask = useCallback((key: string) => {
    setMaskedKeys((prev) => {
      const s = new Set(prev);
      if (s.has(key)) s.delete(key);
      else s.add(key);
      return s;
    });
  }, []);

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary overflow-hidden ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-dark-border">
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
          Variables
        </h3>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Help text */}
      <div className="px-4 py-2 text-[10px] text-text-muted dark:text-dark-text-muted border-b border-border dark:border-dark-border">
        Use{' '}
        <code className="px-1 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-[10px]">
          {'{{variables.key}}'}
        </code>{' '}
        in node templates to reference these values.
      </div>

      {/* Variable list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {entries.length === 0 && (
          <p className="text-xs text-text-muted dark:text-dark-text-muted text-center py-4">
            No variables defined yet.
          </p>
        )}

        {entries.map(([key, value]) => {
          const type = detectType(value);
          const isMasked = maskedKeys.has(key);

          return (
            <div
              key={key}
              className="p-2.5 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md space-y-2"
            >
              {/* Key + actions */}
              <div className="flex items-center gap-1.5">
                <code className="flex-1 text-xs font-medium text-text-primary dark:text-dark-text-primary truncate">
                  {key}
                </code>
                <select
                  value={type}
                  onChange={(e) => handleTypeChange(key, e.target.value as VarType)}
                  className="px-1.5 py-0.5 text-[10px] bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded text-text-secondary dark:text-dark-text-secondary focus:outline-none"
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="json">json</option>
                </select>
                <button
                  onClick={() => toggleMask(key)}
                  className="p-0.5 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
                  title={isMasked ? 'Show value' : 'Hide value'}
                >
                  {isMasked ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
                <button
                  onClick={() => handleDelete(key)}
                  className="p-0.5 text-text-muted hover:text-error transition-colors"
                  title="Delete variable"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>

              {/* Value input */}
              {type === 'boolean' ? (
                <select
                  value={String(value)}
                  onChange={(e) => handleValueChange(key, e.target.value, type)}
                  className={INPUT_CLS}
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : type === 'json' ? (
                <textarea
                  value={isMasked ? '********' : formatValue(value)}
                  onChange={(e) => handleValueChange(key, e.target.value, type)}
                  readOnly={isMasked}
                  className={`${INPUT_CLS} min-h-[60px] font-mono resize-y`}
                  placeholder="{}"
                />
              ) : (
                <input
                  type={isMasked ? 'password' : type === 'number' ? 'number' : 'text'}
                  value={isMasked ? '********' : formatValue(value)}
                  onChange={(e) => handleValueChange(key, e.target.value, type)}
                  readOnly={isMasked}
                  className={INPUT_CLS}
                  placeholder={type === 'number' ? '0' : 'value...'}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Add new variable */}
      <div className="px-3 py-3 border-t border-border dark:border-dark-border">
        <div className="flex gap-1.5">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            className={`flex-1 ${INPUT_CLS}`}
            placeholder="Variable name..."
          />
          <button
            onClick={handleAdd}
            disabled={!newKey.trim() || newKey.trim() in variables}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-primary text-white hover:bg-primary-dark rounded-md transition-colors disabled:opacity-50"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
