import type { ComponentType } from 'react';

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  icon?: ComponentType<{ className?: string }>;
  variant?: 'primary' | 'secondary' | 'ghost';
}

export interface EmptyStateProps {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
  /** Visual style variant */
  variant?: 'default' | 'card' | 'minimal';
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
  /** Icon background color class */
  iconBgColor?: string;
  /** Icon color class */
  iconColor?: string;
}

const sizeClasses = {
  sm: {
    container: 'py-8',
    icon: 'w-10 h-10',
    title: 'text-base',
    description: 'text-sm',
  },
  md: {
    container: 'py-12',
    icon: 'w-16 h-16',
    title: 'text-xl',
    description: 'text-base',
  },
  lg: {
    container: 'py-16',
    icon: 'w-20 h-20',
    title: 'text-2xl',
    description: 'text-lg',
  },
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'default',
  size = 'md',
  iconBgColor = 'bg-bg-tertiary dark:bg-dark-bg-tertiary',
  iconColor = 'text-text-muted dark:text-dark-text-muted',
}: EmptyStateProps) {
  const sizes = sizeClasses[size];

  const getButtonClasses = (buttonVariant: EmptyStateAction['variant'] = 'primary') => {
    const base = 'flex items-center gap-2 px-4 py-2 rounded-lg transition-colors font-medium';
    switch (buttonVariant) {
      case 'primary':
        return `${base} bg-primary hover:bg-primary-dark text-white`;
      case 'secondary':
        return `${base} bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary`;
      case 'ghost':
        return `${base} hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary`;
      default:
        return base;
    }
  };

  if (variant === 'minimal') {
    return (
      <div className={`flex flex-col items-center justify-center text-center ${sizes.container}`}>
        <Icon className={`${sizes.icon} ${iconColor} mb-3`} />
        <h3 className={`${sizes.title} font-medium text-text-primary dark:text-dark-text-primary mb-1`}>
          {title}
        </h3>
        {description && (
          <p className={`${sizes.description} text-text-muted dark:text-dark-text-muted max-w-sm`}>
            {description}
          </p>
        )}
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div className="flex flex-col items-center justify-center p-8 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-2xl">
        <div className={`${iconBgColor} rounded-2xl p-4 mb-4`}>
          <Icon className={`${sizes.icon} ${iconColor}`} />
        </div>
        <h3 className={`${sizes.title} font-semibold text-text-primary dark:text-dark-text-primary mb-2 text-center`}>
          {title}
        </h3>
        {description && (
          <p className={`${sizes.description} text-text-muted dark:text-dark-text-muted mb-6 text-center max-w-xs`}>
            {description}
          </p>
        )}
        {(action || secondaryAction) && (
          <div className="flex flex-wrap items-center justify-center gap-3">
            {action && (
              <button onClick={action.onClick} className={getButtonClasses(action.variant)}>
                {action.icon && <action.icon className="w-4 h-4" />}
                {action.label}
              </button>
            )}
            {secondaryAction && (
              <button
                onClick={secondaryAction.onClick}
                className={getButtonClasses(secondaryAction.variant || 'secondary')}
              >
                {secondaryAction.icon && <secondaryAction.icon className="w-4 h-4" />}
                {secondaryAction.label}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  // Default variant
  return (
    <div className={`flex flex-col items-center justify-center text-center ${sizes.container}`}>
      <div className={`${iconBgColor} rounded-2xl p-5 mb-5`}>
        <Icon className={`${sizes.icon} ${iconColor}`} />
      </div>
      <h3 className={`${sizes.title} font-semibold text-text-primary dark:text-dark-text-primary mb-2`}>
        {title}
      </h3>
      {description && (
        <p className={`${sizes.description} text-text-muted dark:text-dark-text-muted mb-6 max-w-sm`}>
          {description}
        </p>
      )}
      {(action || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {action && (
            <button onClick={action.onClick} className={getButtonClasses(action.variant)}>
              {action.icon && <action.icon className="w-4 h-4" />}
              {action.label}
            </button>
          )}
          {secondaryAction && (
            <button
              onClick={secondaryAction.onClick}
              className={getButtonClasses(secondaryAction.variant || 'ghost')}
            >
              {secondaryAction.icon && <secondaryAction.icon className="w-4 h-4" />}
              {secondaryAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
