import { useState, useEffect } from 'react';
import {
  Folder,
  FolderOpen,
  File,
  Download,
  Trash,
  RefreshCw,
  Archive,
  Clock,
  HardDrive,
  ChevronRight,
  ChevronDown,
} from '../components/icons';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useToast } from '../components/ToastProvider';
import { fileWorkspacesApi } from '../api';
import { useModalClose } from '../hooks';
import type { FileWorkspaceInfo, WorkspaceFile } from '../api';


interface WorkspaceStats {
  total: number;
  totalSize: number;
  totalFiles: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours === 0) {
      const minutes = Math.floor(diff / (1000 * 60));
      return minutes <= 1 ? 'Just now' : `${minutes} minutes ago`;
    }
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  }
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString();
}

export function WorkspacesPage() {
  const toast = useToast();
  const [workspaces, setWorkspaces] = useState<FileWorkspaceInfo[]>([]);
  const [stats, setStats] = useState<WorkspaceStats | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedWorkspace, setSelectedWorkspace] = useState<FileWorkspaceInfo | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [currentPath, setCurrentPath] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const { onBackdropClick: onDeleteBackdropClick } = useModalClose(() => setDeleteConfirm(null));

  useEffect(() => {
    fetchWorkspaces();
  }, []);

  const fetchWorkspaces = async () => {
    setIsLoading(true);
    try {
      const data = await fileWorkspacesApi.list();
      const workspaceList = data;
      setWorkspaces(workspaceList.workspaces);
      // Calculate stats
      const totalSize = workspaceList.workspaces.reduce((acc, w) => acc + (w.size || 0), 0);
      const totalFiles = workspaceList.workspaces.reduce((acc, w) => acc + (w.fileCount || 0), 0);
      setStats({
        total: workspaceList.count,
        totalSize,
        totalFiles,
      });
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  };

  const fetchWorkspaceFiles = async (workspaceId: string, path: string = '') => {
    setIsLoadingFiles(true);
    try {
      const data = await fileWorkspacesApi.files(workspaceId, path || undefined);
      const filesData = data;
      setWorkspaceFiles(filesData.files);
      setCurrentPath(path);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleSelectWorkspace = (workspace: FileWorkspaceInfo) => {
    setSelectedWorkspace(workspace);
    setCurrentPath('');
    setExpandedFolders(new Set());
    fetchWorkspaceFiles(workspace.id);
  };

  const handleDownload = async (workspaceId: string) => {
    try {
      const response = await fetch(fileWorkspacesApi.downloadUrl(workspaceId));
      if (!response.ok) throw new Error('Download failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `workspace-${workspaceId}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      // API client handles error reporting
    }
  };

  const handleDelete = async (workspaceId: string) => {
    try {
      await fileWorkspacesApi.delete(workspaceId);
      toast.success('Workspace deleted');
      if (selectedWorkspace?.id === workspaceId) {
        setSelectedWorkspace(null);
        setWorkspaceFiles([]);
      }
      fetchWorkspaces();
    } catch {
      // API client handles error reporting
    } finally {
      setDeleteConfirm(null);
    }
  };

  const handleCleanup = async () => {
    try {
      await fileWorkspacesApi.cleanup(7);
      toast.success('Old workspaces cleaned up');
      fetchWorkspaces();
    } catch {
      // API client handles error reporting
    }
  };

  const toggleFolder = (path: string) => {
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
      if (selectedWorkspace) {
        fetchWorkspaceFiles(selectedWorkspace.id, path);
      }
    }
    setExpandedFolders(newExpanded);
  };

  const navigateToPath = (path: string) => {
    if (selectedWorkspace) {
      setCurrentPath(path);
      fetchWorkspaceFiles(selectedWorkspace.id, path);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            File Workspaces
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Session-based file storage for AI operations
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCleanup}
            className="px-3 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors flex items-center gap-2"
            title="Clean up workspaces older than 7 days"
          >
            <Archive className="w-4 h-4" />
            Cleanup
          </button>
          <button
            onClick={fetchWorkspaces}
            className="p-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Stats Bar */}
      {stats && (
        <div className="px-6 py-3 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <Folder className="w-4 h-4 text-primary" />
              <span className="text-text-muted dark:text-dark-text-muted">Workspaces:</span>
              <span className="font-medium text-text-primary dark:text-dark-text-primary">{stats.total}</span>
            </div>
            <div className="flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-primary" />
              <span className="text-text-muted dark:text-dark-text-muted">Total Size:</span>
              <span className="font-medium text-text-primary dark:text-dark-text-primary">{formatBytes(stats.totalSize)}</span>
            </div>
            <div className="flex items-center gap-2">
              <File className="w-4 h-4 text-primary" />
              <span className="text-text-muted dark:text-dark-text-muted">Files:</span>
              <span className="font-medium text-text-primary dark:text-dark-text-primary">{stats.totalFiles}</span>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Workspace List */}
        <div className="w-80 border-r border-border dark:border-dark-border overflow-y-auto">
          {isLoading ? (
            <LoadingSpinner message="Loading workspaces..." />
          ) : workspaces.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full p-4">
              <Folder className="w-12 h-12 text-text-muted dark:text-dark-text-muted mb-3" />
              <p className="text-sm text-text-muted dark:text-dark-text-muted text-center">
                No workspaces yet. They will be created automatically during chat sessions.
              </p>
            </div>
          ) : (
            <div className="p-2">
              {workspaces.map((workspace) => (
                <div
                  key={workspace.id}
                  className={`group p-3 rounded-lg cursor-pointer transition-colors ${
                    selectedWorkspace?.id === workspace.id
                      ? 'bg-primary/10 border border-primary/30'
                      : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
                  }`}
                  onClick={() => handleSelectWorkspace(workspace)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-2 min-w-0 flex-1">
                      <FolderOpen className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="font-medium text-text-primary dark:text-dark-text-primary text-sm truncate">
                          {workspace.name || workspace.id.slice(0, 8)}
                        </p>
                        <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                          {workspace.sessionId || workspace.id}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(workspace.id);
                        }}
                        className="p-1.5 text-text-muted hover:text-primary rounded transition-colors"
                        title="Download as ZIP"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirm(workspace.id);
                        }}
                        className="p-1.5 text-text-muted hover:text-error rounded transition-colors"
                        title="Delete workspace"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-text-muted dark:text-dark-text-muted">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatDate(workspace.updatedAt)}
                    </span>
                    {workspace.fileCount !== undefined && (
                      <span className="flex items-center gap-1">
                        <File className="w-3 h-3" />
                        {workspace.fileCount} files
                      </span>
                    )}
                  </div>
                  {workspace.tags && workspace.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {workspace.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 text-xs bg-primary/10 text-primary rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* File Browser */}
        <div className="flex-1 overflow-y-auto">
          {selectedWorkspace ? (
            <div className="h-full flex flex-col">
              {/* Workspace Header */}
              <div className="px-6 py-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
                      {selectedWorkspace.name || selectedWorkspace.id}
                    </h3>
                    {selectedWorkspace.description && (
                      <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
                        {selectedWorkspace.description}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => handleDownload(selectedWorkspace.id)}
                    className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-dark transition-colors flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Download ZIP
                  </button>
                </div>

                {/* Breadcrumb */}
                {currentPath && (
                  <div className="flex items-center gap-1 mt-3 text-sm">
                    <button
                      onClick={() => navigateToPath('')}
                      className="text-primary hover:underline"
                    >
                      Root
                    </button>
                    {currentPath.split('/').filter(Boolean).map((part, idx, arr) => (
                      <span key={idx} className="flex items-center gap-1">
                        <ChevronRight className="w-4 h-4 text-text-muted" />
                        <button
                          onClick={() => navigateToPath(arr.slice(0, idx + 1).join('/'))}
                          className="text-primary hover:underline"
                        >
                          {part}
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Files List */}
              <div className="flex-1 overflow-y-auto p-4">
                {isLoadingFiles ? (
                  <LoadingSpinner size="sm" message="Loading files..." />
                ) : workspaceFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32">
                    <File className="w-10 h-10 text-text-muted dark:text-dark-text-muted mb-2" />
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      No files in this {currentPath ? 'folder' : 'workspace'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {workspaceFiles.map((file) => (
                      <div
                        key={file.path}
                        className="flex items-center justify-between p-3 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          {file.isDirectory ? (
                            <button
                              onClick={() => toggleFolder(file.path)}
                              className="flex items-center gap-2"
                            >
                              {expandedFolders.has(file.path) ? (
                                <ChevronDown className="w-4 h-4 text-text-muted" />
                              ) : (
                                <ChevronRight className="w-4 h-4 text-text-muted" />
                              )}
                              <FolderOpen className="w-5 h-5 text-primary" />
                            </button>
                          ) : (
                            <File className="w-5 h-5 text-text-muted dark:text-dark-text-muted ml-6" />
                          )}
                          <div className="min-w-0">
                            <p className="text-sm text-text-primary dark:text-dark-text-primary truncate">
                              {file.name}
                            </p>
                            <p className="text-xs text-text-muted dark:text-dark-text-muted">
                              {formatDate(file.modifiedAt)}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-xs text-text-muted dark:text-dark-text-muted">
                            {file.isDirectory ? '--' : formatBytes(file.size)}
                          </span>
                          {!file.isDirectory && (
                            <a
                              href={`/api/v1/file-workspaces/${selectedWorkspace.id}/file/${file.path}?download=true`}
                              className="p-1.5 text-text-muted hover:text-primary rounded transition-colors"
                              title="Download file"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full">
              <Folder className="w-16 h-16 text-text-muted dark:text-dark-text-muted mb-4" />
              <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Select a Workspace
              </h3>
              <p className="text-text-muted dark:text-dark-text-muted">
                Choose a workspace from the list to view its files
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onDeleteBackdropClick}>
          <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-error/10 flex items-center justify-center">
                <Trash className="w-5 h-5 text-error" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                Delete Workspace
              </h3>
            </div>
            <p className="text-text-secondary dark:text-dark-text-secondary mb-6">
              Are you sure you want to delete this workspace? All files will be permanently removed.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="px-4 py-2 bg-error text-white rounded-lg hover:bg-error/90 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
