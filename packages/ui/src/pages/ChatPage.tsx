import { useRef, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChatInput } from '../components/ChatInput';
import { MessageList } from '../components/MessageList';
import { WorkspaceSelector } from '../components/WorkspaceSelector';
import { useChatStore } from '../hooks/useChatStore';
import { AlertCircle, Settings, Bot } from '../components/icons';

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  description?: string;
  recommended?: boolean;
}

interface ModelsResponse {
  success: boolean;
  data: {
    models: ModelInfo[];
    configuredProviders: string[];
    availableProviders: string[];
  };
}

interface ProviderInfo {
  id: string;
  name: string;
}

interface ProvidersResponse {
  success: boolean;
  data: {
    providers: ProviderInfo[];
  };
}

interface SettingsResponse {
  success: boolean;
  data: {
    configuredProviders: string[];
    defaultProvider: string | null;
    defaultModel: string | null;
  };
}

interface AgentInfo {
  id: string;
  name: string;
  provider: string;
  model: string;
}

interface AgentResponse {
  success: boolean;
  data: AgentInfo;
}

export function ChatPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    messages,
    isLoading,
    error,
    lastFailedMessage,
    provider,
    model,
    workspaceId,
    streamingContent,
    progressEvents,
    setProvider,
    setModel,
    setAgentId,
    setWorkspaceId,
    sendMessage,
    retryLastMessage,
    clearMessages,
    cancelRequest,
  } = useChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [providerNames, setProviderNames] = useState<Record<string, string>>({});
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [currentAgent, setCurrentAgent] = useState<AgentInfo | null>(null);

  // Fetch data on mount (only if provider not set - preserves state on navigation)
  useEffect(() => {
    if (!provider) {
      fetchData();
    } else {
      // Provider already set, just load models list for dropdown
      fetchModelsOnly();
    }
  }, []);

  // Fetch only models list (for dropdown) without changing provider/model
  const fetchModelsOnly = async () => {
    try {
      const [modelsRes, providersRes] = await Promise.all([
        fetch('/api/v1/models'),
        fetch('/api/v1/providers'),
      ]);

      const modelsData: ModelsResponse = await modelsRes.json();
      const providersData: ProvidersResponse = await providersRes.json();

      if (providersData.success) {
        const namesMap: Record<string, string> = {};
        for (const p of providersData.data.providers) {
          namesMap[p.id] = p.name;
        }
        setProviderNames(namesMap);
      }

      if (modelsData.success) {
        setModels(modelsData.data.models);
        setConfiguredProviders(modelsData.data.configuredProviders);
      }
    } catch (err) {
      console.error('Failed to fetch models:', err);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const fetchData = async () => {
    try {
      // Fetch models, providers, and settings in parallel
      const [modelsRes, providersRes, settingsRes] = await Promise.all([
        fetch('/api/v1/models'),
        fetch('/api/v1/providers'),
        fetch('/api/v1/settings'),
      ]);

      const modelsData: ModelsResponse = await modelsRes.json();
      const providersData: ProvidersResponse = await providersRes.json();
      const settingsData: SettingsResponse = await settingsRes.json();

      // Build provider names lookup
      let namesMap: Record<string, string> = {};
      if (providersData.success) {
        for (const p of providersData.data.providers) {
          namesMap[p.id] = p.name;
        }
        setProviderNames(namesMap);
      }

      if (modelsData.success) {
        setModels(modelsData.data.models);
        setConfiguredProviders(modelsData.data.configuredProviders);

        // Check URL params for agent/provider/model
        const agentId = searchParams.get('agent');
        const urlProvider = searchParams.get('provider');
        const urlModel = searchParams.get('model');

        // If agent is specified, fetch agent details
        if (agentId) {
          try {
            const agentRes = await fetch(`/api/v1/agents/${agentId}`);
            const agentData: AgentResponse = await agentRes.json();
            if (agentData.success && agentData.data) {
              setCurrentAgent(agentData.data);
              setAgentId(agentData.data.id); // Set agentId for chat requests

              // Resolve "default" provider/model to actual values
              let agentProvider = agentData.data.provider;
              let agentModel = agentData.data.model;

              // If provider is "default", use settings default or first configured
              if (agentProvider === 'default') {
                if (settingsData.success && settingsData.data.defaultProvider &&
                    modelsData.data.configuredProviders.includes(settingsData.data.defaultProvider)) {
                  agentProvider = settingsData.data.defaultProvider;
                } else if (modelsData.data.configuredProviders.length > 0) {
                  agentProvider = modelsData.data.configuredProviders[0];
                }
              }

              // If model is "default", use settings default or first model of provider
              if (agentModel === 'default') {
                if (settingsData.success && settingsData.data.defaultModel) {
                  agentModel = settingsData.data.defaultModel;
                } else {
                  const firstModel = modelsData.data.models.find((m) => m.provider === agentProvider);
                  if (firstModel) agentModel = firstModel.id;
                }
              }

              setProvider(agentProvider);
              setModel(agentModel);
              return; // Agent takes priority
            }
          } catch {
            // Agent not found, continue with URL params or defaults
          }
        }

        // Use URL params if provided
        if (urlProvider && modelsData.data.configuredProviders.includes(urlProvider)) {
          setProvider(urlProvider);
          if (urlModel) {
            setModel(urlModel);
          } else {
            // Set first model of provider
            const firstModel = modelsData.data.models.find((m) => m.provider === urlProvider);
            if (firstModel) setModel(firstModel.id);
          }
          return;
        }

        // Use settings default if available
        if (settingsData.success) {
          if (settingsData.data.defaultProvider && modelsData.data.configuredProviders.includes(settingsData.data.defaultProvider)) {
            setProvider(settingsData.data.defaultProvider);
            if (settingsData.data.defaultModel) {
              setModel(settingsData.data.defaultModel);
            } else {
              const firstModel = modelsData.data.models.find((m) => m.provider === settingsData.data.defaultProvider);
              if (firstModel) setModel(firstModel.id);
            }
            return;
          }
        }

        // Fallback to first configured provider
        if (modelsData.data.configuredProviders.length > 0) {
          const firstProvider = modelsData.data.configuredProviders[0];
          const firstModel = modelsData.data.models.find((m) => m.provider === firstProvider);
          if (firstModel && !modelsData.data.configuredProviders.includes(provider)) {
            setProvider(firstProvider);
            setModel(firstModel.id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch data:', err);
    } finally {
      setIsLoadingModels(false);
    }
  };

  // Auto-scroll to bottom when new messages or streaming content arrives
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, progressEvents]);

  // Group models by provider (only configured providers)
  const modelsByProvider = models.reduce<Record<string, ModelInfo[]>>((acc, m) => {
    // Only include models from configured providers
    if (!configuredProviders.includes(m.provider)) return acc;
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider].push(m);
    return acc;
  }, {});

  // Update model when provider changes
  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const providerModels = modelsByProvider[newProvider];
    if (providerModels && providerModels.length > 0) {
      const recommended = providerModels.find((m) => m.recommended);
      setModel(recommended?.id ?? providerModels[0].id);
    }
    setShowProviderMenu(false);
    // Keep agent context - just update the provider/model being used
    // Agent's personality/tools remain, only the underlying LLM changes
  };

  const handleNewChat = async () => {
    // Cancel any ongoing request and clear frontend messages
    clearMessages();
    setCurrentAgent(null);
    setAgentId(null); // Clear agent for chat requests
    setSearchParams({});

    // Reset backend context for fresh conversation
    try {
      await fetch('/api/v1/chat/reset-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model }),
      });
    } catch {
      // Ignore errors - context reset is best-effort
    }
  };

  const currentProviderName = providerNames[provider] ?? provider;
  const isProviderConfigured = configuredProviders.includes(provider);

  // Extract agent display name (remove emoji if present)
  const agentDisplayName = currentAgent?.name?.match(/^(\p{Emoji})\s*(.+)$/u)?.[2] ?? currentAgent?.name;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center gap-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary flex items-center gap-2">
              {currentAgent ? (
                <>
                  <Bot className="w-5 h-5 text-primary" />
                  {agentDisplayName}
                </>
              ) : (
                'Chat'
              )}
            </h2>
            <p className="text-sm text-text-muted dark:text-dark-text-muted">
              {currentAgent ? (
                `Using ${currentProviderName} / ${model}`
              ) : !isLoadingModels && configuredProviders.length > 0 && !isProviderConfigured ? (
                <span className="text-warning">Provider not configured</span>
              ) : (
                'Talk to your AI assistant'
              )}
            </p>
          </div>

          {/* Workspace Selector */}
          <WorkspaceSelector
            selectedWorkspaceId={workspaceId}
            onWorkspaceChange={setWorkspaceId}
          />

          {/* Provider/Model Selector */}
          <div className="relative">
            <button
              onClick={() => setShowProviderMenu(!showProviderMenu)}
              disabled={isLoadingModels}
              className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors disabled:opacity-50"
            >
              {isLoadingModels ? (
                <span className="text-text-muted dark:text-dark-text-muted">Loading...</span>
              ) : (
                <>
                  <span className="font-medium text-text-primary dark:text-dark-text-primary">
                    {currentProviderName}
                  </span>
                  <span className="text-text-muted dark:text-dark-text-muted">
                    / {model}
                  </span>
                </>
              )}
              <svg
                className={`w-4 h-4 text-text-muted transition-transform ${showProviderMenu ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {showProviderMenu && (
              <div className="absolute top-full left-0 mt-1 w-80 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg shadow-lg z-50 max-h-96 overflow-y-auto">
                {configuredProviders.length === 0 ? (
                  <div className="p-4 text-center">
                    <p className="text-sm text-text-muted dark:text-dark-text-muted mb-2">
                      No providers configured
                    </p>
                    <a
                      href="/settings"
                      className="text-sm text-primary hover:underline flex items-center justify-center gap-1"
                    >
                      <Settings className="w-4 h-4" /> Configure API Keys
                    </a>
                  </div>
                ) : (
                  Object.entries(modelsByProvider).map(([providerId, providerModels]) => (
                    <div key={providerId} className="border-b border-border dark:border-dark-border last:border-b-0">
                      <div
                        className={`px-3 py-2 text-sm font-medium cursor-pointer hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary ${
                          provider === providerId ? 'bg-primary/10 text-primary' : 'text-text-primary dark:text-dark-text-primary'
                        }`}
                        onClick={() => handleProviderChange(providerId)}
                      >
                        {providerNames[providerId] ?? providerId}
                      </div>
                      {provider === providerId && (
                        <div className="px-2 pb-2">
                          {providerModels.map((m) => (
                            <button
                              key={m.id}
                              onClick={() => {
                                setModel(m.id);
                                setShowProviderMenu(false);
                                // Keep agent context - just update the model being used
                              }}
                              className={`w-full text-left px-2 py-1.5 text-xs rounded ${
                                model === m.id
                                  ? 'bg-primary text-white'
                                  : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span>{m.name}</span>
                                {m.recommended && (
                                  <span className="text-[10px] opacity-70">Recommended</span>
                                )}
                              </div>
                              {m.description && (
                                <p className="text-[10px] opacity-60 mt-0.5 line-clamp-1">
                                  {m.description}
                                </p>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleNewChat}
          className="px-4 py-2 text-sm text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded-lg transition-colors"
        >
          New Chat
        </button>
      </header>

      {/* Click outside to close menu */}
      {showProviderMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowProviderMenu(false)}
        />
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
                {currentAgent ? `Chat with ${agentDisplayName}` : 'Welcome to OwnPilot'}
              </h3>

              {!isLoadingModels && configuredProviders.length === 0 ? (
                <>
                  <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg mb-4">
                    <div className="flex items-center justify-center gap-2 text-warning mb-2">
                      <AlertCircle className="w-5 h-5" />
                      <span className="font-medium">Demo Mode</span>
                    </div>
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      No API keys configured. You'll receive simulated responses.
                    </p>
                  </div>
                  <a
                    href="/settings"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors mb-4"
                  >
                    <Settings className="w-4 h-4" />
                    Configure API Keys
                  </a>
                </>
              ) : (
                <>
                  <p className="text-text-muted dark:text-dark-text-muted mb-2">
                    Start a conversation by typing a message below.
                  </p>
                  <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
                    Currently using: <span className="font-medium text-primary">{currentProviderName}</span> / <span className="font-mono">{model}</span>
                  </p>
                </>
              )}

              {/* Example prompts organized by category */}
              <div className="space-y-4 text-left">
                {/* General */}
                <div>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mb-2 text-center">General</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {[
                      'What can you help me with?',
                      'Tell me about your capabilities',
                    ].map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => sendMessage(suggestion)}
                        className="px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary rounded-full hover:bg-primary hover:text-white transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Code Execution */}
                <div>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mb-2 text-center">Code Execution (Docker sandbox)</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {[
                      { label: 'Run JavaScript', prompt: 'Run this JavaScript code: console.log("Hello from Node.js!"); const sum = [1,2,3,4,5].reduce((a,b) => a+b, 0); console.log("Sum:", sum);' },
                      { label: 'Run Python', prompt: 'Run this Python code: import sys; print(f"Python {sys.version}"); print("Fibonacci:", [0,1,1,2,3,5,8,13,21])' },
                      { label: 'Run Shell', prompt: 'Run this shell command: echo "System info:" && uname -a && echo "Current date:" && date' },
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={() => sendMessage(item.prompt)}
                        className="px-3 py-1.5 text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full hover:bg-blue-500 hover:text-white transition-colors"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Tools */}
                <div>
                  <p className="text-xs text-text-muted dark:text-dark-text-muted mb-2 text-center">Tools & Search</p>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {[
                      { label: 'Web Search', prompt: 'Search the web for the latest news about AI developments' },
                      { label: 'Weather', prompt: 'What is the current weather in Istanbul?' },
                      { label: 'Calculator', prompt: 'Calculate: (15 * 27) + (sqrt(144) / 3) - 18^2' },
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={() => sendMessage(item.prompt)}
                        className="px-3 py-1.5 text-sm bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded-full hover:bg-emerald-500 hover:text-white transition-colors"
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            <MessageList
              messages={messages}
              onRetry={retryLastMessage}
              canRetry={!!lastFailedMessage && !isLoading}
            />

            {/* Streaming content and progress */}
            {isLoading && (streamingContent || progressEvents.length > 0) && (
              <div className="mt-4 p-4 bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border">
                {/* Progress events */}
                {progressEvents.length > 0 && (
                  <div className="mb-3 space-y-1">
                    {progressEvents.slice(-5).map((event, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                        {event.type === 'status' && (
                          <>
                            <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
                            <span>{event.message}</span>
                          </>
                        )}
                        {event.type === 'tool_start' && (
                          <>
                            <span className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
                            <span>🔧 Running <strong>{event.tool?.name}</strong>...</span>
                          </>
                        )}
                        {event.type === 'tool_end' && (
                          <>
                            <span className={`w-2 h-2 ${event.result?.success ? 'bg-green-500' : 'bg-red-500'} rounded-full`} />
                            <span>
                              {event.result?.success ? '✓' : '✗'} {event.tool?.name}
                              <span className="opacity-60 ml-1">({event.result?.durationMs}ms)</span>
                            </span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Streaming text */}
                {streamingContent && (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <div className="whitespace-pre-wrap">{streamingContent}</div>
                    <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5" />
                  </div>
                )}

                {/* Loading indicator when no content yet */}
                {!streamingContent && progressEvents.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-text-muted dark:text-dark-text-muted">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                    <span>Thinking...</span>
                  </div>
                )}
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-6 mb-4 px-4 py-2 bg-error/10 border border-error/20 rounded-lg text-error text-sm">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="px-6 py-4 border-t border-border dark:border-dark-border">
        <ChatInput onSend={sendMessage} onStop={cancelRequest} isLoading={isLoading} />
      </div>
    </div>
  );
}
