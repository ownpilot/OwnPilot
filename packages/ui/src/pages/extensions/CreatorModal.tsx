import { useState } from 'react';
import {
  Sparkles,
  Wrench,
  X,
  Plus,
  Copy,
  Code,
  Check,
} from '../../components/icons';
import { useToast } from '../../components/ToastProvider';
import { extensionsApi } from '../../api/endpoints/extensions';
import type { ToolDraft } from './constants';
import { EXTENSION_CATEGORIES, DEFAULT_PARAMS, DEFAULT_CODE } from './constants';
import { ToolDraftCard } from './ToolDraftCard';

export function CreatorModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();

  // Step
  const [step, setStep] = useState<'describe' | 'metadata' | 'tools' | 'extras' | 'preview'>(
    'describe'
  );

  // AI Describe
  const [aiDescription, setAiDescription] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  // Metadata
  const [extensionId, setExtensionId] = useState('');
  const [idManuallyEdited, setIdManuallyEdited] = useState(false);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('utilities');
  const [icon, setIcon] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [tags, setTags] = useState('');

  // Tools
  const [tools, setTools] = useState<ToolDraft[]>([]);

  // Extras
  const [systemPrompt, setSystemPrompt] = useState('');
  const [keywords, setKeywords] = useState('');
  const [docsUrl, setDocsUrl] = useState('');

  // UI
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Populate wizard from AI-generated manifest
  const populateFromManifest = (m: Record<string, unknown>) => {
    setName((m.name as string) || '');
    setExtensionId((m.id as string) || '');
    setIdManuallyEdited(true);
    setVersion((m.version as string) || '1.0.0');
    setDescription((m.description as string) || '');
    setCategory((m.category as string) || 'utilities');
    setIcon((m.icon as string) || '');
    const author = m.author as { name?: string } | undefined;
    if (author?.name) setAuthorName(author.name);
    if (Array.isArray(m.tags)) setTags(m.tags.join(', '));
    if (m.system_prompt) setSystemPrompt(m.system_prompt as string);
    if (Array.isArray(m.keywords)) setKeywords(m.keywords.join(', '));
    if (m.docs) setDocsUrl(m.docs as string);

    if (Array.isArray(m.tools)) {
      setTools(
        (m.tools as Record<string, unknown>[]).map((t) => ({
          name: (t.name as string) || '',
          description: (t.description as string) || '',
          parameters: JSON.stringify(
            t.parameters || { type: 'object', properties: {}, required: [] },
            null,
            2
          ),
          code: (t.code as string) || '',
          permissions: Array.isArray(t.permissions) ? (t.permissions as string[]) : [],
          requiresApproval: (t.requires_approval as boolean) || false,
          expanded: false,
        }))
      );
    }

    setStep('metadata');
  };

  const handleGenerate = async () => {
    if (!aiDescription.trim()) {
      setError('Please describe the extension you want to create.');
      return;
    }
    setError(null);
    setIsGenerating(true);
    try {
      const result = await extensionsApi.generate(aiDescription.trim());
      if (result.validation && !result.validation.valid) {
        toast.warning(
          `Generated with ${result.validation.errors.length} warning(s). Review and fix in the next steps.`
        );
      }
      populateFromManifest(result.manifest);
      toast.success('Extension manifest generated! Review and edit below.');
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Generation failed. Try rephrasing your description.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-derive ID from name
  const handleNameChange = (val: string) => {
    setName(val);
    if (!idManuallyEdited) {
      setExtensionId(
        val
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
      );
    }
  };

  const handleIdChange = (val: string) => {
    setIdManuallyEdited(true);
    setExtensionId(val.toLowerCase().replace(/[^a-z0-9-]/g, ''));
  };

  // Tool helpers
  const addTool = () => {
    setTools((prev) => [
      ...prev.map((t) => ({ ...t, expanded: false })),
      {
        name: '',
        description: '',
        parameters: DEFAULT_PARAMS,
        code: DEFAULT_CODE,
        permissions: [],
        requiresApproval: false,
        expanded: true,
      },
    ]);
  };

  const updateTool = (index: number, updates: Partial<ToolDraft>) => {
    setTools((prev) => prev.map((t, i) => (i === index ? { ...t, ...updates } : t)));
  };

  const removeTool = (index: number) => {
    setTools((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleToolExpanded = (index: number) => {
    setTools((prev) => prev.map((t, i) => (i === index ? { ...t, expanded: !t.expanded } : t)));
  };

  const toggleToolPermission = (index: number, perm: string) => {
    setTools((prev) =>
      prev.map((t, i) =>
        i === index
          ? {
              ...t,
              permissions: t.permissions.includes(perm)
                ? t.permissions.filter((p) => p !== perm)
                : [...t.permissions, perm],
            }
          : t
      )
    );
  };

  // Validation
  const metadataValid =
    extensionId.length > 0 &&
    /^[a-z0-9][a-z0-9-]*$/.test(extensionId) &&
    name.trim().length > 0 &&
    version.trim().length > 0 &&
    description.trim().length > 0;

  const toolsValid =
    tools.length > 0 &&
    tools.every((t) => {
      if (!t.name || !/^[a-z0-9_]+$/.test(t.name)) return false;
      if (!t.description.trim()) return false;
      if (!t.code.trim()) return false;
      try {
        JSON.parse(t.parameters);
      } catch {
        return false;
      }
      return true;
    });

  // Build manifest
  const buildManifest = () => {
    const manifest: Record<string, unknown> = {
      id: extensionId,
      name,
      version,
      description,
      category,
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: JSON.parse(t.parameters),
        code: t.code,
        ...(t.permissions.length > 0 && { permissions: t.permissions }),
        ...(t.requiresApproval && { requires_approval: true }),
      })),
    };
    if (icon) manifest.icon = icon;
    if (authorName) manifest.author = { name: authorName };
    if (tags.trim())
      manifest.tags = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    if (systemPrompt.trim()) manifest.system_prompt = systemPrompt;
    if (keywords.trim())
      manifest.keywords = keywords
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean);
    if (docsUrl.trim()) manifest.docs = docsUrl;
    return manifest;
  };

  const manifestJson = step === 'preview' ? JSON.stringify(buildManifest(), null, 2) : '';

  const handleInstall = async () => {
    setError(null);
    setIsInstalling(true);
    try {
      const manifest = buildManifest();
      await extensionsApi.install(manifest);
      toast.success(`Extension "${name}" installed successfully`);
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Installation failed');
    } finally {
      setIsInstalling(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(manifestJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const handleNext = () => {
    setError(null);
    if (step === 'describe') {
      setStep('metadata');
    } else if (step === 'metadata') {
      if (!metadataValid) {
        setError('Please fill in all required fields (ID, Name, Version, Description).');
        return;
      }
      setStep('tools');
    } else if (step === 'tools') {
      if (!toolsValid) {
        setError('Add at least one tool with valid name, description, parameters JSON, and code.');
        return;
      }
      setStep('extras');
    } else if (step === 'extras') {
      setStep('preview');
    }
  };

  const handleBack = () => {
    setError(null);
    if (step === 'metadata') setStep('describe');
    else if (step === 'tools') setStep('metadata');
    else if (step === 'extras') setStep('tools');
    else if (step === 'preview') setStep('extras');
  };

  const steps = ['describe', 'metadata', 'tools', 'extras', 'preview'] as const;
  const stepLabels = {
    describe: 'Describe',
    metadata: 'Metadata',
    tools: 'Tools',
    extras: 'Extras',
    preview: 'Preview',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="w-full max-w-3xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border dark:border-dark-border">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
              <Code className="w-5 h-5 text-primary" />
              Create Extension
            </h3>
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary rounded transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          {/* Step tabs */}
          <div className="flex gap-4 mt-3">
            {steps.map((s, i) => (
              <button
                key={s}
                onClick={() => {
                  const currentIdx = steps.indexOf(step);
                  if (i <= currentIdx) {
                    setError(null);
                    setStep(s);
                  }
                }}
                className={`text-sm font-medium ${
                  step === s
                    ? 'text-primary border-b-2 border-primary pb-1'
                    : steps.indexOf(step) > i
                      ? 'text-text-secondary dark:text-dark-text-secondary cursor-pointer'
                      : 'text-text-muted dark:text-dark-text-muted cursor-default'
                }`}
              >
                {i + 1}. {stepLabels[s]}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* Step 1: Describe */}
          {step === 'describe' && (
            <div className="space-y-4">
              <p className="text-sm text-text-secondary dark:text-dark-text-secondary">
                Describe the extension you want to create and let AI generate the manifest for you,
                or skip to create one manually.
              </p>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  What should this extension do?
                </label>
                <textarea
                  value={aiDescription}
                  onChange={(e) => setAiDescription(e.target.value)}
                  rows={5}
                  placeholder="Example: I want an extension that can fetch weather data for any city using a free weather API, with tools for current weather and 5-day forecast..."
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  disabled={isGenerating}
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !aiDescription.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {isGenerating ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Generate with AI
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setError(null);
                    setStep('metadata');
                  }}
                  className="text-sm text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary transition-colors"
                  disabled={isGenerating}
                >
                  Skip — Create Manually
                </button>
              </div>

              {isGenerating && (
                <p className="text-xs text-text-muted dark:text-dark-text-muted animate-pulse">
                  AI is generating your extension manifest. This may take a moment...
                </p>
              )}
            </div>
          )}

          {/* Step 2: Metadata */}
          {step === 'metadata' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  placeholder="My Awesome Extension"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  ID *
                </label>
                <input
                  type="text"
                  value={extensionId}
                  onChange={(e) => handleIdChange(e.target.value)}
                  placeholder="my-awesome-extension"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Lowercase letters, numbers, and hyphens only. Auto-derived from name.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Version *
                  </label>
                  <input
                    type="text"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.0"
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  >
                    {EXTENSION_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c.charAt(0).toUpperCase() + c.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Description *
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder="What does this extension do?"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Icon
                  </label>
                  <input
                    type="text"
                    value={icon}
                    onChange={(e) => setIcon(e.target.value)}
                    placeholder="e.g. \uD83D\uDD27"
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Author Name
                  </label>
                  <input
                    type="text"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder="Your Name"
                    className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Tags
                </label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. search, web, api"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Comma-separated
                </p>
              </div>
            </div>
          )}

          {/* Step 2: Tools */}
          {step === 'tools' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary flex items-center gap-2">
                  <Wrench className="w-4 h-4" />
                  Tools ({tools.length})
                </h4>
                <button
                  onClick={addTool}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Tool
                </button>
              </div>

              {tools.length === 0 && (
                <div className="text-center py-12 text-text-muted dark:text-dark-text-muted">
                  <Wrench className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>No tools yet. Add at least one tool to continue.</p>
                </div>
              )}

              {tools.map((tool, index) => (
                <ToolDraftCard
                  key={index}
                  tool={tool}
                  index={index}
                  onUpdate={(updates) => updateTool(index, updates)}
                  onRemove={() => removeTool(index)}
                  onToggleExpanded={() => toggleToolExpanded(index)}
                  onTogglePermission={(perm) => toggleToolPermission(index, perm)}
                />
              ))}
            </div>
          )}

          {/* Step 3: Extras */}
          {step === 'extras' && (
            <div className="space-y-4">
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                All fields below are optional. Skip if not needed.
              </p>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  System Prompt
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={4}
                  placeholder="Additional instructions injected when this extension is active..."
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Guides the AI on when and how to use this extension's tools
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Keywords
                </label>
                <input
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g. search, browse, news, google"
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Hint words for tool selection prioritization (comma-separated)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Documentation URL
                </label>
                <input
                  type="url"
                  value={docsUrl}
                  onChange={(e) => setDocsUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>
          )}

          {/* Step 4: Preview & Install */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                  extension.json Preview
                </h4>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-success" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                  {copied ? 'Copied!' : 'Copy JSON'}
                </button>
              </div>
              <pre className="p-4 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm font-mono text-text-primary dark:text-dark-text-primary overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
                {manifestJson}
              </pre>
            </div>
          )}

          {error && (
            <div className="mt-4 p-3 bg-error/10 border border-error/20 rounded-lg">
              <p className="text-sm text-error">{error}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border dark:border-dark-border flex justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
          >
            Cancel
          </button>
          <div className="flex gap-2">
            {step !== 'describe' && (
              <button
                onClick={handleBack}
                className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
              >
                Back
              </button>
            )}
            {step === 'preview' ? (
              <button
                onClick={handleInstall}
                disabled={isInstalling}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {isInstalling ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Installing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Install Extension
                  </>
                )}
              </button>
            ) : step !== 'describe' ? (
              <button
                onClick={handleNext}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                Next
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
