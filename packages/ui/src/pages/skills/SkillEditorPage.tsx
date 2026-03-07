import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Editor from '@monaco-editor/react';
import { useToast } from '../../components/ToastProvider';
import { extensionsApi, type FileEntry, type FileTreeResult } from '../../api/endpoints/extensions';
import { MarkdownContent } from '../../components/MarkdownContent';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Eye,
  Code,
  X,
} from '../../components/icons';

/* ---------- File tree node ---------- */
function TreeNode({
  entry,
  depth,
  selectedPath,
  onSelect,
}: {
  entry: FileEntry;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = entry.type === 'directory';
  const isSelected = entry.path === selectedPath;

  return (
    <div>
      <button
        onClick={() => {
          if (isDir) setExpanded((e) => !e);
          else onSelect(entry.path);
        }}
        className={`flex items-center gap-1.5 w-full px-2 py-1 text-xs rounded transition-colors truncate ${
          isSelected
            ? 'bg-primary/15 text-primary font-medium'
            : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {isDir ? (
          expanded ? (
            <>
              <ChevronDown className="w-3 h-3 shrink-0" />
              <FolderOpen className="w-3.5 h-3.5 shrink-0 text-amber-500" />
            </>
          ) : (
            <>
              <ChevronRight className="w-3 h-3 shrink-0" />
              <Folder className="w-3.5 h-3.5 shrink-0 text-amber-500" />
            </>
          )
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <File className="w-3.5 h-3.5 shrink-0 text-text-muted dark:text-dark-text-muted" />
          </>
        )}
        <span className="truncate">{entry.name}</span>
      </button>
      {isDir && expanded && entry.children?.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

/* ---------- New file dialog ---------- */
function NewFileDialog({
  onConfirm,
  onCancel,
}: {
  onConfirm: (path: string) => void;
  onCancel: () => void;
}) {
  const [path, setPath] = useState('');
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-border dark:border-dark-border">
      <input
        autoFocus
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && path.trim()) onConfirm(path.trim());
          if (e.key === 'Escape') onCancel();
        }}
        placeholder="path/to/file.md"
        className="flex-1 text-xs px-2 py-1 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
      <button
        onClick={() => path.trim() && onConfirm(path.trim())}
        className="text-xs text-primary hover:text-primary/80"
      >
        OK
      </button>
      <button onClick={onCancel} className="text-xs text-text-muted hover:text-text-secondary">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/* ---------- Language map ---------- */
function getMonacoLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    md: 'markdown',
    js: 'javascript',
    ts: 'typescript',
    json: 'json',
    yaml: 'yaml',
    yml: 'yaml',
    py: 'python',
    sh: 'shell',
    html: 'html',
    css: 'css',
    txt: 'plaintext',
  };
  return map[ext] ?? 'plaintext';
}

/* ---------- Main page ---------- */
export function SkillEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [treeData, setTreeData] = useState<FileTreeResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState('');
  const [originalContent, setOriginalContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showNewFile, setShowNewFile] = useState(false);
  const [extensionName, setExtensionName] = useState('');
  const editorRef = useRef<unknown>(null);

  const isDirty = fileContent !== originalContent;

  /* Load file tree */
  const loadTree = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const data = await extensionsApi.listFiles(id);
      setTreeData(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  /* Load extension name */
  useEffect(() => {
    if (!id) return;
    extensionsApi.getById(id).then((pkg) => setExtensionName(pkg.name)).catch(() => {});
  }, [id]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  /* Open a file */
  const openFile = useCallback(
    async (path: string) => {
      if (!id) return;
      if (isDirty && selectedFile) {
        const ok = window.confirm('You have unsaved changes. Discard them?');
        if (!ok) return;
      }
      try {
        const result = await extensionsApi.readFile(id, path);
        setSelectedFile(path);
        setFileContent(result.content);
        setOriginalContent(result.content);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to read file');
      }
    },
    [id, isDirty, selectedFile, toast]
  );

  /* Save current file */
  const saveFile = useCallback(async () => {
    if (!id || !selectedFile) return;
    setSaving(true);
    try {
      await extensionsApi.writeFile(id, selectedFile, fileContent);
      setOriginalContent(fileContent);
      toast.success('File saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  }, [id, selectedFile, fileContent, toast]);

  /* Create new file */
  const createFile = useCallback(
    async (path: string) => {
      if (!id) return;
      setShowNewFile(false);
      try {
        await extensionsApi.writeFile(id, path, '');
        await loadTree();
        openFile(path);
        toast.success(`Created ${path}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to create file');
      }
    },
    [id, loadTree, openFile, toast]
  );

  /* Delete current file */
  const deleteFile = useCallback(async () => {
    if (!id || !selectedFile) return;
    const ok = window.confirm(`Delete "${selectedFile}"?`);
    if (!ok) return;
    try {
      await extensionsApi.deleteFile(id, selectedFile);
      setSelectedFile(null);
      setFileContent('');
      setOriginalContent('');
      await loadTree();
      toast.success('File deleted');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete file');
    }
  }, [id, selectedFile, loadTree, toast]);

  /* Keyboard shortcut: Ctrl+S to save */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (isDirty && selectedFile) saveFile();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isDirty, selectedFile, saveFile]);

  const isMarkdown = selectedFile?.endsWith('.md') ?? false;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2.5 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/skills')}
            className="p-1.5 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-text-secondary dark:text-dark-text-secondary" />
          </button>
          <div>
            <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
              {extensionName || 'Skill Editor'}
            </h2>
            {selectedFile && (
              <p className="text-[11px] text-text-muted dark:text-dark-text-muted">
                {selectedFile}
                {isDirty && <span className="text-amber-500 ml-1">(unsaved)</span>}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {selectedFile && isMarkdown && (
            <button
              onClick={() => setShowPreview((p) => !p)}
              className={`p-1.5 rounded-lg transition-colors ${
                showPreview
                  ? 'bg-primary/15 text-primary'
                  : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary'
              }`}
              title={showPreview ? 'Hide preview' : 'Show preview'}
            >
              {showPreview ? <Code className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
          {selectedFile && (
            <>
              <button
                onClick={deleteFile}
                className="p-1.5 rounded-lg hover:bg-red-500/10 text-text-secondary dark:text-dark-text-secondary hover:text-red-500 transition-colors"
                title="Delete file"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={saveFile}
                disabled={!isDirty || saving}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar — file tree */}
        <div className="w-56 shrink-0 border-r border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border dark:border-dark-border">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted dark:text-dark-text-muted">
              Files
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setShowNewFile(true)}
                className="p-1 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted"
                title="New file"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={loadTree}
                className="p-1 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted"
                title="Refresh"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : treeData?.tree.length ? (
              treeData.tree.map((entry) => (
                <TreeNode
                  key={entry.path}
                  entry={entry}
                  depth={0}
                  selectedPath={selectedFile}
                  onSelect={openFile}
                />
              ))
            ) : (
              <p className="px-3 py-4 text-xs text-text-muted dark:text-dark-text-muted">
                No files found on disk.
              </p>
            )}
          </div>

          {showNewFile && (
            <NewFileDialog onConfirm={createFile} onCancel={() => setShowNewFile(false)} />
          )}
        </div>

        {/* Editor area */}
        <div className="flex-1 min-w-0 flex">
          {selectedFile ? (
            showPreview && isMarkdown ? (
              /* Split: editor + preview */
              <div className="flex flex-1 min-w-0">
                <div className="flex-1 min-w-0">
                  <Editor
                    height="100%"
                    language={getMonacoLang(selectedFile)}
                    value={fileContent}
                    onChange={(v) => setFileContent(v ?? '')}
                    onMount={(editor) => {
                      editorRef.current = editor;
                    }}
                    theme="vs-dark"
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: 'on',
                      wordWrap: 'on',
                      scrollBeyondLastLine: false,
                      automaticLayout: true,
                      tabSize: 2,
                    }}
                  />
                </div>
                <div className="w-px bg-border dark:bg-dark-border" />
                <div className="flex-1 min-w-0 overflow-y-auto p-4">
                  <MarkdownContent content={fileContent} />
                </div>
              </div>
            ) : (
              /* Editor only */
              <Editor
                height="100%"
                language={getMonacoLang(selectedFile)}
                value={fileContent}
                onChange={(v) => setFileContent(v ?? '')}
                onMount={(editor) => {
                  editorRef.current = editor;
                }}
                theme="vs-dark"
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  wordWrap: 'on',
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  tabSize: 2,
                }}
              />
            )
          ) : (
            /* No file selected */
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <Code className="w-10 h-10 mx-auto mb-3 text-text-muted/30 dark:text-dark-text-muted/30" />
                <p className="text-sm text-text-muted dark:text-dark-text-muted">
                  Select a file from the tree to start editing
                </p>
                <p className="text-xs text-text-muted/60 dark:text-dark-text-muted/60 mt-1">
                  {treeData?.skillDir ?? ''}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
