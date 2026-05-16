import { useState, useEffect } from 'react';
import { useToast } from '../../components/ToastProvider';
import { fleetApi } from '../../api/endpoints/fleet';
import type {
  CreateFleetInput,
  FleetScheduleType,
  FleetWorkerType,
} from '../../api/endpoints/fleet';
import { fileWorkspacesApi } from '../../api/endpoints/misc';
import { silentCatch } from '../../utils/ignore-error';
import type { FileWorkspaceInfo } from '../../api/types/workspace';
import {
  Plus,
  Bot,
  Terminal,
  Globe,
  Activity,
  Users,
  ChevronDown,
  ChevronRight,
  X,
} from '../../components/icons';
import { getWorkerTypeIcon, getScheduleLabel } from './utils';

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
      {
        name: 'reviewer',
        type: 'ai-chat',
        description: 'Analyzes code for bugs, security, and best practices',
      },
      {
        name: 'fixer',
        type: 'coding-cli',
        description: 'Applies automated fixes using Claude Code',
      },
      {
        name: 'reporter',
        type: 'api-call',
        description: 'Summarizes findings into a concise report',
      },
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
      {
        name: 'researcher',
        type: 'ai-chat',
        description: 'Deep research using web browsing and memory tools',
      },
      {
        name: 'analyst',
        type: 'ai-chat',
        description: 'Analyzes data patterns and draws conclusions',
      },
      {
        name: 'fact-checker',
        type: 'api-call',
        description: 'Verifies claims and cross-references sources',
      },
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
      {
        name: 'drafter',
        type: 'ai-chat',
        description: 'Creates initial content drafts with research',
      },
      { name: 'editor', type: 'api-call', description: 'Refines tone, clarity, and grammar' },
      {
        name: 'seo-optimizer',
        type: 'api-call',
        description: 'Optimizes for search engines and readability',
      },
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
      {
        name: 'health-checker',
        type: 'mcp-bridge',
        description: 'Pings services and checks health endpoints',
      },
      {
        name: 'log-analyzer',
        type: 'ai-chat',
        description: 'Analyzes logs for errors and anomalies',
      },
      {
        name: 'responder',
        type: 'ai-chat',
        description: 'Takes remediation actions when issues detected',
      },
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
      {
        name: 'coder-1',
        type: 'coding-cli',
        description: 'Feature development and implementation',
      },
      {
        name: 'coder-2',
        type: 'coding-cli',
        description: 'Refactoring and code quality improvements',
      },
      { name: 'test-writer', type: 'coding-cli', description: 'Writes unit and integration tests' },
      {
        name: 'doc-writer',
        type: 'coding-cli',
        description: 'Generates and updates documentation',
      },
      {
        name: 'coordinator',
        type: 'ai-chat',
        description: 'Reviews outputs and coordinates between workers',
      },
    ],
  },
];

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
  name: '',
  type: 'ai-chat',
  description: '',
  provider: '',
  model: '',
  systemPrompt: '',
  cliProvider: 'claude-code',
  cwd: '',
  mcpServer: '',
  mcpTools: '',
});

export function CreateFleetModal({
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
  const [workers, setWorkers] = useState<WorkerFormState[]>([emptyWorker()]);
  const [workspaces, setWorkspaces] = useState<FileWorkspaceInfo[]>([]);
  const [expandedWorker, setExpandedWorker] = useState<number | null>(0);

  useEffect(() => {
    fileWorkspacesApi
      .list()
      .then((data) => setWorkspaces(data.workspaces ?? []))
      .catch(silentCatch('createFleet.workspaces'));
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
    setWorkers((prev) => prev.map((w, i) => (i === index ? { ...w, [field]: value } : w)));
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
          cli_provider: w.type === 'coding-cli' ? w.cliProvider || 'claude-code' : undefined,
          cwd: w.cwd.trim() || undefined,
          mcp_server: w.mcpServer.trim() || undefined,
          mcp_tools: w.mcpTools.trim() ? w.mcpTools.split(',').map((t) => t.trim()) : undefined,
        })),
        schedule_type: scheduleType,
        schedule_config:
          scheduleType === 'interval'
            ? { intervalMs }
            : scheduleType === 'cron' && cronExpr.trim()
              ? { cron: cronExpr.trim() }
              : undefined,
        budget:
          maxCostUsd || maxCyclesPerHour || maxTotalCycles
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
      toast.error(
        `Failed to create fleet: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border shadow-xl">
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
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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

            <button
              onClick={() => setStep('form')}
              className="w-full p-3 rounded-xl border border-dashed border-border dark:border-dark-border hover:border-primary/40 text-sm text-text-secondary dark:text-dark-text-secondary hover:text-primary transition-colors flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Start from scratch
            </button>
          </div>
        )}

        {step === 'form' && (
          <>
            <div className="p-4 space-y-4">
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
                    How often to run a new cycle (
                    {intervalMs >= 60000
                      ? `${Math.round(intervalMs / 60000)}m`
                      : `${Math.round(intervalMs / 1000)}s`}
                    )
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
                        <div className="flex items-center gap-2 p-3">
                          <button
                            onClick={() => setExpandedWorker(isExpanded ? null : idx)}
                            className="p-0.5 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded"
                          >
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5 text-text-tertiary" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5 text-text-tertiary" />
                            )}
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
                            <option value="claw">Claw Agent</option>
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

                        {isExpanded && (
                          <div className="px-3 pb-3 space-y-2 border-t border-border dark:border-dark-border pt-2">
                            <input
                              type="text"
                              value={worker.description}
                              onChange={(e) => updateWorker(idx, 'description', e.target.value)}
                              placeholder="What does this worker do?"
                              className="w-full px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary"
                            />

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
                                  onChange={(e) =>
                                    updateWorker(idx, 'systemPrompt', e.target.value)
                                  }
                                  placeholder="System prompt (optional)"
                                  rows={2}
                                  className="w-full px-2 py-1.5 text-sm rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-tertiary resize-none"
                                />
                              </>
                            )}

                            {worker.type === 'coding-cli' && (
                              <>
                                <div className="grid grid-cols-2 gap-2">
                                  <select
                                    value={worker.cliProvider}
                                    onChange={(e) =>
                                      updateWorker(idx, 'cliProvider', e.target.value)
                                    }
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
