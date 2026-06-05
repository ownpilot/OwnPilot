/**
 * ProfilePage presentational sub-components.
 *
 * Extracted from ProfilePage.tsx — self-contained, props-only widgets with no
 * dependency on the page's state: a progress ring, a stat card, a titled
 * section card, and a tag input.
 */

import { useState } from 'react';
import { X, type User } from '../components/icons';

export function ProgressRing({
  progress,
  size = 80,
  strokeWidth = 8,
  color = 'text-primary',
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90 w-full h-full">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="transparent"
          className="text-bg-tertiary dark:text-dark-bg-tertiary"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="currentColor"
          strokeWidth={strokeWidth}
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`${color} transition-all duration-500 ease-out`}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-lg font-bold text-text-primary dark:text-dark-text-primary">
          {progress}%
        </span>
      </div>
    </div>
  );
}

export function StatCard({
  icon: Icon,
  label,
  value,
  color,
  trend,
}: {
  icon: typeof User;
  label: string;
  value: string | number;
  color: string;
  trend?: { value: number; positive: boolean };
}) {
  return (
    <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-3 mb-2">
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <span className="text-sm text-text-muted dark:text-dark-text-muted">{label}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-2xl font-bold text-text-primary dark:text-dark-text-primary">
          {value}
        </span>
        {trend && (
          <span className={`text-xs mb-1 ${trend.positive ? 'text-success' : 'text-error'}`}>
            {trend.positive ? '+' : ''}
            {trend.value}%
          </span>
        )}
      </div>
    </div>
  );
}

export function SectionCard({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon: typeof User;
  children: React.ReactNode;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="p-5 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-text-primary dark:text-dark-text-primary">{title}</h3>
        </div>
        {action && (
          <button onClick={action.onClick} className="text-xs text-primary hover:underline">
            {action.label}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export function TagInput({
  tags,
  onAdd,
  onRemove,
  placeholder,
  color = 'primary',
}: {
  tags: string[];
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
  placeholder: string;
  color?: 'primary' | 'success' | 'warning' | 'error';
}) {
  const [input, setInput] = useState('');

  const colorClasses = {
    primary: 'bg-primary/10 text-primary border-primary/20',
    success: 'bg-success/10 text-success border-success/20',
    warning: 'bg-warning/10 text-warning border-warning/20',
    error: 'bg-error/10 text-error border-error/20',
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && input.trim()) {
      e.preventDefault();
      onAdd(input.trim());
      setInput('');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm border ${colorClasses[color]}`}
          >
            {tag}
            <button onClick={() => onRemove(tag)} className="hover:opacity-70">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
      />
    </div>
  );
}
