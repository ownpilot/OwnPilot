/**
 * Agent Creator Wizard
 *
 * Steps: Name & Persona → Provider & Model → System Prompt → Parameters → Tools → Complete
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { WizardShell, type WizardStep } from '../../components/WizardShell';
import { agentsApi, providersApi, toolsApi } from '../../api';
import type { ProviderInfo, ProviderConfig, Tool } from '../../types';
import { AlertTriangle, Bot, Sparkles } from '../../components/icons';
import { aiGenerate } from './ai-helper';

interface Props {
  onComplete: () => void;
  onCancel: () => void;
}

const STEPS: WizardStep[] = [
  { id: 'name', label: 'Name' },
  { id: 'provider', label: 'Provider' },
  { id: 'prompt', label: 'Prompt' },
  { id: 'params', label: 'Params' },
  { id: 'tools', label: 'Tools' },
  { id: 'done', label: 'Complete' },
];

const PERSONA_TEMPLATES: Array<{ name: string; prompt: string; description: string }> = [
  {
    name: 'General Assistant',
    prompt: 'You are a helpful AI assistant. Be concise, accurate, and friendly.',
    description: 'Balanced all-purpose assistant',
  },
  {
    name: 'Code Expert',
    prompt:
      'You are an expert software engineer. Write clean, efficient code. Explain your reasoning. Follow best practices and modern patterns.',
    description: 'Specialized in programming and technical tasks',
  },
  {
    name: 'Creative Writer',
    prompt:
      'You are a creative writing assistant. Help with stories, articles, and content. Be imaginative and engaging while maintaining clarity.',
    description: 'Writing, storytelling, and content creation',
  },
  {
    name: 'Research Analyst',
    prompt:
      'You are a research analyst. Provide thorough, well-sourced analysis. Consider multiple perspectives. Present findings clearly with supporting evidence.',
    description: 'Deep analysis and research tasks',
  },
  {
    name: 'Custom',
    prompt: '',
    description: 'Write your own system prompt from scratch',
  },
];

export function AgentCreatorWizard({ onComplete, onCancel }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [maxTokens, setMaxTokens] = useState(8192);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTurns, setMaxTurns] = useState(25);
  const [selectedTools, setSelectedTools] = useState<Set<string>>(new Set());
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; agentId?: string; error?: string } | null>(
    null
  );

  const [aiGenerating, setAiGenerating] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  const [providers, setProviders] = useState<(ProviderInfo | ProviderConfig)[]>([]);
  const [models, setModels] = useState<{ id: string; name: string }[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);

  useEffect(() => {
    providersApi
      .list()
      .then((d) => setProviders(d.providers))
      .catch(() => {});
    toolsApi
      .list()
      .then((d) => setTools(d))
      .catch(() => {});
  }, []);

  // Load models when provider changes
  useEffect(() => {
    if (!selectedProvider) return;
    setModels([]);
    setSelectedModel('');
    providersApi
      .models(selectedProvider)
      .then((d) => {
        setModels(d.models);
        if (d.models.length > 0) setSelectedModel(d.models[0]!.id);
      })
      .catch(() => {});
  }, [selectedProvider]);

  const canGoNext = useMemo(() => {
    switch (step) {
      case 0:
        return name.trim().length >= 2;
      case 1:
        return !!selectedProvider && !!selectedModel;
      case 2:
        return systemPrompt.trim().length >= 10;
      case 3:
        return true; // params always valid with defaults
      case 4:
        return true; // tools optional
      default:
        return false;
    }
  }, [step, name, selectedProvider, selectedModel, systemPrompt]);

  const handleNext = async () => {
    if (step === 4) {
      // Create the agent
      setIsProcessing(true);
      setResult(null);
      try {
        const agent = await agentsApi.create({
          name: name.trim(),
          systemPrompt: systemPrompt.trim(),
          provider: selectedProvider,
          model: selectedModel,
          tools: selectedTools.size > 0 ? [...selectedTools] : undefined,
          maxTokens,
          temperature,
          maxTurns,
        });
        setResult({ ok: true, agentId: agent.id });
        setStep(5);
      } catch (err) {
        setResult({
          ok: false,
          error: err instanceof Error ? err.message : 'Failed to create agent',
        });
        setStep(5);
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    setStep(step + 1);
  };

  const generateSystemPrompt = async () => {
    if (!name.trim()) return;
    setAiGenerating(true);
    aiAbortRef.current?.abort();
    const ctrl = new AbortController();
    aiAbortRef.current = ctrl;
    try {
      const persona =
        selectedPersona && selectedPersona !== 'Custom'
          ? `The agent's persona is "${selectedPersona}".`
          : '';
      const desc = description.trim() ? `Description: "${description.trim()}".` : '';
      const prompt = `Generate a detailed system prompt for an AI agent called "${name.trim()}". ${persona} ${desc}

The system prompt should:
- Define the agent's role and expertise clearly
- Set behavioral guidelines and tone
- Include specific instructions for how to handle requests
- Be between 200-500 words
- Be professional and well-structured

Return ONLY the system prompt text, no explanations or markdown.`;

      const result = await aiGenerate(prompt, ctrl.signal);
      if (result) {
        setSystemPrompt(result);
        setSelectedPersona('Custom');
      }
    } catch {
      // Aborted or failed — ignore
    } finally {
      setAiGenerating(false);
    }
  };

  const toggleTool = (toolName: string) => {
    setSelectedTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) next.delete(toolName);
      else next.add(toolName);
      return next;
    });
  };

  return (
    <WizardShell
      title="Create AI Agent"
      description="Build a custom AI agent with its own personality and tools"
      steps={STEPS}
      currentStep={step}
      canGoNext={canGoNext}
      isProcessing={isProcessing}
      isLastStep={step === 5}
      onNext={handleNext}
      onBack={() => setStep(Math.max(0, step - 1))}
      onCancel={onCancel}
      onComplete={onComplete}
    >
      {/* Step 0: Name & Description */}
      {step === 0 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Name Your Agent
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Give your agent a name and optional description.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Agent Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Code Reviewer, Research Assistant"
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Description{' '}
                <span className="text-text-muted dark:text-dark-text-muted font-normal">
                  (optional)
                </span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this agent do?"
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 1: Provider & Model */}
      {step === 1 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Choose Provider & Model
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Select which AI provider and model this agent will use.
          </p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Provider
              </label>
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm"
              >
                <option value="">Select a provider...</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {selectedProvider && (
              <div>
                <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                  Model
                </label>
                {models.length === 0 ? (
                  <p className="text-sm text-text-muted dark:text-dark-text-muted">
                    Loading models...
                  </p>
                ) : (
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm"
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name || m.id}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Step 2: System Prompt */}
      {step === 2 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            System Prompt
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Define your agent's personality and instructions. Start from a template or write your
            own.
          </p>

          {/* Persona templates */}
          <div className="flex flex-wrap gap-2 mb-4">
            {PERSONA_TEMPLATES.map((t) => (
              <button
                key={t.name}
                onClick={() => {
                  setSelectedPersona(t.name);
                  if (t.prompt) setSystemPrompt(t.prompt);
                }}
                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                  selectedPersona === t.name
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border dark:border-dark-border text-text-muted dark:text-dark-text-muted hover:border-primary/40'
                }`}
              >
                {t.name}
              </button>
            ))}
          </div>

          {/* AI Generate button */}
          <button
            onClick={generateSystemPrompt}
            disabled={aiGenerating || !name.trim()}
            className="flex items-center gap-2 mb-3 px-4 py-2 text-sm rounded-lg bg-gradient-to-r from-purple-500 to-primary text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            <Sparkles className="w-4 h-4" />
            {aiGenerating ? 'Generating...' : 'Generate with AI'}
          </button>

          <textarea
            value={systemPrompt}
            onChange={(e) => {
              setSystemPrompt(e.target.value);
              setSelectedPersona('Custom');
            }}
            placeholder="You are a helpful AI assistant that..."
            rows={8}
            className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y font-mono"
          />
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
            {systemPrompt.length} characters
          </p>
        </div>
      )}

      {/* Step 3: Parameters */}
      {step === 3 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Parameters
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6">
            Fine-tune your agent's behavior. Defaults work well for most use cases.
          </p>

          <div className="space-y-5">
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  Temperature
                </label>
                <span className="text-sm font-mono text-text-muted dark:text-dark-text-muted">
                  {temperature}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-[11px] text-text-muted dark:text-dark-text-muted mt-1">
                <span>Precise (0)</span>
                <span>Creative (2)</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Max Tokens
              </label>
              <select
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm"
              >
                {[1024, 2048, 4096, 8192, 16384, 32768].map((v) => (
                  <option key={v} value={v}>
                    {v.toLocaleString()} tokens
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-text-primary dark:text-dark-text-primary mb-2">
                Max Turns
              </label>
              <select
                value={maxTurns}
                onChange={(e) => setMaxTurns(Number(e.target.value))}
                className="w-full px-3 py-2.5 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary text-sm"
              >
                {[5, 10, 15, 25, 50].map((v) => (
                  <option key={v} value={v}>
                    {v} turns
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Tools */}
      {step === 4 && (
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-1">
            Select Tools
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
            Choose which tools this agent can use. Leave empty for all tools.
          </p>

          <div className="text-xs text-text-muted dark:text-dark-text-muted mb-3">
            {selectedTools.size === 0 ? 'All tools (default)' : `${selectedTools.size} selected`}
            {selectedTools.size > 0 && (
              <button
                onClick={() => setSelectedTools(new Set())}
                className="ml-2 text-primary hover:underline"
              >
                Clear
              </button>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1 border border-border dark:border-dark-border rounded-lg p-2">
            {tools.map((t) => (
              <label
                key={t.name}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedTools.has(t.name)}
                  onChange={() => toggleTool(t.name)}
                  className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm text-text-primary dark:text-dark-text-primary">
                  {t.name}
                </span>
                {t.description && (
                  <span className="text-xs text-text-muted dark:text-dark-text-muted truncate ml-auto">
                    {t.description}
                  </span>
                )}
              </label>
            ))}
            {tools.length === 0 && (
              <p className="text-sm text-text-muted dark:text-dark-text-muted p-3 text-center">
                No tools available
              </p>
            )}
          </div>
        </div>
      )}

      {/* Step 5: Complete */}
      {step === 5 && (
        <div className="text-center py-8">
          {result?.ok ? (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-success/10 flex items-center justify-center mb-4">
                <Bot className="w-8 h-8 text-success" />
              </div>
              <h2 className="text-xl font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Agent Created!
              </h2>
              <p className="text-sm text-text-muted dark:text-dark-text-muted mb-6 max-w-md mx-auto">
                <strong>{name}</strong> is ready. Use it in Chat by selecting it from the agent
                picker.
              </p>
              <a
                href="/agents"
                className="inline-flex px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
              >
                View Agents
              </a>
            </>
          ) : (
            <>
              <div className="w-16 h-16 mx-auto rounded-full bg-error/10 flex items-center justify-center mb-4">
                <AlertTriangle className="w-8 h-8 text-error" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-2">
                Creation Failed
              </h3>
              <p className="text-sm text-error max-w-md mx-auto">{result?.error}</p>
              <button
                onClick={() => {
                  setStep(4);
                  setResult(null);
                }}
                className="mt-3 text-sm text-primary hover:underline"
              >
                Go back and try again
              </button>
            </>
          )}
        </div>
      )}
    </WizardShell>
  );
}
