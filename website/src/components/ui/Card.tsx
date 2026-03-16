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

export function CardHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('mb-4', className)}>{children}</div>;
}

export function CardTitle({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h3 className={cn('text-base font-semibold text-[var(--color-text)]', className)}>
      {children}
    </h3>
  );
}

export function CardDescription({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <p className={cn('text-sm text-[var(--color-text-muted)] mt-1', className)}>{children}</p>;
}
