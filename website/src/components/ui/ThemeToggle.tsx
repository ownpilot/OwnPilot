import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-[var(--color-bg-subtle)] border border-[var(--color-border)] p-0.5">
      {[
        { value: 'light' as const, icon: Sun, label: 'Light' },
        { value: 'system' as const, icon: Monitor, label: 'System' },
        { value: 'dark' as const, icon: Moon, label: 'Dark' },
      ].map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          onClick={() => setTheme(value)}
          aria-label={label}
          className={cn(
            'w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150 cursor-pointer',
            theme === value
              ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm border border-[var(--color-border)]'
              : 'text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)]'
          )}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
      ))}
    </div>
  );
}
