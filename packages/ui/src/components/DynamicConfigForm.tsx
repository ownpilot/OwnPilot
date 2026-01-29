import { useState, useCallback } from 'react';
import { Eye, EyeOff } from './icons';

interface ConfigFieldDefinition {
  name: string;
  label: string;
  type: 'string' | 'secret' | 'url' | 'number' | 'boolean' | 'select' | 'json';
  required?: boolean;
  defaultValue?: unknown;
  envVar?: string;
  placeholder?: string;
  description?: string;
  options?: Array<{ value: string; label: string }>;
  order?: number;
}

interface DynamicConfigFormProps {
  schema: ConfigFieldDefinition[];
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

const INPUT_CLASSES =
  'w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50';

const LABEL_CLASSES =
  'block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5';

const DESCRIPTION_CLASSES =
  'text-xs text-text-muted dark:text-dark-text-muted mt-1';

export function DynamicConfigForm({
  schema,
  values,
  onChange,
  disabled = false,
}: DynamicConfigFormProps) {
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});

  const sortedFields = [...schema].sort((a, b) => {
    const orderA = a.order ?? Infinity;
    const orderB = b.order ?? Infinity;
    if (orderA !== orderB) return orderA - orderB;
    return schema.indexOf(a) - schema.indexOf(b);
  });

  const handleChange = useCallback(
    (fieldName: string, value: unknown) => {
      onChange({ ...values, [fieldName]: value });
    },
    [values, onChange],
  );

  const toggleSecretVisibility = useCallback((fieldName: string) => {
    setVisibleSecrets((prev) => ({ ...prev, [fieldName]: !prev[fieldName] }));
  }, []);

  const validateJson = useCallback((fieldName: string, raw: string) => {
    if (!raw.trim()) {
      setJsonErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
      return;
    }
    try {
      JSON.parse(raw);
      setJsonErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    } catch {
      setJsonErrors((prev) => ({ ...prev, [fieldName]: 'Invalid JSON' }));
    }
  }, []);

  return (
    <div className="space-y-5">
      {sortedFields.map((field) => (
        <div key={field.name}>
          {field.type === 'boolean' ? (
            <BooleanField
              field={field}
              checked={Boolean(values[field.name] ?? field.defaultValue)}
              disabled={disabled}
              onToggle={() =>
                handleChange(
                  field.name,
                  !(values[field.name] ?? field.defaultValue),
                )
              }
            />
          ) : (
            <>
              <label
                htmlFor={`field-${field.name}`}
                className={LABEL_CLASSES}
              >
                {field.label}
                {field.required && (
                  <span className="text-error ml-0.5">*</span>
                )}
              </label>

              {field.type === 'select' ? (
                <select
                  id={`field-${field.name}`}
                  value={String(values[field.name] ?? field.defaultValue ?? '')}
                  onChange={(e) => handleChange(field.name, e.target.value)}
                  disabled={disabled}
                  className={`${INPUT_CLASSES} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <option value="">
                    {field.placeholder ?? 'Select an option...'}
                  </option>
                  {field.options?.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              ) : field.type === 'json' ? (
                <>
                  <textarea
                    id={`field-${field.name}`}
                    value={String(values[field.name] ?? field.defaultValue ?? '')}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    onBlur={(e) => validateJson(field.name, e.target.value)}
                    disabled={disabled}
                    placeholder={field.placeholder}
                    rows={4}
                    className={`${INPUT_CLASSES} font-mono resize-y disabled:opacity-50 disabled:cursor-not-allowed ${
                      jsonErrors[field.name]
                        ? 'border-error focus:ring-error/50'
                        : ''
                    }`}
                  />
                  {jsonErrors[field.name] && (
                    <p className="text-xs text-error mt-1">
                      {jsonErrors[field.name]}
                    </p>
                  )}
                </>
              ) : field.type === 'secret' ? (
                <div className="relative">
                  <input
                    id={`field-${field.name}`}
                    type={visibleSecrets[field.name] ? 'text' : 'password'}
                    value={String(values[field.name] ?? '')}
                    onChange={(e) => handleChange(field.name, e.target.value)}
                    disabled={disabled}
                    placeholder={field.placeholder}
                    className={`${INPUT_CLASSES} pr-10 disabled:opacity-50 disabled:cursor-not-allowed`}
                  />
                  <button
                    type="button"
                    onClick={() => toggleSecretVisibility(field.name)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
                    title={
                      visibleSecrets[field.name] ? 'Hide value' : 'Show value'
                    }
                  >
                    {visibleSecrets[field.name] ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              ) : (
                <input
                  id={`field-${field.name}`}
                  type={
                    field.type === 'number'
                      ? 'number'
                      : field.type === 'url'
                        ? 'url'
                        : 'text'
                  }
                  value={String(values[field.name] ?? field.defaultValue ?? '')}
                  onChange={(e) =>
                    handleChange(
                      field.name,
                      field.type === 'number'
                        ? e.target.value === ''
                          ? ''
                          : Number(e.target.value)
                        : e.target.value,
                    )
                  }
                  disabled={disabled}
                  placeholder={field.placeholder}
                  className={`${INPUT_CLASSES} disabled:opacity-50 disabled:cursor-not-allowed`}
                />
              )}

              {field.description && (
                <p className={DESCRIPTION_CLASSES}>{field.description}</p>
              )}
              {field.envVar && (
                <p className={DESCRIPTION_CLASSES}>
                  Environment variable:{' '}
                  <code className="px-1 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-text-secondary dark:text-dark-text-secondary">
                    {field.envVar}
                  </code>
                </p>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

function BooleanField({
  field,
  checked,
  disabled,
  onToggle,
}: {
  field: ConfigFieldDefinition;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg">
      <div>
        <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
          {field.label}
          {field.required && <span className="text-error ml-0.5">*</span>}
        </p>
        {field.description && (
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            {field.description}
          </p>
        )}
        {field.envVar && (
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
            Environment variable:{' '}
            <code className="px-1 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-text-secondary dark:text-dark-text-secondary">
              {field.envVar}
            </code>
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onToggle}
        disabled={disabled}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed ${
          checked
            ? 'bg-success'
            : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border'
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}
