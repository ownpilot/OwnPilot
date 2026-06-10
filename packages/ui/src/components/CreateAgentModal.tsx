/**
 * Create Agent Modal
 *
 * Multi-step modal for creating a new AI agent with name, model, and tool selection.
 * Shell + step content live in MultiStepModal / AgentFormSteps (shared with
 * EditAgentModal).
 */

import { useState, useEffect } from 'react';
import { agentsApi } from '../api';
import type { Agent, ModelInfo } from '../types';
import { MultiStepModal } from './MultiStepModal';
import { useAgentFormData, AgentInfoStep, AgentModelStep, AgentToolsStep } from './AgentFormSteps';

interface CreateAgentModalProps {
  onClose: () => void;
  onCreated: (agent: Agent) => void;
}

const STEPS = ['info', 'model', 'tools'] as const;
type Step = (typeof STEPS)[number];

export function CreateAgentModal({ onClose, onCreated }: CreateAgentModalProps) {
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant.');
  const [selectedModel, setSelectedModel] = useState<ModelInfo | null>(null);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('info');

  const { models, configuredProviders, modelsByProvider, tools, isLoading } = useAgentFormData();

  // Default to the recommended model once the catalog loads.
  useEffect(() => {
    if (!selectedModel) {
      const recommended = models.find((m) => m.recommended);
      if (recommended) setSelectedModel(recommended);
    }
    // Only reacts to catalog load; selectedModel is read but intentionally not a dep.
  }, [models]);

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

  return (
    <MultiStepModal
      title="Create New Agent"
      steps={STEPS}
      step={step}
      onStepChange={setStep}
      onClose={onClose}
      isLoading={isLoading}
      error={error}
      submitLabel="Create Agent"
      submittingLabel="Creating..."
      isSubmitting={isSubmitting}
      canSubmit={Boolean(name.trim() && selectedModel)}
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
      ) : (
        <AgentToolsStep tools={tools} selectedTools={selectedTools} onToggle={toggleTool} />
      )}
    </MultiStepModal>
  );
}
