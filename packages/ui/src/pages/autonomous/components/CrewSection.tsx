/**
 * CrewSection — Crews tab: deploy, manage, view crews with member agents
 */

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { crewsApi } from '../../../api/endpoints/souls';
import type { AgentCrew, CrewTemplate, CrewAgentInfo } from '../../../api/endpoints/souls';
import {
  Users,
  Plus,
  Play,
  Pause,
  Trash2,
  ChevronDown,
  ChevronRight,
  Database,
  ListChecks,
} from '../../../components/icons';
import { useDialog } from '../../../components/ConfirmDialog';
import { useToast } from '../../../components/ToastProvider';
import { EmptyState } from '../../../components/EmptyState';
import { AgentStatusBadge } from './AgentStatusBadge';
import { CrewMemoryPanel } from './CrewMemoryPanel';
import { CrewTaskQueue } from './CrewTaskQueue';
import { PATTERN_LABELS, formatTimeAgo } from '../helpers';

interface Props {
  crews: AgentCrew[];
  templates: CrewTemplate[];
  onRefresh: () => void;
}

export function CrewSection({ crews, templates, onRefresh }: Props) {
  const navigate = useNavigate();
  const { confirm } = useDialog();
  const toast = useToast();
  const [showTemplates, setShowTemplates] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [crewAgents, setCrewAgents] = useState<Record<string, CrewAgentInfo[]>>({});
  const [crewTab, setCrewTab] = useState<Record<string, 'agents' | 'memory' | 'tasks'>>({});

  const handleDeploy = useCallback(
    async (templateId: string) => {
      try {
        await crewsApi.deploy(templateId);
        toast.success('Crew deployed');
        setShowTemplates(false);
        onRefresh();
      } catch {
        toast.error('Failed to deploy crew');
      }
    },
    [toast, onRefresh]
  );

  const handlePause = useCallback(
    async (crewId: string) => {
      try {
        await crewsApi.pause(crewId);
        toast.success('Crew paused');
        onRefresh();
      } catch {
        toast.error('Failed to pause crew');
      }
    },
    [toast, onRefresh]
  );

  const handleResume = useCallback(
    async (crewId: string) => {
      try {
        await crewsApi.resume(crewId);
        toast.success('Crew resumed');
        onRefresh();
      } catch {
        toast.error('Failed to resume crew');
      }
    },
    [toast, onRefresh]
  );

  const handleDisband = useCallback(
    async (crewId: string) => {
      if (
        !(await confirm({
          message: 'Are you sure you want to disband this crew? This will deactivate all agents.',
          variant: 'danger',
        }))
      )
        return;
      try {
        await crewsApi.disband(crewId);
        toast.success('Crew disbanded');
        setExpandedId(null);
        setCrewAgents((prev) => {
          const next = { ...prev };
          delete next[crewId];
          return next;
        });
        onRefresh();
      } catch {
        toast.error('Failed to disband crew');
      }
    },
    [confirm, toast, onRefresh]
  );

  const toggleExpand = useCallback(
    async (crewId: string) => {
      if (expandedId === crewId) {
        setExpandedId(null);
        return;
      }
      setExpandedId(crewId);
      if (!crewAgents[crewId]) {
        try {
          const detail = await crewsApi.get(crewId);
          if (detail.agents) {
            setCrewAgents((prev) => ({ ...prev, [crewId]: detail.agents! }));
          }
        } catch {
          toast.error('Failed to load crew agents');
          setExpandedId(null);
        }
      }
    },
    [expandedId, crewAgents]
  );

  return (
    <div className="space-y-4">
      {/* Deploy button */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
          {crews.length} Crew{crews.length !== 1 ? 's' : ''}
        </h2>
        <button
          onClick={() => setShowTemplates(!showTemplates)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Deploy Crew
        </button>
      </div>

      {/* Template gallery */}
      {showTemplates && (
        <div className="border border-primary/20 rounded-xl p-4 bg-primary/5 space-y-3">
          <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            Crew Templates
          </h3>
          {templates.length === 0 ? (
            <p className="text-sm text-text-muted dark:text-dark-text-muted italic">
              No templates available.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {templates.map((t) => (
                <div
                  key={t.id}
                  className="border border-border dark:border-dark-border rounded-lg p-3 bg-bg-primary dark:bg-dark-bg-primary hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{t.emoji}</span>
                    <h4 className="font-medium text-text-primary dark:text-dark-text-primary text-sm">
                      {t.name}
                    </h4>
                  </div>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                    {t.description}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                      {PATTERN_LABELS[t.coordinationPattern] || t.coordinationPattern}
                    </span>
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">
                      {t.agents.length} agent{t.agents.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {t.agents.map((a) => (
                      <span
                        key={a.identity.role}
                        className="text-xs px-2 py-0.5 rounded bg-bg-secondary dark:bg-dark-bg-secondary text-text-muted dark:text-dark-text-muted border border-border dark:border-dark-border"
                      >
                        {a.identity.emoji} {a.identity.name}
                      </span>
                    ))}
                  </div>
                  <button
                    onClick={() => handleDeploy(t.id)}
                    className="mt-2 flex items-center gap-1 px-3 py-1 text-xs bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
                  >
                    <Play className="w-3 h-3" />
                    Deploy
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Crew list */}
      {crews.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No crews deployed"
          description="Deploy a crew template to get started with autonomous agent teams."
          action={{ label: 'Browse Templates', onClick: () => setShowTemplates(true), icon: Plus }}
        />
      ) : (
        <div className="space-y-3">
          {crews.map((crew) => {
            const isExpanded = expandedId === crew.id;
            const agents = crewAgents[crew.id];
            return (
              <div
                key={crew.id}
                className="border border-border dark:border-dark-border rounded-xl overflow-hidden"
              >
                {/* Crew header */}
                <div className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Users className="w-5 h-5 text-primary flex-shrink-0" />
                    <div>
                      <h3 className="font-medium text-text-primary dark:text-dark-text-primary">
                        {crew.name}
                      </h3>
                      {crew.description && (
                        <p className="text-xs text-text-muted dark:text-dark-text-muted">
                          {crew.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <AgentStatusBadge
                      status={
                        crew.status === 'active'
                          ? 'running'
                          : crew.status === 'paused'
                            ? 'paused'
                            : 'stopped'
                      }
                    />
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                      {PATTERN_LABELS[crew.coordinationPattern] || crew.coordinationPattern}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="px-4 pb-3 flex items-center gap-2 border-t border-border dark:border-dark-border pt-3">
                  <button
                    onClick={() => toggleExpand(crew.id)}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary-dark"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    {isExpanded ? 'Collapse' : 'Agents'}
                  </button>
                  {crew.status === 'active' && (
                    <button
                      onClick={() => handlePause(crew.id)}
                      className="flex items-center gap-1 text-xs text-warning hover:opacity-80"
                    >
                      <Pause className="w-3.5 h-3.5" /> Pause
                    </button>
                  )}
                  {crew.status === 'paused' && (
                    <button
                      onClick={() => handleResume(crew.id)}
                      className="flex items-center gap-1 text-xs text-success hover:opacity-80"
                    >
                      <Play className="w-3.5 h-3.5" /> Resume
                    </button>
                  )}
                  <button
                    onClick={() => handleDisband(crew.id)}
                    className="flex items-center gap-1 text-xs text-danger hover:opacity-80"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Disband
                  </button>
                </div>

                {/* Expanded tabbed content */}
                {isExpanded && (
                  <div className="border-t border-border dark:border-dark-border">
                    {/* Tab bar */}
                    <div className="flex items-center gap-1 px-4 pt-3 pb-2">
                      {([
                        { key: 'agents' as const, label: 'Agents', icon: Users },
                        { key: 'memory' as const, label: 'Shared Memory', icon: Database },
                        { key: 'tasks' as const, label: 'Task Queue', icon: ListChecks },
                      ]).map(({ key, label, icon: Icon }) => {
                        const activeTab = crewTab[crew.id] || 'agents';
                        return (
                          <button
                            key={key}
                            onClick={() => setCrewTab((prev) => ({ ...prev, [crew.id]: key }))}
                            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                              activeTab === key
                                ? 'bg-primary/10 text-primary font-medium'
                                : 'text-text-muted dark:text-dark-text-muted hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" />
                            {label}
                          </button>
                        );
                      })}
                    </div>

                    {/* Tab content */}
                    <div className="px-4 pb-4">
                      {(crewTab[crew.id] || 'agents') === 'agents' && (
                        <>
                          {!agents ? (
                            <p className="text-xs text-text-muted dark:text-dark-text-muted">
                              Loading agents...
                            </p>
                          ) : agents.length === 0 ? (
                            <p className="text-xs text-text-muted dark:text-dark-text-muted italic">
                              No agents in this crew.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {agents.map((agent) => (
                                <button
                                  key={agent.agentId}
                                  onClick={() => navigate(`/autonomous/agent/${agent.agentId}`)}
                                  className="text-left text-xs px-3 py-2 rounded-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border hover:shadow-sm transition-shadow"
                                >
                                  <div className="flex items-center gap-1.5">
                                    <span>{agent.emoji}</span>
                                    <span className="font-medium text-text-primary dark:text-dark-text-primary">
                                      {agent.name}
                                    </span>
                                    <span className="text-text-muted dark:text-dark-text-muted">
                                      — {agent.role}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1 text-text-muted dark:text-dark-text-muted">
                                    <span>v{agent.soulVersion}</span>
                                    <span className={agent.heartbeatEnabled ? 'text-success' : ''}>
                                      {agent.heartbeatEnabled ? '♥ on' : '♥ off'}
                                    </span>
                                    {agent.lastHeartbeat && (
                                      <span>{formatTimeAgo(agent.lastHeartbeat)}</span>
                                    )}
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      )}

                      {(crewTab[crew.id] || 'agents') === 'memory' && (
                        <CrewMemoryPanel crewId={crew.id} />
                      )}

                      {(crewTab[crew.id] || 'agents') === 'tasks' && (
                        <CrewTaskQueue crewId={crew.id} />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
