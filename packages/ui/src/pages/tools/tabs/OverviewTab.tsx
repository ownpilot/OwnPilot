import type { ToolItem, ToolParams } from '../types';
import { CATEGORY_NAMES, SOURCE_NAMES } from '../constants';

interface OverviewTabProps {
  tool: ToolItem;
}

export function OverviewTab({ tool }: OverviewTabProps) {
  const params = tool.parameters as ToolParams;
  const properties = params?.properties ?? {};
  const requiredFields = params?.required ?? [];
  const paramCount = Object.keys(properties).length;

  return (
    <div className="space-y-5">
      {/* Description */}
      <div>
        <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
          Description
        </h4>
        <p className="text-sm text-text-primary dark:text-dark-text-primary whitespace-pre-wrap leading-relaxed">
          {tool.description}
        </p>
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-4">
        {tool.category && (
          <div className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg">
            <p className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Category</p>
            <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
              {CATEGORY_NAMES[tool.category] || tool.category}
            </p>
          </div>
        )}
        {tool.source && (
          <div className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg">
            <p className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Source</p>
            <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
              {SOURCE_NAMES[tool.source] || tool.source}
            </p>
          </div>
        )}
        <div className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg">
          <p className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Parameters</p>
          <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            {paramCount} total, {requiredFields.length} required
          </p>
        </div>
        <div className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg">
          <p className="text-xs text-text-muted dark:text-dark-text-muted mb-1">Tool Name</p>
          <p className="text-sm font-mono font-medium text-text-primary dark:text-dark-text-primary">
            {tool.name}
          </p>
        </div>
      </div>

      {/* Quick Reference */}
      {paramCount > 0 && (
        <div>
          <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
            Parameters at a Glance
          </h4>
          <div className="flex flex-wrap gap-2">
            {Object.entries(properties).map(([name, prop]) => {
              const isRequired = requiredFields.includes(name);
              return (
                <span
                  key={name}
                  className={`px-2 py-1 text-xs rounded-md font-mono ${
                    isRequired
                      ? 'bg-primary/10 text-primary border border-primary/20'
                      : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary'
                  }`}
                >
                  {name}
                  <span className="ml-1 opacity-60">
                    {prop.type || 'any'}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
