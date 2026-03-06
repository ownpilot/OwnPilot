/**
 * AgentPreviewCard — visual preview of a proposed agent configuration.
 * Used by AIChatCreator (inline after AI response) and TemplateCatalog (expanded view).
 */

import { Bot, Repeat, Cpu, Puzzle } from '../../../components/icons';
import { cronToHuman } from '../helpers';

export interface ProposedAgentConfig {
  kind: 'soul' | 'background';
  name: string;
  emoji: string;
  role: string;
  personality?: string;
  mission: string;
  tools?: string[];
  skills?: string[];
  heartbeatInterval?: string;
  heartbeatEnabled?: boolean;
  autonomyLevel?: number;
  estimatedCost?: string;
  bgMode?: 'continuous' | 'interval' | 'event';
  bgIntervalMs?: number;
  provider?: string;
  model?: string;
}

interface Props {
  config: ProposedAgentConfig;
  onConfirm?: () => void;
  confirmLabel?: string;
  isCreating?: boolean;
}

export function AgentPreviewCard({ config, onConfirm, confirmLabel, isCreating }: Props) {
  const schedule =
    config.kind === 'soul' && config.heartbeatInterval
      ? cronToHuman(config.heartbeatInterval)
      : config.kind === 'background' && config.bgMode === 'interval' && config.bgIntervalMs
        ? `Every ${Math.round(config.bgIntervalMs / 60_000)} min`
        : config.kind === 'background' && config.bgMode === 'event'
          ? 'On demand'
          : config.kind === 'background' && config.bgMode === 'continuous'
            ? 'Continuous'
            : null;

  return (
    <div className="border border-primary/30 bg-primary/5 rounded-xl p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl">{config.emoji}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-semibold text-text-primary dark:text-dark-text-primary truncate">
              {config.name}
            </h4>
            <span
              className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${
                config.kind === 'soul'
                  ? 'bg-primary/10 text-primary'
                  : 'bg-text-muted/10 text-text-muted dark:text-dark-text-muted'
              }`}
            >
              {config.kind === 'soul' ? 'Soul Agent' : 'Background'}
            </span>
          </div>
          <p className="text-xs text-text-muted dark:text-dark-text-muted">{config.role}</p>
        </div>
      </div>

      {/* Mission */}
      <p className="text-sm text-text-secondary dark:text-dark-text-secondary line-clamp-2">
        {config.mission}
      </p>

      {/* Details grid */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted dark:text-dark-text-muted">
        {schedule && (
          <span className="flex items-center gap-1">
            {config.kind === 'soul' ? <Bot className="w-3 h-3" /> : <Repeat className="w-3 h-3" />}
            {schedule}
          </span>
        )}
        {config.autonomyLevel != null && <span>Autonomy: {config.autonomyLevel}/4</span>}
        {config.estimatedCost && <span>{config.estimatedCost}</span>}
        {(config.provider || config.model) && (
          <span className="flex items-center gap-1">
            <Cpu className="w-3 h-3" />
            {config.provider || 'default'}/{config.model || 'default'}
          </span>
        )}
      </div>

      {/* Skills */}
      {config.skills && config.skills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          <Puzzle className="w-3 h-3 text-text-muted dark:text-dark-text-muted mt-0.5" />
          {config.skills.slice(0, 4).map((skill) => (
            <span key={skill} className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary">
              {skill}
            </span>
          ))}
          {config.skills.length > 4 && (
            <span className="text-xs px-1.5 py-0.5 text-text-muted dark:text-dark-text-muted">
              +{config.skills.length - 4} more
            </span>
          )}
        </div>
      )}

      {/* Tools */}
      {config.tools && config.tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {config.tools.slice(0, 6).map((tool) => (
            <span
              key={tool}
              className="text-xs px-1.5 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted"
            >
              {tool.replace('core.', '').replace(/_/g, ' ')}
            </span>
          ))}
          {config.tools.length > 6 && (
            <span className="text-xs px-1.5 py-0.5 text-text-muted dark:text-dark-text-muted">
              +{config.tools.length - 6} more
            </span>
          )}
        </div>
      )}

      {/* Confirm button */}
      {onConfirm && (
        <button
          onClick={onConfirm}
          disabled={isCreating}
          className="w-full mt-1 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isCreating ? 'Creating...' : confirmLabel || 'Create Agent'}
        </button>
      )}
    </div>
  );
}
