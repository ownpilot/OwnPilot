import { Info, AlertTriangle, CheckCircle, Lightbulb, Terminal } from 'lucide-react';
import { cn } from '@/lib/utils';

type CalloutType = 'info' | 'warning' | 'success' | 'tip' | 'note';

interface CalloutProps {
  type?: CalloutType;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

const icons = {
  info: Info,
  warning: AlertTriangle,
  success: CheckCircle,
  tip: Lightbulb,
  note: Terminal,
};

const styles = {
  info: 'bg-blue-500/5 border-blue-500/20 text-blue-700 dark:text-blue-300',
  warning: 'bg-orange-500/5 border-orange-500/20 text-orange-700 dark:text-orange-300',
  success: 'bg-emerald-500/5 border-emerald-500/20 text-emerald-700 dark:text-emerald-300',
  tip: 'bg-purple-500/5 border-purple-500/20 text-purple-700 dark:text-purple-300',
  note: 'bg-[var(--color-bg-subtle)] border-[var(--color-border)] text-[var(--color-text-muted)]',
};

const titleStyles = {
  info: 'text-blue-800 dark:text-blue-200',
  warning: 'text-orange-800 dark:text-orange-200',
  success: 'text-emerald-800 dark:text-emerald-200',
  tip: 'text-purple-800 dark:text-purple-200',
  note: 'text-[var(--color-text)]',
};

export function Callout({ type = 'note', title, children, className }: CalloutProps) {
  const Icon = icons[type];
  return (
    <div className={cn('flex gap-3 rounded-lg border p-4 my-4', styles[type], className)}>
      <Icon className="w-5 h-5 mt-0.5 shrink-0" />
      <div className="text-sm leading-relaxed">
        {title && <p className={cn('font-semibold mb-1', titleStyles[type])}>{title}</p>}
        {children}
      </div>
    </div>
  );
}
