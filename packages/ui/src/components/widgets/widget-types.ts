// Discriminated union for all widget types — enables exhaustive type checking
export type WidgetType =
  // Data visualization
  | 'metric'
  | 'metrics'
  | 'metric_grid'
  | 'stats'
  | 'table'
  | 'bar'
  | 'bar_chart'
  | 'timeline'
  // Content display
  | 'list'
  | 'checklist'
  | 'key_value'
  | 'key_values'
  | 'facts'
  | 'details'
  | 'properties'
  | 'card'
  | 'cards'
  | 'card_grid'
  | 'step'
  | 'steps'
  | 'plan'
  | 'callout'
  | 'note'
  | 'progress'
  // Code & Media
  | 'code'
  | 'code_block'
  | 'image'
  | 'images'
  | 'video'
  | 'audio'
  | 'file'
  | 'files'
  // Advanced
  | 'chart'
  | 'pie_chart'
  | 'line_chart'
  | 'map'
  | 'embed'
  | 'iframe'
  | 'html'
  // Fallback
  | 'json'
  | 'raw';

export type WidgetTone = 'default' | 'info' | 'success' | 'warning' | 'danger';

export interface BaseWidgetProps {
  name: WidgetType;
  data: unknown;
  tone?: WidgetTone;
}

// Per-widget data interfaces
export interface MetricData {
  title?: string;
  value: string | number;
  unit?: string;
  change?: number;
  icon?: string;
  trend?: 'up' | 'down' | 'neutral';
}

export interface MetricsData {
  title?: string;
  items: MetricData[];
  layout?: 'grid' | 'row' | 'column';
}

export interface TableData {
  title?: string;
  headers?: string[];
  rows: string[][] | Record<string, unknown>[];
  caption?: string;
  striped?: boolean;
  hoverable?: boolean;
}

export interface BarChartData {
  title?: string;
  data: Array<{ label: string; value: number; color?: string }>;
  horizontal?: boolean;
  showValues?: boolean;
}

export interface TimelineData {
  title?: string;
  items: Array<{
    id?: string;
    title: string;
    description?: string;
    time?: string;
    date?: string;
    icon?: string;
    tone?: WidgetTone;
  }>;
}

export interface ListData {
  title?: string;
  items: Array<{
    id?: string;
    text: string;
    done?: boolean;
    checked?: boolean;
    icon?: string;
    tone?: WidgetTone;
  }>;
  ordered?: boolean;
  checklist?: boolean;
}

export interface KeyValueData {
  title?: string;
  items: Array<{
    key: string;
    value: string;
    icon?: string;
  }>;
  columns?: 1 | 2 | 3;
}

export interface CardData {
  title?: string;
  items: Array<{
    id?: string;
    label?: string;
    title?: string;
    value?: string;
    detail?: string;
    description?: string;
    icon?: string;
    tone?: WidgetTone;
    href?: string;
  }>;
  layout?: 'grid' | 'row' | 'column';
  columns?: 1 | 2 | 3;
}

export interface StepsData {
  title?: string;
  items: Array<{
    id?: string;
    title: string;
    description?: string;
    status?: 'pending' | 'active' | 'completed' | 'failed';
    icon?: string;
  }>;
}

export interface CalloutData {
  title?: string;
  text: string;
  icon?: string;
  tone?: WidgetTone;
}

export interface ProgressData {
  title?: string;
  value: number;
  max?: number;
  unit?: string;
  showLabel?: boolean;
  striped?: boolean;
  animated?: boolean;
  tone?: WidgetTone;
}

export interface CodeData {
  title?: string;
  language?: string;
  code: string;
  showLineNumbers?: boolean;
  highlightLines?: number[];
  filename?: string;
}

export interface ImageData {
  title?: string;
  src: string;
  alt?: string;
  caption?: string;
  width?: number | string;
  height?: number | string;
  lazy?: boolean;
}

export interface ImagesData {
  title?: string;
  items: ImageData[];
  layout?: 'grid' | 'row' | 'masonry';
  columns?: 1 | 2 | 3 | 4;
}

export interface FileData {
  title?: string;
  name: string;
  size?: number;
  type?: string;
  url?: string;
  icon?: string;
}

export interface FilesData {
  title?: string;
  items: FileData[];
  layout?: 'list' | 'grid';
}

export interface ChartData {
  title?: string;
  type: 'bar' | 'line' | 'pie' | 'area' | 'scatter' | 'donut';
  data: unknown[];
  xKey?: string;
  yKeys?: string[];
  colors?: string[];
  showLegend?: boolean;
  showGrid?: boolean;
  animated?: boolean;
}

export interface VideoData {
  title?: string;
  src: string;
  poster?: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  controls?: boolean;
  width?: number | string;
  height?: number | string;
}

export interface AudioData {
  title?: string;
  src: string;
  autoplay?: boolean;
  loop?: boolean;
  controls?: boolean;
}

export interface EmbedData {
  title?: string;
  src: string;
  width?: number | string;
  height?: number | string;
  sandbox?: boolean;
  allow?: string;
}

export interface HtmlData {
  title?: string;
  html: string;
}

// Widget registry entry
export interface WidgetRegistryEntry {
  component: React.ComponentType<{ data: unknown; tone?: WidgetTone; title?: string }>;
  defaultTone?: WidgetTone;
}

// Normalized parsed widget from chat content
export interface ParsedWidget {
  name: WidgetType;
  data: unknown;
  tone?: WidgetTone;
  title?: string;
  raw?: string;
}

// Widget component props (internal)
export interface WidgetProps {
  data: unknown;
  tone?: WidgetTone;
  title?: string;
}