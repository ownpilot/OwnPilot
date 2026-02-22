import { useState, useEffect } from 'react';
import { HardDrive, Plus, Trash2, Download, Folder, FolderOpen, RefreshCw } from './icons';
import { workspacesApi, apiClient } from '../api';
import { formatBytes } from '../utils/formatters';
import type { WorkspaceSelectorInfo } from '../api';

interface WorkspaceSelectorProps {
  selectedWorkspaceId: string | null;
  onWorkspaceChange: (workspaceId: string | null) => void;
}

export function WorkspaceSelector({
  selectedWorkspaceId,
  onWorkspaceChange,
}: WorkspaceSelectorProps) {
  const [workspaces, setWorkspaces] = useState<WorkspaceSelectorInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showMenu, setShowMenu] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [newWorkspaceDesc, setNewWorkspaceDesc] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const fetchWorkspaces = async () => {
    try {
      const data = await workspacesApi.list();
      const list = data.workspaces;
      setWorkspaces(list ?? []);
      // Auto-select first workspace if none selected
      if (!selectedWorkspaceId && Array.isArray(list) && list.length > 0) {
        onWorkspaceChange(list[0]!.id);
      }
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    setIsCreating(true);
    try {
      const created = await workspacesApi.create(newWorkspaceName.trim());
      setWorkspaces([created, ...workspaces]);
      onWorkspaceChange(created.id);
      setShowCreateModal(false);
      setNewWorkspaceName('');
      setNewWorkspaceDesc('');
    } catch {
      // API client handles error reporting
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteWorkspace = async (id: string) => {
    try {
      await apiClient.delete(`/workspaces/${id}`);
      const remaining = workspaces.filter((w) => w.id !== id);
      setWorkspaces(remaining);
      if (selectedWorkspaceId === id) {
        onWorkspaceChange(remaining.length > 0 ? remaining[0]!.id : null);
      }
    } catch {
      // API client handles error reporting
    }
    setDeleteConfirm(null);
  };

  const handleDownloadWorkspace = async (id: string) => {
    // Trigger download via API
    window.open(`/api/v1/workspaces/${id}/download`, '_blank');
  };

  const selectedWorkspace = workspaces.find((w) => w.id === selectedWorkspaceId);

  return (
    <div className="relative">
      {/* Workspace Button */}
      <button
        onClick={() => setShowMenu(!showMenu)}
        disabled={isLoading}
        className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors disabled:opacity-50"
      >
        {isLoading ? (
          <span className="text-text-muted dark:text-dark-text-muted animate-pulse">
            Loading...
          </span>
        ) : (
          <>
            <HardDrive className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
            <span className="font-medium text-text-primary dark:text-dark-text-primary max-w-[120px] truncate">
              {selectedWorkspace?.name ?? 'No Workspace'}
            </span>
            {selectedWorkspace?.storageUsage && (
              <span className="text-text-muted dark:text-dark-text-muted text-xs">
                ({formatBytes(selectedWorkspace.storageUsage.usedBytes)})
              </span>
            )}
          </>
        )}
        <svg
          className={`w-4 h-4 text-text-muted transition-transform ${showMenu ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu */}
      {showMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
          <div className="absolute top-full left-0 mt-1 w-80 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border dark:border-dark-border">
              <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                Workspaces
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setIsLoading(true);
                    fetchWorkspaces();
                  }}
                  className="p-1 text-text-muted hover:text-text-primary dark:text-dark-text-muted dark:hover:text-dark-text-primary rounded"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowCreateModal(true);
                  }}
                  className="p-1 text-text-muted hover:text-primary dark:text-dark-text-muted rounded"
                  title="Create Workspace"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Workspace List */}
            {workspaces.length === 0 ? (
              <div className="p-4 text-center">
                <p className="text-sm text-text-muted dark:text-dark-text-muted mb-2">
                  No workspaces yet
                </p>
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowCreateModal(true);
                  }}
                  className="text-sm text-primary hover:underline flex items-center justify-center gap-1"
                >
                  <Plus className="w-4 h-4" /> Create your first workspace
                </button>
              </div>
            ) : (
              <div className="py-1">
                {workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    className={`px-3 py-2 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary cursor-pointer ${
                      selectedWorkspaceId === ws.id ? 'bg-primary/10' : ''
                    }`}
                  >
                    <div
                      className="flex items-start justify-between"
                      onClick={() => {
                        onWorkspaceChange(ws.id);
                        setShowMenu(false);
                      }}
                    >
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        {selectedWorkspaceId === ws.id ? (
                          <FolderOpen className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                        ) : (
                          <Folder className="w-4 h-4 text-text-muted dark:text-dark-text-muted mt-0.5 flex-shrink-0" />
                        )}
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                            {ws.name}
                          </div>
                          {ws.description && (
                            <div className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                              {ws.description}
                            </div>
                          )}
                          {ws.storageUsage && (
                            <div className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                              {ws.storageUsage.fileCount} files &middot;{' '}
                              {formatBytes(ws.storageUsage.usedBytes)}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownloadWorkspace(ws.id);
                          }}
                          className="p-1 text-text-muted hover:text-primary dark:text-dark-text-muted rounded"
                          title="Download as ZIP"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteConfirm(ws.id);
                          }}
                          className="p-1 text-text-muted hover:text-error dark:text-dark-text-muted rounded"
                          title="Delete Workspace"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Delete Confirmation */}
                    {deleteConfirm === ws.id && (
                      <div className="mt-2 p-2 bg-error/10 border border-error/20 rounded text-xs">
                        <p className="text-error mb-2">Delete "{ws.name}"?</p>
                        <div className="flex gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteWorkspace(ws.id);
                            }}
                            className="px-2 py-1 bg-error text-white rounded hover:bg-error/80"
                          >
                            Delete
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirm(null);
                            }}
                            className="px-2 py-1 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Create Workspace Modal */}
      {showCreateModal && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-50"
            onClick={() => setShowCreateModal(false)}
          />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg shadow-xl z-50 p-4">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4">
              Create New Workspace
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={newWorkspaceName}
                  onChange={(e) => setNewWorkspaceName(e.target.value)}
                  placeholder="My Workspace"
                  className="w-full px-3 py-2 border border-border dark:border-dark-border rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Description
                </label>
                <input
                  type="text"
                  value={newWorkspaceDesc}
                  onChange={(e) => setNewWorkspaceDesc(e.target.value)}
                  placeholder="Optional description"
                  className="w-full px-3 py-2 border border-border dark:border-dark-border rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWorkspace}
                disabled={!newWorkspaceName.trim() || isCreating}
                className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCreating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
