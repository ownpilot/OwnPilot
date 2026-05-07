// Widget components barrel export
// These widgets are designed to be used with the ChatMessageWidget dispatcher
// or can be used standalone

export { CodeWidget } from './CodeWidget';
export { ImageWidget } from './ImageWidget';
export { FileWidget } from './FileWidget';
export { VideoWidget } from './VideoWidget';
export { AudioWidget } from './AudioWidget';
export { EmbedWidget } from './EmbedWidget';
export { ChartWidget } from './ChartWidget';
export { HtmlWidget } from './HtmlWidget';
export { JsonWidget } from './JsonWidget';
export { WidgetShell } from './WidgetShell';
export { WidgetErrorBoundary, useWidgetErrorBoundary } from './WidgetErrorBoundary';

// Types
export type { WidgetType, WidgetTone, BaseWidgetProps, WidgetRegistryEntry, ParsedWidget, WidgetProps } from './widget-types';
export type {
  MetricData, MetricsData, TableData, BarChartData, TimelineData, ListData, KeyValueData,
  CardData, StepsData, CalloutData, ProgressData, CodeData, ImageData, ImagesData,
  FileData, FilesData, ChartData, VideoData, AudioData, EmbedData, HtmlData,
} from './widget-types';