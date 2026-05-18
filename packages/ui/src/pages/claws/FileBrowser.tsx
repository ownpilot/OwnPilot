import { useState, useEffect } from 'react';
import { useToast } from '../../components/ToastProvider';
import { LoadingSpinner } from '../../components/LoadingSpinner';
import { Plus, X, Save, FolderOpen, FileText, Download, ArrowLeft } from '../../components/icons';
import { authedFetch } from './utils';

export function FileBrowser({
  workspaceId,
  currentPath,
  files,
  isLoading,
  onNavigate,
  onOpenFile,
  onRefresh,
  onFileCreated,
}: {
  workspaceId: string;
  currentPath: string;
  files: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedAt: string;
  }>;
  isLoading: boolean;
  onNavigate: (path: string) => void;
  onOpenFile: (path: string) => void;
  onRefresh: () => void;
  onFileCreated: () => void;
}) {
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newFileContent, setNewFileContent] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const toast = useToast();

  const createFile = async () => {
    if (!newFileName.trim()) {
      toast.error('File name required');
      return;
    }
    setIsCreating(true);
    try {
      const fullPath = currentPath ? `${currentPath}/${newFileName.trim()}` : newFileName.trim();
      const res = await authedFetch(`/api/v1/file-workspaces/${workspaceId}/file/${fullPath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: newFileContent,
      });
      if (!res.ok) throw new Error('Create failed');
      toast.success(`Created ${newFileName.trim()}`);
      setShowNewFile(false);
      setNewFileName('');
      setNewFileContent('');
      onFileCreated();
    } catch {
      toast.error('Failed to create file');
    } finally {
      setIsCreating(false);
    }
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) {
      toast.error('Folder name required');
      return;
    }
    setIsCreatingFolder(true);
    try {
      const fullPath = currentPath
        ? `${currentPath}/${newFolderName.trim()}`
        : newFolderName.trim();
      const res = await authedFetch(`/api/v1/file-workspaces/${workspaceId}/folder/${fullPath}`, {
        method: 'PUT',
      });
      if (!res.ok) throw new Error('Create folder failed');
      toast.success(`Created ${newFolderName.trim()}/`);
      setShowNewFolder(false);
      setNewFolderName('');
      onFileCreated();
    } catch {
      toast.error('Failed to create folder');
    } finally {
      setIsCreatingFolder(false);
    }
  };

  const sorted = [...files].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const filteredFiles = searchQuery
    ? sorted.filter((f) => f.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : sorted;

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        {currentPath && (
          <button
            onClick={() => onNavigate(currentPath.split('/').slice(0, -1).join('/'))}
            className="p-1 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
          >
            <ArrowLeft className="w-4 h-4 text-text-muted" />
          </button>
        )}
        <FolderOpen className="w-4 h-4 text-text-muted shrink-0" />
        <span className="text-sm text-text-muted dark:text-dark-text-muted truncate">
          {currentPath ? `/${currentPath}` : '/'}
        </span>
        <div className="flex-1" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Filter..."
          className="w-28 px-2 py-1 text-xs rounded border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted"
        />
        <button
          onClick={() => {
            setShowNewFolder(!showNewFolder);
            setShowNewFile(false);
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-amber-500/10 text-amber-600 hover:bg-amber-500/20"
        >
          <Plus className="w-3 h-3" /> Folder
        </button>
        <button
          onClick={() => {
            setShowNewFile(!showNewFile);
            setShowNewFolder(false);
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-primary/10 text-primary hover:bg-primary/20"
        >
          <Plus className="w-3 h-3" /> File
        </button>
        <button onClick={onRefresh} className="text-xs text-primary hover:underline">
          Refresh
        </button>
        <a
          href={`/api/v1/file-workspaces/${workspaceId}/download`}
          className="text-xs text-primary hover:underline"
        >
          ZIP
        </a>
      </div>

      {/* New folder form */}
      {showNewFolder && (
        <div className="mb-3 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-amber-500/20 space-y-2">
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            placeholder="folder-name"
            className="w-full px-3 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary"
          />
          <div className="flex gap-2">
            <button
              onClick={createFolder}
              disabled={isCreatingFolder}
              className="px-3 py-1 text-xs rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {isCreatingFolder ? 'Creating...' : 'Create Folder'}
            </button>
            <button
              onClick={() => {
                setShowNewFolder(false);
                setNewFolderName('');
              }}
              className="px-3 py-1 text-xs rounded text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* New file form */}
      {showNewFile && (
        <div className="mb-3 p-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border space-y-2">
          <input
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder="filename.md"
            className="w-full px-3 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary"
          />
          <textarea
            value={newFileContent}
            onChange={(e) => setNewFileContent(e.target.value)}
            placeholder="File content (optional)..."
            rows={3}
            className="w-full px-3 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary resize-none font-mono"
          />
          <div className="flex gap-2">
            <button
              onClick={createFile}
              disabled={isCreating}
              className="px-3 py-1 text-xs rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {isCreating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => {
                setShowNewFile(false);
                setShowNewFolder(false);
                setNewFileName('');
                setNewFileContent('');
                setNewFolderName('');
              }}
              className="px-3 py-1 text-xs rounded text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* File list */}
      {isLoading ? (
        <LoadingSpinner message="Loading files..." />
      ) : filteredFiles.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          {searchQuery
            ? `No files match "${searchQuery}"`
            : currentPath
              ? 'Empty directory.'
              : 'Workspace is empty. Create files or start the claw.'}
        </p>
      ) : (
        <div className="space-y-1">
          {filteredFiles.map((file) => (
            <button
              key={file.path}
              onClick={() => {
                const fPath = currentPath ? `${currentPath}/${file.name}` : file.name;
                if (file.isDirectory) {
                  onNavigate(fPath);
                } else {
                  onOpenFile(fPath);
                }
              }}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors text-left"
            >
              {file.isDirectory ? (
                <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
              ) : (
                <FileText className="w-4 h-4 text-text-muted dark:text-dark-text-muted shrink-0" />
              )}
              <span className="flex-1 text-sm text-text-primary dark:text-dark-text-primary truncate">
                {file.name}
                {file.isDirectory ? '/' : ''}
              </span>
              {!file.isDirectory && (
                <span className="text-xs text-text-muted dark:text-dark-text-muted shrink-0">
                  {file.size < 1024
                    ? `${file.size} B`
                    : file.size < 1048576
                      ? `${(file.size / 1024).toFixed(1)} KB`
                      : `${(file.size / 1048576).toFixed(1)} MB`}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FileEditorModal({
  workspaceId,
  filePath,
  content,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  filePath: string;
  content: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEditable =
    /\.(md|txt|json|yaml|yml|js|ts|py|sh|css|html|csv|xml|toml|ini|cfg|env|log)$/i.test(filePath);
  const isClawFile = filePath.startsWith('.claw/');
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(content ?? '');
  const [isSaving, setIsSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setEditContent(content ?? '');
  }, [content]);

  const saveFile = async () => {
    setIsSaving(true);
    try {
      const res = await authedFetch(`/api/v1/file-workspaces/${workspaceId}/file/${filePath}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: editContent,
      });
      if (!res.ok) throw new Error('Save failed');
      setEditing(false);
      onSaved();
    } catch {
      toast.error('Failed to save file');
    } finally {
      setIsSaving(false);
    }
  };

  // Keyboard shortcut: Ctrl+S to save, Esc to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && editing) {
        e.preventDefault();
        saveFile();
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const fileName = filePath.split('/').pop() ?? filePath;
  const lineCount = (content ?? '').split('\n').length;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/60 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex-1 flex flex-col m-4 md:m-8 lg:mx-16 lg:my-8 bg-bg-primary dark:bg-dark-bg-primary rounded-xl shadow-2xl border border-border dark:border-dark-border overflow-hidden animate-fade-in-up">
        {/* Title bar */}
        <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary dark:bg-dark-bg-secondary border-b border-border dark:border-dark-border">
          <FileText className="w-4 h-4 text-text-muted shrink-0" />
          <span className="text-sm font-mono font-medium text-text-primary dark:text-dark-text-primary">
            {fileName}
          </span>
          <span className="text-xs text-text-muted dark:text-dark-text-muted truncate">
            {filePath}
          </span>
          {isClawFile && (
            <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded font-medium">
              directive
            </span>
          )}
          <div className="flex-1" />
          <span className="text-xs text-text-muted dark:text-dark-text-muted">
            {lineCount} lines
          </span>

          {/* Actions */}
          {isEditable && !editing && (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 font-medium transition-colors"
            >
              Edit
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={saveFile}
                disabled={isSaving}
                className="flex items-center gap-1 px-3 py-1 text-xs rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-50 font-medium"
              >
                <Save className="w-3 h-3" />
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setEditContent(content ?? '');
                }}
                className="px-2 py-1 text-xs rounded-md text-text-muted hover:text-text-primary"
              >
                Cancel
              </button>
            </>
          )}
          <a
            href={`/api/v1/file-workspaces/${workspaceId}/file/${filePath}?download=true`}
            className="p-1.5 rounded-md hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
            title="Download"
          >
            <Download className="w-4 h-4 text-text-muted" />
          </a>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
            title="Close (Esc)"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        {/* Editor / Viewer */}
        <div className="flex-1 overflow-hidden">
          {editing ? (
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full h-full p-4 text-sm font-mono bg-[#1e1e2e] text-[#cdd6f4] border-none resize-none focus:outline-none leading-relaxed"
              spellCheck={false}
              autoFocus
            />
          ) : (
            <div className="h-full overflow-auto">
              <pre className="p-4 text-sm font-mono bg-[#1e1e2e] text-[#cdd6f4] min-h-full leading-relaxed whitespace-pre-wrap">
                {content ?? 'Loading...'}
              </pre>
            </div>
          )}
        </div>

        {/* Status bar */}
        <div className="flex items-center gap-4 px-4 py-1.5 bg-bg-secondary dark:bg-dark-bg-secondary border-t border-border dark:border-dark-border text-xs text-text-muted dark:text-dark-text-muted">
          <span>{editing ? 'Editing' : 'Read-only'}</span>
          {editing && <span>Ctrl+S to save · Esc to close</span>}
          <div className="flex-1" />
          <span>{(content ?? '').length.toLocaleString()} chars</span>
        </div>
      </div>
    </div>
  );
}
