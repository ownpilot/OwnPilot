import { useState, useEffect, useCallback } from 'react';
import { Calendar, Plus, Trash2, Clock, MapPin } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useModalClose } from '../hooks';
import { calendarApi } from '../api';

interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  startDate: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  location?: string;
  isAllDay: boolean;
  color?: string;
  reminders: string[];
  createdAt: string;
  updatedAt: string;
}


const colorOptions = [
  { value: 'blue', label: 'Blue', class: 'bg-primary' },
  { value: 'green', label: 'Green', class: 'bg-success' },
  { value: 'yellow', label: 'Yellow', class: 'bg-warning' },
  { value: 'red', label: 'Red', class: 'bg-error' },
  { value: 'purple', label: 'Purple', class: 'bg-purple-500' },
];

export function CalendarPage() {
  const { confirm } = useDialog();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]!);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('week');

  const fetchEvents = useCallback(async () => {
    try {
      const startDate = getViewStartDate(selectedDate, viewMode);
      const endDate = getViewEndDate(selectedDate, viewMode);

      const params: Record<string, string> = {
        startAfter: startDate,
        startBefore: endDate,
      };

      const data = await calendarApi.list(params);
      setEvents(data as CalendarEvent[]);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, [selectedDate, viewMode]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleDelete = async (eventId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this event?', variant: 'danger' })) return;

    try {
      await calendarApi.delete(eventId);
      fetchEvents();
    } catch {
      // API client handles error reporting
    }
  };

  const todayEvents = events.filter(
    (e) => e.startDate === new Date().toISOString().split('T')[0]
  );

  const upcomingEvents = events.filter(
    (e) => e.startDate > new Date().toISOString().split('T')[0]!
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Calendar
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {todayEvents.length} event{todayEvents.length !== 1 ? 's' : ''} today, {upcomingEvents.length} upcoming
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg p-1">
            {(['day', 'week', 'month'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  viewMode === mode
                    ? 'bg-primary text-white'
                    : 'text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary'
                }`}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Event
          </button>
        </div>
      </header>

      {/* Date Navigation */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-border dark:border-dark-border">
        <button
          onClick={() => setSelectedDate(navigateDate(selectedDate, viewMode, -1))}
          className="px-3 py-1 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded transition-colors"
        >
          Previous
        </button>
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-medium text-text-primary dark:text-dark-text-primary">
            {formatDateRange(selectedDate, viewMode)}
          </h3>
          <button
            onClick={() => setSelectedDate(new Date().toISOString().split('T')[0]!)}
            className="px-2 py-1 text-sm text-primary hover:underline"
          >
            Today
          </button>
        </div>
        <button
          onClick={() => setSelectedDate(navigateDate(selectedDate, viewMode, 1))}
          className="px-3 py-1 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded transition-colors"
        >
          Next
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted dark:text-dark-text-muted">Loading events...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Calendar className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
            <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
              No events scheduled
            </h3>
            <p className="text-text-muted dark:text-dark-text-muted mb-4">
              Add your first event to get started.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Event
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {groupEventsByDate(events).map(([date, dateEvents]) => (
              <div key={date} className="space-y-2">
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary sticky top-0 bg-bg-primary dark:bg-dark-bg-primary py-1">
                  {formatDateHeader(date)}
                </h4>
                {dateEvents.map((event) => (
                  <EventItem
                    key={event.id}
                    event={event}
                    onEdit={() => setEditingEvent(event)}
                    onDelete={() => handleDelete(event.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingEvent) && (
        <EventModal
          event={editingEvent}
          defaultDate={selectedDate}
          onClose={() => {
            setShowCreateModal(false);
            setEditingEvent(null);
          }}
          onSave={() => {
            setShowCreateModal(false);
            setEditingEvent(null);
            fetchEvents();
          }}
        />
      )}
    </div>
  );
}

interface EventItemProps {
  event: CalendarEvent;
  onEdit: () => void;
  onDelete: () => void;
}

function EventItem({ event, onEdit, onDelete }: EventItemProps) {
  const colorClass = colorOptions.find((c) => c.value === event.color)?.class ?? 'bg-primary';

  return (
    <div
      className="flex items-start gap-3 p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors"
    >
      <div className={`w-1 h-full min-h-[40px] rounded-full ${colorClass}`} />

      <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary dark:text-dark-text-primary">
            {event.title}
          </span>
          {event.isAllDay && (
            <span className="px-2 py-0.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full text-text-muted dark:text-dark-text-muted">
              All day
            </span>
          )}
        </div>

        {event.description && (
          <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1 line-clamp-2">
            {event.description}
          </p>
        )}

        <div className="flex items-center gap-3 mt-2 text-xs text-text-muted dark:text-dark-text-muted">
          {!event.isAllDay && event.startTime && (
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {event.startTime}
              {event.endTime && ` - ${event.endTime}`}
            </span>
          )}
          {event.location && (
            <span className="flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              {event.location}
            </span>
          )}
        </div>
      </div>

      <button
        onClick={onDelete}
        className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
        aria-label="Delete event"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

interface EventModalProps {
  event: CalendarEvent | null;
  defaultDate: string;
  onClose: () => void;
  onSave: () => void;
}

function EventModal({ event, defaultDate, onClose, onSave }: EventModalProps) {
  const { onBackdropClick } = useModalClose(onClose);
  const [title, setTitle] = useState(event?.title ?? '');
  const [description, setDescription] = useState(event?.description ?? '');
  const [startDate, setStartDate] = useState(event?.startDate ?? defaultDate);
  const [endDate, setEndDate] = useState(event?.endDate ?? '');
  const [startTime, setStartTime] = useState(event?.startTime ?? '');
  const [endTime, setEndTime] = useState(event?.endTime ?? '');
  const [location, setLocation] = useState(event?.location ?? '');
  const [isAllDay, setIsAllDay] = useState(event?.isAllDay ?? false);
  const [color, setColor] = useState(event?.color ?? 'blue');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startDate) return;

    setIsSaving(true);
    try {
      const body = {
        title: title.trim(),
        description: description.trim() || undefined,
        startDate,
        endDate: endDate || undefined,
        startTime: isAllDay ? undefined : startTime || undefined,
        endTime: isAllDay ? undefined : endTime || undefined,
        location: location.trim() || undefined,
        isAllDay,
        color,
      };

      if (event) {
        await calendarApi.update(event.id, body);
      } else {
        await calendarApi.create(body);
      }
      onSave();
    } catch {
      // Error is handled by the global API client error callback
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onBackdropClick}>
      <div className="w-full max-w-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-border dark:border-dark-border">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {event ? 'Edit Event' : 'Create Event'}
            </h3>
          </div>

          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Event title"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add details..."
                rows={3}
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isAllDay"
                checked={isAllDay}
                onChange={(e) => setIsAllDay(e.target.checked)}
                className="w-4 h-4 rounded border-border dark:border-dark-border"
              />
              <label htmlFor="isAllDay" className="text-sm text-text-secondary dark:text-dark-text-secondary">
                All day event
              </label>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            {!isAllDay && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Location
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Add location"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Color
              </label>
              <div className="flex gap-2">
                {colorOptions.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={`w-8 h-8 rounded-full ${c.class} ${
                      color === c.value ? 'ring-2 ring-offset-2 ring-primary' : ''
                    }`}
                    title={c.label}
                    aria-label={`Set color to ${c.label}`}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="p-4 border-t border-border dark:border-dark-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!title.trim() || !startDate || isSaving}
              className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : event ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Helper functions
function getViewStartDate(date: string, mode: 'day' | 'week' | 'month'): string {
  const d = new Date(date);
  if (mode === 'day') return date;
  if (mode === 'week') {
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d.toISOString().split('T')[0]!;
  }
  // month
  d.setDate(1);
  return d.toISOString().split('T')[0]!;
}

function getViewEndDate(date: string, mode: 'day' | 'week' | 'month'): string {
  const d = new Date(date);
  if (mode === 'day') return date;
  if (mode === 'week') {
    const day = d.getDay();
    d.setDate(d.getDate() + (6 - day));
    return d.toISOString().split('T')[0]!;
  }
  // month
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return d.toISOString().split('T')[0]!;
}

function navigateDate(date: string, mode: 'day' | 'week' | 'month', direction: number): string {
  const d = new Date(date);
  if (mode === 'day') d.setDate(d.getDate() + direction);
  else if (mode === 'week') d.setDate(d.getDate() + direction * 7);
  else d.setMonth(d.getMonth() + direction);
  return d.toISOString().split('T')[0]!;
}

function formatDateRange(date: string, mode: 'day' | 'week' | 'month'): string {
  const d = new Date(date);
  const options: Intl.DateTimeFormatOptions = { month: 'long', year: 'numeric' };

  if (mode === 'day') {
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }
  if (mode === 'week') {
    const start = new Date(getViewStartDate(date, 'week'));
    const end = new Date(getViewEndDate(date, 'week'));
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  return d.toLocaleDateString('en-US', options);
}

function formatDateHeader(date: string): string {
  const d = new Date(date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';

  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function groupEventsByDate(events: CalendarEvent[]): [string, CalendarEvent[]][] {
  const grouped = events.reduce((acc, event) => {
    const date = event.startDate;
    if (!acc[date]) acc[date] = [];
    acc[date].push(event);
    return acc;
  }, {} as Record<string, CalendarEvent[]>);

  return Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));
}
