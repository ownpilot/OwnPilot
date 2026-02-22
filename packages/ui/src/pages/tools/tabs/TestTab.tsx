import { useState } from 'react';
import type { ToolItem, ToolParams, ToolParamProperty } from '../types';
import { toolsApi } from '../../../api';

interface TestTabProps {
  tool: ToolItem;
}

export function TestTab({ tool }: TestTabProps) {
  const params = tool.parameters as ToolParams;
  const properties = params?.properties ?? {};
  const requiredFields = params?.required ?? [];
  const paramNames = Object.keys(properties);

  const [formValues, setFormValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const name of paramNames) {
      const prop = properties[name];
      if (prop?.type === 'boolean') {
        initial[name] = 'false';
      } else {
        initial[name] = '';
      }
    }
    return initial;
  });

  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const updateFormValue = (name: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  };

  const buildArgsFromForm = (): Record<string, unknown> => {
    const args: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(formValues)) {
      if (value === '' || value === undefined) continue;
      const prop = properties[name];
      const type = prop?.type;
      if (type === 'number' || type === 'integer') {
        const num = Number(value);
        if (!isNaN(num)) args[name] = num;
      } else if (type === 'boolean') {
        args[name] = value === 'true';
      } else if (type === 'array' || type === 'object') {
        try {
          args[name] = JSON.parse(value);
        } catch {
          /* skip invalid */
        }
      } else {
        args[name] = value;
      }
    }
    return args;
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const args = buildArgsFromForm();
      const data = await toolsApi.execute(tool.name, args);
      setTestResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setTestResult(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsTesting(false);
    }
  };

  const handleReset = () => {
    const initial: Record<string, string> = {};
    for (const name of paramNames) {
      const prop = properties[name];
      if (prop?.type === 'boolean') {
        initial[name] = 'false';
      } else {
        initial[name] = '';
      }
    }
    setFormValues(initial);
    setTestResult(null);
  };

  const inputClass =
    'w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

  return (
    <div className="space-y-4">
      {paramNames.length > 0 ? (
        <div className="space-y-3">
          {paramNames.map((name) => {
            const prop = properties[name]!;
            const isRequired = requiredFields.includes(name);
            return (
              <FieldInput
                key={name}
                name={name}
                prop={prop}
                isRequired={isRequired}
                value={formValues[name] ?? ''}
                onChange={(val) => updateFormValue(name, val)}
                inputClass={inputClass}
              />
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-text-muted dark:text-dark-text-muted">
          This tool has no parameters.
        </p>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={handleTest}
          disabled={isTesting}
          className="flex-1 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {isTesting ? 'Running...' : 'Run Tool'}
        </button>
        {paramNames.length > 0 && (
          <button
            onClick={handleReset}
            className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg transition-colors"
          >
            Reset
          </button>
        )}
      </div>

      {/* Result */}
      {testResult && (
        <div>
          <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
            Result
          </h4>
          <pre className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-sm text-text-primary dark:text-dark-text-primary overflow-x-auto whitespace-pre-wrap font-mono max-h-80 overflow-y-auto">
            {testResult}
          </pre>
        </div>
      )}
    </div>
  );
}

interface FieldInputProps {
  name: string;
  prop: ToolParamProperty;
  isRequired: boolean;
  value: string;
  onChange: (val: string) => void;
  inputClass: string;
}

function FieldInput({ name, prop, isRequired, value, onChange, inputClass }: FieldInputProps) {
  const type = prop?.type ?? 'string';

  return (
    <div>
      <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
        {name}
        {isRequired && <span className="text-red-500 ml-1">*</span>}
        <span className="ml-2 text-xs text-text-muted dark:text-dark-text-muted font-normal">
          {type}
          {prop?.enum ? ` [${prop.enum.join(', ')}]` : ''}
        </span>
      </label>
      {prop?.description && (
        <p className="text-xs text-text-muted dark:text-dark-text-muted mb-1">{prop.description}</p>
      )}

      {prop?.enum ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="">-- select --</option>
          {prop.enum.map((val) => (
            <option key={val} value={val}>
              {val}
            </option>
          ))}
        </select>
      ) : type === 'boolean' ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
          <option value="false">false</option>
          <option value="true">true</option>
        </select>
      ) : type === 'number' || type === 'integer' ? (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${name}`}
          className={inputClass}
        />
      ) : type === 'array' || type === 'object' ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={type === 'array' ? '["item1", "item2"]' : '{"key": "value"}'}
          rows={3}
          className={`${inputClass} font-mono resize-none`}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={`Enter ${name}`}
          className={inputClass}
        />
      )}
    </div>
  );
}
