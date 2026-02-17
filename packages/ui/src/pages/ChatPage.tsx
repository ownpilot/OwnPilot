import { useRef, useEffect, useState, lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChatInput, type ChatInputHandle } from '../components/ChatInput';
import { MessageList } from '../components/MessageList';
import { SuggestionChips } from '../components/SuggestionChips';
import { MemoryCards } from '../components/MemoryCards';
import { ContextBar } from '../components/ContextBar';
import { ContextDetailModal } from '../components/ContextDetailModal';
import { WorkspaceSelector } from '../components/WorkspaceSelector';
import { useChatStore } from '../hooks/useChatStore';
import { ExecutionSecurityPanel } from '../components/ExecutionSecurityPanel';

// Lazy-load rarely-used components
const SetupWizard = lazy(() => import('../components/SetupWizard').then(m => ({ default: m.SetupWizard })));
const ExecutionApprovalDialog = lazy(() => import('../components/ExecutionApprovalDialog').then(m => ({ default: m.ExecutionApprovalDialog })));
import { AlertCircle, AlertTriangle, Settings, Bot, Shield } from '../components/icons';
import { modelsApi, providersApi, settingsApi, agentsApi, chatApi } from '../api';
import type { ModelInfo, AgentDetail } from '../types';
import { STORAGE_KEYS } from '../constants/storage-keys';

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
    suggestions,
    extractedMemories,
    pendingApproval,
    sessionInfo,
    sendMessage,
    retryLastMessage,
    clearMessages,
    cancelRequest,
    clearSuggestions,
    acceptMemory,
    rejectMemory,
    resolveApproval,
  } = useChatStore();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<ChatInputHandle>(null);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [configuredProviders, setConfiguredProviders] = useState<string[]>([]);
  const [providerNames, setProviderNames] = useState<Record<string, string>>({});
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [currentAgent, setCurrentAgent] = useState<AgentDetail | null>(null);
  const [showContextDetail, setShowContextDetail] = useState(false);

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
      const [modelsData, providersData] = await Promise.all([
        modelsApi.list(),
        providersApi.list(),
      ]);

      const namesMap: Record<string, string> = {};
      for (const p of providersData.providers) {
        namesMap[p.id] = p.name;
      }
      setProviderNames(namesMap);
      setModels(modelsData.models);
      setConfiguredProviders(modelsData.configuredProviders);
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoadingModels(false);
    }
  };

  const fetchData = async () => {
    try {
      // Fetch models, providers, and settings in parallel
      const [modelsData, providersData, settingsData] = await Promise.all([
        modelsApi.list(),
        providersApi.list(),
        settingsApi.get(),
      ]);

      // Build provider names lookup
      const namesMap: Record<string, string> = {};
      for (const p of providersData.providers) {
        namesMap[p.id] = p.name;
      }
      setProviderNames(namesMap);

      setModels(modelsData.models);
      setConfiguredProviders(modelsData.configuredProviders);

      // Check URL params for agent/provider/model
      const agentId = searchParams.get('agent');
      const urlProvider = searchParams.get('provider');
      const urlModel = searchParams.get('model');

      // If agent is specified, fetch agent details
      if (agentId) {
        try {
          const agentData = await agentsApi.get(agentId);
          setCurrentAgent(agentData);
          setAgentId(agentData.id); // Set agentId for chat requests

          // Resolve "default" provider/model to actual values
          let agentProvider = agentData.provider;
          let agentModel = agentData.model;

          // If provider is "default", use settings default or first configured
          if (agentProvider === 'default') {
            if (settingsData.defaultProvider &&
                modelsData.configuredProviders.includes(settingsData.defaultProvider)) {
              agentProvider = settingsData.defaultProvider;
            } else if (modelsData.configuredProviders.length > 0) {
              agentProvider = modelsData.configuredProviders[0]!;
            }
          }

          // If model is "default", use settings default or first model of provider
          if (agentModel === 'default') {
            if (settingsData.defaultModel) {
              agentModel = settingsData.defaultModel;
            } else {
              const firstModel = modelsData.models.find((m) => m.provider === agentProvider);
              if (firstModel) agentModel = firstModel.id;
            }
          }

          setProvider(agentProvider);
          setModel(agentModel);
          return; // Agent takes priority
        } catch {
          // Agent not found, continue with URL params or defaults
        }
      }

      // Use URL params if provided
      if (urlProvider && modelsData.configuredProviders.includes(urlProvider)) {
        setProvider(urlProvider);
        if (urlModel) {
          setModel(urlModel);
        } else {
          // Set first model of provider
          const firstModel = modelsData.models.find((m) => m.provider === urlProvider);
          if (firstModel) setModel(firstModel.id);
        }
        return;
      }

      // Use settings default if available
      if (settingsData.defaultProvider && modelsData.configuredProviders.includes(settingsData.defaultProvider)) {
        setProvider(settingsData.defaultProvider);
        if (settingsData.defaultModel) {
          setModel(settingsData.defaultModel);
        } else {
          const firstModel = modelsData.models.find((m) => m.provider === settingsData.defaultProvider);
          if (firstModel) setModel(firstModel.id);
        }
        return;
      }

      // Fallback to first configured provider
      if (modelsData.configuredProviders.length > 0) {
        const firstProvider = modelsData.configuredProviders[0]!;
        const firstModel = modelsData.models.find((m) => m.provider === firstProvider);
        if (firstModel && !modelsData.configuredProviders.includes(provider)) {
          setProvider(firstProvider);
          setModel(firstModel.id);
        }
      }
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoadingModels(false);
    }
  };

  // Auto-scroll to bottom when new messages or streaming content arrives
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent, progressEvents, suggestions, extractedMemories]);

  // Group models by provider (only configured providers)
  const modelsByProvider = models.reduce<Record<string, ModelInfo[]>>((acc, m) => {
    // Only include models from configured providers
    if (!configuredProviders.includes(m.provider)) return acc;
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider]!.push(m);
    return acc;
  }, {});

  // Update model when provider changes
  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const providerModels = modelsByProvider[newProvider];
    if (providerModels && providerModels.length > 0) {
      const recommended = providerModels.find((m) => m.recommended);
      setModel(recommended?.id ?? providerModels[0]!.id);
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
      await chatApi.resetContext(provider, model);
    } catch {
      // Ignore errors - context reset is best-effort
    }
  };

  const handleCompactContext = async () => {
    await chatApi.compactContext(provider, model);
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
                <span className="text-text-muted dark:text-dark-text-muted animate-pulse">Loading...</span>
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

      {/* Session context bar */}
      <ContextBar sessionInfo={sessionInfo} onNewSession={handleNewChat} onShowDetail={() => setShowContextDetail(true)} />

      {/* Context detail modal */}
      {showContextDetail && sessionInfo && (
        <ContextDetailModal
          sessionInfo={sessionInfo}
          provider={provider}
          model={model}
          onClose={() => setShowContextDetail(false)}
          onCompact={handleCompactContext}
          onClear={handleNewChat}
        />
      )}

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

              {!isLoadingModels && configuredProviders.length === 0 && localStorage.getItem(STORAGE_KEYS.SETUP_COMPLETE) !== 'true' ? (
                <Suspense fallback={null}><SetupWizard onComplete={() => window.location.reload()} /></Suspense>
              ) : !isLoadingModels && configuredProviders.length === 0 ? (
                <>
                  <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg mb-4">
                    <div className="flex items-center justify-center gap-2 text-warning mb-2">
                      <AlertCircle className="w-5 h-5" />
                      <span className="font-medium">No API Keys</span>
                    </div>
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      Configure at least one AI provider to start chatting.
                    </p>
                  </div>
                  <a
                    href="/settings/api-keys"
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
                        className="px-3 py-1.5 text-sm bg-primary/10 text-primary rounded-full hover:bg-primary hover:text-white transition-colors"
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
                        className="px-3 py-1.5 text-sm bg-success/10 text-success rounded-full hover:bg-success hover:text-white transition-colors"
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
                {/* Security block banner */}
                {progressEvents.some(e => e.type === 'tool_end' && e.result?.preview?.includes('blocked in Execution Security')) && (
                  <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <Shield className="w-4 h-4 text-red-500 flex-shrink-0" />
                    <span className="text-xs text-red-600 dark:text-red-400">
                      Tool execution was blocked by Execution Security settings. Adjust permissions in the security panel above.
                    </span>
                  </div>
                )}

                {/* Local execution warning banner */}
                {progressEvents.some(e => e.type === 'tool_end' && e.result?.sandboxed === false) && (
                  <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                    <span className="text-xs text-amber-600 dark:text-amber-400">
                      Code is executing directly on your local machine without Docker sandbox.
                    </span>
                  </div>
                )}

                {/* Progress events */}
                {progressEvents.length > 0 && (
                  <div className="mb-3 space-y-1">
                    {progressEvents.slice(-5).map((event, idx) => (
                      <div key={`progress-${event.type}-${idx}`} className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
                        {event.type === 'status' && (
                          <>
                            <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
                            <span>{event.message}</span>
                          </>
                        )}
                        {event.type === 'tool_start' && (
                          <>
                            <span className="w-2 h-2 bg-warning rounded-full animate-pulse" />
                            <span>🔧 Running <strong>{event.tool?.name}</strong>...</span>
                          </>
                        )}
                        {event.type === 'tool_end' && (
                          <>
                            <span className={`w-2 h-2 ${event.result?.success ? 'bg-success' : 'bg-error'} rounded-full`} />
                            <span>
                              {event.result?.success ? '✓' : '✗'} {event.tool?.name}
                              <span className="opacity-60 ml-1">({event.result?.durationMs}ms)</span>
                            </span>
                            {event.result?.preview?.includes('blocked in Execution Security') ? (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-[10px] bg-red-500/15 text-red-600 dark:text-red-400 rounded font-semibold leading-4">
                                <Shield className="w-3 h-3" />
                                BLOCKED
                              </span>
                            ) : event.result?.sandboxed === false && (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0 text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 rounded font-semibold leading-4">
                                LOCAL
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Streaming text */}
                {streamingContent && (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <div className="whitespace-pre-wrap">{streamingContent.replace(/<memories>[\s\S]*$/, '').trimEnd()}</div>
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

            {!isLoading && extractedMemories.length > 0 && messages.length > 0 && (
              <div className="px-4">
                <MemoryCards
                  memories={extractedMemories}
                  onAccept={acceptMemory}
                  onReject={rejectMemory}
                />
              </div>
            )}

            {!isLoading && suggestions.length > 0 && messages.length > 0 && (
              <div className="px-4">
                <SuggestionChips
                  suggestions={suggestions}
                  onSelect={(s) => { clearSuggestions(); chatInputRef.current?.setValue(s.detail); }}
                />
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
        <ExecutionSecurityPanel />
        <ChatInput ref={chatInputRef} onSend={sendMessage} onStop={cancelRequest} isLoading={isLoading} />
      </div>

      {/* Execution Approval Dialog */}
      {pendingApproval && (
        <Suspense fallback={null}>
          <ExecutionApprovalDialog
            approval={pendingApproval}
            onResolve={resolveApproval}
          />
        </Suspense>
      )}
    </div>
  );
}
