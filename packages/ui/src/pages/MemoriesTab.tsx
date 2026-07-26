import { useState, useEffect, useRef } from 'react';
import { Plus, History, Trash2, AlertCircle } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { memoriesApi } from '../api/endpoints/personal-data';
import type { Memory } from '../api/types';

interface MemoriesTabProps {
  memories: Memory[];
  onMemoriesChange: (memories: Memory[]) => void;
  onLoadAllData: () => void;
}

export function MemoriesTab({ memories, onMemoriesChange, onLoadAllData }: MemoriesTabProps) {
  const { confirm } = useDialog();
  const toast = useToast();

  const [newMemory, setNewMemory] = useState({ content: '', type: 'fact' as const, importance: 2 });
  const [isAddingMemory, setIsAddingMemory] = useState(false);
  const [selectedMemoryIds, setSelectedMemoryIds] = useState<Set<string>>(new Set());
  const [memoryToDelete, setMemoryToDelete] = useState<{ ids: string[]; content: string } | null>(
    null
  );
  const pendingDeleteRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) clearTimeout(pendingDeleteRef.current);
    };
  }, []);

  const addMemory = async () => {
    if (!newMemory.content.trim()) return;
    try {
      setIsAddingMemory(true);
      const memory = await memoriesApi.create({
        content: newMemory.content,
        type: newMemory.type,
        importance: newMemory.importance,
      });
      onMemoriesChange([memory, ...memories]);
      setNewMemory({ content: '', type: 'fact', importance: 2 });
      toast.success('Memory added');
    } catch {
      toast.error('Failed to add memory');
    } finally {
      setIsAddingMemory(false);
    }
  };

  const deleteMemory = async (id: string) => {
    const ok = await confirm({
      title: 'Delete Memory',
      message: 'Are you sure you want to delete this memory?',
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await memoriesApi.delete(id);
      onMemoriesChange(memories.filter((m) => m.id !== id));
      toast.success('Memory deleted');
    } catch {
      toast.error('Failed to delete memory');
    }
  };

  const bulkDeleteMemories = async (ids: string[]) => {
    if (ids.length === 0) return;
    const ok = await confirm({
      title: 'Delete Memories',
      message: `Delete ${ids.length} selected memories? This cannot be undone.`,
      confirmText: `Delete ${ids.length}`,
      variant: 'danger',
    });
    if (!ok) return;

    if (pendingDeleteRef.current) {
      clearTimeout(pendingDeleteRef.current);
      pendingDeleteRef.current = null;
    }

    const deletedIds = new Set(ids);
    onMemoriesChange(memories.filter((m) => !deletedIds.has(m.id)));
    setSelectedMemoryIds(new Set());

    pendingDeleteRef.current = setTimeout(async () => {
      pendingDeleteRef.current = null;
      try {
        await Promise.all(ids.map((id) => memoriesApi.delete(id)));
        toast.success(`Deleted ${ids.length} memories`);
      } catch {
        toast.error('Failed to delete some memories');
        onLoadAllData();
      }
      setMemoryToDelete(null);
    }, 3000);

    setMemoryToDelete({ ids, content: `${ids.length} memories` });
    toast.warning('3s undo window');
  };

  const undoBulkDelete = () => {
    if (!memoryToDelete || !pendingDeleteRef.current) return;
    clearTimeout(pendingDeleteRef.current);
    pendingDeleteRef.current = null;
    setMemoryToDelete(null);
    toast.info('Deletion cancelled');
    onLoadAllData();
  };

  const toggleMemorySelection = (id: string) => {
    setSelectedMemoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Memory Management
          </h3>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {memories.length} memories stored · Help your AI remember important information
          </p>
        </div>
        {memories.length > 0 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedMemoryIds(new Set(memories.map((m) => m.id)))}
              className="text-xs text-primary hover:underline"
            >
              Select all
            </button>
            <span className="text-text-muted">·</span>
            <button
              onClick={() => setSelectedMemoryIds(new Set())}
              className="text-xs text-primary hover:underline"
            >
              Clear
            </button>
            {selectedMemoryIds.size > 0 && (
              <>
                <span className="text-text-muted mx-1">|</span>
                <button
                  onClick={() => bulkDeleteMemories(Array.from(selectedMemoryIds))}
                  className="flex items-center gap-1 px-2 py-1 text-xs text-error bg-error/10 rounded hover:bg-error/20"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete {selectedMemoryIds.size}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Undo banner */}
      {memoryToDelete && (
        <div className="flex items-center gap-3 p-3 bg-warning/10 border border-warning/20 rounded-lg">
          <AlertCircle className="w-4 h-4 text-warning shrink-0" />
          <span className="text-sm text-text-primary dark:text-dark-text-primary flex-1">
            Deleting {memoryToDelete.content}...
          </span>
          <button
            onClick={undoBulkDelete}
            className="text-xs text-primary hover:underline font-medium"
          >
            Undo
          </button>
        </div>
      )}

      {/* Add Memory Form */}
      <div className="p-5 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-border dark:border-dark-border">
        <h4 className="font-medium text-text-primary dark:text-dark-text-primary mb-4 flex items-center gap-2">
          <Plus className="w-4 h-4 text-primary" />
          Add New Memory
        </h4>
        <div className="space-y-4">
          <textarea
            value={newMemory.content}
            onChange={(e) => setNewMemory({ ...newMemory, content: e.target.value })}
            placeholder="What should your AI remember? (e.g., 'I prefer concise responses', 'My dog's name is Max', 'I have a meeting every Monday at 9am')"
            rows={3}
            className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          />
          <div className="flex flex-wrap gap-3">
            <select
              value={newMemory.type}
              onChange={(e) =>
                setNewMemory({ ...newMemory, type: e.target.value as typeof newMemory.type })
              }
              className="px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary"
            >
              <option value="fact">Fact</option>
              <option value="preference">Preference</option>
              <option value="conversation">Conversation</option>
              <option value="event">Event</option>
            </select>
            <select
              value={newMemory.importance}
              onChange={(e) => setNewMemory({ ...newMemory, importance: parseInt(e.target.value) })}
              className="px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary"
            >
              <option value={1}>Low Priority</option>
              <option value={2}>Normal</option>
              <option value={3}>High Priority</option>
            </select>
            <button
              onClick={addMemory}
              disabled={!newMemory.content.trim() || isAddingMemory}
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50 ml-auto"
            >
              {isAddingMemory ? 'Adding...' : 'Add Memory'}
            </button>
          </div>
        </div>
      </div>

      {/* Memories List */}
      <div className="space-y-3">
        {memories.length === 0 ? (
          <div className="text-center py-12 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border border-dashed border-border dark:border-dark-border">
            <History className="w-12 h-12 text-text-muted mx-auto mb-3" />
            <p className="text-text-muted dark:text-dark-text-muted">No memories yet</p>
            <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
              Add your first memory above to help your AI understand you better.
            </p>
          </div>
        ) : (
          memories.map((memory) => (
            <div
              key={memory.id}
              className={`group p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl border transition-colors ${
                selectedMemoryIds.has(memory.id)
                  ? 'border-primary/50 bg-primary/5'
                  : 'border-border dark:border-dark-border hover:border-primary/30'
              }`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={selectedMemoryIds.has(memory.id)}
                  onChange={() => toggleMemorySelection(memory.id)}
                  className="mt-1 w-4 h-4 rounded border-border text-primary focus:ring-primary/50"
                />
                <div
                  className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                    memory.importance >= 3
                      ? 'bg-error'
                      : memory.importance <= 1
                        ? 'bg-text-muted'
                        : 'bg-primary'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <p className="text-text-primary dark:text-dark-text-primary">{memory.content}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs px-2 py-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-full text-text-muted dark:text-dark-text-muted capitalize">
                      {memory.type}
                    </span>
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">
                      {new Date(memory.createdAt).toLocaleDateString()}
                    </span>
                    {memory.source && (
                      <span className="text-xs text-text-muted dark:text-dark-text-muted">
                        via {memory.source}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => deleteMemory(memory.id)}
                  className="opacity-0 group-hover:opacity-100 p-1.5 text-error hover:bg-error/10 rounded-lg transition-all"
                  title="Delete memory"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
