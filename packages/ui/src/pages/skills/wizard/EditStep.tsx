import { useState } from 'react';
import { useToast } from '../../../components/ToastProvider';
import { extensionsApi } from '../../../api/endpoints/extensions';
import { MarkdownContent } from '../../../components/MarkdownContent';
import type { SkillFormat } from './FormatStep';
import type { ExtensionInfo } from '../../../api/types';

interface EditStepProps {
  format: SkillFormat;
  content: string;
  name: string;
  onInstalled: (pkg: ExtensionInfo) => void;
  onBack: () => void;
}

export function EditStep({
  format,
  content,
  name: initialName,
  onInstalled,
  onBack,
}: EditStepProps) {
  const toast = useToast();
  const [text, setText] = useState(content);
  const [isInstalling, setIsInstalling] = useState(false);

  const handleInstall = async () => {
    if (!text.trim()) {
      toast.warning('Content is empty.');
      return;
    }
    setIsInstalling(true);
    try {
      const filename = format === 'agentskills' ? 'SKILL.md' : 'extension.json';
      const mime = format === 'agentskills' ? 'text/markdown' : 'application/json';
      const file = new File([text], filename, { type: mime });
      const result = await extensionsApi.upload(file);
      toast.success(`Installed "${result.package.name}"`);
      onInstalled(result.package);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Install failed');
    } finally {
      setIsInstalling(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
          Review & edit — {initialName}
        </h3>
        <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
          Edit the generated {format === 'agentskills' ? 'SKILL.md' : 'extension manifest'} before
          installing.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 min-h-0" style={{ height: '400px' }}>
        {/* Editor */}
        <div className="flex flex-col">
          <div className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1.5">
            Source
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="flex-1 w-full px-3 py-2 text-xs font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
            spellCheck={false}
          />
        </div>

        {/* Preview */}
        <div className="flex flex-col min-h-0">
          <div className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1.5">
            Preview
          </div>
          <div className="flex-1 overflow-y-auto p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg">
            {format === 'agentskills' ? (
              <MarkdownContent content={text} />
            ) : (
              <pre className="text-xs text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-all">
                {text}
              </pre>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleInstall}
          disabled={isInstalling}
          className="flex items-center gap-2 px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isInstalling ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Installing...
            </>
          ) : (
            'Install & Continue'
          )}
        </button>
      </div>
    </div>
  );
}
