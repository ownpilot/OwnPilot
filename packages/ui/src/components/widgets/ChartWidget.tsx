import type { WidgetTone } from './widget-types';
import { WidgetShell } from './WidgetShell';

interface Props {
  data: unknown;
  tone?: WidgetTone;
  title?: string;
}

interface ChartData {
  type: 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'donut';
  data: unknown[];
  xKey?: string;
  yKeys?: string[];
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
  animated?: boolean;
  title?: string;
}

function isChartData(item: unknown): item is ChartData {
  if (typeof item !== 'object' || item === null) return false;
  const record = item as Record<string, unknown>;
  return typeof record.type === 'string' && Array.isArray(record.data);
}

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

function BarChart({ data, showGrid = true }: { data: Array<{ label: string; value: number; color?: string }>; showGrid: boolean }) {
  const maxValue = Math.max(1, ...data.map(d => Math.abs(d.value || 0)));

  return (
    <div className="space-y-2">
      {data.map((item, index) => {
        const width = Math.max(2, Math.min(100, (Math.abs(item.value) / maxValue) * 100));
        return (
          <div key={index} className="grid grid-cols-[minmax(96px,1fr)_minmax(0,2fr)_auto] items-center gap-2 text-sm">
            <div className="truncate font-medium text-text-secondary dark:text-dark-text-secondary">
              {item.label}
            </div>
            {showGrid && (
              <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary dark:bg-dark-bg-tertiary">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${width}%`, backgroundColor: item.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length] }}
                />
              </div>
            )}
            <div className="min-w-8 text-right tabular-nums text-text-primary dark:text-dark-text-primary">
              {item.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PieChart({ data }: { data: Array<{ label: string; value: number; color?: string }> }) {
  const total = data.reduce((sum, d) => sum + Math.abs(d.value || 0), 0);
  if (total === 0) return null;

  let currentAngle = 0;
  const paths = data.map((item, index) => {
    const percentage = (Math.abs(item.value) / total) * 100;
    const angle = (percentage / 100) * 360;
    const startAngle = currentAngle;
    currentAngle += angle;

    const x1 = 50 + 40 * Math.cos((Math.PI * startAngle) / 180);
    const y1 = 50 + 40 * Math.sin((Math.PI * startAngle) / 180);
    const x2 = 50 + 40 * Math.cos((Math.PI * (startAngle + angle)) / 180);
    const y2 = 50 + 40 * Math.sin((Math.PI * (startAngle + angle)) / 180);

    const largeArc = angle > 180 ? 1 : 0;
    const color = item.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];

    return { path: `M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`, color, label: item.label, value: item.value, percentage };
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <svg viewBox="0 0 100 100" className="w-32 h-32">
        {paths.map((p, i) => (
          <path key={i} d={p.path} fill={p.color} />
        ))}
        <circle cx="50" cy="50" r="20" fill="var(--bg-primary)" />
      </svg>
      <div className="space-y-1">
        {paths.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-text-secondary">{p.label}</span>
            <span className="text-text-muted">({p.percentage.toFixed(1)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DonutChart({ data }: { data: Array<{ label: string; value: number; color?: string }> }) {
  const total = data.reduce((sum, d) => sum + Math.abs(d.value || 0), 0);
  if (total === 0) return null;

  let currentAngle = 0;
  const paths = data.map((item, index) => {
    const percentage = (Math.abs(item.value) / total) * 100;
    const angle = (percentage / 100) * 360;
    const startAngle = currentAngle;
    currentAngle += angle;

    const x1 = 50 + 40 * Math.cos((Math.PI * startAngle) / 180);
    const y1 = 50 + 40 * Math.sin((Math.PI * startAngle) / 180);
    const x2 = 50 + 40 * Math.cos((Math.PI * (startAngle + angle)) / 180);
    const y2 = 50 + 40 * Math.sin((Math.PI * (startAngle + angle)) / 180);

    const largeArc = angle > 180 ? 1 : 0;
    const color = item.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length];

    return { path: `M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`, color, label: item.label, value: item.value, percentage };
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-4">
      <svg viewBox="0 0 100 100" className="w-32 h-32">
        {paths.map((p, i) => (
          <path key={i} d={p.path} fill={p.color} />
        ))}
      </svg>
      <div className="space-y-1">
        {paths.map((p, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="h-3 w-3 rounded-full" style={{ backgroundColor: p.color }} />
            <span className="text-text-secondary">{p.label}</span>
            <span className="text-text-muted">({p.percentage.toFixed(1)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({ data }: { data: Array<{ x: string | number; y: number }> }) {
  const maxY = Math.max(...data.map(d => Math.abs(d.y || 0)), 1);
  const points = data.map((d, i) => ({
    x: (i / Math.max(1, data.length - 1)) * 100,
    y: 100 - ((Math.abs(d.y || 0) / maxY) * 80 + 10),
  }));

  return (
    <div className="relative">
      <svg viewBox="0 0 100 100" className="w-full h-32" preserveAspectRatio="none">
        <polyline
          points={points.map(p => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="var(--primary)" />
        ))}
      </svg>
    </div>
  );
}

function ChartIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
    </svg>
  );
}

export function ChartWidget({ data, title: titleProp }: Props) {
  const record = typeof data === 'object' && data !== null ? data : {};
  const title = (record as { title?: string }).title || titleProp || 'Chart';

  if (!isChartData(data)) {
    // Try to parse as generic chart data
    const rawType = (record as { type?: string }).type || 'bar';
    const chartData: ChartData = {
      type: rawType as ChartData['type'],
      data: Array.isArray(data) ? data : (record as { data?: unknown[] }).data || [],
      title,
    };
    if (chartData.data.length === 0) {
      return (
        <WidgetShell title={title} icon={<ChartIcon />} tone="warning">
          <p className="text-sm text-text-secondary">No chart data provided</p>
        </WidgetShell>
      );
    }
    return <ChartRenderer data={chartData} />;
  }

  if (data.data.length === 0) {
    return (
      <WidgetShell title={title} icon={<ChartIcon />} tone="warning">
        <p className="text-sm text-text-secondary">No chart data provided</p>
      </WidgetShell>
    );
  }

  return <ChartRenderer data={data} />;
}

function ChartRenderer({ data }: { data: ChartData }) {
  const { type, data: chartData, xKey, showGrid = true, title } = data;

  // Normalize data to array of { label, value }
  const normalizedData = chartData.map((item, index) => {
    if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>;
      const label = String(record.label || record.name || record[xKey || 'x'] || `Item ${index + 1}`);
      const value = Number(record.value || record.y || record.count || 0);
      return { label, value, color: record.color as string | undefined };
    }
    return { label: `Item ${index + 1}`, value: Number(item) || 0 };
  });

  return (
    <WidgetShell title={title} icon={<ChartIcon />}>
      {type === 'bar' && <BarChart data={normalizedData} showGrid={showGrid} />}
      {type === 'pie' && <PieChart data={normalizedData} />}
      {type === 'donut' && <DonutChart data={normalizedData} />}
      {type === 'line' && <LineChart data={normalizedData.map((d) => ({ x: d.label, y: d.value }))} />}
      {(type === 'area' || type === 'scatter') && <BarChart data={normalizedData} showGrid={showGrid} />}
    </WidgetShell>
  );
}