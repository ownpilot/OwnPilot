import { type Dispatch, type SetStateAction } from 'react';
import type { ClawConfig } from '../../../api/endpoints/claws';
import { FileText, FileCode, Image as ImageIcon, Archive } from '../../../components/icons';
import { FileBrowser, FileEditorModal } from '../FileBrowser';

// Per-extension styling for artifact pills — keeps the file type visible at a
// glance without parsing the path. New extensions fall back to a neutral pill.
function artifactStyle(path: string): {
  Icon: React.ComponentType<{ className?: string }>;
  tone: string;
} {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['md', 'txt', 'log'].includes(ext))
    return { Icon: FileText, tone: 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20' };
  if (['json', 'jsonl', 'yml', 'yaml', 'toml'].includes(ext))
    return { Icon: FileCode, tone: 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20' };
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'sh', 'go', 'rs'].includes(ext))
    return { Icon: FileCode, tone: 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20' };
  if (['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp'].includes(ext))
    return { Icon: ImageIcon, tone: 'bg-purple-500/10 text-purple-500 hover:bg-purple-500/20' };
  if (['zip', 'tar', 'gz'].includes(ext))
    return { Icon: Archive, tone: 'bg-orange-500/10 text-orange-500 hover:bg-orange-500/20' };
  return { Icon: FileText, tone: 'bg-bg-tertiary text-text-secondary hover:bg-bg-tertiary/70' };
}

export function FilesTab({
  claw,
  currentFilePath,
  workspaceFiles,
  isLoadingFiles,
  loadFiles,
  loadFileContent,
  viewingFile,
  setViewingFile,
  fileContent,
  setFileContent,
  onFileSaved,
}: {
  claw: ClawConfig;
  currentFilePath: string;
  workspaceFiles: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    modifiedAt: string;
  }>;
  isLoadingFiles: boolean;
  loadFiles: (subPath?: string) => void;
  loadFileContent: (filePath: string) => void;
  viewingFile: string | null;
  setViewingFile: Dispatch<SetStateAction<string | null>>;
  fileContent: string | null;
  setFileContent: Dispatch<SetStateAction<string | null>>;
  onFileSaved: () => void;
}) {
  return (
    <div>
      {!claw.workspaceId ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-8 text-center">
          No workspace assigned.
        </p>
      ) : (
        <>
          {/* Artifacts emitted by the claw — pulled straight from the live
              session. Click opens the file in the editor modal. Surfaces
              the work product without the operator having to hunt through
              the workspace tree. */}
          {(claw.session?.artifacts.length ?? 0) > 0 && (
            <div className="mb-4 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  Artifacts emitted ({claw.session!.artifacts.length})
                </p>
                <p className="text-[10px] text-emerald-700/60 dark:text-emerald-300/60">
                  click to open
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {claw.session!.artifacts.map((path) => {
                  const { Icon, tone } = artifactStyle(path);
                  return (
                    <button
                      key={path}
                      onClick={() => loadFileContent(path)}
                      className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded font-mono transition-colors ${tone}`}
                      title={path}
                    >
                      <Icon className="w-3 h-3 shrink-0" />
                      {path.length > 38 ? `…${path.slice(-36)}` : path}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick access .claw/ files */}
          <div className="mb-4 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
            <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-2">
              .claw/ Directives
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {['INSTRUCTIONS.md', 'TASKS.md', 'MEMORY.md', 'LOG.md'].map((f) => (
                <button
                  key={f}
                  onClick={() => loadFileContent(`.claw/${f}`)}
                  className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 font-mono transition-colors"
                >
                  <FileText className="w-3 h-3 shrink-0" />
                  {f}
                </button>
              ))}
            </div>
          </div>

          <FileBrowser
            workspaceId={claw.workspaceId}
            currentPath={currentFilePath}
            files={workspaceFiles}
            isLoading={isLoadingFiles}
            onNavigate={loadFiles}
            onOpenFile={loadFileContent}
            onRefresh={() => loadFiles(currentFilePath)}
            onFileCreated={() => loadFiles(currentFilePath)}
          />
        </>
      )}
      {viewingFile && claw.workspaceId && (
        <FileEditorModal
          workspaceId={claw.workspaceId}
          filePath={viewingFile}
          content={fileContent}
          onClose={() => {
            setViewingFile(null);
            setFileContent(null);
          }}
          onSaved={onFileSaved}
        />
      )}
    </div>
  );
}
