/**
 * Event Monitor Page
 *
 * Real-time EventBus monitor — subscribe to patterns, view live events,
 * and publish custom events via the WebSocket EventBusBridge.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from '../components/ToastProvider';
import {
  MonitorCheck,
  Play,
  Pause,
  Trash2,
  Send,
  Plus,
  X,
  Filter,
  Activity,
  Clock,
  Zap,
  ChevronDown,
  ChevronRight,
} from '../components/icons';

// ============================================================================
// Types
// ============================================================================

interface EventEntry {
  id: string;
  type: string;
  source: string;
  data: unknown;
  timestamp: string;
  receivedAt: number;
}

interface Subscription {
  pattern: string;
  active: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const MAX_EVENTS = 500;
const DEFAULT_PATTERNS = ['**'];
const CATEGORY_COLORS: Record<string, string> = {
  agent: 'bg-blue-500/10 text-blue-500',
  tool: 'bg-purple-500/10 text-purple-500',
  channel: 'bg-green-500/10 text-green-500',
  trigger: 'bg-amber-500/10 text-amber-500',
  system: 'bg-red-500/10 text-red-500',
  gateway: 'bg-cyan-500/10 text-cyan-500',
  external: 'bg-pink-500/10 text-pink-500',
  client: 'bg-indigo-500/10 text-indigo-500',
  resource: 'bg-orange-500/10 text-orange-500',
  plugin: 'bg-teal-500/10 text-teal-500',
};

// ============================================================================
// Component
// ============================================================================

export function EventMonitorPage() {
  const { send, subscribe, status } = useGateway();
  const toast = useToast();

  // State
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [paused, setPaused] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [showPublish, setShowPublish] = useState(false);
  const [publishType, setPublishType] = useState('external.');
  const [publishData, setPublishData] = useState('{}');
  const [selectedEvent, setSelectedEvent] = useState<EventEntry | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const eventIdCounter = useRef(0);

  // Subscribe to event:message, event:subscribed, event:publish:ack, event:publish:error
  useEffect(() => {
    const unsubs = [
      subscribe<{ type: string; source: string; data: unknown; timestamp: string }>(
        'event:message',
        (payload) => {
          if (pausedRef.current) return;
          const entry: EventEntry = {
            id: `evt-${++eventIdCounter.current}`,
            type: payload.type,
            source: payload.source,
            data: payload.data,
            timestamp: payload.timestamp,
            receivedAt: Date.now(),
          };
          setEvents((prev) => {
            const next = [...prev, entry];
            return next.length > MAX_EVENTS ? next.slice(-MAX_EVENTS) : next;
          });
        }
      ),
      subscribe<{ pattern: string; success: boolean; error?: string }>(
        'event:subscribed',
        (payload) => {
          if (payload.success) {
            setSubscriptions((prev) => {
              if (prev.some((s) => s.pattern === payload.pattern)) return prev;
              return [...prev, { pattern: payload.pattern, active: true }];
            });
          } else {
            toast.error(`Subscribe failed: ${payload.error}`);
          }
        }
      ),
      subscribe<{ pattern: string }>('event:unsubscribed', (payload) => {
        setSubscriptions((prev) => prev.filter((s) => s.pattern !== payload.pattern));
      }),
      subscribe<{ type: string }>('event:publish:ack', (payload) => {
        toast.success(`Published: ${payload.type}`);
      }),
      subscribe<{ type: string; error: string }>('event:publish:error', (payload) => {
        toast.error(`Publish failed: ${payload.error}`);
      }),
    ];

    return () => unsubs.forEach((u) => u());
  }, [subscribe, toast]);

  // Auto-subscribe to default patterns on connect
  useEffect(() => {
    if (status !== 'connected') return;
    // Small delay to let bridge initialize
    const timer = setTimeout(() => {
      for (const pattern of DEFAULT_PATTERNS) {
        send('event:subscribe', { pattern });
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [status, send]);

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && eventsEndRef.current) {
      eventsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events.length, autoScroll]);

  // Handlers
  const handleAddPattern = useCallback(() => {
    const pattern = newPattern.trim();
    if (!pattern) return;
    if (subscriptions.some((s) => s.pattern === pattern)) {
      toast.warning('Already subscribed to this pattern');
      return;
    }
    send('event:subscribe', { pattern });
    setNewPattern('');
  }, [newPattern, subscriptions, send, toast]);

  const handleRemovePattern = useCallback(
    (pattern: string) => {
      send('event:unsubscribe', { pattern });
    },
    [send]
  );

  const handlePublish = useCallback(() => {
    try {
      const data = JSON.parse(publishData);
      send('event:publish', { type: publishType, data });
    } catch {
      toast.error('Invalid JSON data');
    }
  }, [publishType, publishData, send, toast]);

  const handleClear = useCallback(() => {
    setEvents([]);
    setSelectedEvent(null);
  }, []);

  // Filtered events
  const filteredEvents = filterText
    ? events.filter(
        (e) =>
          e.type.toLowerCase().includes(filterText.toLowerCase()) ||
          e.source.toLowerCase().includes(filterText.toLowerCase())
      )
    : events;

  // Stats
  const eventsPerSec = events.filter((e) => e.receivedAt > Date.now() - 10000).length / 10;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border shrink-0">
        <div className="flex items-center gap-3">
          <MonitorCheck className="w-5 h-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Event Monitor
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Real-time EventBus bridge — {subscriptions.length} subscription
              {subscriptions.length !== 1 ? 's' : ''}, {events.length} events
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPublish(!showPublish)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg transition-colors text-text-secondary dark:text-dark-text-secondary"
          >
            <Send className="w-3.5 h-3.5" />
            Publish
          </button>
          <button
            onClick={() => setPaused(!paused)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${
              paused
                ? 'bg-warning/10 text-warning'
                : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
            }`}
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary rounded-lg transition-colors text-text-secondary dark:text-dark-text-secondary"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </header>

      {/* Stats Bar */}
      <div className="flex items-center gap-4 px-6 py-2 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-xs shrink-0">
        <span className="flex items-center gap-1.5 text-text-muted dark:text-dark-text-muted">
          <Activity className="w-3 h-3" />
          {eventsPerSec.toFixed(1)} evt/s
        </span>
        <span className="flex items-center gap-1.5 text-text-muted dark:text-dark-text-muted">
          <Zap className="w-3 h-3" />
          {events.length} total
        </span>
        <span className="flex items-center gap-1.5 text-text-muted dark:text-dark-text-muted">
          <Clock className="w-3 h-3" />
          {status === 'connected' ? (
            <span className="text-success">Connected</span>
          ) : (
            <span className="text-error">{status}</span>
          )}
        </span>
        <label className="flex items-center gap-1.5 ml-auto cursor-pointer text-text-muted dark:text-dark-text-muted">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded border-border"
          />
          Auto-scroll
        </label>
      </div>

      {/* Publish Panel (collapsible) */}
      {showPublish && (
        <div className="px-6 py-3 border-b border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary shrink-0 animate-fade-in-up">
          <div className="flex items-center gap-2 mb-2">
            <Send className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
              Publish Event
            </span>
            <span className="text-xs text-text-muted dark:text-dark-text-muted">
              (external.* or client.* only)
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              value={publishType}
              onChange={(e) => setPublishType(e.target.value)}
              placeholder="external.my-event"
              className="flex-1 px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted"
            />
            <input
              type="text"
              value={publishData}
              onChange={(e) => setPublishData(e.target.value)}
              placeholder='{"key": "value"}'
              className="flex-[2] px-3 py-1.5 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg font-mono text-text-primary dark:text-dark-text-primary placeholder:text-text-muted"
            />
            <button
              onClick={handlePublish}
              className="px-4 py-1.5 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar: Subscriptions */}
        <div className="w-64 border-r border-border dark:border-dark-border flex flex-col shrink-0">
          <div className="px-4 py-3 border-b border-border dark:border-dark-border">
            <span className="text-xs font-semibold uppercase text-text-muted dark:text-dark-text-muted tracking-wider">
              Subscriptions
            </span>
          </div>

          {/* Add pattern */}
          <div className="px-3 py-2 border-b border-border dark:border-dark-border">
            <div className="flex gap-1">
              <input
                type="text"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddPattern()}
                placeholder="agent.*"
                className="flex-1 px-2 py-1 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary placeholder:text-text-muted"
              />
              <button
                onClick={handleAddPattern}
                className="px-2 py-1 bg-primary hover:bg-primary-dark text-white rounded transition-colors"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Subscription list */}
          <div className="flex-1 overflow-y-auto">
            {subscriptions.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-text-muted dark:text-dark-text-muted">
                No subscriptions yet
              </div>
            ) : (
              subscriptions.map((sub) => (
                <div
                  key={sub.pattern}
                  className="flex items-center justify-between px-3 py-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary group"
                >
                  <span className="text-xs font-mono text-text-primary dark:text-dark-text-primary truncate">
                    {sub.pattern}
                  </span>
                  <button
                    onClick={() => handleRemovePattern(sub.pattern)}
                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-error/10 rounded transition-all"
                  >
                    <X className="w-3 h-3 text-error" />
                  </button>
                </div>
              ))
            )}
          </div>

          {/* Quick patterns */}
          <div className="px-3 py-2 border-t border-border dark:border-dark-border">
            <span className="text-[10px] font-semibold uppercase text-text-muted dark:text-dark-text-muted tracking-wider mb-1 block">
              Quick Add
            </span>
            <div className="flex flex-wrap gap-1">
              {['agent.*', 'trigger.*', 'channel.**', 'gateway.**', 'external.**'].map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    if (!subscriptions.some((s) => s.pattern === p)) {
                      send('event:subscribe', { pattern: p });
                    }
                  }}
                  disabled={subscriptions.some((s) => s.pattern === p)}
                  className="px-1.5 py-0.5 text-[10px] font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary rounded hover:bg-primary/10 disabled:opacity-40 text-text-secondary dark:text-dark-text-secondary transition-colors"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Event Stream */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Filter */}
          <div className="px-4 py-2 border-b border-border dark:border-dark-border shrink-0">
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
              <input
                type="text"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter by type or source..."
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted"
              />
            </div>
          </div>

          {/* Event List */}
          <div className="flex-1 overflow-y-auto font-mono text-xs">
            {filteredEvents.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-text-muted dark:text-dark-text-muted">
                <MonitorCheck className="w-8 h-8 mb-2 opacity-30" />
                <span className="text-sm">
                  {events.length === 0 ? 'Waiting for events...' : 'No events match the filter'}
                </span>
                {paused && <span className="text-xs text-warning mt-1">Stream paused</span>}
              </div>
            ) : (
              <div className="divide-y divide-border/50 dark:divide-dark-border/50">
                {filteredEvents.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    isSelected={selectedEvent?.id === event.id}
                    onClick={() => setSelectedEvent(selectedEvent?.id === event.id ? null : event)}
                  />
                ))}
                <div ref={eventsEndRef} />
              </div>
            )}
          </div>
        </div>

        {/* Detail Panel */}
        {selectedEvent && (
          <div className="w-80 border-l border-border dark:border-dark-border flex flex-col shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-dark-border">
              <span className="text-xs font-semibold uppercase text-text-muted dark:text-dark-text-muted tracking-wider">
                Event Detail
              </span>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-0.5 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded"
              >
                <X className="w-3.5 h-3.5 text-text-muted" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <DetailField label="Type" value={selectedEvent.type} mono />
              <DetailField label="Source" value={selectedEvent.source} />
              <DetailField
                label="Timestamp"
                value={new Date(selectedEvent.timestamp).toLocaleString()}
              />
              <div>
                <span className="text-[10px] font-semibold uppercase text-text-muted dark:text-dark-text-muted tracking-wider block mb-1">
                  Data
                </span>
                <pre className="p-2 bg-bg-primary dark:bg-dark-bg-primary rounded text-[11px] text-text-primary dark:text-dark-text-primary overflow-x-auto whitespace-pre-wrap break-words max-h-96">
                  {JSON.stringify(selectedEvent.data, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function EventRow({
  event,
  isSelected,
  onClick,
}: {
  event: EventEntry;
  isSelected: boolean;
  onClick: () => void;
}) {
  const category = event.type.split('.')[0] ?? 'unknown';
  const colorClass = CATEGORY_COLORS[category] ?? 'bg-gray-500/10 text-gray-500';
  const time = new Date(event.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-1.5 flex items-center gap-3 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors ${
        isSelected ? 'bg-primary/5' : ''
      }`}
    >
      {isSelected ? (
        <ChevronDown className="w-3 h-3 text-text-muted shrink-0" />
      ) : (
        <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
      )}
      <span className="text-[10px] text-text-muted dark:text-dark-text-muted w-20 shrink-0 tabular-nums">
        {time}
      </span>
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium shrink-0 ${colorClass}`}
      >
        {category}
      </span>
      <span className="text-text-primary dark:text-dark-text-primary truncate">{event.type}</span>
      <span className="text-text-muted dark:text-dark-text-muted truncate ml-auto text-[10px]">
        {event.source}
      </span>
    </button>
  );
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-[10px] font-semibold uppercase text-text-muted dark:text-dark-text-muted tracking-wider block mb-0.5">
        {label}
      </span>
      <span
        className={`text-xs text-text-primary dark:text-dark-text-primary ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  );
}
