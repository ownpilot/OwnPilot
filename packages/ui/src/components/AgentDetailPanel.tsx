/**
 * Agent Detail Panel
 *
 * Slide-in panel showing agent details (name, model, tools) with a chat action.
 */

import { Bot, Play } from './icons';
import type { Agent } from '../types';

export interface AgentDetailPanelProps {
  agent: Agent;
  onClose: () => void;
  onChat: () => void;
}

export function AgentDetailPanel({ agent, onClose, onChat }: AgentDetailPanelProps) {
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
          aria-label="Close agent details"
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
            <p className="text-sm text-text-muted dark:text-dark-text-muted">No tools configured</p>
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
