/**
 * Schema Form Fields — generates typed input fields from a tool's JSON Schema.
 * Each field has an expression toggle to switch between literal values and {{...}} templates.
 */

import { useState, useCallback } from 'react';
import { Code } from '../icons';
import type { ToolParams, ToolParamProperty } from '../../pages/tools/types';

interface SchemaFormFieldsProps {
  schema: ToolParams | undefined;
  toolArgs: Record<string, unknown>;
  onFieldChange: (name: string, value: unknown) => void;
  onFieldFocus: (name: string) => void;
  focusedField: string | null;
}

const typeColors: Record<string, string> = {
  string: 'bg-green-500/10 text-green-500',
  number: 'bg-blue-500/10 text-blue-500',
  integer: 'bg-blue-500/10 text-blue-500',
  boolean: 'bg-amber-500/10 text-amber-500',
  array: 'bg-cyan-500/10 text-cyan-500',
  object: 'bg-orange-500/10 text-orange-500',
};

/** Detect if a value is a template expression */
function isExpression(value: unknown): boolean {
  return typeof value === 'string' && /\{\{.*\}\}/.test(value);
}

const INPUT_CLASSES =
  'w-full px-2.5 py-1.5 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function SchemaFormFields({ schema, toolArgs, onFieldChange, onFieldFocus, focusedField }: SchemaFormFieldsProps) {
  const properties = schema?.properties ?? {};
  const requiredFields = schema?.required ?? [];
  const paramNames = Object.keys(properties);

  if (paramNames.length === 0) {
    return (
      <p className="text-xs text-text-muted dark:text-dark-text-muted">
        This tool has no parameters.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {paramNames.map((name) => {
        const prop = properties[name]!;
        const isRequired = requiredFields.includes(name);
        const currentValue = toolArgs[name];
        return (
          <FieldRow
            key={name}
            name={name}
            prop={prop}
            isRequired={isRequired}
            value={currentValue}
            isFocused={focusedField === name}
            onChange={(val) => onFieldChange(name, val)}
            onFocus={() => onFieldFocus(name)}
          />
        );
      })}
    </div>
  );
}

interface FieldRowProps {
  name: string;
  prop: ToolParamProperty;
  isRequired: boolean;
  value: unknown;
  isFocused: boolean;
  onChange: (val: unknown) => void;
  onFocus: () => void;
}

function FieldRow({ name, prop, isRequired, value, isFocused, onChange, onFocus }: FieldRowProps) {
  const type = prop?.type ?? 'string';
  const autoExpr = isExpression(value);
  const [manualExpr, setManualExpr] = useState(false);
  const exprMode = autoExpr || manualExpr;

  const toggleExpr = useCallback(() => {
    setManualExpr((prev) => !prev);
  }, []);

  return (
    <div>
      {/* Label row */}
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary font-mono">
          {name}
        </span>
        <span className={`px-1 py-0 text-[9px] font-medium rounded font-mono ${typeColors[type] ?? 'bg-gray-500/10 text-gray-500'}`}>
          {type}
        </span>
        {isRequired && <span className="text-[9px] text-red-500 font-medium">*</span>}
        <button
          onClick={toggleExpr}
          className={`ml-auto p-0.5 rounded transition-colors ${
            exprMode
              ? 'bg-primary/20 text-primary'
              : 'text-text-muted hover:text-text-secondary'
          }`}
          title={exprMode ? 'Switch to literal value' : 'Switch to expression {{...}}'}
        >
          <Code className="w-3 h-3" />
        </button>
      </div>

      {/* Description */}
      {prop?.description && (
        <p className="text-[10px] text-text-muted dark:text-dark-text-muted mb-1 leading-relaxed">
          {prop.description}
        </p>
      )}

      {/* Input */}
      {exprMode ? (
        <input
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          placeholder="{{node_1.output.field}}"
          className={`${INPUT_CLASSES} font-mono border-primary/40 ${isFocused ? 'ring-1 ring-primary' : ''}`}
        />
      ) : (
        <TypedInput
          type={type}
          prop={prop}
          value={value}
          onChange={onChange}
          onFocus={onFocus}
          isFocused={isFocused}
        />
      )}
    </div>
  );
}

interface TypedInputProps {
  type: string;
  prop: ToolParamProperty;
  value: unknown;
  onChange: (val: unknown) => void;
  onFocus: () => void;
  isFocused: boolean;
}

function TypedInput({ type, prop, value, onChange, onFocus, isFocused }: TypedInputProps) {
  const focusRing = isFocused ? 'ring-1 ring-primary' : '';

  if (prop?.enum) {
    return (
      <select
        value={value != null ? String(value) : ''}
        onChange={(e) => {
          const v = e.target.value;
          if (type === 'number' || type === 'integer') {
            onChange(v === '' ? undefined : Number(v));
          } else {
            onChange(v || undefined);
          }
        }}
        onFocus={onFocus}
        className={`${INPUT_CLASSES} ${focusRing}`}
      >
        <option value="">-- select --</option>
        {prop.enum.map((val) => (
          <option key={val} value={val}>{val}</option>
        ))}
      </select>
    );
  }

  if (type === 'boolean') {
    return (
      <select
        value={value != null ? String(value) : ''}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === '' ? undefined : v === 'true');
        }}
        onFocus={onFocus}
        className={`${INPUT_CLASSES} ${focusRing}`}
      >
        <option value="">-- select --</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }

  if (type === 'number' || type === 'integer') {
    return (
      <input
        type="number"
        value={value != null ? String(value) : ''}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') { onChange(undefined); return; }
          const num = Number(v);
          if (!isNaN(num)) onChange(num);
        }}
        onFocus={onFocus}
        placeholder={prop?.default !== undefined ? `Default: ${JSON.stringify(prop.default)}` : `Enter ${type}`}
        className={`${INPUT_CLASSES} ${focusRing}`}
      />
    );
  }

  if (type === 'array' || type === 'object') {
    const strValue = value != null
      ? (typeof value === 'string' ? value : JSON.stringify(value, null, 2))
      : '';
    return (
      <textarea
        value={strValue}
        onChange={(e) => {
          const v = e.target.value;
          if (!v.trim()) { onChange(undefined); return; }
          try {
            onChange(JSON.parse(v));
          } catch {
            // Keep as string while user is typing invalid JSON
            onChange(v);
          }
        }}
        onFocus={onFocus}
        rows={3}
        placeholder={type === 'array' ? '["item1", "item2"]' : '{"key": "value"}'}
        className={`${INPUT_CLASSES} font-mono resize-y ${focusRing}`}
      />
    );
  }

  // Default: string input
  return (
    <input
      type="text"
      value={value != null ? String(value) : ''}
      onChange={(e) => onChange(e.target.value || undefined)}
      onFocus={onFocus}
      placeholder={prop?.default !== undefined ? `Default: ${JSON.stringify(prop.default)}` : `Enter ${type}`}
      className={`${INPUT_CLASSES} ${focusRing}`}
    />
  );
}
