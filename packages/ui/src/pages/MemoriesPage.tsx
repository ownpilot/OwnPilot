import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGateway } from '../hooks/useWebSocket';
import { memoriesApi } from '../api';
import type { Memory } from '../api';
import {
  Brain,
  Plus,
  Trash2,
  Search,
  Star,
  Filter,
  Sparkles,
  Edit2,
  Heart,
  Home,
  RefreshCw,
  AlertTriangle,
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { useDebouncedValue, useModalClose, useDebouncedCallback } from '../hooks';
import { PageHomeTab } from '../components/PageHomeTab';

type TabId = 'home' | 'memories';
const TAB_LABELS: Record<TabId, string> = { home: 'Home', memories: 'Memories' };

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
  const [searchParams, setSearchParams] = useSearchParams();

  // Skip home preference from localStorage
  const SKIP_HOME_KEY = 'ownpilot:memories:skipHome';
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Save skip home preference
  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try {
      localStorage.setItem(SKIP_HOME_KEY, String(checked));
    } catch {
      // localStorage might be disabled
    }
  }, []);

  // Auto-redirect to memories if skipHome is enabled and no explicit tab param
  useEffect(() => {
    if (skipHome && !searchParams.get('tab')) {
      setSearchParams({ tab: 'memories' });
    }
  }, [skipHome, searchParams, setSearchParams]);

  const activeTab = (searchParams.get('tab') as TabId) || 'home';
  const setActiveTab = (t: TabId) => setSearchParams(t === 'home' ? {} : { tab: t });

  const { confirm } = useDialog();
  const toast = useToast();
  const { subscribe } = useGateway();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [typeFilter, setTypeFilter] = useState<Memory['type'] | 'all'>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const fetchMemories = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (debouncedSearch) {
        params.query = debouncedSearch;
      }
      if (typeFilter !== 'all') {
        params.type = typeFilter;
      }

      const data = await memoriesApi.list(params);
      setMemories(data.memories);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load memories');
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, typeFilter]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const debouncedRefresh = useDebouncedCallback(() => fetchMemories(), 2000);

  useEffect(() => {
    const unsub = subscribe<{ entity: string }>('data:changed', (data) => {
      if (data.entity === 'memory') debouncedRefresh();
    });
    return () => {
      unsub();
    };
  }, [subscribe, debouncedRefresh]);

  const handleDelete = useCallback(
    async (memoryId: string) => {
      if (
        !(await confirm({
          message: 'Are you sure you want to delete this memory?',
          variant: 'danger',
        }))
      )
        return;

      try {
        await memoriesApi.delete(memoryId);
        toast.success('Memory deleted');
        fetchMemories();
      } catch {
        // API client handles error reporting
      }
    },
    [confirm, toast, fetchMemories]
  );

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      fetchMemories();
    },
    [fetchMemories]
  );

  const factCount = useMemo(() => memories.filter((m) => m.type === 'fact').length, [memories]);
  const preferenceCount = useMemo(
    () => memories.filter((m) => m.type === 'preference').length,
    [memories]
  );

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

      {/* URL-based tabs */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'memories'] as TabId[]).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {t === 'home' && <Home className="w-3.5 h-3.5" />}
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Home Tab */}
      {activeTab === 'home' && (
        <div className="flex-1 overflow-y-auto p-6">
          <PageHomeTab
            heroIcons={[
              { icon: Brain, color: 'text-primary bg-primary/10' },
              { icon: Heart, color: 'text-violet-500 bg-violet-500/10' },
              { icon: Search, color: 'text-emerald-500 bg-emerald-500/10' },
            ]}
            title="Your AI's Long-Term Memory"
            subtitle="Memories let your AI remember facts, preferences, and context across conversations — so it gets better over time."
            cta={{ label: 'View Memories', icon: Brain, onClick: () => setActiveTab('memories') }}
            skipHomeChecked={skipHome}
            onSkipHomeChange={handleSkipHomeChange}
            skipHomeLabel="Skip this screen and go directly to Memories"
            features={[
              {
                icon: Sparkles,
                color: 'text-amber-500 bg-amber-500/10',
                title: 'Auto-Capture',
                description:
                  'The AI automatically identifies and saves important facts from conversations.',
              },
              {
                icon: Edit2,
                color: 'text-blue-500 bg-blue-500/10',
                title: 'Manual Memories',
                description: 'Add your own memories manually for things the AI should know.',
              },
              {
                icon: Heart,
                color: 'text-pink-500 bg-pink-500/10',
                title: 'Favorites',
                description: 'Mark important memories as favorites for quick access.',
              },
              {
                icon: Search,
                color: 'text-green-500 bg-green-500/10',
                title: 'Semantic Search',
                description: 'Find memories using natural language — not just keyword matching.',
              },
            ]}
            steps={[
              {
                title: 'AI captures key facts automatically',
                detail:
                  'During conversations, the AI identifies important information and saves it as memories.',
              },
              {
                title: 'Review saved memories',
                detail:
                  'Browse all captured memories, edit them, or remove ones that are no longer relevant.',
              },
              {
                title: 'Mark important ones as favorites',
                detail: 'Star key memories so they are prioritized in future conversations.',
              },
              {
                title: 'AI recalls them in future conversations',
                detail:
                  'The AI uses stored memories to provide more personalized and contextual responses.',
              },
            ]}
          />
        </div>
      )}

      {/* Memories Tab */}
      {activeTab === 'memories' && (
        <>
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
                aria-label="Filter by memory type"
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
          <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
            {isLoading ? (
              <LoadingSpinner message="Loading memories..." />
            ) : error ? (
              <EmptyState
                icon={AlertTriangle}
                title="Failed to load memories"
                description={error}
                variant="card"
                action={{
                  label: 'Try Again',
                  onClick: fetchMemories,
                  icon: RefreshCw,
                }}
              />
            ) : memories.length === 0 ? (
              <EmptyState
                icon={Brain}
                title={searchQuery ? 'No memories found' : 'No memories yet'}
                description={
                  searchQuery
                    ? `No memories matching "${searchQuery}". Try a different search term.`
                    : 'The AI will automatically remember important information from conversations. You can also add memories manually.'
                }
                variant="card"
                iconBgColor="bg-violet-500/10 dark:bg-violet-500/20"
                iconColor="text-violet-500"
                action={{
                  label: 'Add Memory',
                  onClick: () => setShowCreateModal(true),
                  icon: Plus,
                }}
              />
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
        </>
      )}

      {/* Create/Edit Modal */}
      {(showCreateModal || editingMemory) && (
        <MemoryModal
          memory={editingMemory}
          onClose={() => {
            setShowCreateModal(false);
            setEditingMemory(null);
          }}
          onSave={() => {
            toast.success(editingMemory ? 'Memory updated' : 'Memory created');
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
      className="card-elevated card-hover flex items-start gap-3 p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg cursor-pointer"
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
        aria-label="Delete memory"
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
  const { onBackdropClick } = useModalClose(onClose);
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

      if (memory) {
        await memoriesApi.update(memory.id, body);
      } else {
        await memoriesApi.create(body);
      }
      onSave();
    } catch {
      // API client handles error reporting
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onBackdropClick}
    >
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
