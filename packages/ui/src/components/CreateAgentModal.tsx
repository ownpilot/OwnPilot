/**
 * Create Agent Modal
 *
 * Multi-step modal for creating a new AI agent with name, model, and tool selection.
 */

import { useState, useEffect, useMemo } from 'react';
import { LoadingSpinner } from './LoadingSpinner';
import { agentsApi, modelsApi, toolsApi } from '../api';
import { useModalClose } from '../hooks';
import type { Agent, Tool, ModelInfo } from '../types';

export interface CreateAgentModalProps {
  onClose: () => void;
  onCreated: (agent: Agent) => void;
}

export function CreateAgentModal({ onClose, onCreated }: CreateAgentModalProps) {
  const { onBackdropClick } = useModalClose(onClose);
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant.');
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<'info' | 'model' | 'tools'>('info');

  useEffect(() => {
    Promise.all([fetchModels(), fetchTools()]).finally(() => setIsLoading(false));
  }, []);

  const fetchModels = async () => {
    try {
      const data = await modelsApi.list();
      setModels(data.models);
      setConfiguredProviders(data.configuredProviders);
      // Set default model
      const recommended = data.models.find((m) => m.recommended);
      if (recommended) setSelectedModel(recommended);
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

  const handleSubmit = async () => {
    if (!name.trim() || !selectedModel) return;

    setError(null);
    setIsSubmitting(true);

    try {
      const created = await agentsApi.create({
        name,
        systemPrompt,
        provider: selectedModel.provider,
        model: selectedModel.id,
        tools: selectedTools,
      });

      onCreated(created);
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

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onBackdropClick}
    >
      <div className="w-full max-w-2xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Create New Agent
          </h3>
          <div className="flex gap-4 mt-3">
            {(['info', 'model', 'tools'] as const).map((s, i) => (
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
                            selectedModel?.id === model.id
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
          ) : (
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
                onClick={() => setStep(step === 'model' ? 'info' : 'model')}
                className="px-4 py-2 text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
              >
                Back
              </button>
            )}
            {step === 'tools' ? (
              <button
                onClick={handleSubmit}
                disabled={isSubmitting || !name.trim() || !selectedModel}
                className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSubmitting ? 'Creating...' : 'Create Agent'}
              </button>
            ) : (
              <button
                onClick={() => setStep(step === 'info' ? 'model' : 'tools')}
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
