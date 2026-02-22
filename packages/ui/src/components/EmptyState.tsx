import type { ComponentType } from 'react';

export interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: ComponentType<{ className?: string }>;
  };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full">
      <Icon className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
      <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
        {title}
      </h3>
      {description && (
        <p className="text-text-muted dark:text-dark-text-muted mb-4">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          {action.icon && <action.icon className="w-4 h-4" />}
          {action.label}
        </button>
      )}
    </div>
  );
}
