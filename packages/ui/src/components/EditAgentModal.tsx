/**
 * Edit Agent Modal
 *
 * Multi-step modal for editing an existing AI agent's name, model, tools, and config.
 * Shell + shared step content live in MultiStepModal / AgentFormSteps (shared
 * with CreateAgentModal); only the config step is specific to editing.
 */

import { useState, useEffect } from 'react';
import { agentsApi } from '../api';
import type { Agent, ModelInfo, AgentDetail } from '../types';
import { MultiStepModal } from './MultiStepModal';
import { useAgentFormData, AgentInfoStep, AgentModelStep, AgentToolsStep } from './AgentFormSteps';

interface EditAgentModalProps {
  agentId: string;
  onClose: () => void;
  onUpdated: (agent: Agent) => void;
}

const STEPS = ['info', 'model', 'tools', 'config'] as const;
type Step = (typeof STEPS)[number];

export function EditAgentModal({ agentId, onClose, onUpdated }: EditAgentModalProps) {
  const [agentDetail, setAgentDetail] = useState<AgentDetail | null>(null);
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [maxTokens, setMaxTokens] = useState(4096);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTurns, setMaxTurns] = useState(50);
  const [maxToolCalls, setMaxToolCalls] = useState(200);
  const [isLoadingAgent, setIsLoadingAgent] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('info');

  const { models, configuredProviders, modelsByProvider, tools, isLoading } = useAgentFormData();

  useEffect(() => {
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
      } finally {
        setIsLoadingAgent(false);
      }
    };
    void fetchAgentDetail();
  }, [agentId]);

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

  return (
    <MultiStepModal
      title="Edit Agent"
      steps={STEPS}
      step={step}
      onStepChange={setStep}
      onClose={onClose}
      isLoading={isLoading || isLoadingAgent}
      error={error}
      submitLabel="Save Changes"
      submittingLabel="Saving..."
      isSubmitting={isSubmitting}
      canSubmit={Boolean(name.trim())}
      canAdvance={!(step === 'info' && !name.trim())}
      onSubmit={handleSubmit}
    >
      {step === 'info' ? (
        <AgentInfoStep
          name={name}
          onNameChange={setName}
          systemPrompt={systemPrompt}
          onSystemPromptChange={setSystemPrompt}
        />
      ) : step === 'model' ? (
        <AgentModelStep
          modelsByProvider={modelsByProvider}
          configuredProviders={configuredProviders}
          selectedModel={selectedModel}
          onSelect={setSelectedModel}
        />
      ) : step === 'tools' ? (
        <AgentToolsStep tools={tools} selectedTools={selectedTools} onToggle={toggleTool} />
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
    </MultiStepModal>
  );
}
