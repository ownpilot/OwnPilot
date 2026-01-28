import { useState, useEffect } from 'react';
import {
  Calendar,
  CheckCircle2,
  Zap,
  Clock,
  AlertTriangle,
} from './icons';

interface TimelineItem {
  id: string;
  type: 'event' | 'task' | 'trigger';
  title: string;
  time: string;
  description?: string;
  priority?: 'high' | 'medium' | 'low';
  status?: string;
  isPast: boolean;
}

interface DailyBriefingData {
  tasks: {
    dueToday: Array<{
      id: string;
      title: string;
      dueDate?: string;
      priority: string;
      status: string;
    }>;
    overdue: Array<{
      id: string;
      title: string;
      dueDate?: string;
      priority: string;
      status: string;
    }>;
  };
  calendar: {
    todayEvents: Array<{
      id: string;
      title: string;
      startTime: string;
      endTime?: string;
      description?: string;
    }>;
  };
  triggers: {
    scheduledToday: Array<{
      id: string;
      name: string;
      nextFire?: string;
      description?: string;
    }>;
  };
}

interface DataResponse {
  success: boolean;
  data?: DailyBriefingData;
  error?: { message: string };
}

export function TimelineView() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTimelineData();
  }, []);

  const fetchTimelineData = async () => {
    try {
      const response = await fetch('/api/v1/dashboard/data');
      const result: DataResponse = await response.json();

      if (result.success && result.data) {
        const timelineItems = buildTimelineItems(result.data);
        setItems(timelineItems);
      } else if (result.error) {
        setError(result.error.message);
      }
    } catch (err) {
      console.error('Failed to fetch timeline data:', err);
      setError('Failed to load timeline');
    } finally {
      setIsLoading(false);
    }
  };

  const buildTimelineItems = (data: DailyBriefingData): TimelineItem[] => {
    const now = new Date();
    const items: TimelineItem[] = [];

    // Add today's events
    data.calendar.todayEvents.forEach((event) => {
      const eventTime = new Date(event.startTime);
      items.push({
        id: event.id,
        type: 'event',
        title: event.title,
        time: event.startTime,
        description: event.description,
        isPast: eventTime < now,
      });
    });

    // Add overdue tasks (at the top, as "past")
    data.tasks.overdue.forEach((task) => {
      items.push({
        id: task.id,
        type: 'task',
        title: task.title,
        time: task.dueDate || new Date().toISOString(),
        priority: task.priority as 'high' | 'medium' | 'low',
        status: 'overdue',
        isPast: true,
      });
    });

    // Add today's due tasks
    data.tasks.dueToday.forEach((task) => {
      items.push({
        id: task.id,
        type: 'task',
        title: task.title,
        time: task.dueDate || new Date().toISOString(),
        priority: task.priority as 'high' | 'medium' | 'low',
        status: task.status,
        isPast: false,
      });
    });

    // Add scheduled triggers
    data.triggers.scheduledToday.forEach((trigger) => {
      if (trigger.nextFire) {
        const triggerTime = new Date(trigger.nextFire);
        items.push({
          id: trigger.id,
          type: 'trigger',
          title: trigger.name,
          time: trigger.nextFire,
          description: trigger.description,
          isPast: triggerTime < now,
        });
      }
    });

    // Sort by time
    items.sort((a, b) => {
      const timeA = new Date(a.time).getTime();
      const timeB = new Date(b.time).getTime();
      return timeA - timeB;
    });

    return items;
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  const getTypeIcon = (type: TimelineItem['type']) => {
    switch (type) {
      case 'event':
        return <Calendar className="w-4 h-4" />;
      case 'task':
        return <CheckCircle2 className="w-4 h-4" />;
      case 'trigger':
        return <Zap className="w-4 h-4" />;
    }
  };

  const getTypeColor = (type: TimelineItem['type'], isPast: boolean, status?: string) => {
    if (status === 'overdue') {
      return {
        bg: 'bg-error/20',
        text: 'text-error',
        border: 'border-error/40',
      };
    }
    if (isPast) {
      return {
        bg: 'bg-text-muted/10',
        text: 'text-text-muted dark:text-dark-text-muted',
        border: 'border-text-muted/20',
      };
    }

    switch (type) {
      case 'event':
        return {
          bg: 'bg-primary/20',
          text: 'text-primary',
          border: 'border-primary/40',
        };
      case 'task':
        return {
          bg: 'bg-success/20',
          text: 'text-success',
          border: 'border-success/40',
        };
      case 'trigger':
        return {
          bg: 'bg-warning/20',
          text: 'text-warning',
          border: 'border-warning/40',
        };
    }
  };

  const getPriorityBadge = (priority?: string) => {
    if (!priority) return null;

    const colors = {
      high: 'bg-error/20 text-error',
      medium: 'bg-warning/20 text-warning',
      low: 'bg-text-muted/20 text-text-muted',
    };

    return (
      <span className={`px-1.5 py-0.5 text-xs rounded ${colors[priority as keyof typeof colors] || colors.low}`}>
        {priority}
      </span>
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-primary" />
          <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
            Today's Timeline
          </h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="w-12 h-4 bg-text-muted/20 rounded" />
              <div className="flex-1 h-12 bg-text-muted/10 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-4 h-4 text-error" />
          <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
            Today's Timeline
          </h3>
        </div>
        <p className="text-sm text-text-muted dark:text-dark-text-muted">{error}</p>
      </div>
    );
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="w-4 h-4 text-primary" />
          <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
            Today's Timeline
          </h3>
        </div>
        <p className="text-sm text-text-muted dark:text-dark-text-muted text-center py-4">
          No events, tasks, or triggers scheduled for today
        </p>
      </div>
    );
  }

  return (
    <div className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-xl">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-4 h-4 text-primary" />
        <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
          Today's Timeline
        </h3>
        <span className="text-xs text-text-muted dark:text-dark-text-muted">
          ({items.length} items)
        </span>
      </div>

      <div className="space-y-2">
        {items.map((item, index) => {
          const colors = getTypeColor(item.type, item.isPast, item.status);
          const isLast = index === items.length - 1;

          return (
            <div key={item.id} className="flex gap-3">
              {/* Time column */}
              <div className={`w-14 text-right text-xs font-medium pt-2 ${item.isPast ? 'text-text-muted/60 dark:text-dark-text-muted/60' : 'text-text-muted dark:text-dark-text-muted'}`}>
                {item.status === 'overdue' ? (
                  <span className="text-error">Overdue</span>
                ) : (
                  formatTime(item.time)
                )}
              </div>

              {/* Timeline line and dot */}
              <div className="flex flex-col items-center">
                <div className={`w-3 h-3 rounded-full ${colors.bg} border-2 ${colors.border} mt-2`} />
                {!isLast && (
                  <div className="w-px flex-1 bg-border dark:bg-dark-border my-1" />
                )}
              </div>

              {/* Content */}
              <div className={`flex-1 pb-3 ${item.isPast ? 'opacity-60' : ''}`}>
                <div className={`p-2 rounded-lg border ${colors.border} bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50`}>
                  <div className="flex items-start gap-2">
                    <span className={colors.text}>{getTypeIcon(item.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${item.isPast ? 'text-text-muted dark:text-dark-text-muted' : 'text-text-primary dark:text-dark-text-primary'}`}>
                          {item.title}
                        </span>
                        {getPriorityBadge(item.priority)}
                      </div>
                      {item.description && (
                        <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5 line-clamp-1">
                          {item.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
