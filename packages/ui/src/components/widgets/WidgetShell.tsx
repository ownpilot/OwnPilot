import type { ReactNode } from 'react';
import type { WidgetTone } from './widget-types';

interface WidgetShellProps {
  children: ReactNode;
  title?: string;
  icon?: ReactNode;
  tone?: WidgetTone;
}

const toneClasses: Record<WidgetTone, { shell: string; icon: string; marker: string }> = {
  success: {
    shell: 'border-success/25 bg-success/5',
    icon: 'text-success',
    marker: 'bg-success',
  },
  warning: {
    shell: 'border-warning/30 bg-warning/10',
    icon: 'text-warning',
    marker: 'bg-warning',
  },
  danger: {
    shell: 'border-error/30 bg-error/10',
    icon: 'text-error',
    marker: 'bg-error',
  },
  info: {
    shell: 'border-primary/25 bg-primary/5',
    icon: 'text-primary',
    marker: 'bg-primary',
  },
  default: {
    shell: 'border-border bg-bg-primary dark:border-dark-border dark:bg-dark-bg-primary',
    icon: 'text-text-muted dark:text-dark-text-muted',
    marker: 'bg-text-muted dark:bg-dark-text-muted',
  },
};

export function WidgetShell({ children, title, icon, tone = 'default' }: WidgetShellProps) {
  const classes = toneClasses[tone];
  return (
    <section className={`my-3 rounded-lg border ${classes.shell} overflow-hidden`}>
      {(title || icon) && (
        <div className="flex items-center gap-2 border-b border-border/70 px-3 py-2 dark:border-dark-border/70">
          {icon && <span className={classes.icon}>{icon}</span>}
          {title && (
            <div className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
              {title}
            </div>
          )}
        </div>
      )}
      <div className="p-3">{children}</div>
    </section>
  );
}