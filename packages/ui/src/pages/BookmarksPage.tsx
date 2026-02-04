import { useState, useEffect, useCallback } from 'react';
import { Bookmark, Plus, Trash2, Star, ExternalLink, Search, Folder } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { useDebouncedValue, useModalClose } from '../hooks';
import { bookmarksApi } from '../api';
import type { BookmarkItem } from '../api';


export function BookmarksPage() {
  const { confirm } = useDialog();
  const toast = useToast();
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const debouncedSearch = useDebouncedValue(searchQuery, 300);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState<BookmarkItem | null>(null);
  const [filter, setFilter] = useState<'all' | 'favorites'>('all');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  const fetchBookmarks = useCallback(async () => {
    try {
      const params: Record<string, string> = {};
      if (debouncedSearch) params.search = debouncedSearch;
      if (filter === 'favorites') params.favorite = 'true';
      if (selectedFolder) params.folder = selectedFolder;

      const data = await bookmarksApi.list(params);
      setBookmarks(data);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  }, [debouncedSearch, filter, selectedFolder]);

  useEffect(() => {
    fetchBookmarks();
  }, [fetchBookmarks]);

  const handleDelete = useCallback(async (bookmarkId: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this bookmark?', variant: 'danger' })) return;

    try {
      await bookmarksApi.delete(bookmarkId);
      toast.success('Bookmark deleted');
      fetchBookmarks();
    } catch {
      // API client handles error reporting
    }
  }, [confirm, toast, fetchBookmarks]);

  const handleToggleFavorite = useCallback(async (bookmark: BookmarkItem) => {
    try {
      await bookmarksApi.favorite(bookmark.id);
      toast.success(bookmark.isFavorite ? 'Removed from favorites' : 'Added to favorites');
      fetchBookmarks();
    } catch {
      // API client handles error reporting
    }
  }, [toast, fetchBookmarks]);

  // Get unique folders
  const folders = Array.from(new Set(bookmarks.map((b) => b.folder).filter(Boolean))) as string[];
  const favoriteCount = bookmarks.filter((b) => b.isFavorite).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Bookmarks
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {bookmarks.length} bookmark{bookmarks.length !== 1 ? 's' : ''}, {favoriteCount} favorite{favoriteCount !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Bookmark
        </button>
      </header>

      {/* Search and Filters */}
      <div className="px-6 py-3 border-b border-border dark:border-dark-border space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted dark:text-dark-text-muted" />
          <input
            type="text"
            placeholder="Search bookmarks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {(['all', 'favorites'] as const).map((f) => (
            <button
              key={f}
              onClick={() => {
                setFilter(f);
                setSelectedFolder(null);
              }}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                filter === f && !selectedFolder
                  ? 'bg-primary text-white'
                  : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
              }`}
            >
              {f === 'all' ? 'All' : 'Favorites'}
            </button>
          ))}
          {folders.length > 0 && (
            <>
              <span className="text-text-muted dark:text-dark-text-muted">|</span>
              {folders.map((folder) => (
                <button
                  key={folder}
                  onClick={() => {
                    setSelectedFolder(folder);
                    setFilter('all');
                  }}
                  className={`flex items-center gap-1 px-3 py-1 text-sm rounded-full transition-colors ${
                    selectedFolder === folder
                      ? 'bg-primary text-white'
                      : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                  }`}
                >
                  <Folder className="w-3 h-3" />
                  {folder}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
        {isLoading ? (
          <LoadingSpinner message="Loading bookmarks..." />
        ) : bookmarks.length === 0 ? (
          <EmptyState
            icon={Bookmark}
            title={searchQuery ? 'No bookmarks found' : 'No bookmarks yet'}
            description={searchQuery ? 'Try a different search term.' : 'Save your favorite links to access them later.'}
            action={!searchQuery ? { label: 'Add Bookmark', onClick: () => setShowCreateModal(true), icon: Plus } : undefined}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {bookmarks.map((bookmark) => (
              <BookmarkCard
                key={bookmark.id}
                bookmark={bookmark}
                onEdit={() => setEditingBookmark(bookmark)}
                onDelete={() => handleDelete(bookmark.id)}
                onToggleFavorite={() => handleToggleFavorite(bookmark)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      {(showCreateModal || editingBookmark) && (
        <BookmarkModal
          bookmark={editingBookmark}
          folders={folders}
          onClose={() => {
            setShowCreateModal(false);
            setEditingBookmark(null);
          }}
          onSave={() => {
            toast.success(editingBookmark ? 'Bookmark updated' : 'Bookmark created');
            setShowCreateModal(false);
            setEditingBookmark(null);
            fetchBookmarks();
          }}
        />
      )}
    </div>
  );
}

interface BookmarkCardProps {
  bookmark: BookmarkItem;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
}

function BookmarkCard({ bookmark, onEdit, onDelete, onToggleFavorite }: BookmarkCardProps) {
  const getDomain = (url: string) => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };

  return (
    <div className="card-elevated card-hover flex flex-col p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg">
      <div className="flex items-start gap-3 flex-1">
        {/* Favicon */}
        <div className="w-8 h-8 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary flex items-center justify-center flex-shrink-0">
          {bookmark.favicon ? (
            <img src={bookmark.favicon} alt="" className="w-5 h-5" />
          ) : (
            <Bookmark className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 cursor-pointer" onClick={onEdit}>
          <h4 className="font-medium text-text-primary dark:text-dark-text-primary line-clamp-1">
            {bookmark.title}
          </h4>
          <p className="text-xs text-text-muted dark:text-dark-text-muted line-clamp-1">
            {getDomain(bookmark.url)}
          </p>
          {bookmark.description && (
            <p className="text-sm text-text-secondary dark:text-dark-text-secondary mt-1 line-clamp-2">
              {bookmark.description}
            </p>
          )}
        </div>
      </div>

      {/* Tags and Actions */}
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-border dark:border-dark-border">
        <div className="flex flex-wrap gap-1">
          {bookmark.folder && (
            <span className="flex items-center gap-1 px-2 py-0.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary rounded text-text-muted dark:text-dark-text-muted">
              <Folder className="w-3 h-3" />
              {bookmark.folder}
            </span>
          )}
          {bookmark.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 text-xs bg-primary/10 text-primary rounded"
            >
              {tag}
            </span>
          ))}
          {bookmark.tags.length > 2 && (
            <span className="px-2 py-0.5 text-xs text-text-muted dark:text-dark-text-muted">
              +{bookmark.tags.length - 2}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <a
            href={bookmark.url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
            onClick={(e) => e.stopPropagation()}
            aria-label="Open bookmark in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </a>
          <button
            onClick={onToggleFavorite}
            className={`p-1 transition-colors ${
              bookmark.isFavorite
                ? 'text-warning'
                : 'text-text-muted dark:text-dark-text-muted hover:text-warning'
            }`}
            aria-label={bookmark.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={`w-4 h-4 ${bookmark.isFavorite ? 'fill-warning' : ''}`} />
          </button>
          <button
            onClick={onDelete}
            className="p-1 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
            aria-label="Delete bookmark"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

interface BookmarkModalProps {
  bookmark: BookmarkItem | null;
  folders: string[];
  onClose: () => void;
  onSave: () => void;
}

function BookmarkModal({ bookmark, folders, onClose, onSave }: BookmarkModalProps) {
  const { onBackdropClick } = useModalClose(onClose);
  const [url, setUrl] = useState(bookmark?.url ?? '');
  const [title, setTitle] = useState(bookmark?.title ?? '');
  const [description, setDescription] = useState(bookmark?.description ?? '');
  const [folder, setFolder] = useState(bookmark?.folder ?? '');
  const [newFolder, setNewFolder] = useState('');
  const [tags, setTags] = useState(bookmark?.tags.join(', ') ?? '');
  const [isFavorite, setIsFavorite] = useState(bookmark?.isFavorite ?? false);
  const [isSaving, setIsSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !title.trim()) return;

    setIsSaving(true);
    try {
      const body = {
        url: url.trim(),
        title: title.trim(),
        description: description.trim() || undefined,
        folder: (newFolder.trim() || folder) || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        isFavorite,
      };

      if (bookmark) {
        await bookmarksApi.update(bookmark.id, body);
      } else {
        await bookmarksApi.create(body);
      }
      onSave();
    } catch {
      // handled by API client
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
              {bookmark ? 'Edit Bookmark' : 'Add Bookmark'}
            </h3>
          </div>

          <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Title
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Page title"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add a description..."
                rows={2}
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Folder
              </label>
              <div className="space-y-2">
                {folders.length > 0 && (
                  <select
                    value={folder}
                    onChange={(e) => {
                      setFolder(e.target.value);
                      setNewFolder('');
                    }}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    <option value="">No folder</option>
                    {folders.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  type="text"
                  value={newFolder}
                  onChange={(e) => {
                    setNewFolder(e.target.value);
                    setFolder('');
                  }}
                  placeholder="Or create new folder..."
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                Tags
              </label>
              <input
                type="text"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Comma-separated tags"
                className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isFavorite"
                checked={isFavorite}
                onChange={(e) => setIsFavorite(e.target.checked)}
                className="w-4 h-4 rounded border-border dark:border-dark-border"
              />
              <label htmlFor="isFavorite" className="text-sm text-text-secondary dark:text-dark-text-secondary">
                Mark as favorite
              </label>
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
              disabled={!url.trim() || !title.trim() || isSaving}
              className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isSaving ? 'Saving...' : bookmark ? 'Save' : 'Add'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
