/**
 * SensorChart
 *
 * Simple SVG time-series line chart for sensor telemetry data.
 * No external chart library dependency.
 */

import type { EdgeTelemetry } from '../api/endpoints/edge';

// =============================================================================
// Props
// =============================================================================

interface SensorChartProps {
  data: EdgeTelemetry[];
  unit?: string;
  height?: number;
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

export function SensorChart({ data, unit = '', height = 120, className = '' }: SensorChartProps) {
  if (data.length < 2) {
    return (
      <div
        className={`flex items-center justify-center text-xs text-text-muted dark:text-dark-text-muted ${className}`}
        style={{ height }}
      >
        Not enough data points
      </div>
    );
  }

  // Sort by time ascending
  const sorted = [...data].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
  );

  // Extract numeric values
  const values = sorted.map((d) => {
    const v = Number(d.value);
    return isNaN(v) ? 0 : v;
  });

  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  const width = 300;
  const padding = { top: 10, right: 10, bottom: 20, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  // Build SVG path
  const points = values.map((v, i) => {
    const x = padding.left + (i / (values.length - 1)) * chartW;
    const y = padding.top + chartH - ((v - minVal) / range) * chartH;
    return { x, y };
  });

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

  // Area fill under line
  const lastPt = points[points.length - 1]!;
  const firstPt = points[0]!;
  const areaPath = `${linePath} L ${lastPt.x} ${padding.top + chartH} L ${firstPt.x} ${padding.top + chartH} Z`;

  // Y-axis labels
  const yLabels = [minVal, minVal + range / 2, maxVal];

  // X-axis labels (first and last timestamps)
  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={`w-full ${className}`} style={{ height }}>
      {/* Grid lines */}
      {yLabels.map((val, i) => {
        const y = padding.top + chartH - ((val - minVal) / range) * chartH;
        return (
          <g key={i}>
            <line
              x1={padding.left}
              y1={y}
              x2={width - padding.right}
              y2={y}
              stroke="currentColor"
              strokeOpacity={0.1}
              strokeDasharray="2,2"
            />
            <text
              x={padding.left - 4}
              y={y + 3}
              textAnchor="end"
              fontSize={8}
              fill="currentColor"
              fillOpacity={0.5}
            >
              {val.toFixed(1)}
              {unit ? ` ${unit}` : ''}
            </text>
          </g>
        );
      })}

      {/* Area fill */}
      <path d={areaPath} fill="url(#chartGradient)" />

      {/* Line */}
      <path d={linePath} fill="none" stroke="#6366f1" strokeWidth={1.5} />

      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2} fill="#6366f1" />
      ))}

      {/* X-axis labels */}
      <text x={padding.left} y={height - 4} fontSize={8} fill="currentColor" fillOpacity={0.5}>
        {formatTime(sorted[0]!.recordedAt)}
      </text>
      <text
        x={width - padding.right}
        y={height - 4}
        textAnchor="end"
        fontSize={8}
        fill="currentColor"
        fillOpacity={0.5}
      >
        {formatTime(sorted[sorted.length - 1]!.recordedAt)}
      </text>

      {/* Gradient definition */}
      <defs>
        <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity={0.2} />
          <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
        </linearGradient>
      </defs>
    </svg>
  );
}
