/**
 * Edit Agent Modal
 *
 * Multi-step modal for editing an existing AI agent's name, model, tools, and config.
 */

import { useState, useEffect, useMemo } from 'react';
import { LoadingSpinner } from './LoadingSpinner';
import { agentsApi, modelsApi, toolsApi } from '../api';
import { useModalClose } from '../hooks';
import type { Agent, Tool, ModelInfo, AgentDetail } from '../types';

export interface EditAgentModalProps {
  agentId: string;
  onClose: () => void;
  onUpdated: (agent: Agent) => void;
}

export function EditAgentModal({ agentId, onClose, onUpdated }: EditAgentModalProps) {
  const { onBackdropClick } = useModalClose(onClose);
  const [agentDetail, setAgentDetail] = useState<AgentDetail | null>(null);
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTurns, setMaxTurns] = useState(50);
  const [maxToolCalls, setMaxToolCalls] = useState(200);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'info' | 'model' | 'tools' | 'config'>('info');

  useEffect(() => {
    Promise.all([fetchAgentDetail(), fetchModels(), fetchTools()]).finally(() =>
      setIsLoading(false)
    );
  }, [agentId]);

  const fetchAgentDetail = async () => {
    try {
      const agent = await agentsApi.get(agentId);
      setAgentDetail(agent);
      setName(agent.name);
      setSystemPrompt(agent.systemPrompt || '');
      setSelectedTools(agent.tools || []);
      setMaxTokens(agent.config?.maxTokens || 4096);
      setTemperature(agent.config?.temperature || 0.7);
      setMaxTurns(agent.config?.maxTurns || 50);
      setMaxToolCalls(agent.config?.maxToolCalls || 200);
    } catch {
      setError('Failed to load agent details');
    }
  };

  const fetchModels = async () => {
    try {
      const data = await modelsApi.list();
      setModels(data.models);
      setConfiguredProviders(data.configuredProviders);
    } catch {
      // API client handles error reporting
    }
  };

  const fetchTools = async () => {
    try {
      const data = await toolsApi.list();
      setTools(data);
    } catch {
      // API client handles error reporting
    }
  };

  // Set selected model once both agent detail and models are loaded
  useEffect(() => {
    if (agentDetail && models.length > 0) {
      const currentModel = models.find(
        (m) => m.provider === agentDetail.provider && m.id === agentDetail.model
      );
      if (currentModel) {
        setSelectedModel(currentModel);
      }
    }
  }, [agentDetail, models]);

  const handleSubmit = async () => {
    if (!name.trim()) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const updated = await agentsApi.update(agentId, {
        name,
        systemPrompt,
        provider: selectedModel?.provider,
        model: selectedModel?.id,
        tools: selectedTools,
        maxTokens,
        temperature,
        maxTurns,
        maxToolCalls,
      });

      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleTool = (toolName: string) => {
    setSelectedTools((prev) =>
      prev.includes(toolName) ? prev.filter((t) => t !== toolName) : [...prev, toolName]
    );
  };

  // Group models by provider
  const modelsByProvider = useMemo(
    () =>
      models.reduce<Record<string, ModelInfo[]>>((acc, model) => {
        if (!acc[model.provider]) acc[model.provider] = [];
        acc[model.provider]!.push(model);
        return acc;
      }, {}),
    [models]
  );

  const steps = ['info', 'model', 'tools', 'config'] as const;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onBackdropClick}
    >
      <div className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Edit Agent
          </h3>
          <div className="flex gap-4 mt-3">
            {steps.map((s, i) => (
              <button
                key={s}
                onClick={() => setStep(s)}
                className={`text-sm font-medium ${
                  step === s
                    ? 'text-primary border-b-2 border-primary pb-1'
                    : 'text-text-muted dark:text-dark-text-muted'
                }`}
              >
                {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {isLoading ? (
            <LoadingSpinner size="sm" message="Loading..." />
          ) : step === 'info' ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Agent Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                  placeholder="My Assistant"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  System Prompt
                </label>
                <textarea
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
                  placeholder="You are a helpful AI assistant."
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Define how your agent should behave and respond.
                </p>
              </div>
            </div>
          ) : step === 'model' ? (
            <div className="space-y-6">
              {configuredProviders.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-text-muted dark:text-dark-text-muted mb-4">
                    No providers configured. Add API keys in Settings first.
                  </p>
                  <a href="/settings" className="text-primary hover:underline">
                    Go to Settings
                  </a>
                </div>
              ) : (
                Object.entries(modelsByProvider).map(([provider, providerModels]) => (
                  <div key={provider}>
                    <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-2 capitalize">
                      {provider}
                      {!configuredProviders.includes(provider) && (
                        <span className="ml-2 text-xs text-warning">(not configured)</span>
                      )}
                    </h4>
                    <div className="grid gap-2">
                      {providerModels.map((model) => (
                        <button
                          key={model.id}
                          onClick={() => setSelectedModel(model)}
                          disabled={!configuredProviders.includes(provider)}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            selectedModel?.id === model.id &&
                            selectedModel?.provider === model.provider
                              ? 'border-primary bg-primary/5'
                              : 'border-border dark:border-dark-border hover:border-primary/50'
                          } ${!configuredProviders.includes(provider) ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <span className="font-medium text-text-primary dark:text-dark-text-primary">
                                {model.name}
                              </span>
                              {model.recommended && (
                                <span className="ml-2 text-xs text-primary">Recommended</span>
                              )}
                            </div>
                            <span className="text-xs text-text-muted dark:text-dark-text-muted">
                              ${model.inputPrice}/${model.outputPrice} /M
                            </span>
                          </div>
                          {model.description && (
                            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                              {model.description}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : step === 'tools' ? (
            <div className="space-y-4">
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                Select tools this agent can use:
              </p>
              {tools.length === 0 ? (
                <p className="text-text-muted dark:text-dark-text-muted text-center py-8">
                  No tools available.
                </p>
              ) : (
                <div className="grid gap-2">
                  {tools.map((tool) => (
                    <button
                      key={tool.name}
                      onClick={() => toggleTool(tool.name)}
                      className={`p-3 rounded-lg border text-left transition-all ${
                        selectedTools.includes(tool.name)
                          ? 'border-primary bg-primary/5'
                          : 'border-border dark:border-dark-border hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-text-primary dark:text-dark-text-primary">
                          {tool.name}
                        </span>
                        {selectedTools.includes(tool.name) && (
                          <span className="text-xs text-primary">Selected</span>
                        )}
                      </div>
                      <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                        {tool.description}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value) || 4096)}
                  min={1}
                  max={128000}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Maximum tokens for the response (1-128000)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Temperature: {temperature}
                </label>
                <input
                  type="range"
                  value={temperature}
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                  min={0}
                  max={2}
                  step={0.1}
                  className="w-full"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Controls randomness (0 = deterministic, 2 = very creative)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Max Turns
                </label>
                <input
                  type="number"
                  value={maxTurns}
                  onChange={(e) => setMaxTurns(parseInt(e.target.value) || 10)}
                  min={1}
                  max={100}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Maximum conversation turns before stopping (1-100)
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Max Tool Calls
                </label>
                <input
                  type="number"
                  value={maxToolCalls}
                  onChange={(e) => setMaxToolCalls(parseInt(e.target.value) || 50)}
                  min={1}
                  max={200}
                  className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Maximum tool calls per turn (1-200)
                </p>
              </div>
            </div>
          )}

          {error && <p className="text-sm text-error mt-4">{error}</p>}
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
            {step !== 'info' && (
              <button
                onClick={() => {
                  const currentIndex = steps.indexOf(step);
                  if (currentIndex > 0) setStep(steps[currentIndex - 1]!);
                }}
                className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
              >
                Back
              </button>
            )}
            {step === 'config' ? (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !name.trim()}
                className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </button>
            ) : (
              <button
                onClick={() => {
                  const currentIndex = steps.indexOf(step);
                  if (currentIndex < steps.length - 1) setStep(steps[currentIndex + 1]!);
                }}
                disabled={step === 'info' && !name.trim()}
                className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
