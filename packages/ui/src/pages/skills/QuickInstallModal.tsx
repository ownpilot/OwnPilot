import { useState, useRef, useCallback } from 'react';
import { X, Upload, FolderOpen, CheckCircle2 } from '../../components/icons';
import { useToast } from '../../components/ToastProvider';
import { extensionsApi } from '../../api/endpoints/extensions';

const ALLOWED_EXTS = ['.md', '.json', '.zip', '.skill'];
const MAX_SIZE_MB = 5;
const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;

interface QuickInstallModalProps {
  onClose: () => void;
  onInstalled: () => void;
}

function validateFile(file: File): string | null {
  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
  if (!ALLOWED_EXTS.includes(ext)) {
    return `Unsupported file type "${ext}". Allowed: ${ALLOWED_EXTS.join(', ')}`;
  }
  if (file.size > MAX_SIZE_BYTES) {
    return `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max size is ${MAX_SIZE_MB} MB.`;
  }
  return null;
}

export function QuickInstallModal({ onClose, onInstalled }: QuickInstallModalProps) {
  const toast = useToast();
  const [mode, setMode] = useState<'upload' | 'path' | 'json'>('upload');
  const [filePath, setFilePath] = useState('');
  const [jsonText, setJsonText] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [successName, setSuccessName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = useCallback(
    async (file: File) => {
      const validationError = validateFile(file);
      if (validationError) {
        setError(validationError);
        return;
      }
      setError(null);
      setSelectedFile(file);
      setIsInstalling(true);
      try {
        const result = await extensionsApi.upload(file);
        const name = result.package?.name ?? file.name;
        setSuccessName(name);
        toast.success(`Installed "${name}"`);
        onInstalled();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
        setSelectedFile(null);
      } finally {
        setIsInstalling(false);
      }
    },
    [toast, onInstalled]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleUpload(file);
    },
    [handleUpload]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleInstallPath = async () => {
    setError(null);
    if (!filePath.trim()) {
      setError('Please enter a file path.');
      return;
    }
    setIsInstalling(true);
    try {
      await extensionsApi.installFromPath(filePath.trim());
      toast.success('Installed successfully');
      onInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed');
    } finally {
      setIsInstalling(false);
    }
  };

  const handleInstallJson = async () => {
    setError(null);
    if (!jsonText.trim()) {
      setError('Please paste the manifest content.');
      return;
    }
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(jsonText);
    } catch (parseErr) {
      const msg = parseErr instanceof SyntaxError ? parseErr.message : 'Invalid JSON';
      setError(`JSON parse error: ${msg}`);
      return;
    }
    setIsInstalling(true);
    try {
      await extensionsApi.install(manifest);
      toast.success('Extension installed successfully');
      onInstalled();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Installation failed');
    } finally {
      setIsInstalling(false);
    }
  };

  const switchMode = (m: 'upload' | 'path' | 'json') => {
    setMode(m);
    setError(null);
    setSelectedFile(null);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border dark:border-dark-border flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Quick Install
            </h3>
            <p className="text-sm text-text-muted dark:text-dark-text-muted mt-0.5">
              Install a skill or extension from a file, path, or manifest
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary rounded transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-border dark:border-dark-border">
          {(['upload', 'path', 'json'] as const).map((m) => (
            <button
              key={m}
              onClick={() => switchMode(m)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                mode === m
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
              }`}
            >
              {m === 'upload' ? 'Upload File' : m === 'path' ? 'File Path' : 'JSON Manifest'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto">
          {mode === 'upload' && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.json,.zip,.skill"
                className="hidden"
                onChange={handleFileChange}
              />
              {successName ? (
                /* Success state */
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <div className="w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
                    <CheckCircle2 className="w-8 h-8 text-success" />
                  </div>
                  <p className="font-medium text-text-primary dark:text-dark-text-primary">
                    Installed successfully
                  </p>
                  <p className="text-sm text-text-muted dark:text-dark-text-muted">{successName}</p>
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => !isInstalling && fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors ${
                    isInstalling
                      ? 'border-primary/30 bg-primary/5 cursor-wait'
                      : isDragging
                        ? 'border-primary bg-primary/5 cursor-copy'
                        : 'border-border dark:border-dark-border hover:border-primary/50 cursor-pointer'
                  }`}
                >
                  {isInstalling ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-10 h-10 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                      <p className="text-sm text-text-secondary dark:text-dark-text-secondary">
                        Installing{selectedFile ? ` "${selectedFile.name}"` : ''}…
                      </p>
                    </div>
                  ) : (
                    <>
                      <Upload
                        className={`w-10 h-10 mx-auto mb-3 transition-colors ${isDragging ? 'text-primary' : 'text-text-muted dark:text-dark-text-muted'}`}
                      />
                      <p className="font-medium text-text-primary dark:text-dark-text-primary mb-1">
                        {isDragging ? 'Drop to install' : 'Drop a file here or click to browse'}
                      </p>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted">
                        Supports: <span className="font-mono text-xs">.skill .zip .md .json</span>
                      </p>
                      <p className="text-xs text-text-muted/70 dark:text-dark-text-muted/70 mt-1">
                        Max {MAX_SIZE_MB} MB
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {mode === 'path' && (
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                  Path to skill file on the server
                </label>
                <input
                  type="text"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleInstallPath()}
                  placeholder="/path/to/skill/SKILL.md"
                  className="w-full px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <div className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg">
                <p className="text-xs text-text-muted dark:text-dark-text-muted">
                  Enter the absolute path to a <span className="font-mono">SKILL.md</span> or{' '}
                  <span className="font-mono">extension.json</span> file on the server. The file
                  must be accessible by the OwnPilot gateway process.
                </p>
              </div>
            </div>
          )}

          {mode === 'json' && (
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                Paste extension manifest (JSON)
              </label>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder={
                  '{\n  "id": "my-extension",\n  "name": "My Extension",\n  "version": "1.0.0",\n  "description": "...",\n  "tools": []\n}'
                }
                className="w-full h-56 px-3 py-2 text-sm font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1.5">
                Must be a valid OwnPilot extension manifest with{' '}
                <span className="font-mono">id</span>, <span className="font-mono">name</span>, and{' '}
                <span className="font-mono">version</span>.
              </p>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-error/10 border border-error/20 rounded-lg">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border dark:border-dark-border flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            {successName ? 'Close' : 'Cancel'}
          </button>
          {mode !== 'upload' && (
            <button
              onClick={mode === 'path' ? handleInstallPath : handleInstallJson}
              disabled={isInstalling}
              className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {isInstalling ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Installing…
                </>
              ) : (
                <>
                  <FolderOpen className="w-4 h-4" />
                  Install
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
