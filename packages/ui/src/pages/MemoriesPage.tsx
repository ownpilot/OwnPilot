import { useState, useEffect, useCallback } from 'react';
import { Brain, Plus, Trash2, Search, Star, Filter } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';

interface Memory {
  id: string;
  type: 'fact' | 'preference' | 'conversation' | 'event';
  content: string;
  source?: string;
  importance: number;
  createdAt: string;
  updatedAt: string;
  accessedAt?: string;
  metadata?: Record<string, unknown>;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { message: string };
}

const typeColors = {
  fact: 'bg-blue-500/10 text-blue-500',
  preference: 'bg-purple-500/10 text-purple-500',
  conversation: 'bg-green-500/10 text-green-500',
  event: 'bg-orange-500/10 text-orange-500',
};

const typeLabels = {
  fact: 'Fact',
  preference: 'Preference',
  conversation: 'Conversation',
  event: 'Event',
};

export function MemoriesPage() {
  const { confirm } = useDialog();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<Memory['type'] | 'all'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);

  const fetchMemories = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) {
        params.append('query', searchQuery);
      }
      if (typeFilter !== 'all') {
        params.append('type', typeFilter);
      }

      const response = await fetch(`/api/v1/memories?${params}`);
      const data: ApiResponse<{ memories: Memory[] }> = await response.json();
      if (data.success && data.data) {
        setMemories(data.data.memories);
      }
    } catch (err) {
      console.error('Failed to fetch memories:', err);
    } finally {
      setIsLoading(false);
    }
  }, [searchQuery, typeFilter]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const handleDelete = async (memoryId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this memory?', variant: 'danger' })) return;

    try {
      const response = await fetch(`/api/v1/memories/${memoryId}`, {
        method: 'DELETE',
      });
      const data: ApiResponse<void> = await response.json();
      if (data.success) {
        fetchMemories();
      }
    } catch (err) {
      console.error('Failed to delete memory:', err);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchMemories();
  };

  const factCount = memories.filter((m) => m.type === 'fact').length;
  const preferenceCount = memories.filter((m) => m.type === 'preference').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Memories
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {factCount} facts, {preferenceCount} preferences, {memories.length} total
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Memory
        </button>
      </header>

      {/* Search and Filters */}
      <div className="flex gap-4 px-6 py-3 border-b border-border dark:border-dark-border">
        <form onSubmit={handleSearch} className="flex-1 flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search memories..."
              className="w-full pl-10 pr-4 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
          >
            Search
          </button>
        </form>

        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as Memory['type'] | 'all')}
            className="px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          >
            <option value="all">All Types</option>
            <option value="fact">Facts</option>
            <option value="preference">Preferences</option>
            <option value="conversation">Conversations</option>
            <option value="event">Events</option>
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted dark:text-dark-text-muted">Loading memories...</p>
          </div>
        ) : memories.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <Brain className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
            <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
              No memories yet
            </h3>
            <p className="text-text-muted dark:text-dark-text-muted mb-4">
              {searchQuery
                ? 'No memories match your search.'
                : 'The AI will automatically remember important information from conversations.'}
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Memory
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {memories.map((memory) => (
              <MemoryItem
                key={memory.id}
                memory={memory}
                onEdit={() => setEditingMemory(memory)}
                onDelete={() => handleDelete(memory.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingMemory) && (
        <MemoryModal
          memory={editingMemory}
          onClose={() => {
            setShowCreateModal(false);
            setEditingMemory(null);
          }}
          onSave={() => {
            setShowCreateModal(false);
            setEditingMemory(null);
            fetchMemories();
          }}
        />
      )}
    </div>
  );
}

interface MemoryItemProps {
  memory: Memory;
  onEdit: () => void;
  onDelete: () => void;
}

function MemoryItem({ memory, onEdit, onDelete }: MemoryItemProps) {
  return (
    <div
      className="flex items-start gap-3 p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg hover:border-primary transition-colors cursor-pointer"
      onClick={onEdit}
    >
      <Brain className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`px-2 py-0.5 text-xs rounded-full ${typeColors[memory.type]}`}>
            {typeLabels[memory.type]}
          </span>
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                className={`w-3 h-3 ${
                  i < Math.round(memory.importance * 5)
                    ? 'text-warning fill-warning'
                    : 'text-text-muted dark:text-dark-text-muted'
                }`}
              />
            ))}
          </div>
        </div>

        <p className="text-text-primary dark:text-dark-text-primary">{memory.content}</p>

        <div className="flex items-center gap-3 mt-2 text-xs text-text-muted dark:text-dark-text-muted">
          {memory.source && <span>Source: {memory.source}</span>}
          <span>{new Date(memory.createdAt).toLocaleDateString()}</span>
        </div>
      </div>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
}

interface MemoryModalProps {
  memory: Memory | null;
  onClose: () => void;
  onSave: () => void;
}

function MemoryModal({ memory, onClose, onSave }: MemoryModalProps) {
  const [content, setContent] = useState(memory?.content ?? '');
  const [type, setType] = useState<Memory['type']>(memory?.type ?? 'fact');
  const [importance, setImportance] = useState(memory?.importance ?? 0.5);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setIsSaving(true);
    try {
      const body = {
        content: content.trim(),
        type,
        importance,
      };

      const url = memory ? `/api/v1/memories/${memory.id}` : '/api/v1/memories';
      const method = memory ? 'PATCH' : 'POST';

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
      console.error('Failed to save memory:', err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-border dark:border-dark-border">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {memory ? 'Edit Memory' : 'Add Memory'}
            </h3>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Content
              </label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="What should the AI remember?"
                rows={4}
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Type
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as Memory['type'])}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option value="fact">Fact</option>
                  <option value="preference">Preference</option>
                  <option value="event">Event</option>
                  <option value="conversation">Conversation</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Importance ({Math.round(importance * 100)}%)
                </label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={importance}
                  onChange={(e) => setImportance(parseFloat(e.target.value))}
                  className="w-full"
                />
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
              disabled={!content.trim() || isSaving}
              className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : memory ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
