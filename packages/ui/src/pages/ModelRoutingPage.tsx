/**
 * Model Routing Settings Page
 *
 * Configure per-process AI provider/model routing with optional fallback.
 * Processes: chat, channels, channel media, pulse, and subagents.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertCircle,
  Check,
  X,
  Home,
  Shuffle,
  Brain,
  Gauge,
  DollarSign,
  Shield,
} from '../components/icons';
import { PageHomeTab } from '../components/PageHomeTab';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import {
  modelRoutingApi,
  modelsApi,
  type ChannelRoutingEntry,
  type ChannelRoutingKind,
  type ProcessRouting,
  type ResolvedRouting,
  type RoutingProcess,
} from '../api';
import type { ModelInfo } from '../types';

type TabId = 'home' | 'routing';

const TAB_LABELS: Record<TabId, string> = {
  home: 'Home',
  routing: 'Routing',
};

const PROCESSES: Array<{
  id: RoutingProcess;
  label: string;
  description: string;
}> = [
  {
    id: 'chat',
    label: 'Web Chat',
    description: 'Chat conversations from the web UI (when user does not explicitly pick a model)',
  },
  {
    id: 'channel',
    label: 'Channels',
    description: 'Messages received through channels (Telegram, Discord, WhatsApp, Slack)',
  },
  {
    id: 'channel_media',
    label: 'Channel Media',
    description: 'Attachment-heavy channel messages such as image, audio, video, and files',
  },
  {
    id: 'pulse',
    label: 'Pulse & Triggers',
    description: 'Scheduled tasks, trigger actions, and autonomy engine',
  },
  {
    id: 'subagent',
    label: 'Subagents',
    description: 'Ephemeral child agents spawned by the chat agent for parallel task delegation',
  },
];

interface ProcessCardState {
  routing: ProcessRouting;
  resolved: ResolvedRouting;
  isDirty: boolean;
  isSaving: boolean;
}

interface ChannelCardState extends ChannelRoutingEntry {
  isDirty: boolean;
  isSaving: boolean;
  isMediaDirty: boolean;
  isMediaSaving: boolean;
}

const emptyRouting: ProcessRouting = {
  provider: null,
  model: null,
  fallbackProvider: null,
  fallbackModel: null,
};

const emptyResolved: ResolvedRouting = {
  ...emptyRouting,
  source: 'global',
};

export function ModelRoutingPage() {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<TabId>('home');

  // Skip home preference from localStorage
  const SKIP_HOME_KEY = 'ownpilot:modelrouting:skipHome';
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Save skip home preference
  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try {
      localStorage.setItem(SKIP_HOME_KEY, String(checked));
    } catch {
      // localStorage might be disabled
    }
  }, []);

  // Auto-redirect to routing if skipHome is enabled
  useEffect(() => {
    if (skipHome) {
      setActiveTab('routing');
    }
  }, [skipHome]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [states, setStates] = useState<Record<RoutingProcess, ProcessCardState>>({
    chat: { routing: emptyRouting, resolved: emptyResolved, isDirty: false, isSaving: false },
    channel: { routing: emptyRouting, resolved: emptyResolved, isDirty: false, isSaving: false },
    channel_media: {
      routing: emptyRouting,
      resolved: emptyResolved,
      isDirty: false,
      isSaving: false,
    },
    pulse: { routing: emptyRouting, resolved: emptyResolved, isDirty: false, isSaving: false },
    subagent: { routing: emptyRouting, resolved: emptyResolved, isDirty: false, isSaving: false },
  });
  const [channelStates, setChannelStates] = useState<Record<string, ChannelCardState>>({});

  // Derived: unique configured provider list for dropdowns
  const providerOptions = useMemo(() => {
    const providerIds = new Set<string>();
    for (const m of models) {
      if (configuredProviders.includes(m.provider)) {
        providerIds.add(m.provider);
      }
    }
    return Array.from(providerIds).sort();
  }, [models, configuredProviders]);

  // Load data
  const loadData = useCallback(async () => {
    try {
      setError(null);
      const [routingData, modelsData, channelRoutingData] = await Promise.all([
        modelRoutingApi.getAll(),
        modelsApi.list(),
        modelRoutingApi.getChannels(),
      ]);

      setModels(modelsData.models);
      setConfiguredProviders(modelsData.configuredProviders);

      const newStates = {} as Record<RoutingProcess, ProcessCardState>;
      for (const p of PROCESSES) {
        newStates[p.id] = {
          routing: routingData.routing[p.id] ?? emptyRouting,
          resolved: routingData.resolved[p.id] ?? emptyResolved,
          isDirty: false,
          isSaving: false,
        };
      }
      setStates(newStates);

      const nextChannelStates: Record<string, ChannelCardState> = {};
      for (const channel of channelRoutingData.channels) {
        nextChannelStates[channel.pluginId] = {
          ...channel,
          isDirty: false,
          isSaving: false,
          isMediaDirty: false,
          isMediaSaving: false,
        };
      }
      setChannelStates(nextChannelStates);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model routing data');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update a field in the local form state
  const updateField = useCallback(
    (process: RoutingProcess, field: keyof ProcessRouting, value: string | null) => {
      setStates((prev) => ({
        ...prev,
        [process]: {
          ...prev[process],
          routing: { ...prev[process].routing, [field]: value || null },
          isDirty: true,
        },
      }));
    },
    []
  );

  const updateChannelField = useCallback(
    (
      pluginId: string,
      kind: ChannelRoutingKind,
      field: keyof ProcessRouting,
      value: string | null
    ) => {
      setChannelStates((prev) => {
        const current = prev[pluginId];
        if (!current) return prev;
        return {
          ...prev,
          [pluginId]:
            kind === 'media'
              ? {
                  ...current,
                  mediaRouting: { ...current.mediaRouting, [field]: value || null },
                  isMediaDirty: true,
                }
              : {
                  ...current,
                  routing: { ...current.routing, [field]: value || null },
                  isDirty: true,
                },
        };
      });
    },
    []
  );

  // Save routing for a process
  const handleSave = useCallback(
    async (process: RoutingProcess) => {
      setStates((prev) => ({
        ...prev,
        [process]: { ...prev[process], isSaving: true },
      }));

      try {
        const result = await modelRoutingApi.update(process, states[process].routing);
        setStates((prev) => ({
          ...prev,
          [process]: {
            routing: result.routing,
            resolved: result.resolved,
            isDirty: false,
            isSaving: false,
          },
        }));
        toast.success('Routing saved');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save routing');
        setStates((prev) => ({
          ...prev,
          [process]: { ...prev[process], isSaving: false },
        }));
      }
    },
    [states, toast]
  );

  // Clear routing for a process (revert to global default)
  const handleClear = useCallback(
    async (process: RoutingProcess) => {
      try {
        await modelRoutingApi.clear(process);
        // Refresh to get new resolved values
        const result = await modelRoutingApi.get(process);
        setStates((prev) => ({
          ...prev,
          [process]: {
            routing: result.routing,
            resolved: result.resolved,
            isDirty: false,
            isSaving: false,
          },
        }));
        toast.success('Routing cleared — using global default');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to clear routing');
      }
    },
    [toast]
  );

  const handleChannelSave = useCallback(
    async (pluginId: string, kind: ChannelRoutingKind = 'default') => {
      setChannelStates((prev) => {
        const current = prev[pluginId];
        if (!current) return prev;
        return {
          ...prev,
          [pluginId]:
            kind === 'media' ? { ...current, isMediaSaving: true } : { ...current, isSaving: true },
        };
      });

      try {
        const current = channelStates[pluginId];
        if (!current) return;
        const result = await modelRoutingApi.updateChannel(
          pluginId,
          kind === 'media' ? current.mediaRouting : current.routing,
          kind
        );
        setChannelStates((prev) => {
          const existing = prev[pluginId];
          if (!existing) return prev;
          return {
            ...prev,
            [pluginId]:
              kind === 'media'
                ? {
                    ...existing,
                    mediaRouting: result.routing,
                    mediaResolved: result.resolved,
                    isMediaDirty: false,
                    isMediaSaving: false,
                  }
                : {
                    ...existing,
                    routing: result.routing,
                    resolved: result.resolved,
                    isDirty: false,
                    isSaving: false,
                  },
          };
        });
        toast.success('Channel routing saved');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to save channel routing');
        setChannelStates((prev) => {
          const existing = prev[pluginId];
          if (!existing) return prev;
          return {
            ...prev,
            [pluginId]:
              kind === 'media'
                ? { ...existing, isMediaSaving: false }
                : { ...existing, isSaving: false },
          };
        });
      }
    },
    [channelStates, toast]
  );

  const handleChannelClear = useCallback(
    async (pluginId: string, kind: ChannelRoutingKind = 'default') => {
      try {
        await modelRoutingApi.clearChannel(pluginId, kind);
        const result = await modelRoutingApi.getChannel(pluginId, kind);
        setChannelStates((prev) => {
          const existing = prev[pluginId];
          if (!existing) return prev;
          return {
            ...prev,
            [pluginId]:
              kind === 'media'
                ? {
                    ...existing,
                    mediaRouting: result.routing,
                    mediaResolved: result.resolved,
                    isMediaDirty: false,
                    isMediaSaving: false,
                  }
                : {
                    ...existing,
                    routing: result.routing,
                    resolved: result.resolved,
                    isDirty: false,
                    isSaving: false,
                  },
          };
        });
        toast.success('Channel routing cleared');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to clear channel routing');
      }
    },
    [toast]
  );

  // Get models for a specific provider
  const getModelsForProvider = useCallback(
    (provider: string | null) => {
      if (!provider) return [];
      return models
        .filter((m) => m.provider === provider && configuredProviders.includes(m.provider))
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    [models, configuredProviders]
  );

  const selectClasses =
    'w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Model Routing
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Configure which AI provider and model each process uses. Processes without specific
            configuration use the global default. Optionally set a fallback model for automatic
            failover.
          </p>
        </div>
      </header>

      {/* Tab bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'routing'] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
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

      {/* Home tab */}
      {activeTab === 'home' && (
        <div className="flex-1 overflow-y-auto">
          <PageHomeTab
            heroIcons={[
              { icon: Shuffle, color: 'text-primary bg-primary/10' },
              { icon: Brain, color: 'text-violet-500 bg-violet-500/10' },
              { icon: Gauge, color: 'text-emerald-500 bg-emerald-500/10' },
            ]}
            title="Smart Model Routing"
            subtitle="Route AI requests to the right model based on task complexity, cost limits, or custom rules. Optimize for speed, quality, or budget."
            cta={{ label: 'View Routes', icon: Shuffle, onClick: () => setActiveTab('routing') }}
            skipHomeChecked={skipHome}
            onSkipHomeChange={handleSkipHomeChange}
            skipHomeLabel="Skip this screen and go directly to Routing"
            features={[
              {
                icon: Shuffle,
                color: 'text-blue-500 bg-blue-500/10',
                title: 'Rule-Based Routing',
                description:
                  'Route each process to a specific provider and model, or let it fall back to the global default.',
              },
              {
                icon: DollarSign,
                color: 'text-purple-500 bg-purple-500/10',
                title: 'Cost Optimization',
                description:
                  'Assign cheaper models to simple tasks and reserve powerful models for complex reasoning.',
              },
              {
                icon: Shield,
                color: 'text-emerald-500 bg-emerald-500/10',
                title: 'Fallback Chains',
                description:
                  'Set a fallback provider and model for automatic failover when the primary is unavailable.',
              },
              {
                icon: Gauge,
                color: 'text-orange-500 bg-orange-500/10',
                title: 'Performance Metrics',
                description:
                  'See which provider and model each process resolves to — process-level or global default.',
              },
            ]}
            steps={[
              {
                title: 'Define routing rules',
                detail:
                  'Choose a provider and model for each process — chat, channels, pulse, subagents.',
              },
              {
                title: 'Set model preferences',
                detail: 'Pick from your configured providers and their available models.',
              },
              {
                title: 'Configure fallbacks',
                detail: 'Add a fallback provider and model for automatic failover.',
              },
              {
                title: 'Monitor performance',
                detail: 'Check the effective routing for each process and adjust as needed.',
              },
            ]}
            quickActions={[
              {
                icon: Shuffle,
                label: 'Manage Routes',
                description: 'Configure provider and model routing per process',
                onClick: () => setActiveTab('routing'),
              },
            ]}
          />
        </div>
      )}

      {/* Routing tab content */}
      {activeTab === 'routing' && isLoading && (
        <div className="flex items-center justify-center py-20">
          <LoadingSpinner size="md" />
        </div>
      )}

      {activeTab === 'routing' && !isLoading && error && (
        <div className="p-6">
          <div className="flex items-center gap-2 text-error">
            <AlertCircle className="h-5 w-5" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {activeTab === 'routing' && !isLoading && !error && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-6 p-6">
            {/* Process Cards */}
            {PROCESSES.map((proc) => {
              const state = states[proc.id];
              const hasProcessConfig = state.routing.provider || state.routing.model;
              const resolvedSource = state.resolved.source;

              return (
                <div
                  key={proc.id}
                  className="rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary p-5"
                >
                  {/* Card Header */}
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                        {proc.label}
                      </h2>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted">
                        {proc.description}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        resolvedSource === 'process'
                          ? 'bg-primary/10 text-primary'
                          : 'bg-gray-500/20 text-gray-600 dark:text-gray-400'
                      }`}
                    >
                      {resolvedSource === 'process' ? 'Process Config' : 'Global Default'}
                    </span>
                  </div>

                  {/* Primary Model */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
                      Primary Model
                    </label>
                    <div className="flex gap-3">
                      <select
                        className={selectClasses}
                        value={state.routing.provider ?? ''}
                        onChange={(e) => {
                          updateField(proc.id, 'provider', e.target.value);
                          updateField(proc.id, 'model', null);
                        }}
                      >
                        <option value="">Default (global)</option>
                        {providerOptions.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <select
                        className={selectClasses}
                        value={state.routing.model ?? ''}
                        onChange={(e) => updateField(proc.id, 'model', e.target.value)}
                      >
                        <option value="">Default</option>
                        {getModelsForProvider(state.routing.provider).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Fallback Model */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
                      Fallback Model{' '}
                      <span className="font-normal text-text-muted dark:text-dark-text-muted">
                        (automatic failover)
                      </span>
                    </label>
                    <div className="flex gap-3">
                      <select
                        className={selectClasses}
                        value={state.routing.fallbackProvider ?? ''}
                        onChange={(e) => {
                          updateField(proc.id, 'fallbackProvider', e.target.value);
                          updateField(proc.id, 'fallbackModel', null);
                        }}
                      >
                        <option value="">None</option>
                        {providerOptions.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                      <select
                        className={selectClasses}
                        value={state.routing.fallbackModel ?? ''}
                        onChange={(e) => updateField(proc.id, 'fallbackModel', e.target.value)}
                        disabled={!state.routing.fallbackProvider}
                      >
                        <option value="">None</option>
                        {getModelsForProvider(state.routing.fallbackProvider).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Resolved Info */}
                  <div className="mb-4 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary px-3 py-2">
                    <p className="text-xs text-text-muted dark:text-dark-text-muted">
                      <span className="font-medium text-text-secondary dark:text-dark-text-secondary">
                        Effective:
                      </span>{' '}
                      {state.resolved.provider
                        ? `${state.resolved.provider} / ${state.resolved.model ?? 'default model'}`
                        : 'No provider configured'}
                      {state.resolved.fallbackProvider && (
                        <>
                          {' '}
                          &rarr; fallback: {state.resolved.fallbackProvider} /{' '}
                          {state.resolved.fallbackModel}
                        </>
                      )}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex justify-end gap-2">
                    {hasProcessConfig && (
                      <button
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                        onClick={() => handleClear(proc.id)}
                      >
                        <X className="h-3.5 w-3.5" />
                        Clear
                      </button>
                    )}
                    <button
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => handleSave(proc.id)}
                      disabled={!state.isDirty || state.isSaving}
                    >
                      {state.isSaving ? (
                        <LoadingSpinner size="sm" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                      Save
                    </button>
                  </div>
                </div>
              );
            })}

            {Object.values(channelStates).length > 0 && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                    Per-Channel Overrides
                  </h3>
                  <p className="text-sm text-text-muted dark:text-dark-text-muted">
                    Override routing for a specific channel. Empty values inherit from the shared
                    channel routes above.
                  </p>
                </div>
                {Object.values(channelStates).map((channel) => (
                  <div
                    key={channel.pluginId}
                    className="rounded-xl border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary p-5"
                  >
                    <div className="mb-4">
                      <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
                        {channel.name}
                      </h3>
                      <p className="text-sm text-text-muted dark:text-dark-text-muted">
                        {channel.pluginId} · {channel.platform} · {channel.status}
                      </p>
                    </div>
                    {[
                      {
                        title: 'Messages',
                        kind: 'default' as const,
                        routing: channel.routing,
                        resolved: channel.resolved,
                        isDirty: channel.isDirty,
                        isSaving: channel.isSaving,
                      },
                      {
                        title: 'Media Messages',
                        kind: 'media' as const,
                        routing: channel.mediaRouting,
                        resolved: channel.mediaResolved,
                        isDirty: channel.isMediaDirty,
                        isSaving: channel.isMediaSaving,
                      },
                    ].map((section) => {
                      const hasConfig =
                        section.routing.provider ||
                        section.routing.model ||
                        section.routing.fallbackProvider ||
                        section.routing.fallbackModel;

                      return (
                        <div
                          key={section.kind}
                          className="mb-4 rounded-lg border border-border dark:border-dark-border p-4 last:mb-0"
                        >
                          <div className="mb-3 text-sm font-medium text-text-primary dark:text-dark-text-primary">
                            {section.title}
                          </div>
                          <div className="mb-3 flex gap-3">
                            <select
                              className={selectClasses}
                              value={section.routing.provider ?? ''}
                              onChange={(e) => {
                                updateChannelField(
                                  channel.pluginId,
                                  section.kind,
                                  'provider',
                                  e.target.value
                                );
                                updateChannelField(channel.pluginId, section.kind, 'model', null);
                              }}
                            >
                              <option value="">Inherit</option>
                              {providerOptions.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                            <select
                              className={selectClasses}
                              value={section.routing.model ?? ''}
                              onChange={(e) =>
                                updateChannelField(
                                  channel.pluginId,
                                  section.kind,
                                  'model',
                                  e.target.value
                                )
                              }
                            >
                              <option value="">Default</option>
                              {getModelsForProvider(section.routing.provider).map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="mb-3 flex gap-3">
                            <select
                              className={selectClasses}
                              value={section.routing.fallbackProvider ?? ''}
                              onChange={(e) => {
                                updateChannelField(
                                  channel.pluginId,
                                  section.kind,
                                  'fallbackProvider',
                                  e.target.value
                                );
                                updateChannelField(
                                  channel.pluginId,
                                  section.kind,
                                  'fallbackModel',
                                  null
                                );
                              }}
                            >
                              <option value="">None</option>
                              {providerOptions.map((p) => (
                                <option key={p} value={p}>
                                  {p}
                                </option>
                              ))}
                            </select>
                            <select
                              className={selectClasses}
                              value={section.routing.fallbackModel ?? ''}
                              onChange={(e) =>
                                updateChannelField(
                                  channel.pluginId,
                                  section.kind,
                                  'fallbackModel',
                                  e.target.value
                                )
                              }
                              disabled={!section.routing.fallbackProvider}
                            >
                              <option value="">None</option>
                              {getModelsForProvider(section.routing.fallbackProvider).map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="mb-3 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary px-3 py-2 text-xs text-text-muted dark:text-dark-text-muted">
                            Effective: {section.resolved.provider ?? 'No provider configured'}
                            {section.resolved.model ? ` / ${section.resolved.model}` : ''}
                          </div>
                          <div className="flex justify-end gap-2">
                            {hasConfig && (
                              <button
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border dark:border-dark-border rounded-lg text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
                                onClick={() => handleChannelClear(channel.pluginId, section.kind)}
                              >
                                <X className="h-3.5 w-3.5" />
                                Clear
                              </button>
                            )}
                            <button
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                              onClick={() => handleChannelSave(channel.pluginId, section.kind)}
                              disabled={!section.isDirty || section.isSaving}
                            >
                              {section.isSaving ? (
                                <LoadingSpinner size="sm" />
                              ) : (
                                <Check className="h-3.5 w-3.5" />
                              )}
                              Save
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
