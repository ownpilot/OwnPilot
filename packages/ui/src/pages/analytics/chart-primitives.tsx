/**
 * Chart primitives for the analytics dashboard.
 *
 * SectionCard / StatCard / MiniDonut / DonutLegend / ChartTooltip / EmptyChart
 * were defined inline in AnalyticsPage.tsx. They are presentational: props in,
 * markup out, no data fetching and no page state.
 */

import { Link } from 'react-router';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import { fmtCost, fmtTokens } from './format';

export function SectionCard({
  title,
  icon: Icon,
  iconColor = 'text-primary',
  action,
  children,
  className = '',
}: {
  title: string;
  icon: React.ElementType;
  iconColor?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl ${className}`}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary flex items-center gap-2">
          <Icon className={`w-4 h-4 ${iconColor}`} />
          {title}
        </h3>
        {action}
      </div>
      {children}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
  bgColor,
  link,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  link?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center gap-3">
        <div
          className={`w-10 h-10 rounded-lg ${bgColor} flex items-center justify-center flex-shrink-0`}
        >
          <Icon className={`w-5 h-5 ${color}`} />
        </div>
        <div className="min-w-0">
          <p className="text-xl font-bold text-text-primary dark:text-dark-text-primary leading-tight">
            {value}
          </p>
          <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">{label}</p>
        </div>
      </div>
      {sub && <p className="mt-2 text-xs text-text-muted dark:text-dark-text-muted">{sub}</p>}
    </>
  );

  const cls =
    'card-elevated card-hover p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border hover:border-primary rounded-xl transition-colors';

  if (link) {
    return (
      <Link to={link} className={cls}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

// ---------------------------------------------------------------------------
// Mini charts
// ---------------------------------------------------------------------------

export function MiniDonut({
  data,
  colors,
}: {
  data: { name: string; value: number }[];
  colors: string[];
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-text-muted dark:text-dark-text-muted">
        No data
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius="55%"
          outerRadius="85%"
          paddingAngle={2}
          dataKey="value"
          stroke="none"
        >
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            background: 'var(--color-bg-tertiary, #1e293b)',
            border: '1px solid var(--color-border, #334155)',
            borderRadius: '8px',
            fontSize: '12px',
            color: 'var(--color-text-primary, #e2e8f0)',
          }}
          formatter={(value: unknown, name: unknown) => [
            `${value} (${total > 0 ? ((Number(value) / total) * 100).toFixed(0) : 0}%)`,
            String(name),
          ]}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function DonutLegend({
  data,
  colors,
}: {
  data: { name: string; value: number }[];
  colors: string[];
}) {
  return (
    <div className="space-y-1.5 min-w-0">
      {data.map((d, i) => (
        <div key={d.name} className="flex items-center gap-2 text-xs">
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ background: colors[i % colors.length] }}
          />
          <span className="text-text-muted dark:text-dark-text-muted truncate">{d.name}</span>
          <span className="ml-auto font-semibold text-text-primary dark:text-dark-text-primary">
            {d.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom chart tooltip — matching site's muted aesthetic
// ---------------------------------------------------------------------------

export function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg bg-bg-secondary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border p-2.5 shadow-lg text-xs">
      <p className="font-medium text-text-primary dark:text-dark-text-primary mb-1">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-text-muted dark:text-dark-text-muted">{p.name}:</span>
          <span className="font-medium text-text-primary dark:text-dark-text-primary">
            {typeof p.value === 'number' && p.name.toLowerCase().includes('cost')
              ? fmtCost(p.value)
              : typeof p.value === 'number' && p.name.toLowerCase().includes('token')
                ? fmtTokens(p.value)
                : p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state for charts
// ---------------------------------------------------------------------------

export function EmptyChart({
  height = 240,
  message = 'No data for this period',
}: {
  height?: number;
  message?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center text-xs text-text-muted dark:text-dark-text-muted`}
      style={{ height }}
    >
      {message}
    </div>
  );
}
