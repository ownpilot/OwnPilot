/**
 * LLM Config Panel — configuration for LLM-type workflow nodes.
 * Supports provider/model selection, system prompt, user message with templates,
 * temperature/max tokens, and custom API key/base URL.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import { X, Trash2, Brain } from '../../icons';
import { providersApi } from '../../../api';
import type { LlmNodeData } from '../LlmNode';
import type { NodeExecutionStatus } from '../../../api/types';
import { OutputTreeBrowser } from '../OutputTreeBrowser';
import { JsonTreeView } from '../JsonTreeView';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import {
  statusBadgeStyles,
  statusIcons,
  RetryTimeoutFields,
  OutputAliasField,
  RetryAttemptsDisplay,
  INPUT_CLS,
} from '../NodeConfigPanel';

export function LlmConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
  className = '',
}: NodeConfigPanelProps) {
  const data = node.data as LlmNodeData;

  const [label, setLabel] = useState(data.label ?? 'LLM');
  const [provider, setProvider] = useState(data.provider ?? '');
  const [model, setModel] = useState(data.model ?? '');
  const [systemPrompt, setSystemPrompt] = useState(data.systemPrompt ?? '');
  const [userMessage, setUserMessage] = useState(data.userMessage ?? '');
  const [temperature, setTemperature] = useState(data.temperature ?? 0.7);
  const [maxTokens, setMaxTokens] = useState(data.maxTokens ?? 4096);
  const [apiKey, setApiKey] = useState(data.apiKey ?? '');
  const [baseUrl, setBaseUrl] = useState(data.baseUrl ?? '');
  const [showAdvanced, setShowAdvanced] = useState(!!data.apiKey || !!data.baseUrl);

  // Available providers from API (with configuration status)
  const [providers, setProviders] = useState<
    Array<{ id: string; name: string; isConfigured: boolean }>
  >([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

  const hasResults = !!(data.executionStatus as string) && data.executionStatus !== 'pending';
  const [activeTab, setActiveTab] = useState<'config' | 'results'>(
    hasResults ? 'results' : 'config'
  );

  // Reset on node change
  useEffect(() => {
    setLabel(data.label ?? 'LLM');
    setProvider(data.provider ?? '');
    setModel(data.model ?? '');
    setSystemPrompt(data.systemPrompt ?? '');
    setUserMessage(data.userMessage ?? '');
    setTemperature(data.temperature ?? 0.7);
    setMaxTokens(data.maxTokens ?? 4096);
    setApiKey(data.apiKey ?? '');
    setBaseUrl(data.baseUrl ?? '');
    setShowAdvanced(!!(data.apiKey ?? data.baseUrl));
    setActiveTab(data.executionStatus && data.executionStatus !== 'pending' ? 'results' : 'config');
  }, [node.id]);

  useEffect(() => {
    if (hasResults) setActiveTab('results');
  }, [hasResults]);

  // Derived: configured providers sorted first
  const configuredProviders = useMemo(() => providers.filter((p) => p.isConfigured), [providers]);
  const isProviderConfigured = useMemo(
    () => configuredProviders.some((p) => p.id === provider),
    [configuredProviders, provider]
  );

  // Fetch available providers
  useEffect(() => {
    let cancelled = false;
    providersApi
      .list()
      .then((resp) => {
        if (cancelled) return;
        const items = resp.providers
          .map((p) => ({
            id: p.id,
            name: p.name ?? p.id,
            isConfigured:
              'isConfigured' in p
                ? !!(p as unknown as Record<string, unknown>).isConfigured
                : false,
          }))
          .filter((p) => p.id);
        setProviders(items);
      })
      .catch(() => {
        /* non-critical */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch models when provider changes, auto-select first if model empty
  useEffect(() => {
    if (!provider) {
      setModels([]);
      return;
    }
    let cancelled = false;
    providersApi
      .models(provider)
      .then((resp) => {
        if (cancelled) return;
        const list = resp.models ?? [];
        setModels(list);
        // Auto-select first model when current model is empty
        const firstModel = list[0];
        if (!model && firstModel) {
          setModel(firstModel.id);
          onUpdate(node.id, { ...data, model: firstModel.id });
        }
      })
      .catch(() => {
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  // Auto-select first configured provider when provider is empty/unconfigured
  useEffect(() => {
    const first = configuredProviders[0];
    if (first && !provider) {
      setProvider(first.id);
      onUpdate(node.id, { ...data, provider: first.id });
    }
  }, [configuredProviders.length]); // only on initial provider load

  // Auto-expand advanced section when provider is not configured (needs manual API key)
  useEffect(() => {
    if (providers.length > 0 && !isProviderConfigured && !apiKey) {
      setShowAdvanced(true);
    }
  }, [isProviderConfigured, providers.length]);

  const pushUpdate = useCallback(
    (partial: Partial<LlmNodeData>) => {
      onUpdate(node.id, { ...data, ...partial });
    },
    [node.id, data, onUpdate]
  );

  // Insert template from output tree
  const injectTemplate = useCallback(
    (template: string) => {
      setUserMessage((prev) => prev + template);
      pushUpdate({ userMessage: userMessage + template });
    },
    [userMessage, pushUpdate]
  );

  // Copy template path to clipboard
  const copyToClipboard = useCallback((template: string) => {
    navigator.clipboard?.writeText(template);
  }, []);

  return (
    <div
      className={`flex flex-col border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary ${className}`}
    >
      {/* Header with tabs */}
      <div className="flex items-center gap-2 p-3 border-b border-border dark:border-dark-border">
        <div className="w-5 h-5 rounded-full bg-indigo-500/20 flex items-center justify-center shrink-0">
          <Brain className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
        </div>
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1 truncate">
          {data.label ?? 'LLM'}
        </h3>
        {hasResults && (
          <div className="flex bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md p-0.5 shrink-0">
            <button
              onClick={() => setActiveTab('config')}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                activeTab === 'config'
                  ? 'bg-bg-primary dark:bg-dark-bg-primary shadow-sm font-medium text-text-primary dark:text-dark-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Config
            </button>
            <button
              onClick={() => setActiveTab('results')}
              className={`px-2.5 py-1 text-[11px] rounded transition-colors ${
                activeTab === 'results'
                  ? 'bg-bg-primary dark:bg-dark-bg-primary shadow-sm font-medium text-text-primary dark:text-dark-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
              }`}
            >
              Results
            </button>
          </div>
        )}
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors shrink-0"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {activeTab === 'results' ? (
        /* ================================================================
         * Results Tab — LLM output viewer
         * ================================================================ */
        <div className="flex-1 overflow-y-auto p-3 space-y-4">
          {/* Status badge + duration */}
          <div className="flex items-center gap-2">
            {(() => {
              const status = data.executionStatus as NodeExecutionStatus;
              const StatusIcon = statusIcons[status];
              return (
                <>
                  <span
                    className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${statusBadgeStyles[status]}`}
                  >
                    {StatusIcon && <StatusIcon className="w-3 h-3" />}
                    {status}
                  </span>
                  {data.executionDuration != null && (
                    <span className="text-xs text-text-muted dark:text-dark-text-muted">
                      {(data.executionDuration as number) < 1000
                        ? `${data.executionDuration}ms`
                        : `${((data.executionDuration as number) / 1000).toFixed(1)}s`}
                    </span>
                  )}
                  {(data.retryAttempts as number) > 0 && (
                    <RetryAttemptsDisplay
                      retryAttempts={data.retryAttempts as number}
                      status={String(data.executionStatus)}
                    />
                  )}
                </>
              );
            })()}
          </div>

          {/* Output */}
          {data.executionOutput !== undefined && data.executionOutput !== null && (
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Output
              </label>
              {typeof data.executionOutput === 'string' ? (
                <pre className="px-3 py-2 text-xs font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md overflow-x-auto max-h-64 overflow-y-auto text-text-primary dark:text-dark-text-primary whitespace-pre-wrap break-words">
                  {data.executionOutput}
                </pre>
              ) : (
                <div className="px-2 py-1.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md max-h-64 overflow-y-auto">
                  <JsonTreeView
                    data={data.executionOutput}
                    pathPrefix={`${node.id}.output`}
                    onClickPath={copyToClipboard}
                  />
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {data.executionError && (
            <div>
              <label className="block text-xs font-medium text-error mb-1">Error</label>
              <pre className="px-3 py-2 text-xs font-mono bg-error/5 border border-error/20 rounded-md overflow-x-auto max-h-32 overflow-y-auto text-error whitespace-pre-wrap break-words">
                {data.executionError as string}
              </pre>
            </div>
          )}

          <div className="pt-2 border-t border-border dark:border-dark-border">
            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
              {provider} / {model}
            </span>
          </div>
        </div>
      ) : (
        /* ================================================================
         * Config Tab
         * ================================================================ */
        <>
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Configured Providers — quick select */}
            {configuredProviders.length > 0 ? (
              <div>
                <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1.5">
                  Your AI Providers
                </label>
                <div className="flex flex-wrap gap-1">
                  {configuredProviders.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setProvider(p.id);
                        setModel('');
                        pushUpdate({ provider: p.id, model: '' });
                      }}
                      className={`px-2 py-1 text-[10px] rounded border transition-colors flex items-center gap-1 ${
                        provider === p.id
                          ? 'bg-indigo-500/20 border-indigo-400 text-indigo-600 dark:text-indigo-400'
                          : 'bg-bg-tertiary dark:bg-dark-bg-tertiary border-border dark:border-dark-border text-text-muted hover:border-indigo-400/50'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-success shrink-0" />
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : providers.length > 0 ? (
              <div className="px-3 py-2 text-xs bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md text-text-muted">
                No AI providers configured. Add API keys in{' '}
                <span className="font-medium">Settings → AI Providers</span>.
              </div>
            ) : null}

            {/* Label */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Label
              </label>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={() => {
                  if (label !== data.label) pushUpdate({ label });
                }}
                className={INPUT_CLS}
              />
            </div>

            {/* Provider */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Provider
              </label>
              {providers.length > 0 ? (
                <select
                  value={provider}
                  onChange={(e) => {
                    const p = e.target.value;
                    setProvider(p);
                    setModel('');
                    pushUpdate({ provider: p, model: '' });
                  }}
                  className={INPUT_CLS}
                >
                  {configuredProviders.length > 0 && (
                    <optgroup label="Configured">
                      {configuredProviders.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Other">
                    {providers
                      .filter((p) => !p.isConfigured)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (no key)
                        </option>
                      ))}
                  </optgroup>
                </select>
              ) : (
                <input
                  type="text"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  onBlur={() => pushUpdate({ provider })}
                  placeholder="openai, anthropic, google..."
                  className={INPUT_CLS}
                />
              )}
              {/* Warning for unconfigured provider */}
              {providers.length > 0 && !isProviderConfigured && provider && (
                <p className="mt-1.5 px-2.5 py-1.5 text-[10px] bg-warning/10 text-warning border border-warning/20 rounded-md">
                  No API key for <span className="font-medium">{provider}</span>. Configure it in
                  Settings → AI Providers, or enter a key below.
                </p>
              )}
            </div>

            {/* Model */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                Model
              </label>
              {models.length > 0 ? (
                <select
                  value={model}
                  onChange={(e) => {
                    setModel(e.target.value);
                    pushUpdate({ model: e.target.value });
                  }}
                  className={INPUT_CLS}
                >
                  <option value="">Select model...</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name || m.id}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  onBlur={() => pushUpdate({ model })}
                  placeholder="gpt-4o, claude-sonnet-4-5-20250514..."
                  className={INPUT_CLS}
                />
              )}
            </div>

            {/* System Prompt */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                System Prompt
              </label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                onBlur={() => pushUpdate({ systemPrompt: systemPrompt || undefined })}
                rows={3}
                className={`${INPUT_CLS} resize-y font-mono text-xs`}
                placeholder="You are a helpful assistant that..."
              />
            </div>

            {/* User Message */}
            <div>
              <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                User Message
                <span className="ml-1 font-normal text-text-muted/60">
                  (supports {'{{nodeId.output}}'} templates)
                </span>
              </label>
              <textarea
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                onBlur={() => pushUpdate({ userMessage })}
                rows={4}
                className={`${INPUT_CLS} resize-y font-mono text-xs`}
                placeholder="Analyze the following data: {{node_1.output}}"
              />
            </div>

            {/* Temperature + Max Tokens */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                  Temperature
                </label>
                <input
                  type="number"
                  value={temperature}
                  onChange={(e) => setTemperature(Number(e.target.value))}
                  onBlur={() => pushUpdate({ temperature })}
                  min={0}
                  max={2}
                  step={0.1}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                  Max Tokens
                </label>
                <input
                  type="number"
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(Number(e.target.value))}
                  onBlur={() => pushUpdate({ maxTokens })}
                  min={1}
                  max={128000}
                  step={256}
                  className={INPUT_CLS}
                />
              </div>
            </div>

            {/* Advanced: custom API key + base URL */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
              >
                {showAdvanced ? 'Hide' : 'Show'} Advanced (API Key, Base URL)
              </button>

              {showAdvanced && (
                <div className="mt-2 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                      Custom API Key
                      <span className="ml-1 font-normal text-text-muted/60">
                        (overrides stored key)
                      </span>
                    </label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      onBlur={() => pushUpdate({ apiKey: apiKey || undefined })}
                      placeholder="sk-..."
                      className={INPUT_CLS}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1">
                      Custom Base URL
                    </label>
                    <input
                      type="text"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      onBlur={() => pushUpdate({ baseUrl: baseUrl || undefined })}
                      placeholder="https://api.example.com/v1"
                      className={INPUT_CLS}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Output tree browser — upstream node outputs */}
            {upstreamNodes.length > 0 && (
              <OutputTreeBrowser upstreamNodes={upstreamNodes} onInsert={injectTemplate} />
            )}
            <OutputAliasField
              data={data as unknown as Record<string, unknown>}
              nodeId={node.id}
              onUpdate={onUpdate}
            />


            <RetryTimeoutFields
              data={data as unknown as Record<string, unknown>}
              nodeId={node.id}
              onUpdate={onUpdate}
            />
          </div>

          {/* Delete */}
          <div className="p-3 border-t border-border dark:border-dark-border">
            <button
              onClick={() => onDelete(node.id)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-error bg-error/10 hover:bg-error/20 rounded-md transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete LLM Node
            </button>
          </div>
        </>
      )}
    </div>
  );
}
