/**
 * Model Routing Settings Page
 *
 * Configure per-process AI provider/model routing with optional fallback.
 * Processes: Chat, Telegram, Pulse & Triggers (scheduler shares pulse config).
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { AlertCircle, Check, X, Sparkles } from '../components/icons';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import {
  modelRoutingApi,
  modelsApi,
  type ProcessRouting,
  type ResolvedRouting,
  type RoutingProcess,
} from '../api';
import type { ModelInfo } from '../types';

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
    id: 'telegram',
    label: 'Telegram',
    description: 'Messages received through the Telegram channel',
  },
  {
    id: 'pulse',
    label: 'Pulse & Triggers',
    description: 'Scheduled tasks, trigger actions, and autonomy engine',
  },
];

interface ProcessCardState {
  routing: ProcessRouting;
  resolved: ResolvedRouting;
  isDirty: boolean;
  isSaving: boolean;
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
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [states, setStates] = useState<Record<RoutingProcess, ProcessCardState>>({
    chat: { routing: emptyRouting, resolved: emptyResolved, isDirty: false, isSaving: false },
    telegram: { routing: emptyRouting, resolved: emptyResolved, isDirty: false, isSaving: false },
    pulse: { routing: emptyRouting, resolved: emptyResolved, isDirty: false, isSaving: false },
  });

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
      const [routingData, modelsData] = await Promise.all([
        modelRoutingApi.getAll(),
        modelsApi.list(),
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-error">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  const selectClasses =
    'w-full px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-text-primary dark:text-dark-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-text-primary dark:text-dark-text-primary">
            Model Routing
          </h1>
        </div>
        <p className="mt-2 text-sm text-text-muted dark:text-dark-text-muted">
          Configure which AI provider and model each process uses. Processes without specific
          configuration use the global default. Optionally set a fallback model for automatic
          failover.
        </p>
      </div>

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
                {state.isSaving ? <LoadingSpinner size="sm" /> : <Check className="h-3.5 w-3.5" />}
                Save
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
