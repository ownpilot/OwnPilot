import { cn } from '@/lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  glass?: boolean;
}

export function Card({ children, className, hover, glass }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-[var(--color-border)] p-6',
        'bg-[var(--color-surface)]',
        hover && [
          'transition-all duration-200',
          'hover:border-[hsl(var(--primary)/0.4)]',
          'hover:shadow-lg hover:shadow-[hsl(var(--primary)/0.05)]',
          'hover:-translate-y-0.5',
        ],
        glass && 'backdrop-blur-sm bg-[var(--color-surface)]/80',
        className
      )}
    >
      {children}
    </div>
  );
}
