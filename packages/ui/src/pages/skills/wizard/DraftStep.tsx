import { useState, useEffect } from 'react';
import { Sparkles } from '../../../components/icons';
import { extensionsApi } from '../../../api/endpoints/extensions';
import { useToast } from '../../../components/ToastProvider';
import type { SkillFormat } from './FormatStep';

interface DraftStepProps {
  format: SkillFormat;
  onDrafted: (content: string, name: string) => void;
  onBack: () => void;
}

function intentKey(format: SkillFormat) {
  return `skills-hub-draft-intent-${format}`;
}

export function DraftStep({ format, onDrafted, onBack }: DraftStepProps) {
  const toast = useToast();
  const [description, setDescription] = useState(() => {
    try {
      return localStorage.getItem(intentKey(format)) ?? '';
    } catch {
      return '';
    }
  });
  const [isGenerating, setIsGenerating] = useState(false);

  // Persist intent as user types (debounced via useEffect)
  useEffect(() => {
    const timeout = setTimeout(() => {
      try {
        if (description.trim()) {
          localStorage.setItem(intentKey(format), description);
        } else {
          localStorage.removeItem(intentKey(format));
        }
      } catch {
        // ignore
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [description, format]);

  const handleGenerate = async () => {
    if (!description.trim()) {
      toast.warning('Please describe what you want to build.');
      return;
    }
    setIsGenerating(true);
    try {
      if (format === 'agentskills') {
        const res = await extensionsApi.generateSkill(description);
        // Clear saved intent on success
        try {
          localStorage.removeItem(intentKey(format));
        } catch {
          /* ignore */
        }
        onDrafted(res.content, res.name);
      } else {
        const res = await extensionsApi.generate(description);
        try {
          localStorage.removeItem(intentKey(format));
        } catch {
          /* ignore */
        }
        onDrafted(
          JSON.stringify(res.manifest, null, 2),
          (res.manifest as { name?: string }).name ?? 'extension'
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
          Describe your {format === 'agentskills' ? 'skill' : 'extension'}
        </h3>
        <p className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
          {format === 'agentskills'
            ? 'Describe what knowledge or instructions the skill should provide.'
            : 'Describe what tools and automations the extension should include.'}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2">
          Intent
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={
            format === 'agentskills'
              ? 'e.g. A skill for summarizing PDF documents and extracting key insights...'
              : 'e.g. An extension that searches GitHub issues and creates tasks from them...'
          }
          rows={6}
          className="w-full px-3 py-2 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
        />
        <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1.5 flex items-center gap-1.5">
          Be specific about capabilities, constraints, and edge cases.
          {description.trim() && <span className="opacity-60">· Draft auto-saved</span>}
        </p>
      </div>

      <div className="flex justify-between items-center">
        <button
          onClick={onBack}
          className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !description.trim()}
          className="flex items-center gap-2 px-5 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isGenerating ? (
            <>
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4" />
              Generate with AI
            </>
          )}
        </button>
      </div>
    </div>
  );
}
