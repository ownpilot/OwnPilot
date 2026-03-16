import { cn } from '@/lib/utils';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'purple' | 'blue' | 'green' | 'orange' | 'red' | 'outline';
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium',
        {
          default:
            'bg-[var(--color-bg-subtle)] text-[var(--color-text-muted)] border border-[var(--color-border)]',
          purple:
            'bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20',
          blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
          green:
            'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
          orange:
            'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20',
          red: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20',
          outline: 'border border-[var(--color-border)] text-[var(--color-text-muted)]',
        }[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
