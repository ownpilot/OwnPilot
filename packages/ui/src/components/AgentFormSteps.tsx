/**
 * Shared step content + data hook for the Create / Edit agent modals.
 *
 * The info, model, and tools steps were duplicated verbatim between
 * CreateAgentModal and EditAgentModal; they live here once now. Each step
 * is a controlled component — the modal owns the form state.
 */

import { useState, useEffect, useMemo } from 'react';
import { modelsApi, toolsApi } from '../api';
import type { Tool, ModelInfo } from '../types';

// ---------------------------------------------------------------------------
// Data hook
// ---------------------------------------------------------------------------

export interface AgentFormData {
  models: ModelInfo[];
  configuredProviders: string[];
  modelsByProvider: Record<string, ModelInfo[]>;
  tools: Tool[];
  isLoading: boolean;
}

/** Loads the model catalog + tool list both agent modals need. */
export function useAgentFormData(): AgentFormData {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
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
        setTools(await toolsApi.list());
      } catch {
        // API client handles error reporting
      }
    };
    Promise.all([fetchModels(), fetchTools()]).finally(() => setIsLoading(false));
  }, []);

  const modelsByProvider = useMemo(
    () =>
      models.reduce<Record<string, ModelInfo[]>>((acc, model) => {
        if (!acc[model.provider]) acc[model.provider] = [];
        acc[model.provider]!.push(model);
        return acc;
      }, {}),
    [models]
  );

  return { models, configuredProviders, modelsByProvider, tools, isLoading };
}

// ---------------------------------------------------------------------------
// Step: info (name + system prompt)
// ---------------------------------------------------------------------------

export function AgentInfoStep({
  name,
  onNameChange,
  systemPrompt,
  onSystemPromptChange,
}: {
  name: string;
  onNameChange: (value: string) => void;
  systemPrompt: string;
  onSystemPromptChange: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
          Agent Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
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
          onChange={(e) => onSystemPromptChange(e.target.value)}
          rows={6}
          className="w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none"
          placeholder="You are a helpful AI assistant."
        />
        <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
          Define how your agent should behave and respond.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: model selection
// ---------------------------------------------------------------------------

export function AgentModelStep({
  modelsByProvider,
  configuredProviders,
  selectedModel,
  onSelect,
}: {
  modelsByProvider: Record<string, ModelInfo[]>;
  configuredProviders: string[];
  selectedModel: ModelInfo | null;
  onSelect: (model: ModelInfo) => void;
}) {
  if (configuredProviders.length === 0) {
    return (
      <div className="text-center py-8">
        <p className="text-text-muted dark:text-dark-text-muted mb-4">
          No providers configured. Add API keys in Settings first.
        </p>
        <a href="/settings" className="text-primary hover:underline">
          Go to Settings
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(modelsByProvider).map(([provider, providerModels]) => (
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
                onClick={() => onSelect(model)}
                disabled={!configuredProviders.includes(provider)}
                className={`p-3 rounded-lg border text-left transition-all ${
                  selectedModel?.id === model.id && selectedModel?.provider === model.provider
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
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step: tool selection
// ---------------------------------------------------------------------------

export function AgentToolsStep({
  tools,
  selectedTools,
  onToggle,
}: {
  tools: Tool[];
  selectedTools: string[];
  onToggle: (toolName: string) => void;
}) {
  return (
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
              onClick={() => onToggle(tool.name)}
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
  );
}
