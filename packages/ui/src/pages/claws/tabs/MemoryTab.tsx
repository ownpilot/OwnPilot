import { useState, useEffect } from 'react';
import type { ClawConfig } from '../../../api/endpoints/claws';
import { LoadingSpinner } from '../../../components/LoadingSpinner';
import { useToast } from '../../../components/ToastProvider';
import {
  Copy,
  Edit3,
  Download,
  BookOpen,
  Database,
  FileText,
  ListChecks,
} from '../../../components/icons';
import { authedFetch } from '../utils';

export function MemoryTab({ claw }: { claw: ClawConfig }) {
  const toast = useToast();
  const [memoryFiles, setMemoryFiles] = useState<Record<string, string>>({});
  const [loadingFiles, setLoadingFiles] = useState<string[]>([]);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const clawFiles = ['INSTRUCTIONS.md', 'TASKS.md', 'MEMORY.md', 'LOG.md'];

  useEffect(() => {
    if (!claw.workspaceId) return;
    setLoadingFiles(clawFiles);
    Promise.all(
      clawFiles.map(async (f) => {
        try {
          const res = await authedFetch(
            `/api/v1/file-workspaces/${claw.workspaceId}/file/.claw/${f}?raw=true`
          );
          const text = res.ok ? await res.text() : '';
          const status = res.status;
          if (!res.ok) {
            console.warn(`[MemoryTab] Failed to load .claw/${f}: ${res.status} ${res.statusText}`);
          }
          return { name: f, content: text, status };
        } catch (err) {
          console.warn(`[MemoryTab] Exception loading .claw/${f}:`, err);
          return { name: f, content: '', status: 0 };
        }
      })
    ).then((results) => {
      const map: Record<string, string> = {};
      for (const r of results) map[r.name] = r.content;
      setMemoryFiles(map);
      setLoadingFiles([]);
    });
  }, [claw.workspaceId]);

  const startEdit = (name: string) => {
    setEditingFile(name);
    setEditContent(memoryFiles[name] ?? '');
  };

  const saveFile = async () => {
    if (!editingFile || !claw.workspaceId) return;
    setIsSaving(true);
    try {
      const res = await authedFetch(
        `/api/v1/file-workspaces/${claw.workspaceId}/file/.claw/${editingFile}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: editContent }),
        }
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Save failed: ${res.status} ${errText}`);
      }
      setMemoryFiles((prev) => ({ ...prev, [editingFile]: editContent }));
      setEditingFile(null);
      toast.success(`${editingFile} saved`);
    } catch (err) {
      toast.error(`Failed to save: ${err instanceof Error ? err.message : 'unknown'}`);
    } finally {
      setIsSaving(false);
    }
  };

  const copyToClipboard = (content: string) => {
    navigator.clipboard
      .writeText(content)
      .then(() => toast.success('Copied'))
      .catch(() => toast.error('Copy failed'));
  };

  if (!claw.workspaceId) {
    return <p className="text-sm text-text-muted py-8 text-center">No workspace assigned.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          .claw/ directive files — the claw's persistent working memory.
        </p>
        <div className="flex items-center gap-2">
          {editingFile && (
            <>
              <button
                onClick={saveFile}
                disabled={isSaving}
                className="px-2 py-1 text-xs rounded bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setEditingFile(null)}
                className="px-2 py-1 text-xs rounded text-text-muted hover:text-text-primary"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {loadingFiles.length > 0 ? (
        <LoadingSpinner message="Loading .claw/ files..." />
      ) : (
        <div className="space-y-4">
          {clawFiles.map((name) => {
            const content = memoryFiles[name] ?? '';
            const isEditing = editingFile === name;
            const isEmpty = !content.trim();
            const FileIcon =
              name === 'INSTRUCTIONS.md'
                ? BookOpen
                : name === 'TASKS.md'
                  ? ListChecks
                  : name === 'MEMORY.md'
                    ? Database
                    : FileText;

            return (
              <div
                key={name}
                className="rounded-lg border border-border dark:border-dark-border overflow-hidden"
              >
                {/* File header */}
                <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary dark:bg-dark-bg-secondary border-b border-border dark:border-dark-border">
                  <FileIcon className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-mono font-medium text-text-primary dark:text-dark-text-primary">
                    .claw/{name}
                  </span>
                  <span className="text-xs text-text-muted">({content.length} chars)</span>
                  {!content && (
                    <span
                      className="text-xs text-red-400 ml-1"
                      title="File empty or load failed — check browser console for status"
                    >
                      ⚠ empty
                    </span>
                  )}
                  <div className="flex-1" />
                  {!isEditing && (
                    <>
                      <button
                        onClick={() => copyToClipboard(content)}
                        className="text-xs text-text-muted hover:text-text-primary"
                        title="Copy"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {name !== 'LOG.md' && (
                        <button
                          onClick={() => startEdit(name)}
                          className="text-xs text-primary hover:underline"
                          title="Edit"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <a
                        href={`/api/v1/file-workspaces/${claw.workspaceId}/file/.claw/${name}?download=true`}
                        className="text-xs text-text-muted hover:text-text-primary"
                        title="Download"
                      >
                        <Download className="w-3.5 h-3.5" />
                      </a>
                    </>
                  )}
                </div>

                {/* File content */}
                {isEditing ? (
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full p-4 text-sm font-mono bg-[#1e1e2e] text-[#cdd6f4] border-none resize-none focus:outline-none leading-relaxed"
                    style={{ minHeight: '200px' }}
                    autoFocus
                  />
                ) : isEmpty ? (
                  <div className="p-4 text-sm text-text-muted italic">
                    No content yet. The claw will write here during execution.
                  </div>
                ) : (
                  <pre className="p-4 text-sm font-mono text-text-secondary dark:text-dark-text-secondary whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto bg-[#0d0d0d]">
                    {content}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
