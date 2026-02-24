import { useState } from 'react';
import { X, Plus } from '../../components/icons';
import { useToast } from '../../components/ToastProvider';
import { extensionsApi } from '../../api/endpoints/extensions';

export function InstallModal({
  onClose,
  onInstalled,
}: {
  onClose: () => void;
  onInstalled: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<'json' | 'path'>('json');
  const [jsonText, setJsonText] = useState('');
  const [filePath, setFilePath] = useState('');
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleInstall = async () => {
    setError(null);
    setIsInstalling(true);

    try {
      if (mode === 'json') {
        if (!jsonText.trim()) {
          setError('Please paste the extension manifest (JSON) content.');
          setIsInstalling(false);
          return;
        }
        let manifest: Record<string, unknown>;
        try {
          manifest = JSON.parse(jsonText);
        } catch {
          setError('Invalid JSON. Please check the manifest content.');
          setIsInstalling(false);
          return;
        }
        await extensionsApi.install(manifest);
      } else {
        if (!filePath.trim()) {
          setError('Please enter the path to the extension manifest file.');
          setIsInstalling(false);
          return;
        }
        await extensionsApi.installFromPath(filePath.trim());
      }
      toast.success('Extension installed successfully');
      onInstalled();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Installation failed';
      setError(msg);
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-border dark:border-dark-border">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Install Extension
            </h3>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
            Install an extension from a JSON manifest or file path.
          </p>
        </div>

        {/* Mode Tabs */}
        <div className="flex border-b border-border dark:border-dark-border">
          <button
            onClick={() => setMode('json')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              mode === 'json'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
            }`}
          >
            JSON Manifest
          </button>
          <button
            onClick={() => setMode('path')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              mode === 'path'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
            }`}
          >
            File Path
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex-1 overflow-y-auto">
          {mode === 'json' ? (
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                Paste extension manifest content
              </label>
              <textarea
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder={
                  '{\n  "id": "my-extension",\n  "name": "My Extension",\n  "version": "1.0.0",\n  "description": "...",\n  "tools": [...]\n}'
                }
                className="w-full h-64 px-3 py-2 text-sm font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
              />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
                Path to extension manifest file
              </label>
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="/path/to/extensions/my-ext/extension.json"
                className="w-full px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <p className="text-xs text-text-muted dark:text-dark-text-muted mt-2">
                Enter the absolute path to the extension manifest file on the server.
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
            Cancel
          </button>
          <button
            onClick={handleInstall}
            disabled={isInstalling}
            className="px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isInstalling ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Installing...
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                Install
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
