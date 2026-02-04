import { useState, useEffect, useCallback, useMemo } from 'react';
import { FileText, Plus, Trash2, Pin, Search } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { useDebouncedValue, useModalClose } from '../hooks';
import { notesApi } from '../api';
import type { Note } from '../api';


export function NotesPage() {
  const { confirm } = useDialog();
  const toast = useToast();
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchNotes = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (debouncedSearch) {
        params.search = debouncedSearch;
      }

      const data = await notesApi.list(params);
      setNotes(data);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleDelete = useCallback(async (noteId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this note?', variant: 'danger' })) return;

    try {
      await notesApi.delete(noteId);
      toast.success('Note deleted');
      fetchNotes();
      setSelectedNote((prev) => prev?.id === noteId ? null : prev);
    } catch {
      // API client handles error reporting
    }
  }, [confirm, toast, fetchNotes]);

  const handleTogglePin = useCallback(async (note: Note) => {
    try {
      await notesApi.pin(note.id);
      toast.success(note.isPinned ? 'Note unpinned' : 'Note pinned');
      fetchNotes();
    } catch {
      // API client handles error reporting
    }
  }, [toast, fetchNotes]);

  const pinnedNotes = useMemo(() => notes.filter((n) => n.isPinned), [notes]);
  const otherNotes = useMemo(() => notes.filter((n) => !n.isPinned), [notes]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Notes
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Note
        </button>
      </header>

      {/* Search */}
      <div className="px-6 py-3 border-b border-border dark:border-dark-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search notes..."
            className="w-full pl-10 pr-4 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
        {isLoading ? (
          <LoadingSpinner message="Loading notes..." />
        ) : notes.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={searchQuery ? 'No notes found' : 'No notes yet'}
            description={searchQuery ? 'Try a different search term.' : 'Create your first note to get started.'}
            action={!searchQuery ? { label: 'Create Note', onClick: () => setShowCreateModal(true), icon: Plus } : undefined}
          />
        ) : (
          <div className="space-y-6">
            {/* Pinned Notes */}
            {pinnedNotes.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-3 flex items-center gap-2">
                  <Pin className="w-4 h-4" />
                  Pinned
                </h3>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {pinnedNotes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onClick={() => setSelectedNote(note)}
                      onTogglePin={() => handleTogglePin(note)}
                      onDelete={() => handleDelete(note.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Other Notes */}
            {otherNotes.length > 0 && (
              <div>
                {pinnedNotes.length > 0 && (
                  <h3 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-3">
                    All Notes
                  </h3>
                )}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {otherNotes.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      onClick={() => setSelectedNote(note)}
                      onTogglePin={() => handleTogglePin(note)}
                      onDelete={() => handleDelete(note.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Note Detail/Edit Modal */}
      {(showCreateModal || selectedNote) && (
        <NoteModal
          note={selectedNote}
          onClose={() => {
            setShowCreateModal(false);
            setSelectedNote(null);
          }}
          onSave={() => {
            toast.success(selectedNote ? 'Note updated' : 'Note created');
            setShowCreateModal(false);
            setSelectedNote(null);
            fetchNotes();
          }}
        />
      )}
    </div>
  );
}

interface NoteCardProps {
  note: Note;
  onClick: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

function NoteCard({ note, onClick, onTogglePin, onDelete }: NoteCardProps) {
  const colorStyles = note.color
    ? { borderLeftColor: note.color, borderLeftWidth: '4px' }
    : {};

  return (
    <div
      style={colorStyles}
      className="card-elevated card-hover p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-text-primary dark:text-dark-text-primary line-clamp-1">
          {note.title || 'Untitled'}
        </h3>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin();
            }}
            className={`p-1 rounded transition-colors ${
              note.isPinned
                ? 'text-primary'
                : 'text-text-muted dark:text-dark-text-muted hover:text-primary'
            }`}
            aria-label={note.isPinned ? 'Unpin note' : 'Pin note'}
          >
            <Pin className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error rounded transition-colors"
            aria-label="Delete note"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <p className="text-sm text-text-muted dark:text-dark-text-muted mt-2 line-clamp-3">
        {note.content}
      </p>

      <div className="flex items-center gap-2 mt-3 text-xs text-text-muted dark:text-dark-text-muted">
        {note.category && (
          <span className="px-1.5 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded">
            {note.category}
          </span>
        )}
        <span>
          {new Date(note.updatedAt).toLocaleDateString()}
        </span>
      </div>
    </div>
  );
}

interface NoteModalProps {
  note: Note | null;
  onClose: () => void;
  onSave: () => void;
}

function NoteModal({ note, onClose, onSave }: NoteModalProps) {
  const { onBackdropClick } = useModalClose(onClose);
  const [title, setTitle] = useState(note?.title ?? '');
  const [content, setContent] = useState(note?.content ?? '');
  const [category, setCategory] = useState(note?.category ?? '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setIsSaving(true);
    try {
      const body = {
        title: title.trim() || 'Untitled',
        content: content.trim(),
        category: category.trim() || undefined,
      };

      if (note) {
        await notesApi.update(note.id, body);
      } else {
        await notesApi.create(body);
      }
      onSave();
    } catch {
      // API client handles error reporting
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onBackdropClick}>
      <div className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          <div className="p-6 border-b border-border dark:border-dark-border">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Note title..."
              className="w-full text-xl font-semibold text-text-primary dark:text-dark-text-primary bg-transparent border-none focus:outline-none"
              autoFocus
            />
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your note..."
              className="w-full h-full min-h-[300px] bg-transparent text-text-primary dark:text-dark-text-primary focus:outline-none resize-none"
            />
          </div>

          <div className="p-4 border-t border-border dark:border-dark-border flex items-center justify-between">
            <div>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Category..."
                className="px-3 py-1 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!content.trim() || isSaving}
                className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSaving ? 'Saving...' : note ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
