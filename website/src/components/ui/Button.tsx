import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'outline' | 'link';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 cursor-pointer select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-50',
          {
            primary: [
              'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]',
              'hover:bg-[hsl(var(--primary)/0.9)] active:scale-[0.98]',
              'shadow-sm shadow-[hsl(var(--primary)/0.25)]',
            ],
            secondary: [
              'bg-[var(--color-surface-raised)] text-[var(--color-text)]',
              'border border-[var(--color-border)]',
              'hover:bg-[var(--color-bg-subtle)] active:scale-[0.98]',
            ],
            ghost: [
              'text-[var(--color-text-muted)]',
              'hover:bg-[var(--color-bg-subtle)] hover:text-[var(--color-text)]',
            ],
            outline: [
              'border border-[var(--color-border)] text-[var(--color-text)]',
              'hover:bg-[var(--color-bg-subtle)] active:scale-[0.98]',
            ],
            link: ['text-[hsl(var(--primary))] underline-offset-4', 'hover:underline p-0 h-auto'],
          }[variant],
          {
            sm: 'h-8 px-3 text-sm',
            md: 'h-10 px-4 text-sm',
            lg: 'h-12 px-6 text-base',
            icon: 'h-9 w-9 p-0',
          }[size],
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
