import type { ToolItem, ToolParams, ToolParamProperty } from '../types';

interface SchemaTabProps {
  tool: ToolItem;
}

export function SchemaTab({ tool }: SchemaTabProps) {
  const params = tool.parameters as ToolParams;
  const properties = params?.properties ?? {};
  const requiredFields = params?.required ?? [];
  const paramNames = Object.keys(properties);

  if (paramNames.length === 0) {
    return (
      <p className="text-sm text-text-muted dark:text-dark-text-muted">
        This tool has no parameters.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {paramNames.map((name) => {
        const prop = properties[name]!;
        const isRequired = requiredFields.includes(name);
        return <ParamRow key={name} name={name} prop={prop} isRequired={isRequired} />;
      })}

      {/* Raw JSON toggle */}
      <details className="mt-4">
        <summary className="text-xs text-text-muted dark:text-dark-text-muted cursor-pointer hover:text-text-secondary">
          View raw JSON Schema
        </summary>
        <pre className="mt-2 p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg text-xs text-text-primary dark:text-dark-text-primary overflow-x-auto font-mono">
          {JSON.stringify(tool.parameters, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function ParamRow({
  name,
  prop,
  isRequired,
}: {
  name: string;
  prop: ToolParamProperty;
  isRequired: boolean;
}) {
  return (
    <div className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg">
      {/* Header: name + type + required badge */}
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono text-sm font-medium text-text-primary dark:text-dark-text-primary">
          {name}
        </span>
        <TypeBadge type={prop.type} />
        {isRequired && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-red-500/10 text-red-500 rounded">
            required
          </span>
        )}
        {prop.enum && (
          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-purple-500/10 text-purple-500 rounded">
            enum
          </span>
        )}
      </div>

      {/* Description */}
      {prop.description && (
        <p className="text-xs text-text-muted dark:text-dark-text-muted mb-2 leading-relaxed">
          {prop.description}
        </p>
      )}

      {/* Extra info */}
      <div className="flex flex-wrap gap-2">
        {prop.enum && (
          <div className="flex flex-wrap gap-1">
            {prop.enum.map((val) => (
              <span
                key={val}
                className="px-1.5 py-0.5 text-[10px] bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary rounded font-mono"
              >
                {val}
              </span>
            ))}
          </div>
        )}
        {prop.default !== undefined && (
          <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
            default: <span className="font-mono">{JSON.stringify(prop.default)}</span>
          </span>
        )}
        {prop.minimum !== undefined && (
          <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
            min: <span className="font-mono">{prop.minimum}</span>
          </span>
        )}
        {prop.maximum !== undefined && (
          <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
            max: <span className="font-mono">{prop.maximum}</span>
          </span>
        )}
        {prop.items?.type && (
          <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
            items: <span className="font-mono">{prop.items.type}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type?: string }) {
  const colorMap: Record<string, string> = {
    string: 'bg-green-500/10 text-green-500',
    number: 'bg-blue-500/10 text-blue-500',
    integer: 'bg-blue-500/10 text-blue-500',
    boolean: 'bg-amber-500/10 text-amber-500',
    array: 'bg-cyan-500/10 text-cyan-500',
    object: 'bg-orange-500/10 text-orange-500',
  };
  const color = colorMap[type || ''] || 'bg-gray-500/10 text-gray-500';

  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded font-mono ${color}`}>
      {type || 'any'}
    </span>
  );
}
