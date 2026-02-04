import { useState, useEffect } from 'react';
import {
  Folder,
  File,
  ChevronRight,
  Home,
  RefreshCw,
  Download,
  Search,
  Edit,
} from './icons';
import { CodeBlock } from './CodeBlock';
import { toolsApi } from '../api';
import { LoadingSpinner } from './LoadingSpinner';

interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: string;
  extension?: string;
}

interface FileBrowserProps {
  initialPath?: string;
  onFileSelect?: (file: FileItem) => void;
  onFileOpen?: (file: FileItem, content: string) => void;
}

export function FileBrowser({ initialPath = '~', onFileSelect, onFileOpen }: FileBrowserProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // viewMode state reserved for future grid/list toggle feature
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let stale = false;
    setIsLoading(true);
    setError(null);

    toolsApi.execute('list_directory', { path: currentPath, recursive: false })
      .then((data) => {
        if (stale) return;
        const result = (data as Record<string, unknown>)?.result as Record<string, unknown> | undefined;
        if (result?.files) {
          setFiles(result.files as FileItem[]);
        } else {
          setError((result?.error as string) || 'Failed to load directory');
        }
      })
      .catch(() => {
        if (stale) return;
        setError('Failed to connect to server');
      })
      .finally(() => {
        if (!stale) setIsLoading(false);
      });

    return () => { stale = true; };
  }, [currentPath, refreshKey]);

  const refreshDirectory = () => setRefreshKey(k => k + 1);

  const loadFileContent = async (file: FileItem) => {
    if (file.isDirectory) return;

    setIsLoading(true);
    try {
      const data = await toolsApi.execute('read_file', { path: file.path }) as Record<string, unknown>;
      const result = data?.result as Record<string, unknown> | undefined;
      if (result?.content !== undefined) {
        setFileContent(result.content as string);
        onFileOpen?.(file, result.content as string);
      }
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileClick = (file: FileItem) => {
    if (file.isDirectory) {
      setCurrentPath(file.path);
      setSelectedFile(null);
      setFileContent(null);
    } else {
      setSelectedFile(file);
      loadFileContent(file);
      onFileSelect?.(file);
    }
  };

  const navigateUp = () => {
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      setCurrentPath('/' + parts.join('/'));
    }
  };

  const filteredFiles = files.filter((file) =>
    file.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div className="flex flex-col h-full bg-bg-primary dark:bg-dark-bg-primary">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border">
        {/* Navigation */}
        <button
          onClick={() => setCurrentPath('~')}
          className="p-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          title="Home"
        >
          <Home className="w-4 h-4 text-text-secondary dark:text-dark-text-secondary" />
        </button>
        <button
          onClick={navigateUp}
          className="p-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          title="Up"
        >
          <ChevronRight className="w-4 h-4 text-text-secondary dark:text-dark-text-secondary rotate-180" />
        </button>
        <button
          onClick={refreshDirectory}
          className="p-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className={`w-4 h-4 text-text-secondary dark:text-dark-text-secondary ${isLoading ? 'animate-spin' : ''}`} />
        </button>

        {/* Breadcrumb */}
        <div className="flex-1 flex items-center gap-1 px-3 py-1.5 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg overflow-x-auto">
          {currentPath.split('/').filter(Boolean).map((part, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              <button
                onClick={() => {
                  const path = '/' + arr.slice(0, i + 1).join('/');
                  setCurrentPath(path);
                }}
                className="text-sm text-text-secondary dark:text-dark-text-secondary hover:text-primary whitespace-nowrap"
              >
                {part}
              </button>
              {i < arr.length - 1 && (
                <ChevronRight className="w-3 h-3 text-text-muted" />
              )}
            </span>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="w-48 pl-9 pr-3 py-1.5 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg text-sm text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File List */}
        <div className="w-80 border-r border-border dark:border-dark-border overflow-y-auto">
          {error ? (
            <div className="p-4 text-center">
              <p className="text-error text-sm">{error}</p>
              <button
                onClick={refreshDirectory}
                className="mt-2 px-3 py-1 text-sm text-primary hover:bg-primary/10 rounded transition-colors"
              >
                Retry
              </button>
            </div>
          ) : isLoading && files.length === 0 ? (
            <div className="p-4">
              <LoadingSpinner size="sm" message="Loading..." />
            </div>
          ) : sortedFiles.length === 0 ? (
            <div className="p-4 text-center text-text-muted">
              No files found
            </div>
          ) : (
            <div className="py-2">
              {sortedFiles.map((file) => (
                <FileRow
                  key={file.path}
                  file={file}
                  isSelected={selectedFile?.path === file.path}
                  onClick={() => handleFileClick(file)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Preview Panel */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedFile && fileContent !== null ? (
            <>
              {/* File Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-dark-border">
                <div className="flex items-center gap-2">
                  <File className="w-5 h-5 text-text-secondary dark:text-dark-text-secondary" />
                  <span className="font-medium text-text-primary dark:text-dark-text-primary">
                    {selectedFile.name}
                  </span>
                  {selectedFile.size !== undefined && (
                    <span className="text-xs text-text-muted">
                      {formatFileSize(selectedFile.size)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button className="p-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg">
                    <Download className="w-4 h-4 text-text-secondary dark:text-dark-text-secondary" />
                  </button>
                  <button className="p-2 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg">
                    <Edit className="w-4 h-4 text-text-secondary dark:text-dark-text-secondary" />
                  </button>
                </div>
              </div>

              {/* File Content */}
              <div className="flex-1 overflow-auto p-4">
                <CodeBlock
                  code={fileContent}
                  language={detectLanguage(selectedFile.name)}
                  filename={selectedFile.name}
                  maxHeight="100%"
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <File className="w-16 h-16 mx-auto text-text-muted dark:text-dark-text-muted mb-4" />
                <p className="text-text-muted dark:text-dark-text-muted">
                  Select a file to preview
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface FileRowProps {
  file: FileItem;
  isSelected: boolean;
  onClick: () => void;
}

function FileRow({ file, isSelected, onClick }: FileRowProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
        isSelected
          ? 'bg-primary/10 text-primary'
          : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary'
      }`}
    >
      {file.isDirectory ? (
        <Folder className="w-5 h-5 text-blue-400 flex-shrink-0" />
      ) : (
        <File className={`w-5 h-5 flex-shrink-0 ${getFileColor(file.name)}`} />
      )}
      <span className="flex-1 truncate text-sm">{file.name}</span>
      {!file.isDirectory && file.size !== undefined && (
        <span className="text-xs text-text-muted dark:text-dark-text-muted">
          {formatFileSize(file.size)}
        </span>
      )}
    </button>
  );
}

// Helper functions
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileColor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const colors: Record<string, string> = {
    ts: 'text-blue-400',
    tsx: 'text-blue-400',
    js: 'text-yellow-400',
    jsx: 'text-yellow-400',
    py: 'text-green-400',
    json: 'text-orange-400',
    html: 'text-red-400',
    css: 'text-purple-400',
    md: 'text-gray-400',
  };
  return colors[ext] || 'text-gray-400';
}

function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const langMap: Record<string, string> = {
    js: 'javascript',
    jsx: 'javascript',
    ts: 'typescript',
    tsx: 'typescript',
    py: 'python',
    json: 'json',
    html: 'html',
    css: 'css',
    md: 'markdown',
    sh: 'bash',
    bash: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
    go: 'go',
    rs: 'rust',
  };
  return langMap[ext] || 'plaintext';
}
