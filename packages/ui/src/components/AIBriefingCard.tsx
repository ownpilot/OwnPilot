import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Lightbulb,
  Focus,
  Target,
  Settings,
} from './icons';

interface AIBriefing {
  id: string;
  summary: string;
  priorities: string[];
  insights: string[];
  suggestedFocusAreas: string[];
  generatedAt: string;
  expiresAt: string;
  modelUsed: string;
  cached: boolean;
}

interface BriefingResponse {
  success: boolean;
  data?: {
    aiBriefing: AIBriefing | null;
    cached?: boolean;
    error?: string;
  };
  error?: { message: string };
}

interface ProviderModel {
  provider: string;
  providerName: string;
  model: string;
  modelName: string;
}

interface ProvidersListResponse {
  success: boolean;
  data?: {
    providers: Array<{
      id: string;
      name: string;
      isConfigured: boolean;
      isEnabled: boolean;
    }>;
  };
}

interface ProviderModelsResponse {
  success: boolean;
  data?: {
    provider: string;
    providerName: string;
    models: Array<{ id: string; name: string }>;
    isConfigured: boolean;
  };
}

const STORAGE_KEY = 'briefing-model-preference';

// Default fallback if API fails
const DEFAULT_MODEL: ProviderModel = {
  provider: 'openai',
  providerName: 'OpenAI',
  model: 'gpt-4o-mini',
  modelName: 'GPT-4o Mini',
};

