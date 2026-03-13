/**
 * Fleet Page — Manage coordinated background agent armies
 *
 * Follows the app's page convention: header → tab bar → PageHomeTab / content.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from '../components/ToastProvider';
import { useDialog } from '../components/ConfirmDialog';
import { PageHomeTab } from '../components/PageHomeTab';
import { fleetApi } from '../api/endpoints/fleet';
import type {
  FleetConfig,
  FleetTask,
  FleetWorkerType,
  FleetWorkerResult,
  FleetScheduleType,
  FleetSessionState,
  CreateFleetInput,
  CreateFleetTaskInput,
} from '../api/endpoints/fleet';
import { fileWorkspacesApi } from '../api/endpoints/misc';
import type { FileWorkspaceInfo } from '../api/types/workspace';
import {
  Plus,
  Play,
  Pause,
  Square,
  Trash2,
  RefreshCw,
  Search,
  Bot,
  Terminal,
  Globe,
  Server,
  Clock,
  Activity,
  Users,
  Send,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Layers,
  X,
  Gauge,
  Home,
  Zap,
  Brain,
} from '../components/icons';

// =============================================================================
// Helpers
// =============================================================================

function getStateBadge(state: FleetSessionState | null): string {
  switch (state) {
    case 'running':
      return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30';
    case 'paused':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
    case 'error':
      return 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30';
    case 'stopped':
      return 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400 border-zinc-500/30';
    case 'completed':
      return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30';
    default:
      return 'bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20';
  }
}

function getWorkerTypeIcon(type: FleetWorkerType) {
  switch (type) {
    case 'ai-chat':
      return Bot;
    case 'coding-cli':
      return Terminal;
    case 'api-call':
      return Globe;
    case 'mcp-bridge':
      return Server;
  }
}

function getWorkerTypeLabel(type: FleetWorkerType): string {
  switch (type) {
    case 'ai-chat':
      return 'AI Chat';
    case 'coding-cli':
      return 'Coding CLI';
    case 'api-call':
      return 'API Call';
    case 'mcp-bridge':
      return 'MCP Bridge';
  }
}

function getWorkerTypeColor(type: FleetWorkerType): string {
  switch (type) {
    case 'ai-chat':
      return 'text-violet-500 bg-violet-500/10 border-violet-500/20';
    case 'coding-cli':
      return 'text-cyan-500 bg-cyan-500/10 border-cyan-500/20';
    case 'api-call':
      return 'text-amber-500 bg-amber-500/10 border-amber-500/20';
    case 'mcp-bridge':
      return 'text-rose-500 bg-rose-500/10 border-rose-500/20';
  }
}

function getScheduleLabel(type: FleetScheduleType): string {
  switch (type) {
    case 'continuous':
      return 'Continuous';
    case 'interval':
      return 'Interval';
    case 'cron':
      return 'Cron';
    case 'event':
      return 'Event-driven';
    case 'on-demand':
      return 'On-demand';
  }
}

function getTaskStatusColor(status: string): string {
  switch (status) {
    case 'completed':
      return 'text-success';
    case 'running':
      return 'text-info';
    case 'failed':
      return 'text-error';
    case 'cancelled':
      return 'text-text-tertiary dark:text-dark-text-tertiary';
    default:
      return 'text-warning';
  }
}

function formatCost(cost: number): string {
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

// =============================================================================
// Fleet Templates
// =============================================================================

interface FleetTemplate {
  id: string;
  name: string;
  description: string;
  icon: typeof Bot;
  mission: string;
  scheduleType: FleetScheduleType;
  concurrency: number;
  workers: Array<{ name: string; type: FleetWorkerType; description: string }>;
}

const FLEET_TEMPLATES: FleetTemplate[] = [
  {
    id: 'code-review',
    name: 'Code Review Army',
    description: 'Automated code review pipeline with AI reviewers and CLI fixers',
    icon: Terminal,
    mission:
      'Review code quality, find bugs, security issues, and performance problems. Fix simple issues automatically, report complex ones.',
    scheduleType: 'on-demand',
    concurrency: 3,
    workers: [
      { name: 'reviewer', type: 'ai-chat', description: 'Analyzes code for bugs, security, and best practices' },
      { name: 'fixer', type: 'coding-cli', description: 'Applies automated fixes using Claude Code' },
      { name: 'reporter', type: 'api-call', description: 'Summarizes findings into a concise report' },
    ],
  },
  {
    id: 'research',
    name: 'Research & Analysis Squad',
    description: 'Multi-agent research team that gathers, analyzes, and synthesizes information',
    icon: Globe,
    mission:
      'Research topics thoroughly using multiple perspectives. Gather data, verify facts, analyze patterns, and produce structured reports.',
    scheduleType: 'on-demand',
    concurrency: 5,
    workers: [
      { name: 'researcher', type: 'ai-chat', description: 'Deep research using web browsing and memory tools' },
      { name: 'analyst', type: 'ai-chat', description: 'Analyzes data patterns and draws conclusions' },
      { name: 'fact-checker', type: 'api-call', description: 'Verifies claims and cross-references sources' },
      { name: 'writer', type: 'api-call', description: 'Synthesizes findings into clear reports' },
    ],
  },
  {
    id: 'data-pipeline',
    name: 'Data Processing Pipeline',
    description: 'Continuous data ingestion, transformation, and analysis',
    icon: Activity,
    mission:
      'Continuously process incoming data. Transform, validate, classify, and store results. Alert on anomalies.',
    scheduleType: 'interval',
    concurrency: 3,
    workers: [
      { name: 'ingester', type: 'ai-chat', description: 'Collects and validates incoming data' },
      { name: 'transformer', type: 'api-call', description: 'Classifies and transforms raw data' },
      { name: 'analyzer', type: 'ai-chat', description: 'Detects patterns and anomalies' },
    ],
  },
  {
    id: 'content-factory',
    name: 'Content Factory',
    description: 'Automated content creation, editing, and publishing pipeline',
    icon: Bot,
    mission:
      'Generate high-quality content at scale. Draft, edit, fact-check, and format articles, documentation, and social media posts.',
    scheduleType: 'on-demand',
    concurrency: 4,
    workers: [
      { name: 'drafter', type: 'ai-chat', description: 'Creates initial content drafts with research' },
      { name: 'editor', type: 'api-call', description: 'Refines tone, clarity, and grammar' },
      { name: 'seo-optimizer', type: 'api-call', description: 'Optimizes for search engines and readability' },
      { name: 'formatter', type: 'ai-chat', description: 'Formats and prepares final output' },
    ],
  },
  {
    id: 'monitoring',
    name: 'System Monitor Fleet',
    description: 'Continuous monitoring, health checks, and incident response',
    icon: Activity,
    mission:
      'Monitor system health continuously. Check APIs, databases, and services. Alert on issues, attempt auto-remediation.',
    scheduleType: 'continuous',
    concurrency: 3,
    workers: [
      { name: 'health-checker', type: 'mcp-bridge', description: 'Pings services and checks health endpoints' },
      { name: 'log-analyzer', type: 'ai-chat', description: 'Analyzes logs for errors and anomalies' },
      { name: 'responder', type: 'ai-chat', description: 'Takes remediation actions when issues detected' },
    ],
  },
  {
    id: 'coding-army',
    name: 'Coding Army',
    description: 'Parallel code generation using multiple CLI agents',
    icon: Terminal,
    mission:
      'Execute multiple coding tasks in parallel using CLI coding agents. Each worker handles independent tasks like feature development, refactoring, or test writing.',
    scheduleType: 'on-demand',
    concurrency: 5,
    workers: [
      { name: 'coder-1', type: 'coding-cli', description: 'Feature development and implementation' },
      { name: 'coder-2', type: 'coding-cli', description: 'Refactoring and code quality improvements' },
      { name: 'test-writer', type: 'coding-cli', description: 'Writes unit and integration tests' },
      { name: 'doc-writer', type: 'coding-cli', description: 'Generates and updates documentation' },
      { name: 'coordinator', type: 'ai-chat', description: 'Reviews outputs and coordinates between workers' },
    ],
  },
];

// =============================================================================
// Sub-components
// =============================================================================

/** Create Fleet Modal — template picker + form */
function CreateFleetModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState<'templates' | 'form'>('templates');
  const [isCreating, setIsCreating] = useState(false);
  const [name, setName] = useState('');
  const [mission, setMission] = useState('');
  const [description, setDescription] = useState('');
  const [scheduleType, setScheduleType] = useState<FleetScheduleType>('on-demand');
  const [concurrencyLimit, setConcurrencyLimit] = useState(5);
  const [autoStart, setAutoStart] = useState(true);
  const [intervalMs, setIntervalMs] = useState(60000);
  const [cronExpr, setCronExpr] = useState('');
  const [maxCostUsd, setMaxCostUsd] = useState('');
  const [maxCyclesPerHour, setMaxCyclesPerHour] = useState('');
  const [maxTotalCycles, setMaxTotalCycles] = useState('');
  interface WorkerFormState {
    name: string;
    type: FleetWorkerType;
    description: string;
    provider: string;
    model: string;
    systemPrompt: string;
    cliProvider: string;
    cwd: string;
    mcpServer: string;
    mcpTools: string;
  }
  const emptyWorker = (): WorkerFormState => ({
    name: '', type: 'ai-chat', description: '', provider: '', model: '',
    systemPrompt: '', cliProvider: 'claude-code', cwd: '', mcpServer: '', mcpTools: '',
  });

  const [workers, setWorkers] = useState<WorkerFormState[]>([emptyWorker()]);
  const [workspaces, setWorkspaces] = useState<FileWorkspaceInfo[]>([]);
  const [expandedWorker, setExpandedWorker] = useState<number | null>(0);

  useEffect(() => {
    fileWorkspacesApi.list()
      .then((data) => setWorkspaces(data.workspaces ?? []))
      .catch(() => {});
  }, []);

  const applyTemplate = (template: FleetTemplate) => {
    setName(template.name);
    setMission(template.mission);
    setDescription(template.description);
    setScheduleType(template.scheduleType);
    setConcurrencyLimit(template.concurrency);
    setWorkers(template.workers.map((w) => ({ ...emptyWorker(), ...w })));
    setStep('form');
  };

  const addWorker = () => {
    const idx = workers.length;
    setWorkers((prev) => [...prev, emptyWorker()]);
    setExpandedWorker(idx);
  };

  const removeWorker = (index: number) => {
    setWorkers((prev) => prev.filter((_, i) => i !== index));
    if (expandedWorker === index) setExpandedWorker(null);
  };

  const updateWorker = (index: number, field: string, value: string) => {
    setWorkers((prev) =>
      prev.map((w, i) => (i === index ? { ...w, [field]: value } : w))
    );
  };

  const handleCreate = async () => {
    if (!name.trim() || !mission.trim()) {
      toast.error('Name and mission are required');
      return;
    }
    const validWorkers = workers.filter((w) => w.name.trim());
    if (validWorkers.length === 0) {
      toast.error('At least one worker with a name is required');
      return;
    }

    setIsCreating(true);
    try {
      const input: CreateFleetInput = {
        name: name.trim(),
        mission: mission.trim(),
        description: description.trim() || undefined,
        workers: validWorkers.map((w) => ({
          name: w.name.trim(),
          type: w.type,
          description: w.description.trim() || undefined,
          provider: w.provider.trim() || undefined,
          model: w.model.trim() || undefined,
          system_prompt: w.systemPrompt.trim() || undefined,
          cli_provider: w.type === 'coding-cli' ? (w.cliProvider || 'claude-code') : undefined,
          cwd: w.cwd.trim() || undefined,
          mcp_server: w.mcpServer.trim() || undefined,
          mcp_tools: w.mcpTools.trim() ? w.mcpTools.split(',').map((t) => t.trim()) : undefined,
        })),
        schedule_type: scheduleType,
        schedule_config: scheduleType === 'interval'
          ? { intervalMs }
          : scheduleType === 'cron' && cronExpr.trim()
          ? { cron: cronExpr.trim() }
          : undefined,
        budget: (maxCostUsd || maxCyclesPerHour || maxTotalCycles)
          ? {
              maxCostUsd: maxCostUsd ? parseFloat(maxCostUsd) : undefined,
              maxCyclesPerHour: maxCyclesPerHour ? parseInt(maxCyclesPerHour) : undefined,
              maxTotalCycles: maxTotalCycles ? parseInt(maxTotalCycles) : undefined,
            }
          : undefined,
        concurrency_limit: concurrencyLimit,
        auto_start: autoStart,
      };
      await fleetApi.create(input);
      toast.success(`Fleet "${name}" created${autoStart ? ' and started' : ''}`);
      onCreated();
      onClose();
    } catch (err) {
      toast.error(`Failed to create fleet: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border shadow-xl">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary p-4 rounded-t-xl z-10">
          <div className="flex items-center gap-2">
            {step === 'form' && (
              <button
                onClick={() => setStep('templates')}
                className="p-1 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded text-text-secondary"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>
            )}
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              {step === 'templates' ? 'Choose a Template' : 'Configure Fleet'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1: Template Picker */}
        {step === 'templates' && (
          <div className="p-4">
            <p className="text-sm text-text-secondary dark:text-dark-text-secondary mb-4">
              Pick a template or start from scratch. You can customize everything after.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {FLEET_TEMPLATES.map((tpl) => {
                const Icon = tpl.icon;
                return (
                  <button
                    key={tpl.id}
                    onClick={() => applyTemplate(tpl)}
                    className="text-left p-4 rounded-xl border border-border dark:border-dark-border hover:border-primary/40 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-all group"
                  >
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-primary/10 text-primary">
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-text-primary dark:text-dark-text-primary group-hover:text-primary">
                          {tpl.name}
                        </div>
                        <p className="text-xs text-text-tertiary dark:text-dark-text-tertiary mt-0.5 line-clamp-2">
                          {tpl.description}
                        </p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary">
                            <Users className="w-2.5 h-2.5" /> {tpl.workers.length} workers
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary">
                            {getScheduleLabel(tpl.scheduleType)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Blank option */}
            <button
              onClick={() => setStep('form')}
              className="w-full p-3 rounded-xl border border-dashed border-border dark:border-dark-border hover:border-primary/40 text-sm text-text-secondary dark:text-dark-text-secondary hover:text-primary transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Start from scratch
            </button>
          </div>
        )}

        {/* Step 2: Form */}
        {step === 'form' && (
          <>
            <div className="p-4 space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Fleet Name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Code Review Army"
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                />
              </div>

              {/* Mission */}
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Mission
                </label>
                <textarea
                  value={mission}
                  onChange={(e) => setMission(e.target.value)}
                  placeholder="Describe what this fleet should accomplish..."
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary resize-none"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                  Description <span className="text-text-tertiary">(optional)</span>
                </label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief description"
                  className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                />
              </div>

              {/* Schedule & Concurrency */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Schedule
                  </label>
                  <select
                    value={scheduleType}
                    onChange={(e) => setScheduleType(e.target.value as FleetScheduleType)}
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
                  >
                    <option value="on-demand">On-demand</option>
                    <option value="continuous">Continuous</option>
                    <option value="interval">Interval</option>
                    <option value="cron">Cron</option>
                    <option value="event">Event-driven</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Concurrency Limit
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={concurrencyLimit}
                    onChange={(e) => setConcurrencyLimit(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
                  />
                </div>
              </div>

              {/* Schedule-specific config */}
              {scheduleType === 'interval' && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Interval (seconds)
                  </label>
                  <input
                    type="number"
                    min={5}
                    value={Math.round(intervalMs / 1000)}
                    onChange={(e) => setIntervalMs(Number(e.target.value) * 1000)}
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary"
                  />
                  <p className="text-xs text-text-tertiary dark:text-dark-text-tertiary mt-1">
                    How often to run a new cycle ({intervalMs >= 60000 ? `${Math.round(intervalMs / 60000)}m` : `${Math.round(intervalMs / 1000)}s`})
                  </p>
                </div>
              )}
              {scheduleType === 'cron' && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1">
                    Cron Expression
                  </label>
                  <input
                    type="text"
                    value={cronExpr}
                    onChange={(e) => setCronExpr(e.target.value)}
                    placeholder="e.g. 0 */6 * * * (every 6 hours)"
                    className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary font-mono text-sm"
                  />
                </div>
              )}

              {/* Budget limits (collapsible) */}
              <details className="group">
                <summary className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary cursor-pointer hover:text-text-primary dark:hover:text-dark-text-primary">
                  Budget Limits <span className="text-text-tertiary">(optional)</span>
                </summary>
                <div className="grid grid-cols-3 gap-2 mt-2">
                  <div>
                    <label className="block text-xs text-text-tertiary dark:text-dark-text-tertiary mb-1">
                      Max Cost ($)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      value={maxCostUsd}
                      onChange={(e) => setMaxCostUsd(e.target.value)}
                      placeholder="10.00"
                      className="w-full px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-tertiary dark:text-dark-text-tertiary mb-1">
                      Max Cycles/hr
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={maxCyclesPerHour}
                      onChange={(e) => setMaxCyclesPerHour(e.target.value)}
                      placeholder="10"
                      className="w-full px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-text-tertiary dark:text-dark-text-tertiary mb-1">
                      Max Total Cycles
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={maxTotalCycles}
                      onChange={(e) => setMaxTotalCycles(e.target.value)}
                      placeholder="100"
                      className="w-full px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                    />
                  </div>
                </div>
              </details>

              {/* Auto-start */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                  className="rounded border-border"
                />
                <span className="text-sm text-text-secondary dark:text-dark-text-secondary">
                  Auto-start after creation
                </span>
              </label>

              {/* Workers */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                    Workers
                  </label>
                  <button
                    onClick={addWorker}
                    className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                  >
                    <Plus className="w-3 h-3" /> Add Worker
                  </button>
                </div>
                <div className="space-y-3">
                  {workers.map((worker, idx) => {
                    const WIcon = getWorkerTypeIcon(worker.type);
                    const isExpanded = expandedWorker === idx;
                    return (
                      <div
                        key={idx}
                        className="rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary"
                      >
                        {/* Worker header row */}
                        <div className="flex items-center gap-2 p-3">
                          <button
                            onClick={() => setExpandedWorker(isExpanded ? null : idx)}
                            className="p-0.5 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded"
                          >
                            {isExpanded
                              ? <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
                              : <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
                            }
                          </button>
                          <WIcon className="w-4 h-4 text-text-tertiary flex-shrink-0" />
                          <input
                            type="text"
                            value={worker.name}
                            onChange={(e) => updateWorker(idx, 'name', e.target.value)}
                            placeholder="Worker name"
                            className="flex-1 px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                          />
                          <select
                            value={worker.type}
                            onChange={(e) => updateWorker(idx, 'type', e.target.value)}
                            className="px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary"
                          >
                            <option value="ai-chat">AI Chat</option>
                            <option value="coding-cli">Coding CLI</option>
                            <option value="api-call">API Call</option>
                            <option value="mcp-bridge">MCP Bridge</option>
                          </select>
                          {workers.length > 1 && (
                            <button
                              onClick={() => removeWorker(idx)}
                              className="p-1 text-error hover:text-error/80"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>

                        {/* Expanded config */}
                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-2 border-t border-border dark:border-dark-border pt-2">
                            <input
                              type="text"
                              value={worker.description}
                              onChange={(e) => updateWorker(idx, 'description', e.target.value)}
                              placeholder="What does this worker do?"
                              className="w-full px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                            />

                            {/* ai-chat & api-call: provider, model, system prompt */}
                            {(worker.type === 'ai-chat' || worker.type === 'api-call') && (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <input
                                    type="text"
                                    value={worker.provider}
                                    onChange={(e) => updateWorker(idx, 'provider', e.target.value)}
                                    placeholder="Provider (e.g. anthropic)"
                                    className="px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                                  />
                                  <input
                                    type="text"
                                    value={worker.model}
                                    onChange={(e) => updateWorker(idx, 'model', e.target.value)}
                                    placeholder="Model (e.g. claude-sonnet-4-5-20250514)"
                                    className="px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                                  />
                                </div>
                                <textarea
                                  value={worker.systemPrompt}
                                  onChange={(e) => updateWorker(idx, 'systemPrompt', e.target.value)}
                                  placeholder="System prompt (optional)"
                                  rows={2}
                                  className="w-full px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary resize-none"
                                />
                              </>
                            )}

                            {/* coding-cli: CLI provider + workspace */}
                            {worker.type === 'coding-cli' && (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <select
                                    value={worker.cliProvider}
                                    onChange={(e) => updateWorker(idx, 'cliProvider', e.target.value)}
                                    className="px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary"
                                  >
                                    <option value="claude-code">Claude Code</option>
                                    <option value="codex">Codex</option>
                                    <option value="gemini-cli">Gemini CLI</option>
                                  </select>
                                  <input
                                    type="text"
                                    value={worker.cwd}
                                    onChange={(e) => updateWorker(idx, 'cwd', e.target.value)}
                                    placeholder="Working directory path"
                                    className="px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                                  />
                                </div>
                                {workspaces.length > 0 && (
                                  <div>
                                    <div className="text-xs text-text-tertiary dark:text-dark-text-tertiary mb-1">
                                      Or pick a workspace:
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                      {workspaces.slice(0, 6).map((ws) => (
                                        <button
                                          key={ws.id}
                                          type="button"
                                          onClick={() => updateWorker(idx, 'cwd', ws.path)}
                                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                                            worker.cwd === ws.path
                                              ? 'border-primary bg-primary/10 text-primary'
                                              : 'border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:border-primary/40'
                                          }`}
                                        >
                                          {ws.name}
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}

                            {/* mcp-bridge: server + tools */}
                            {worker.type === 'mcp-bridge' && (
                              <div className="grid grid-cols-2 gap-2">
                                <input
                                  type="text"
                                  value={worker.mcpServer}
                                  onChange={(e) => updateWorker(idx, 'mcpServer', e.target.value)}
                                  placeholder="MCP server name"
                                  className="px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                                />
                                <input
                                  type="text"
                                  value={worker.mcpTools}
                                  onChange={(e) => updateWorker(idx, 'mcpTools', e.target.value)}
                                  placeholder="Tools (comma-separated)"
                                  className="px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary p-4 rounded-b-xl">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-lg border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={isCreating}
                className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {isCreating ? 'Creating...' : 'Create Fleet'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Add Tasks Modal */
function AddTasksModal({
  fleet,
  onClose,
  onAdded,
}: {
  fleet: FleetConfig;
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [isAdding, setIsAdding] = useState(false);
  const [tasks, setTasks] = useState<Array<{ title: string; description: string; priority: string; assignedWorker: string }>>([
    { title: '', description: '', priority: 'normal', assignedWorker: '' },
  ]);

  const addTask = () => {
    setTasks((prev) => [...prev, { title: '', description: '', priority: 'normal', assignedWorker: '' }]);
  };

  const removeTask = (index: number) => {
    setTasks((prev) => prev.filter((_, i) => i !== index));
  };

  const updateTask = (index: number, field: string, value: string) => {
    setTasks((prev) =>
      prev.map((t, i) => (i === index ? { ...t, [field]: value } : t))
    );
  };

  const handleAdd = async () => {
    const validTasks = tasks.filter((t) => t.title.trim() && t.description.trim());
    if (validTasks.length === 0) {
      toast.error('At least one task with title and description is required');
      return;
    }

    setIsAdding(true);
    try {
      const taskInputs: CreateFleetTaskInput[] = validTasks.map((t) => ({
        title: t.title.trim(),
        description: t.description.trim(),
        priority: t.priority as 'low' | 'normal' | 'high' | 'critical',
        assigned_worker: t.assignedWorker || undefined,
      }));
      await fleetApi.addTasks(fleet.id, taskInputs);
      toast.success(`Added ${validTasks.length} task(s) to "${fleet.name}"`);
      onAdded();
      onClose();
    } catch (err) {
      toast.error(`Failed to add tasks: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-xl max-h-[80vh] overflow-y-auto rounded-xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary p-4 rounded-t-xl">
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Add Tasks to {fleet.name}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          {tasks.map((task, idx) => (
            <div
              key={idx}
              className="p-3 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary space-y-2"
            >
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={task.title}
                  onChange={(e) => updateTask(idx, 'title', e.target.value)}
                  placeholder="Task title"
                  className="flex-1 px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                />
                <select
                  value={task.priority}
                  onChange={(e) => updateTask(idx, 'priority', e.target.value)}
                  className="px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
                {tasks.length > 1 && (
                  <button onClick={() => removeTask(idx)} className="p-1 text-error hover:text-error/80">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {fleet.workers.length > 0 && (
                <select
                  value={task.assignedWorker}
                  onChange={(e) => updateTask(idx, 'assignedWorker', e.target.value)}
                  className="w-full px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary"
                >
                  <option value="">Auto-assign worker</option>
                  {fleet.workers.map((w) => (
                    <option key={w.name} value={w.name}>
                      {w.name} ({getWorkerTypeLabel(w.type)})
                    </option>
                  ))}
                </select>
              )}
              <textarea
                value={task.description}
                onChange={(e) => updateTask(idx, 'description', e.target.value)}
                placeholder="Describe what the worker should do..."
                rows={2}
                className="w-full px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary resize-none"
              />
            </div>
          ))}
          <button
            onClick={addTask}
            className="inline-flex items-center gap-1 text-sm text-primary hover:text-primary/80"
          >
            <Plus className="w-4 h-4" /> Add another task
          </button>
        </div>

        <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary p-4 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={isAdding}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {isAdding ? 'Adding...' : 'Add Tasks'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Broadcast Modal */
function BroadcastModal({
  fleet,
  onClose,
}: {
  fleet: FleetConfig;
  onClose: () => void;
}) {
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const handleSend = async () => {
    if (!message.trim()) return;
    setIsSending(true);
    try {
      await fleetApi.broadcast(fleet.id, message.trim());
      toast.success('Message broadcast to all workers');
      onClose();
    } catch (err) {
      toast.error(`Broadcast failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border shadow-xl">
        <div className="flex items-center justify-between border-b border-border dark:border-dark-border p-4">
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Broadcast to {fleet.name}
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message to broadcast to all workers..."
            rows={4}
            className="w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary resize-none"
            autoFocus
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border dark:border-dark-border p-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-border dark:border-dark-border text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={isSending || !message.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Send className="w-4 h-4" />
            {isSending ? 'Sending...' : 'Broadcast'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Fleet Detail Panel (slide-out from right) */
function FleetDetailPanel({
  fleet,
  onClose,
  onAction,
}: {
  fleet: FleetConfig;
  onClose: () => void;
  onAction: (action: string, fleet: FleetConfig) => void;
}) {
  const { subscribe } = useGateway();
  const [tasks, setTasks] = useState<FleetTask[]>([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [taskFilter, setTaskFilter] = useState('');
  const [expandedSection, setExpandedSection] = useState<string | null>('tasks');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [history, setHistory] = useState<FleetWorkerResult[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [activityLog, setActivityLog] = useState<Array<{ time: string; text: string; type: 'info' | 'success' | 'error' }>>([]);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    try {
      const result = await fleetApi.listTasks(fleet.id, taskFilter || undefined);
      setTasks(result);
    } catch {
      setTasks([]);
    } finally {
      setTasksLoading(false);
    }
  }, [fleet.id, taskFilter]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const result = await fleetApi.getHistory(fleet.id, 20, 0);
      setHistory(result.entries);
      setHistoryTotal(result.total);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [fleet.id]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // Real-time activity feed via WS
  useEffect(() => {
    const unsubs = [
      subscribe<{ fleetId: string; taskId: string; workerName: string; workerType: string }>(
        'fleet:worker:started',
        (data) => {
          if (data.fleetId !== fleet.id) return;
          setActivityLog((prev) => [
            { time: new Date().toLocaleTimeString(), text: `${data.workerName} (${data.workerType}) started task`, type: 'info' },
            ...prev.slice(0, 49),
          ]);
        }
      ),
      subscribe<{ fleetId: string; taskId: string; workerName: string; success: boolean; output: string; durationMs: number; costUsd: number }>(
        'fleet:worker:completed',
        (data) => {
          if (data.fleetId !== fleet.id) return;
          setActivityLog((prev) => [
            {
              time: new Date().toLocaleTimeString(),
              text: `${data.workerName} ${data.success ? 'completed' : 'failed'} (${(data.durationMs / 1000).toFixed(1)}s)`,
              type: data.success ? 'success' : 'error',
            },
            ...prev.slice(0, 49),
          ]);
          // Refresh tasks and history when worker completes
          loadTasks();
          loadHistory();
        }
      ),
      subscribe<{ fleetId: string }>('fleet:cycle:end', (data) => {
        if (data.fleetId !== fleet.id) return;
        loadTasks();
        loadHistory();
      }),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, fleet.id, loadTasks, loadHistory]);

  const state = fleet.session?.state ?? null;

  const toggleSection = (section: string) =>
    setExpandedSection(expandedSection === section ? null : section);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="w-full max-w-lg h-full overflow-y-auto bg-bg-primary dark:bg-dark-bg-primary border-l border-border dark:border-dark-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-bg-primary dark:bg-dark-bg-primary border-b border-border dark:border-dark-border p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary truncate">
              {fleet.name}
            </h2>
            <button onClick={onClose} className="p-1 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-text-secondary dark:text-dark-text-secondary line-clamp-2">
            {fleet.mission}
          </p>
          <div className="flex items-center gap-2 mt-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${getStateBadge(state)}`}
            >
              {state === 'running' && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                </span>
              )}
              {state ?? 'idle'}
            </span>
            <span className="text-xs text-text-tertiary dark:text-dark-text-tertiary">
              {getScheduleLabel(fleet.scheduleType)}
            </span>
            <span className="text-xs text-text-tertiary dark:text-dark-text-tertiary">
              {fleet.workers.length} worker(s)
            </span>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-1.5 mt-3">
            {state !== 'running' && state !== 'paused' && (
              <button
                onClick={() => onAction('start', fleet)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors"
              >
                <Play className="w-3 h-3" /> Start
              </button>
            )}
            {state === 'running' && (
              <>
                <button
                  onClick={() => onAction('pause', fleet)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-warning/10 text-warning hover:bg-warning/20 transition-colors"
                >
                  <Pause className="w-3 h-3" /> Pause
                </button>
                <button
                  onClick={() => onAction('stop', fleet)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-error/10 text-error hover:bg-error/20 transition-colors"
                >
                  <Square className="w-3 h-3" /> Stop
                </button>
              </>
            )}
            {state === 'paused' && (
              <>
                <button
                  onClick={() => onAction('resume', fleet)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-success/10 text-success hover:bg-success/20 transition-colors"
                >
                  <Play className="w-3 h-3" /> Resume
                </button>
                <button
                  onClick={() => onAction('stop', fleet)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-error/10 text-error hover:bg-error/20 transition-colors"
                >
                  <Square className="w-3 h-3" /> Stop
                </button>
              </>
            )}
            <button
              onClick={() => onAction('addTasks', fleet)}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-3 h-3" /> Tasks
            </button>
            {state === 'running' && (
              <button
                onClick={() => onAction('broadcast', fleet)}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-info/10 text-info hover:bg-info/20 transition-colors"
              >
                <Send className="w-3 h-3" /> Broadcast
              </button>
            )}
          </div>
        </div>

        {/* Session Stats */}
        {fleet.session && (
          <div className="grid grid-cols-4 gap-2 p-4 border-b border-border dark:border-dark-border">
            <div className="text-center">
              <div className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                {fleet.session.cyclesCompleted}
              </div>
              <div className="text-xs text-text-tertiary dark:text-dark-text-tertiary">Cycles</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-success">{fleet.session.tasksCompleted}</div>
              <div className="text-xs text-text-tertiary dark:text-dark-text-tertiary">Done</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-error">{fleet.session.tasksFailed}</div>
              <div className="text-xs text-text-tertiary dark:text-dark-text-tertiary">Failed</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                {formatCost(fleet.session.totalCostUsd)}
              </div>
              <div className="text-xs text-text-tertiary dark:text-dark-text-tertiary">Cost</div>
            </div>
          </div>
        )}

        {/* Budget Info */}
        {fleet.budget && (fleet.budget.maxCostUsd || fleet.budget.maxCyclesPerHour || fleet.budget.maxTotalCycles) && (
          <div className="flex items-center gap-3 px-4 py-2 border-b border-border dark:border-dark-border text-xs text-text-tertiary dark:text-dark-text-tertiary">
            <Gauge className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Budget:</span>
            {fleet.budget.maxCostUsd != null && (
              <span>max ${fleet.budget.maxCostUsd.toFixed(2)}</span>
            )}
            {fleet.budget.maxCyclesPerHour != null && (
              <span>{fleet.budget.maxCyclesPerHour} cycles/hr</span>
            )}
            {fleet.budget.maxTotalCycles != null && (
              <span>{fleet.budget.maxTotalCycles} total cycles</span>
            )}
          </div>
        )}

        {/* Workers Section */}
        <div className="border-b border-border dark:border-dark-border">
          <button
            onClick={() => toggleSection('workers')}
            className="w-full flex items-center justify-between p-4 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-text-primary dark:text-dark-text-primary">
              <Users className="w-4 h-4" />
              Workers ({fleet.workers.length})
            </span>
            {expandedSection === 'workers' ? (
              <ChevronDown className="w-4 h-4 text-text-tertiary" />
            ) : (
              <ChevronRight className="w-4 h-4 text-text-tertiary" />
            )}
          </button>
          {expandedSection === 'workers' && (
            <div className="px-4 pb-4 space-y-2">
              {fleet.workers.map((w, idx) => {
                const Icon = getWorkerTypeIcon(w.type);
                const colorClass = getWorkerTypeColor(w.type);
                return (
                  <div
                    key={idx}
                    className="flex items-start gap-3 p-2 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary"
                  >
                    <div className={`p-1.5 rounded-md border ${colorClass}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                        {w.name}
                      </div>
                      <div className="text-xs text-text-tertiary dark:text-dark-text-tertiary">
                        {getWorkerTypeLabel(w.type)}
                        {w.provider && ` · ${w.provider}`}
                        {w.model && ` · ${w.model}`}
                        {w.cwd && ` · ${w.cwd}`}
                        {w.cliProvider && w.cliProvider !== 'claude-code' && ` · ${w.cliProvider}`}
                      </div>
                      {w.description && (
                        <div className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5">
                          {w.description}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Tasks Section */}
        <div className="border-b border-border dark:border-dark-border">
          <button
            onClick={() => toggleSection('tasks')}
            className="w-full flex items-center justify-between p-4 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-text-primary dark:text-dark-text-primary">
              <Layers className="w-4 h-4" />
              Tasks ({tasks.length})
            </span>
            {expandedSection === 'tasks' ? (
              <ChevronDown className="w-4 h-4 text-text-tertiary" />
            ) : (
              <ChevronRight className="w-4 h-4 text-text-tertiary" />
            )}
          </button>
          {expandedSection === 'tasks' && (
            <div className="px-4 pb-4">
              {/* Status filter */}
              <div className="flex items-center gap-1 mb-3">
                {['', 'queued', 'running', 'completed', 'failed'].map((s) => (
                  <button
                    key={s}
                    onClick={() => setTaskFilter(s)}
                    className={`px-2 py-1 text-xs rounded-md ${
                      taskFilter === s
                        ? 'bg-primary text-white'
                        : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                    }`}
                  >
                    {s || 'All'}
                  </button>
                ))}
              </div>

              {tasksLoading ? (
                <div className="text-center py-4 text-sm text-text-tertiary dark:text-dark-text-tertiary">
                  Loading...
                </div>
              ) : tasks.length === 0 ? (
                <div className="text-center py-4 text-sm text-text-tertiary dark:text-dark-text-tertiary">
                  No tasks yet
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {tasks.map((task) => {
                    const isExpanded = expandedTaskId === task.id;
                    return (
                      <div
                        key={task.id}
                        className="rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary"
                      >
                        <button
                          className="w-full p-2 text-left"
                          onClick={() => setExpandedTaskId(isExpanded ? null : task.id)}
                        >
                          <div className="flex items-center gap-2">
                            {task.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />}
                            {task.status === 'running' && <Activity className="w-3.5 h-3.5 text-info flex-shrink-0 animate-pulse" />}
                            {task.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-error flex-shrink-0" />}
                            {task.status === 'queued' && <Clock className="w-3.5 h-3.5 text-warning flex-shrink-0" />}
                            {task.status === 'cancelled' && <X className="w-3.5 h-3.5 text-text-tertiary flex-shrink-0" />}
                            <span className="text-sm text-text-primary dark:text-dark-text-primary truncate flex-1">
                              {task.title}
                            </span>
                            <span className={`text-xs ${getTaskStatusColor(task.status)}`}>
                              {task.status}
                            </span>
                            {isExpanded
                              ? <ChevronDown className="w-3 h-3 text-text-tertiary" />
                              : <ChevronRight className="w-3 h-3 text-text-tertiary" />
                            }
                          </div>
                        </button>

                        {/* Expanded task details */}
                        {isExpanded && (
                          <div className="px-2 pb-2 space-y-1.5 border-t border-border/50 dark:border-dark-border/50 pt-1.5">
                            {task.description && (
                              <p className="text-xs text-text-secondary dark:text-dark-text-secondary">
                                {task.description}
                              </p>
                            )}
                            {task.assignedWorker && (
                              <div className="text-xs text-text-tertiary dark:text-dark-text-tertiary">
                                Worker: <span className="text-text-secondary dark:text-dark-text-secondary">{task.assignedWorker}</span>
                              </div>
                            )}
                            <div className="flex items-center gap-3 text-xs text-text-tertiary dark:text-dark-text-tertiary">
                              {task.startedAt && <span>Started: {new Date(task.startedAt).toLocaleTimeString()}</span>}
                              {task.completedAt && <span>Done: {new Date(task.completedAt).toLocaleTimeString()}</span>}
                              {task.startedAt && task.completedAt && (
                                <span>{((new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / 1000).toFixed(1)}s</span>
                              )}
                              <span>Retries: {task.retries}/{task.maxRetries}</span>
                            </div>
                            {task.output && (
                              <div>
                                <div className="text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-0.5">Output:</div>
                                <pre className="text-xs text-text-primary dark:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono">
                                  {task.output}
                                </pre>
                              </div>
                            )}
                            {task.error && (
                              <div>
                                <div className="text-xs font-medium text-error mb-0.5">Error:</div>
                                <pre className="text-xs text-error bg-error/5 rounded p-2 max-h-20 overflow-auto whitespace-pre-wrap break-words font-mono">
                                  {task.error}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Execution History Section */}
        <div className="border-b border-border dark:border-dark-border">
          <button
            onClick={() => toggleSection('history')}
            className="w-full flex items-center justify-between p-4 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-text-primary dark:text-dark-text-primary">
              <RefreshCw className="w-4 h-4" />
              Execution History ({historyTotal})
            </span>
            {expandedSection === 'history' ? (
              <ChevronDown className="w-4 h-4 text-text-tertiary" />
            ) : (
              <ChevronRight className="w-4 h-4 text-text-tertiary" />
            )}
          </button>
          {expandedSection === 'history' && (
            <div className="px-4 pb-4">
              {historyLoading ? (
                <div className="text-center py-4 text-sm text-text-tertiary dark:text-dark-text-tertiary">
                  Loading...
                </div>
              ) : history.length === 0 ? (
                <div className="text-center py-4 text-sm text-text-tertiary dark:text-dark-text-tertiary">
                  No execution history yet
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {history.map((entry, idx) => {
                    const Icon = getWorkerTypeIcon(entry.workerType);
                    return (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {entry.success
                            ? <CheckCircle2 className="w-3.5 h-3.5 text-success flex-shrink-0" />
                            : <XCircle className="w-3.5 h-3.5 text-error flex-shrink-0" />
                          }
                          <Icon className="w-3 h-3 text-text-tertiary" />
                          <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate flex-1">
                            {entry.workerName}
                          </span>
                          <span className="text-xs text-text-tertiary dark:text-dark-text-tertiary">
                            {(entry.durationMs / 1000).toFixed(1)}s
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-text-tertiary dark:text-dark-text-tertiary ml-5">
                          <span>{entry.workerType}</span>
                          {entry.costUsd != null && entry.costUsd > 0 && (
                            <span>{formatCost(entry.costUsd)}</span>
                          )}
                          {entry.tokensUsed && (
                            <span>{entry.tokensUsed.prompt + entry.tokensUsed.completion} tok</span>
                          )}
                          <span>{new Date(entry.executedAt).toLocaleTimeString()}</span>
                        </div>
                        {entry.output && (
                          <pre className="text-xs text-text-secondary dark:text-dark-text-secondary bg-bg-tertiary dark:bg-dark-bg-tertiary rounded p-1.5 mt-1.5 ml-5 max-h-24 overflow-auto whitespace-pre-wrap break-words font-mono line-clamp-4">
                            {entry.output.slice(0, 500)}
                          </pre>
                        )}
                        {entry.error && (
                          <p className="text-xs text-error mt-1 ml-5 truncate">{entry.error}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live Activity Feed */}
        {activityLog.length > 0 && (
          <div className="border-b border-border dark:border-dark-border">
            <button
              onClick={() => toggleSection('activity')}
              className="w-full flex items-center justify-between p-4 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
            >
              <span className="flex items-center gap-2 text-sm font-medium text-text-primary dark:text-dark-text-primary">
                <Activity className="w-4 h-4" />
                Live Activity ({activityLog.length})
              </span>
              {expandedSection === 'activity' ? (
                <ChevronDown className="w-4 h-4 text-text-tertiary" />
              ) : (
                <ChevronRight className="w-4 h-4 text-text-tertiary" />
              )}
            </button>
            {expandedSection === 'activity' && (
              <div className="px-4 pb-4 max-h-48 overflow-y-auto">
                <div className="space-y-1">
                  {activityLog.map((entry, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-xs">
                      <span className="text-text-tertiary dark:text-dark-text-tertiary whitespace-nowrap font-mono">
                        {entry.time}
                      </span>
                      <span className={
                        entry.type === 'success' ? 'text-success' :
                        entry.type === 'error' ? 'text-error' :
                        'text-text-secondary dark:text-dark-text-secondary'
                      }>
                        {entry.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="p-4">
          <div className="flex items-center gap-2 text-xs text-text-tertiary dark:text-dark-text-tertiary">
            <Clock className="w-3 h-3" />
            Created {new Date(fleet.createdAt).toLocaleDateString()}
            {fleet.session?.startedAt && (
              <>
                {' / Started '}
                {new Date(fleet.session.startedAt).toLocaleString()}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Fleet Card */
function FleetCard({
  fleet,
  onAction,
  onSelect,
}: {
  fleet: FleetConfig;
  onAction: (action: string, fleet: FleetConfig) => void;
  onSelect: (fleet: FleetConfig) => void;
}) {
  const state = fleet.session?.state ?? null;
  const isRunning = state === 'running';
  const isPaused = state === 'paused';

  return (
    <div
      className="rounded-xl border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary hover:border-primary/30 transition-colors cursor-pointer"
      onClick={() => onSelect(fleet)}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary truncate">
              {fleet.name}
            </h3>
            <p className="text-xs text-text-tertiary dark:text-dark-text-tertiary line-clamp-2 mt-0.5">
              {fleet.mission}
            </p>
          </div>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ml-2 flex-shrink-0 ${getStateBadge(state)}`}
          >
            {isRunning && (
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-success" />
              </span>
            )}
            {state ?? 'idle'}
          </span>
        </div>

        {/* Workers */}
        <div className="flex flex-wrap gap-1 mb-3">
          {fleet.workers.map((w, idx) => {
            const Icon = getWorkerTypeIcon(w.type);
            const colorClass = getWorkerTypeColor(w.type);
            return (
              <span
                key={idx}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded border ${colorClass}`}
                title={`${w.name} (${getWorkerTypeLabel(w.type)})`}
              >
                <Icon className="w-3 h-3" />
                {w.name}
              </span>
            );
          })}
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-text-tertiary dark:text-dark-text-tertiary mb-2">
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {getScheduleLabel(fleet.scheduleType)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Gauge className="w-3 h-3" />
            {fleet.concurrencyLimit} max
          </span>
        </div>

        {/* Stats */}
        {fleet.session && (
          <div className="grid grid-cols-4 gap-1 text-center">
            <div>
              <div className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                {fleet.session.cyclesCompleted}
              </div>
              <div className="text-[10px] text-text-tertiary dark:text-dark-text-tertiary">cycles</div>
            </div>
            <div>
              <div className="text-xs font-medium text-success">{fleet.session.tasksCompleted}</div>
              <div className="text-[10px] text-text-tertiary dark:text-dark-text-tertiary">done</div>
            </div>
            <div>
              <div className="text-xs font-medium text-error">{fleet.session.tasksFailed}</div>
              <div className="text-[10px] text-text-tertiary dark:text-dark-text-tertiary">failed</div>
            </div>
            <div>
              <div className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
                {formatCost(fleet.session.totalCostUsd)}
              </div>
              <div className="text-[10px] text-text-tertiary dark:text-dark-text-tertiary">cost</div>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div
        className="flex items-center border-t border-border dark:border-dark-border"
        onClick={(e) => e.stopPropagation()}
      >
        {!isRunning && !isPaused && (
          <button
            onClick={() => onAction('start', fleet)}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-success hover:bg-success/5"
            title="Start"
          >
            <Play className="w-3.5 h-3.5" /> Start
          </button>
        )}
        {isRunning && (
          <>
            <button
              onClick={() => onAction('pause', fleet)}
              className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-warning hover:bg-warning/5"
              title="Pause"
            >
              <Pause className="w-3.5 h-3.5" /> Pause
            </button>
            <button
              onClick={() => onAction('stop', fleet)}
              className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-error hover:bg-error/5 border-l border-border dark:border-dark-border"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
          </>
        )}
        {isPaused && (
          <>
            <button
              onClick={() => onAction('resume', fleet)}
              className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-success hover:bg-success/5"
              title="Resume"
            >
              <Play className="w-3.5 h-3.5" /> Resume
            </button>
            <button
              onClick={() => onAction('stop', fleet)}
              className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-error hover:bg-error/5 border-l border-border dark:border-dark-border"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" /> Stop
            </button>
          </>
        )}
        <button
          onClick={() => onAction('addTasks', fleet)}
          className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-primary hover:bg-primary/5 border-l border-border dark:border-dark-border"
          title="Add Tasks"
        >
          <Plus className="w-3.5 h-3.5" /> Tasks
        </button>
        {isRunning && (
          <button
            onClick={() => onAction('broadcast', fleet)}
            className="flex-1 flex items-center justify-center gap-1 py-2 text-xs text-info hover:bg-info/5 border-l border-border dark:border-dark-border"
            title="Broadcast"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={() => onAction('delete', fleet)}
          className="flex items-center justify-center py-2 px-3 text-xs text-error hover:bg-error/5 border-l border-border dark:border-dark-border"
          title="Delete"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Main Page
// =============================================================================

type TabId = 'home' | 'fleets';

const TAB_LABELS: Record<TabId, string> = {
  home: 'Home',
  fleets: 'Fleets',
};

export function FleetPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useDialog();

  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId =
    tabParam && (['home', 'fleets'] as string[]).includes(tabParam) ? tabParam : 'home';
  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  const [fleets, setFleets] = useState<FleetConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedFleet, setSelectedFleet] = useState<FleetConfig | null>(null);
  const [addTasksFleet, setAddTasksFleet] = useState<FleetConfig | null>(null);
  const [broadcastFleet, setBroadcastFleet] = useState<FleetConfig | null>(null);

  const loadFleets = useCallback(async () => {
    try {
      const result = await fleetApi.list();
      setFleets(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load fleets');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFleets();
  }, [loadFleets]);

  // Auto-refresh via WebSocket events
  const { subscribe } = useGateway();
  useEffect(() => {
    const unsubs = [
      subscribe('fleet:cycle:end', loadFleets),
      subscribe('fleet:started', loadFleets),
      subscribe('fleet:stopped', loadFleets),
      subscribe('fleet:paused', loadFleets),
      subscribe('fleet:resumed', loadFleets),
      subscribe('fleet:worker:completed', loadFleets),
    ];
    return () => unsubs.forEach((u) => u());
  }, [subscribe, loadFleets]);

  // Poll every 10s for running fleets
  useEffect(() => {
    const hasRunning = fleets.some((f) => f.session?.state === 'running');
    if (!hasRunning) return;
    const timer = setInterval(loadFleets, 10_000);
    return () => clearInterval(timer);
  }, [fleets, loadFleets]);

  const handleAction = async (action: string, fleet: FleetConfig) => {
    try {
      switch (action) {
        case 'start':
          await fleetApi.start(fleet.id);
          toast.success(`Fleet "${fleet.name}" started`);
          break;
        case 'pause':
          await fleetApi.pause(fleet.id);
          toast.success(`Fleet "${fleet.name}" paused`);
          break;
        case 'resume':
          await fleetApi.resume(fleet.id);
          toast.success(`Fleet "${fleet.name}" resumed`);
          break;
        case 'stop':
          await fleetApi.stop(fleet.id);
          toast.success(`Fleet "${fleet.name}" stopped`);
          break;
        case 'addTasks':
          setAddTasksFleet(fleet);
          return;
        case 'broadcast':
          setBroadcastFleet(fleet);
          return;
        case 'delete': {
          const ok = await confirm({
            title: 'Delete Fleet',
            message: `Delete "${fleet.name}" and all its tasks? This cannot be undone.`,
            confirmText: 'Delete',
            variant: 'danger',
          });
          if (!ok) return;
          await fleetApi.delete(fleet.id);
          toast.success(`Fleet "${fleet.name}" deleted`);
          if (selectedFleet?.id === fleet.id) setSelectedFleet(null);
          break;
        }
      }
      loadFleets();
    } catch (err) {
      toast.error(`Action failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const filteredFleets = searchQuery
    ? fleets.filter(
        (f) =>
          f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          f.mission.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : fleets;

  const runningCount = fleets.filter((f) => f.session?.state === 'running').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Fleet Command
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            {fleets.length} fleet{fleets.length !== 1 ? 's' : ''} configured
            {runningCount > 0 && ` · ${runningCount} running`}
          </p>
        </div>
        <button
          onClick={() => {
            setTab('fleets');
            setShowCreate(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Fleet
        </button>
      </header>

      {/* Tab Bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'fleets'] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Home Tab */}
      {activeTab === 'home' && (
        <PageHomeTab
          heroIcons={[
            { icon: Layers, color: 'text-primary bg-primary/10' },
            { icon: Bot, color: 'text-violet-500 bg-violet-500/10' },
            { icon: Terminal, color: 'text-cyan-500 bg-cyan-500/10' },
          ]}
          title="Coordinated Agent Armies"
          subtitle="Deploy fleets of AI workers that run in the background — coding agents, research bots, data processors, and monitors — all coordinated from a single command center."
          cta={{
            label: 'New Fleet',
            icon: Plus,
            onClick: () => {
              setTab('fleets');
              setShowCreate(true);
            },
          }}
          features={[
            {
              icon: Users,
              color: 'text-primary bg-primary/10',
              title: '4 Worker Types',
              description:
                'AI Chat (full 250+ tools), Coding CLI (Claude Code, Codex, Gemini), API Call (lightweight), and MCP Bridge (external services).',
            },
            {
              icon: Zap,
              color: 'text-amber-500 bg-amber-500/10',
              title: '5 Schedule Modes',
              description:
                'Run on-demand, continuously, on intervals, via cron, or triggered by events.',
            },
            {
              icon: Brain,
              color: 'text-violet-500 bg-violet-500/10',
              title: 'Task Queue',
              description:
                'Add tasks to the queue with priorities. Workers pick tasks automatically and report results.',
            },
            {
              icon: Activity,
              color: 'text-emerald-500 bg-emerald-500/10',
              title: 'Real-Time Monitoring',
              description:
                'Track cycles, costs, task completion, and worker status with live WebSocket updates.',
            },
          ]}
          steps={[
            {
              title: 'Create a fleet',
              detail: 'Click "New Fleet" and pick a template or start from scratch.',
            },
            {
              title: 'Configure workers',
              detail:
                'Add workers with different types — AI Chat for complex reasoning, Coding CLI for code tasks, API Call for lightweight ops.',
            },
            {
              title: 'Add tasks to the queue',
              detail: 'Describe what each worker should do. Set priorities and dependencies.',
            },
            {
              title: 'Start and monitor',
              detail:
                'Hit start and watch your fleet execute tasks in parallel. Track progress in real-time.',
            },
          ]}
          quickActions={[
            {
              icon: Terminal,
              label: 'Code Review Army',
              description: 'Automated code review with AI reviewers and CLI fixers',
              onClick: () => {
                setTab('fleets');
                setShowCreate(true);
              },
            },
            {
              icon: Globe,
              label: 'Research Squad',
              description: 'Multi-agent research team with analysis and synthesis',
              onClick: () => {
                setTab('fleets');
                setShowCreate(true);
              },
            },
            {
              icon: Activity,
              label: 'System Monitor',
              description: 'Continuous health checks and auto-remediation',
              onClick: () => {
                setTab('fleets');
                setShowCreate(true);
              },
            },
          ]}
          infoBox={{
            icon: Layers,
            title: 'Built on Top of Existing Services',
            description:
              'Fleet workers reuse the same engines as background agents, coding agents, and MCP servers. No new infrastructure needed — just orchestration.',
            color: 'blue',
          }}
        />
      )}

      {/* Fleets Tab */}
      {activeTab === 'fleets' && (
        <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
          {/* Summary bar */}
          <div className="flex items-center gap-4 mb-4">
            <div className="flex items-center gap-2 text-sm text-text-secondary dark:text-dark-text-secondary">
              <Layers className="w-4 h-4" />
              <span>{fleets.length} fleet{fleets.length !== 1 ? 's' : ''}</span>
            </div>
            {runningCount > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-success">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-success" />
                </span>
                {runningCount} running
              </div>
            )}
            <div className="flex-1" />
            <button
              onClick={loadFleets}
              className="p-2 rounded-lg border border-border dark:border-dark-border hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4 text-text-secondary dark:text-dark-text-secondary" />
            </button>
          </div>

          {/* Search */}
          {fleets.length > 0 && (
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search fleets..."
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary text-sm"
              />
            </div>
          )}

          {/* Fleet Grid */}
          {isLoading ? (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-48 rounded-xl border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary animate-pulse"
                />
              ))}
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 p-4 rounded-lg bg-error/10 text-error">
              <AlertCircle className="w-5 h-5 flex-shrink-0" />
              <span className="text-sm">{error}</span>
            </div>
          ) : filteredFleets.length === 0 && searchQuery ? (
            <div className="text-center py-12">
              <Search className="w-10 h-10 mx-auto text-text-tertiary dark:text-dark-text-tertiary mb-3 opacity-40" />
              <p className="text-text-secondary dark:text-dark-text-secondary">
                No fleets match "{searchQuery}"
              </p>
            </div>
          ) : fleets.length === 0 ? (
            <div className="text-center py-12">
              <Layers className="w-10 h-10 mx-auto text-text-tertiary dark:text-dark-text-tertiary mb-3 opacity-40" />
              <p className="text-text-secondary dark:text-dark-text-secondary">
                No fleets yet. Create one to get started.
              </p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-primary text-white hover:bg-primary/90"
              >
                <Plus className="w-4 h-4" /> New Fleet
              </button>
            </div>
          ) : (
            <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
              {filteredFleets.map((fleet) => (
                <FleetCard
                  key={fleet.id}
                  fleet={fleet}
                  onAction={handleAction}
                  onSelect={setSelectedFleet}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <CreateFleetModal onClose={() => setShowCreate(false)} onCreated={loadFleets} />
      )}
      {addTasksFleet && (
        <AddTasksModal
          fleet={addTasksFleet}
          onClose={() => setAddTasksFleet(null)}
          onAdded={loadFleets}
        />
      )}
      {broadcastFleet && (
        <BroadcastModal fleet={broadcastFleet} onClose={() => setBroadcastFleet(null)} />
      )}
      {selectedFleet && (
        <FleetDetailPanel
          fleet={selectedFleet}
          onClose={() => setSelectedFleet(null)}
          onAction={handleAction}
        />
      )}
    </div>
  );
}
