import type { ComponentType } from 'react';

interface StatCardProps {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  subValue?: string;
  color?: string;
  alert?: boolean;
}

export function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  color = 'text-primary',
  alert,
}: StatCardProps) {
  return (
    <div
      className={`p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg ${alert ? 'ring-1 ring-error' : ''}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${alert ? 'text-error' : color}`} />
        <span className="text-xs text-text-muted dark:text-dark-text-muted">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={`text-lg font-semibold ${alert ? 'text-error' : 'text-text-primary dark:text-dark-text-primary'}`}
        >
          {value}
        </span>
        {subValue && (
          <span className="text-xs text-text-muted dark:text-dark-text-muted">{subValue}</span>
        )}
      </div>
    </div>
  );
}
