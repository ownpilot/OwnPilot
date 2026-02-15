/**
 * Agents Page
 *
 * Create and manage AI agents with provider/model selection
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash, Bot, Settings, MessageSquare } from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { CreateAgentModal } from '../components/CreateAgentModal';
import { EditAgentModal } from '../components/EditAgentModal';
import { AgentDetailPanel } from '../components/AgentDetailPanel';
import { agentsApi } from '../api';
import type { Agent } from '../types';

export function AgentsPage() {
  const navigate = useNavigate();
  const { confirm } = useDialog();
  const toast = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  useEffect(() => {
    fetchAgents();
  }, []);

  const handleChatWithAgent = useCallback((agent: Agent) => {
    // Navigate to chat with the agent's provider and model
    navigate(`/?agent=${agent.id}&provider=${agent.provider}&model=${agent.model}`);
  }, [navigate]);

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

  const deleteAgent = useCallback(async (id: string) => {
    if (!await confirm({ message: 'Are you sure you want to delete this agent?', variant: 'danger' })) return;

    try {
      await agentsApi.delete(id);
      toast.success('Agent deleted');
      setAgents((prev) => prev.filter((a) => a.id !== id));
      setSelectedAgent((prev) => prev?.id === id ? null : prev);
    } catch {
      // API client handles error reporting
    }
  }, [confirm, toast]);

  const openEditModal = useCallback((agentId: string) => {
    setEditingAgentId(agentId);
    setShowEditModal(true);
  }, []);

  const handleAgentUpdated = useCallback((updatedAgent: Agent) => {
    toast.success('Agent updated');
    setAgents((prev) => prev.map((a) => (a.id === updatedAgent.id ? updatedAgent : a)));
    setSelectedAgent((prev) => prev?.id === updatedAgent.id ? updatedAgent : prev);
    setShowEditModal(false);
    setEditingAgentId(null);
  }, [toast]);

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
            toast.success('Agent created');
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
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); } }}
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
          aria-label="Delete agent"
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
