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

/**
 * There is deliberately no per-widget payload interface here.
 *
 * Widget `data` arrives as JSON the model wrote, so it can be any shape or
 * malformed. Every widget takes `data: unknown` and narrows it at the point of
 * use; declaring `data: CodeData` would assert a shape nothing guarantees and
 * switch the compiler off exactly where the runtime guards live. A set of such
 * interfaces existed here, unused by any widget, and was removed rather than
 * wired up. The authoritative payload examples are in the system prompt
 * (`gateway/src/services/agent/prompt.ts`), which is what the model reads.
 */

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
