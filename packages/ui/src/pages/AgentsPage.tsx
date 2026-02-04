/**
 * Agents Page
 *
 * Create and manage AI agents with provider/model selection
 */

import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash, Bot, Settings, MessageSquare, Play } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { agentsApi, modelsApi, toolsApi } from '../api';
import { useModalClose } from '../hooks';
import type { Agent, Tool, ModelInfo, AgentDetail } from '../types';

export function AgentsPage() {
  const navigate = useNavigate();
  const { confirm } = useDialog();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleChatWithAgent = (agent: Agent) => {
    // Navigate to chat with the agent's provider and model
    navigate(`/?agent=${agent.id}&provider=${agent.provider}&model=${agent.model}`);
  };

  const fetchAgents = async () => {
    try {
      const data = await agentsApi.list();
      setAgents(data);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  };

  const deleteAgent = async (id: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this agent?', variant: 'danger' })) return;

    try {
      await agentsApi.delete(id);
      setAgents((prev) => prev.filter((a) => a.id !== id));
      if (selectedAgent?.id === id) {
        setSelectedAgent(null);
      }
    } catch {
      // API client handles error reporting
    }
  };

  const openEditModal = (agentId: string) => {
    setEditingAgentId(agentId);
    setShowEditModal(true);
  };

  const handleAgentUpdated = (updatedAgent: Agent) => {
    setAgents((prev) => prev.map((a) => (a.id === updatedAgent.id ? updatedAgent : a)));
    if (selectedAgent?.id === updatedAgent.id) {
      setSelectedAgent(updatedAgent);
    }
    setShowEditModal(false);
    setEditingAgentId(null);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            AI Agents
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {agents.length} agent{agents.length !== 1 ? 's' : ''} configured
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Agent
        </button>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
        {isLoading ? (
          <LoadingSpinner message="Loading agents..." />
        ) : agents.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="No agents yet"
            description="Create your first AI agent to get started. Agents can use different models and tools to help with various tasks."
            action={{ label: 'Create Agent', onClick: () => setShowCreateModal(true), icon: Plus }}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onDelete={() => deleteAgent(agent.id)}
                onSelect={() => setSelectedAgent(agent)}
                onChat={() => handleChatWithAgent(agent)}
                onConfigure={() => openEditModal(agent.id)}
                isSelected={selectedAgent?.id === agent.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <CreateAgentModal
          onClose={() => setShowCreateModal(false)}
          onCreated={(agent) => {
            setAgents((prev) => [...prev, agent]);
            setShowCreateModal(false);
          }}
        />
      )}

      {/* Edit Modal */}
      {showEditModal && editingAgentId && (
        <EditAgentModal
          agentId={editingAgentId}
          onClose={() => {
            setShowEditModal(false);
            setEditingAgentId(null);
          }}
          onUpdated={handleAgentUpdated}
        />
      )}

      {/* Agent Detail Panel */}
      {selectedAgent && (
        <AgentDetailPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onChat={() => handleChatWithAgent(selectedAgent)}
        />
      )}
    </div>
  );
}

interface AgentCardProps {
  agent: Agent;
  onDelete: () => void;
  onSelect: () => void;
  onChat: () => void;
  onConfigure: () => void;
  isSelected: boolean;
}

function AgentCard({ agent, onDelete, onSelect, onChat, onConfigure, isSelected }: AgentCardProps) {
  // Extract emoji from name if present
  const nameMatch = agent.name.match(/^(\p{Emoji})\s*(.+)$/u);
  const emoji = nameMatch ? nameMatch[1] : null;
  const displayName = nameMatch ? nameMatch[2] : agent.name;

  return (
    <div
      onClick={onSelect}
      className={`card-elevated p-4 bg-bg-secondary dark:bg-dark-bg-secondary border rounded-xl cursor-pointer transition-all ${
        isSelected
          ? 'border-primary ring-2 ring-primary/20'
          : 'border-border dark:border-dark-border card-hover'
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-xl">
            {emoji || <Bot className="w-5 h-5 text-primary" />}
          </div>
          <div>
            <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
              {displayName}
            </h3>
            <p className="text-xs text-text-muted dark:text-dark-text-muted font-mono">
              {agent.provider}/{agent.model}
            </p>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="p-2 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
          title="Delete agent"
        >
          <Trash className="w-4 h-4" />
        </button>
      </div>

      {/* Tools */}
      {agent.tools.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {agent.tools.slice(0, 3).map((tool) => (
            <span
              key={tool}
              className="px-2 py-0.5 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary rounded"
            >
              {tool}
            </span>
          ))}
          {agent.tools.length > 3 && (
            <span className="px-2 py-0.5 text-xs text-text-muted dark:text-dark-text-muted">
              +{agent.tools.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border dark:border-dark-border">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onChat();
          }}
          className="flex items-center gap-1 px-3 py-1.5 text-xs text-white bg-primary hover:bg-primary-dark rounded-md transition-colors"
        >
          <MessageSquare className="w-3 h-3" /> Chat
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onConfigure();
          }}
          className="flex items-center gap-1 text-xs text-text-muted dark:text-dark-text-muted hover:text-primary"
        >
          <Settings className="w-3 h-3" /> Configure
        </button>
      </div>
    </div>
  );
}

interface CreateAgentModalProps {
  onClose: () => void;
  onCreated: (agent: Agent) => void;
}

function CreateAgentModal({ onClose, onCreated }: CreateAgentModalProps) {
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
      prev.includes(toolName)
        ? prev.filter((t) => t !== toolName)
        : [...prev, toolName]
    );
  };

  // Group models by provider
  const modelsByProvider = useMemo(() => models.reduce<Record<string, ModelInfo[]>>((acc, model) => {
    if (!acc[model.provider]) acc[model.provider] = [];
    acc[model.provider]!.push(model);
    return acc;
  }, {}), [models]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onBackdropClick}>
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
                  <a
                    href="/settings"
                    className="text-primary hover:underline"
                  >
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

          {error && (
            <p className="text-sm text-error mt-4">{error}</p>
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

interface AgentDetailPanelProps {
  agent: Agent;
  onClose: () => void;
  onChat: () => void;
}

function AgentDetailPanel({ agent, onClose, onChat }: AgentDetailPanelProps) {
  // Extract emoji from name if present
  const nameMatch = agent.name.match(/^(\p{Emoji})\s*(.+)$/u);
  const emoji = nameMatch ? nameMatch[1] : null;
  const displayName = nameMatch ? nameMatch[2] : agent.name;

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-bg-primary dark:bg-dark-bg-primary border-l border-border dark:border-dark-border shadow-xl z-40 flex flex-col">
      <div className="p-4 border-b border-border dark:border-dark-border flex items-center justify-between">
        <h3 className="font-semibold text-text-primary dark:text-dark-text-primary">
          Agent Details
        </h3>
        <button
          onClick={onClose}
          className="p-1 text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-2xl">
            {emoji || <Bot className="w-6 h-6 text-primary" />}
          </div>
          <div>
            <h4 className="font-medium text-text-primary dark:text-dark-text-primary">
              {displayName}
            </h4>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              Created {new Date(agent.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div>
          <h5 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
            Model
          </h5>
          <p className="text-text-primary dark:text-dark-text-primary font-mono text-sm">
            {agent.provider}/{agent.model}
          </p>
        </div>

        <div>
          <h5 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
            Tools ({agent.tools.length})
          </h5>
          {agent.tools.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {agent.tools.map((tool) => (
                <span
                  key={tool}
                  className="px-2 py-1 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary rounded"
                >
                  {tool}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              No tools configured
            </p>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-border dark:border-dark-border">
        <button
          onClick={onChat}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Play className="w-4 h-4" /> Start Chat
        </button>
      </div>
    </div>
  );
}

interface EditAgentModalProps {
  agentId: string;
  onClose: () => void;
  onUpdated: (agent: Agent) => void;
}

function EditAgentModal({ agentId, onClose, onUpdated }: EditAgentModalProps) {
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
    Promise.all([fetchAgentDetail(), fetchModels(), fetchTools()]).finally(() => setIsLoading(false));
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
      prev.includes(toolName)
        ? prev.filter((t) => t !== toolName)
        : [...prev, toolName]
    );
  };

  // Group models by provider
  const modelsByProvider = useMemo(() => models.reduce<Record<string, ModelInfo[]>>((acc, model) => {
    if (!acc[model.provider]) acc[model.provider] = [];
    acc[model.provider]!.push(model);
    return acc;
  }, {}), [models]);

  const steps = ['info', 'model', 'tools', 'config'] as const;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onBackdropClick}>
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

          {error && (
            <p className="text-sm text-error mt-4">{error}</p>
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