export function AIBriefingCard() {
  const [briefing, setBriefing] = useState<AIBriefing | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [availableModels, setAvailableModels] = useState<ProviderModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<ProviderModel>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved) as ProviderModel;
      } catch {
        return DEFAULT_MODEL;
      }
    }
    return DEFAULT_MODEL;
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch available providers and their models (two-step process)
  useEffect(() => {
    const fetchProvidersAndModels = async () => {
      try {
        // Step 1: Get list of all providers
        const providersRes = await fetch('/api/v1/providers');
        const providersData: ProvidersListResponse = await providersRes.json();

        if (!providersData.success || !providersData.data?.providers) {
          console.error('Failed to fetch providers list');
          return;
        }

        // Filter to only configured and enabled providers
        const configuredProviders = providersData.data.providers.filter(
          p => p.isConfigured && p.isEnabled
        );

        if (configuredProviders.length === 0) {
          console.log('No configured providers found');
          return;
        }

        // Step 2: Fetch models for each configured provider (in parallel)
        const modelPromises = configuredProviders.map(async (provider) => {
          try {
            const modelsRes = await fetch(`/api/v1/providers/${provider.id}/models`);
            const modelsData: ProviderModelsResponse = await modelsRes.json();

            if (modelsData.success && modelsData.data?.models) {
              // Take first 5 models per provider for briefing dropdown
              return modelsData.data.models.slice(0, 5).map(model => ({
                provider: provider.id,
                providerName: modelsData.data?.providerName || provider.name,
                model: model.id,
                modelName: model.name,
              }));
            }
            return [];
          } catch (err) {
            console.error(`Failed to fetch models for ${provider.id}:`, err);
            return [];
          }
        });

        const modelArrays = await Promise.all(modelPromises);
        const models: ProviderModel[] = modelArrays.flat();

        if (models.length > 0) {
          setAvailableModels(models);

          // If saved model is not in available list, use first available
          const savedModel = localStorage.getItem(STORAGE_KEY);
          if (savedModel) {
            try {
              const parsed = JSON.parse(savedModel) as ProviderModel;
              const found = models.find(
                m => m.provider === parsed.provider && m.model === parsed.model
              );
              if (!found && models.length > 0) {
                setSelectedModel(models[0]);
                localStorage.setItem(STORAGE_KEY, JSON.stringify(models[0]));
              }
            } catch {
              // Invalid saved data, use first model
              setSelectedModel(models[0]);
              localStorage.setItem(STORAGE_KEY, JSON.stringify(models[0]));
            }
          } else {
            // No saved preference, use first available
            setSelectedModel(models[0]);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(models[0]));
          }
        }
      } catch (err) {
        console.error('Failed to fetch providers:', err);
      }
    };

    fetchProvidersAndModels();
  }, []);

  const fetchBriefing = useCallback(async (refresh = false, useStreaming = false) => {
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    if (refresh || useStreaming) {
      setIsStreaming(true);
      setStreamingText('');
      setBriefing(null);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      // If streaming, use the streaming endpoint
      if (useStreaming || refresh) {
        const url = `/api/v1/dashboard/briefing/stream?provider=${selectedModel.provider}&model=${selectedModel.model}`;
        const response = await fetch(url, {
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          throw new Error('Failed to start streaming');
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response body');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                setIsStreaming(false);
                continue;
              }

              try {
                const parsed = JSON.parse(data);

                if (parsed.type === 'chunk') {
                  setStreamingText(prev => prev + parsed.content);
                } else if (parsed.type === 'complete') {
                  setBriefing(parsed.briefing);
                  setIsStreaming(false);
                } else if (parsed.type === 'error') {
                  setError(parsed.message);
                  setIsStreaming(false);
                }
              } catch {
                // Not JSON, treat as text chunk
                setStreamingText(prev => prev + data);
              }
            }
          }
        }
      } else {
        // Non-streaming fetch for initial load (use cache)
        const url = `/api/v1/dashboard/briefing?provider=${selectedModel.provider}&model=${selectedModel.model}`;
        const response = await fetch(url, {
          signal: abortControllerRef.current.signal,
        });
        const data: BriefingResponse = await response.json();

        if (data.success && data.data?.aiBriefing) {
          setBriefing(data.data.aiBriefing);
        } else if (data.data?.error) {
          setError(data.data.error);
        } else if (data.error) {
          setError(data.error.message);
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return;
      }
      console.error('Failed to fetch briefing:', err);
      setError('Failed to load AI briefing');
    } finally {
      setIsLoading(false);
      setIsStreaming(false);
    }
  }, [selectedModel]);

  useEffect(() => {
    fetchBriefing(false, false);

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowModelSelector(false);
      }
    };

    if (showModelSelector) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showModelSelector]);

  const handleRefresh = () => {
    fetchBriefing(true, true);
  };

  const handleModelChange = (model: ProviderModel) => {
    setSelectedModel(model);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(model));
    setShowModelSelector(false);
    // Refresh with new model
    fetchBriefing(true, true);
  };

  // Loading state
  if (isLoading && !isStreaming) {
    return (
      <div className="mb-6 p-6 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary animate-pulse" />
          </div>
          <div className="flex-1">
            <div className="h-4 w-48 bg-primary/20 rounded animate-pulse mb-2" />
            <div className="h-3 w-32 bg-primary/10 rounded animate-pulse" />
          </div>
        </div>
        <div className="mt-4 space-y-2">
          <div className="h-4 bg-primary/10 rounded animate-pulse" />
          <div className="h-4 bg-primary/10 rounded animate-pulse w-3/4" />
        </div>
      </div>
    );
  }

  // Streaming state
  if (isStreaming) {
    return (
      <div className="mb-6 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-xl overflow-hidden">
        <div className="p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary animate-pulse" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-text-primary dark:text-dark-text-primary">
                AI Daily Briefing
              </h3>
              <span className="px-2 py-0.5 text-xs rounded-full bg-primary/20 text-primary animate-pulse">
                generating...
              </span>
            </div>
            <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">
              {selectedModel.providerName} / {selectedModel.modelName}
            </p>
          </div>
          <RefreshCw className="w-4 h-4 text-primary animate-spin" />
        </div>
        <div className="px-4 pb-4">
          <p className="text-text-primary dark:text-dark-text-primary leading-relaxed">
            {streamingText || 'Analyzing your data...'}
            <span className="inline-block w-2 h-4 bg-primary/60 animate-pulse ml-1" />
          </p>
        </div>
      </div>
    );
  }

  // Error state with no data
  if (error && !briefing) {
    return (
      <div className="mb-6 p-6 bg-error/5 border border-error/20 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-error/20 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-error" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-text-primary dark:text-dark-text-primary">
              AI Briefing Unavailable
            </h3>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">{error}</p>
          </div>
          <button
            onClick={handleRefresh}
            className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          >
            <RefreshCw className="w-5 h-5 text-text-muted" />
          </button>
        </div>
      </div>
    );
  }

  // Success state
  if (!briefing) return null;

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  };

  // Group models by provider for the dropdown
  const modelsByProvider = availableModels.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = {
        name: model.providerName,
        models: [],
      };
    }
    acc[model.provider].models.push(model);
    return acc;
  }, {} as Record<string, { name: string; models: ProviderModel[] }>);

  return (
    <div className="mb-6 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-xl overflow-visible">
      {/* Header */}
      <div
        className="p-4 flex items-center gap-3 cursor-pointer hover:bg-primary/5 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-text-primary dark:text-dark-text-primary">
              AI Daily Briefing
            </h3>
            {briefing.cached && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-primary/20 text-primary">
                cached
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted dark:text-dark-text-muted truncate">
            Generated at {formatTime(briefing.generatedAt)} • {briefing.modelUsed}
          </p>
        </div>

        {/* Model Selector */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowModelSelector(!showModelSelector);
            }}
            className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
            title="Change AI model"
          >
            <Settings className="w-4 h-4 text-text-muted" />
          </button>

          {showModelSelector && (
            <div
              className="absolute right-0 top-full mt-2 w-72 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg shadow-xl z-[100] max-h-80 overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-3 border-b border-border dark:border-dark-border sticky top-0 bg-bg-primary dark:bg-dark-bg-primary">
                <p className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
                  Select AI Model
                </p>
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
                  Choose from your configured providers
                </p>
              </div>
              <div className="p-2">
                {Object.entries(modelsByProvider).map(([providerId, { name, models }]) => (
                  <div key={providerId} className="mb-2 last:mb-0">
                    <div className="px-2 py-1 text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                      {name}
                    </div>
                    {models.map((model) => (
                      <button
                        key={`${model.provider}-${model.model}`}
                        onClick={() => handleModelChange(model)}
                        className={`w-full text-left px-3 py-2 rounded-md transition-colors ${
                          selectedModel.provider === model.provider && selectedModel.model === model.model
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary text-text-primary dark:text-dark-text-primary'
                        }`}
                      >
                        <div className="font-medium text-sm">{model.modelName}</div>
                        <div className="text-xs text-text-muted dark:text-dark-text-muted truncate">
                          {model.model}
                        </div>
                      </button>
                    ))}
                  </div>
                ))}

                {availableModels.length === 0 && (
                  <div className="px-3 py-4 text-center text-sm text-text-muted dark:text-dark-text-muted">
                    No providers configured.
                    <br />
                    Add API keys in Settings.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            handleRefresh();
          }}
          className="p-2 rounded-lg hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          title="Regenerate briefing"
        >
          <RefreshCw className="w-4 h-4 text-text-muted" />
        </button>
        <div className="p-2">
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          )}
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Summary */}
          <p className="text-text-primary dark:text-dark-text-primary leading-relaxed">
            {briefing.summary}
          </p>

          {/* Priorities */}
          {briefing.priorities.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-warning" />
                <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                  Today's Priorities
                </h4>
              </div>
              <ol className="space-y-1 pl-6">
                {briefing.priorities.map((priority, index) => (
                  <li
                    key={index}
                    className="text-sm text-text-primary dark:text-dark-text-primary list-decimal marker:text-primary marker:font-semibold"
                  >
                    {priority}
                  </li>
                ))}
              </ol>
            </div>
          )}

          {/* Insights & Focus Areas Grid */}
          {(briefing.insights.length > 0 || briefing.suggestedFocusAreas.length > 0) && (
            <div className="grid md:grid-cols-2 gap-4">
              {/* Insights */}
              {briefing.insights.length > 0 && (
                <div className="p-3 bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Lightbulb className="w-4 h-4 text-success" />
                    <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                      Insights
                    </h4>
                  </div>
                  <ul className="space-y-1">
                    {briefing.insights.map((insight, index) => (
                      <li
                        key={index}
                        className="text-sm text-text-muted dark:text-dark-text-muted flex items-start gap-2"
                      >
                        <span className="text-success mt-1">•</span>
                        {insight}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Focus Areas */}
              {briefing.suggestedFocusAreas.length > 0 && (
                <div className="p-3 bg-bg-secondary/50 dark:bg-dark-bg-secondary/50 rounded-lg">
                  <div className="flex items-center gap-2 mb-2">
                    <Focus className="w-4 h-4 text-info" />
                    <h4 className="text-sm font-medium text-text-secondary dark:text-dark-text-secondary">
                      Suggested Focus Areas
                    </h4>
                  </div>
                  <ul className="space-y-1">
                    {briefing.suggestedFocusAreas.map((area, index) => (
                      <li
                        key={index}
                        className="text-sm text-text-muted dark:text-dark-text-muted flex items-start gap-2"
                      >
                        <span className="text-info mt-1">•</span>
                        {area}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
