import { type Dispatch, type SetStateAction } from 'react';
import type { ClawConfig } from '../../../api/endpoints/claws';
import { FileText } from '../../../components/icons';
import { FileBrowser, FileEditorModal } from '../FileBrowser';

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
