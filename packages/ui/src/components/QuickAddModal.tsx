/**
 * Quick Add Modal
 *
 * Shared component for creating personal data items (Task, Note, Bookmark,
 * Contact, Event, Capture) via a modal form. Used by StatsPanel and DashboardPage.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CheckCircle2, FileText, Bookmark, Users, Calendar, Lightbulb, Send, X } from './icons';
import { tasksApi, notesApi, bookmarksApi, contactsApi, calendarApi, capturesApi } from '../api';
import { LoadingSpinner } from './LoadingSpinner';
import { useToast } from './ToastProvider';

// ---- Types ----

export type QuickAddType = 'task' | 'note' | 'bookmark' | 'contact' | 'event' | 'capture';

export const QUICK_ADD_ITEMS: {
  type: QuickAddType;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  color: string;
}[] = [
  { type: 'task', icon: CheckCircle2, label: 'Task', color: 'text-primary' },
  { type: 'note', icon: FileText, label: 'Note', color: 'text-warning' },
  { type: 'bookmark', icon: Bookmark, label: 'Bookmark', color: 'text-blue-500' },
  { type: 'contact', icon: Users, label: 'Contact', color: 'text-purple-500' },
  { type: 'event', icon: Calendar, label: 'Event', color: 'text-success' },
  { type: 'capture', icon: Lightbulb, label: 'Capture', color: 'text-amber-500' },
];

// ---- Modal ----

interface QuickAddModalProps {
  type: QuickAddType;
  onClose: () => void;
  onCreated: () => void;
}

export function QuickAddModal({ type, onClose, onCreated }: QuickAddModalProps) {
  const toast = useToast();
  const [isSaving, setIsSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');
  const [date, setDate] = useState('');
  const [priority, setPriority] = useState('normal');

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  const item = QUICK_ADD_ITEMS.find((i) => i.type === type)!;

  // Auto-focus when modal opens
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const handleSubmit = async () => {
    if (type === 'task' && !title.trim()) return;
    if (type === 'note' && !title.trim()) return;
    if (type === 'bookmark' && !url.trim()) return;
    if (type === 'contact' && !title.trim()) return;
    if (type === 'event' && !title.trim()) return;
    if (type === 'capture' && !content.trim()) return;

    setIsSaving(true);
    try {
      switch (type) {
        case 'task':
          await tasksApi.create({ title: title.trim(), priority });
          break;
        case 'note':
          await notesApi.create({ title: title.trim(), content: content.trim() || undefined });
          break;
        case 'bookmark':
          await bookmarksApi.create({ url: url.trim(), title: title.trim() || undefined });
          break;
        case 'contact':
          await contactsApi.create({ name: title.trim(), email: email.trim() || undefined });
          break;
        case 'event':
          await calendarApi.create({
            title: title.trim(),
            startDate: date || new Date().toISOString(),
            endDate: date || new Date().toISOString(),
          });
          break;
        case 'capture':
          await capturesApi.create({ content: content.trim() });
          break;
      }
      toast.success(`${item.label} added!`);
      onClose();
      onCreated();
    } catch {
      toast.error(`Failed to add ${item.label.toLowerCase()}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const inputClass =
    'w-full px-3 py-2 text-sm bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted';

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] animate-[fadeIn_150ms_ease-out]"
      onClick={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div className="w-full max-w-sm mx-4 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-2xl animate-[scaleIn_150ms_ease-out]">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary flex items-center justify-center">
              <item.icon className={`w-4 h-4 ${item.color}`} />
            </div>
            <h3 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
              New {item.label}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-5 pb-5 space-y-3" onKeyDown={handleKeyDown}>
          {type === 'task' && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Title
                </label>
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  type="text"
                  placeholder="What needs to be done?"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className={inputClass}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </>
          )}

          {type === 'note' && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Title
                </label>
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  type="text"
                  placeholder="Note title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Content
                </label>
                <textarea
                  placeholder="Write something..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={3}
                  className={inputClass + ' resize-none'}
                />
              </div>
            </>
          )}

          {type === 'bookmark' && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  URL
                </label>
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  type="text"
                  placeholder="https://..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Title
                </label>
                <input
                  type="text"
                  placeholder="Optional title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
            </>
          )}

          {type === 'contact' && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Name
                </label>
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  type="text"
                  placeholder="Contact name"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Email
                </label>
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </div>
            </>
          )}

          {type === 'event' && (
            <>
              <div>
                <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Title
                </label>
                <input
                  ref={inputRef as React.RefObject<HTMLInputElement>}
                  type="text"
                  placeholder="Event title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Date & Time
                </label>
                <input
                  type="datetime-local"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </>
          )}

          {type === 'capture' && (
            <div>
              <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Thought
              </label>
              <textarea
                ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                placeholder="Quick thought, idea, snippet..."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={3}
                className={inputClass + ' resize-none'}
              />
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              className="px-3 py-2 text-sm font-medium rounded-lg border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {isSaving ? (
                <LoadingSpinner size="sm" />
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Add
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Grid trigger (for StatsPanel sidebar) ----

interface QuickAddGridProps {
  onCreated: () => void;
}

export function QuickAddGrid({ onCreated }: QuickAddGridProps) {
  const [activeType, setActiveType] = useState<QuickAddType | null>(null);

  const openModal = useCallback((type: QuickAddType) => {
    setActiveType(type);
  }, []);

  return (
    <>
      <div className="space-y-2">
        <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
          Quick Add
        </h4>
        <div className="grid grid-cols-3 gap-1.5">
          {QUICK_ADD_ITEMS.map(({ type, icon: Icon, label, color }) => (
            <button
              key={type}
              onClick={() => openModal(type)}
              title={`Add ${label}`}
              className="flex flex-col items-center gap-1 py-2 px-1 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary transition-colors group"
            >
              <Icon className={`w-4 h-4 ${color} group-hover:scale-110 transition-transform`} />
              <span className="text-[10px] text-text-muted dark:text-dark-text-muted group-hover:text-text-primary dark:group-hover:text-dark-text-primary">
                {label}
              </span>
            </button>
          ))}
        </div>
      </div>

      {activeType && (
        <QuickAddModal
          type={activeType}
          onClose={() => setActiveType(null)}
          onCreated={onCreated}
        />
      )}
    </>
  );
}
