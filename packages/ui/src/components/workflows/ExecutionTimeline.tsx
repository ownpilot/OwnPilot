import { useMemo, useState } from 'react';

interface NodeResult {
  nodeId: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  output?: unknown;
  error?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
}

interface ExecutionTimelineProps {
  nodeResults: Record<string, NodeResult>;
  nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>;
}

interface TimelineNode {
  id: string;
  label: string;
  status: NodeResult['status'];
  startTime: number;
  endTime: number;
  durationMs: number;
  output?: unknown;
  error?: string;
}

export function ExecutionTimeline({ nodeResults, nodes }: ExecutionTimelineProps) {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  const timelineData = useMemo(() => {
    const nodesWithTiming: TimelineNode[] = [];
    let earliestStart = Infinity;
    let latestEnd = -Infinity;

    // Build timeline nodes from results
    Object.entries(nodeResults).forEach(([nodeId, result]) => {
      if (!result.startedAt) return;

      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;

      const startTime = new Date(result.startedAt).getTime();
      const endTime = result.completedAt
        ? new Date(result.completedAt).getTime()
        : startTime + (result.durationMs || 0);

      earliestStart = Math.min(earliestStart, startTime);
      latestEnd = Math.max(latestEnd, endTime);

      nodesWithTiming.push({
        id: nodeId,
        label: (node.data.label as string) || node.type || nodeId,
        status: result.status,
        startTime,
        endTime,
        durationMs: result.durationMs || 0,
        output: result.output,
        error: result.error,
      });
    });

    // Sort by start time
    nodesWithTiming.sort((a, b) => a.startTime - b.startTime);

    const totalDuration = latestEnd - earliestStart || 1;

    return {
      nodes: nodesWithTiming,
      earliestStart,
      latestEnd,
      totalDuration,
    };
  }, [nodeResults, nodes]);

  if (timelineData.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-text-muted dark:text-dark-text-muted">
        No execution timing data available
      </div>
    );
  }

  const getStatusColor = (status: NodeResult['status']): string => {
    switch (status) {
      case 'success':
        return 'bg-success/70';
      case 'error':
        return 'bg-error/70';
      case 'skipped':
        return 'bg-text-muted/30';
      case 'running':
      case 'pending':
        return 'bg-warning/70';
      default:
        return 'bg-text-muted/30';
    }
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatOutput = (output: unknown): string => {
    if (output === null || output === undefined) return 'No output';
    if (typeof output === 'string') return output;
    try {
      const str = JSON.stringify(output);
      return str.length > 100 ? str.substring(0, 100) + '...' : str;
    } catch {
      return String(output);
    }
  };

  const getTimeAxisLabels = (): string[] => {
    const { totalDuration } = timelineData;
    const labels: string[] = [];

    // Create 5 time labels across the timeline
    for (let i = 0; i <= 4; i++) {
      const ms = (totalDuration * i) / 4;
      labels.push(formatDuration(ms));
    }

    return labels;
  };

  const timeLabels = getTimeAxisLabels();

  return (
    <div className="space-y-4">
      {/* Time axis */}
      <div className="flex">
        <div className="w-[150px] shrink-0" />
        <div className="flex-1 relative h-6">
          <div className="absolute inset-0 flex justify-between text-[10px] text-text-muted dark:text-dark-text-muted">
            {timeLabels.map((label, idx) => (
              <span key={idx} className="relative">
                <span className="absolute left-0 top-0 -translate-x-1/2">{label}</span>
                <div className="absolute left-0 top-4 w-px h-2 bg-text-muted/30 dark:bg-dark-text-muted/30" />
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline bars */}
      <div className="space-y-2 overflow-x-auto">
        {timelineData.nodes.map((node) => {
          const startOffset =
            ((node.startTime - timelineData.earliestStart) / timelineData.totalDuration) * 100;
          const width = ((node.endTime - node.startTime) / timelineData.totalDuration) * 100;
          const isHovered = hoveredNode === node.id;

          return (
            <div key={node.id} className="flex items-center gap-3 min-w-[600px]">
              {/* Node label */}
              <div className="w-[150px] shrink-0">
                <div className="text-xs text-text-primary dark:text-dark-text-primary truncate">
                  {node.label}
                </div>
              </div>

              {/* Timeline area */}
              <div className="flex-1 relative h-8">
                {/* Background track */}
                <div className="absolute inset-0 bg-text-muted/10 dark:bg-dark-text-muted/10 rounded" />

                {/* Duration bar */}
                <div
                  className={`absolute top-1 bottom-1 rounded ${getStatusColor(node.status)} transition-opacity ${
                    isHovered ? 'opacity-90' : 'opacity-100'
                  }`}
                  style={{
                    left: `${startOffset}%`,
                    width: `${Math.max(width, 0.5)}%`,
                  }}
                  onMouseEnter={() => setHoveredNode(node.id)}
                  onMouseLeave={() => setHoveredNode(null)}
                >
                  <div className="h-full flex items-center justify-center px-2">
                    <span className="text-[10px] text-white font-medium whitespace-nowrap">
                      {formatDuration(node.durationMs)}
                    </span>
                  </div>
                </div>

                {/* Hover tooltip */}
                {isHovered && (
                  <div className="absolute left-0 top-full mt-1 z-10 bg-bg-secondary dark:bg-dark-bg-secondary border border-border-primary dark:border-dark-border-primary rounded shadow-lg p-3 min-w-[250px] max-w-[400px]">
                    <div className="space-y-1">
                      <div className="font-medium text-sm text-text-primary dark:text-dark-text-primary">
                        {node.label}
                      </div>
                      <div className="text-xs text-text-muted dark:text-dark-text-muted">
                        Status: <span className="capitalize">{node.status}</span>
                      </div>
                      <div className="text-xs text-text-muted dark:text-dark-text-muted">
                        Duration: {formatDuration(node.durationMs)}
                      </div>
                      {node.error && (
                        <div className="text-xs text-error">
                          Error:{' '}
                          {node.error.length > 100
                            ? node.error.substring(0, 100) + '...'
                            : node.error}
                        </div>
                      )}
                      {!node.error && node.output !== undefined && (
                        <div className="text-xs text-text-muted dark:text-dark-text-muted">
                          Output: {formatOutput(node.output)}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
