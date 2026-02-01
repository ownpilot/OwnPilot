import { useState, useEffect, useCallback } from 'react';
import { FileText, Plus, Trash2, Pin, Search } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { notesApi } from '../api';

interface Note {
  id: string;
  title: string;
  content: string;
  contentType: 'markdown' | 'text';
  category?: string;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  color?: string;
  createdAt: string;
  updatedAt: string;
}


export function NotesPage() {
  const { confirm } = useDialog();
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchNotes = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (searchQuery) {
        params.search = searchQuery;
      }

      const data = await notesApi.list(params);
      setNotes(data as Note[]);
    } catch (err) {
      console.error('Failed to fetch notes:', err);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleDelete = async (noteId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this note?', variant: 'danger' })) return;

    try {
      await notesApi.delete(noteId);
      fetchNotes();
      if (selectedNote?.id === noteId) {
        setSelectedNote(null);
      }
    } catch (err) {
      console.error('Failed to delete note:', err);
    }
  };

  const handleTogglePin = async (note: Note) => {
    try {
      await notesApi.pin(note.id);
      fetchNotes();
    } catch (err) {
      console.error('Failed to toggle pin:', err);
    }
  };

  const pinnedNotes = notes.filter((n) => n.isPinned);
  const otherNotes = notes.filter((n) => !n.isPinned);

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
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted dark:text-dark-text-muted">Loading notes...</p>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <FileText className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
            <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
              {searchQuery ? 'No notes found' : 'No notes yet'}
            </h3>
            <p className="text-text-muted dark:text-dark-text-muted mb-4">
              {searchQuery
                ? 'Try a different search term.'
                : 'Create your first note to get started.'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create Note
              </button>
            )}
          </div>
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
      className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors cursor-pointer"
      onClick={onClick}
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
          >
            <Pin className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error rounded transition-colors"
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

      const url = note ? `/api/v1/notes/${note.id}` : '/api/v1/notes';
      const method = note ? 'PATCH' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (data.success) {
        onSave();
      }
    } catch (err) {
      console.error('Failed to save note:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
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
