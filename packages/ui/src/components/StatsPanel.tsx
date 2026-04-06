/**
 * Stats Panel Component
 *
 * Right sidebar displaying real-time stats:
 * - Personal data counts (tasks, notes, etc.)
 * - Token/cost usage (actual data)
 * - Provider/model info
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { formatNumber } from '../utils/formatters';
import { useGateway } from '../hooks/useWebSocket';
import { useDebouncedCallback } from '../hooks';
import { usePageContext } from '../hooks/usePageContext';
import {
  Activity,
  Brain,
  Check,
  ChevronDown,
  DollarSign,
  Hash,
  PanelRight,
  ChevronRight,
  CheckCircle2,
  FileText,
  Calendar,
  Users,
  Bookmark,
  Repeat,
  Receipt,
  AlertCircle,
  TrendingUp,
  Cpu,
  MessageSquare,
  Send,
  FolderOpen,
  Terminal,
  Bot,
  StopCircle,
  Wrench,
  Layers,
  Settings,
} from './icons';
import { MarkdownContent } from './MarkdownContent';
import { summaryApi, costsApi, providersApi, modelsApi } from '../api';
import { STORAGE_KEYS } from '../constants/storage-keys';
import type { SummaryData, CostsData, ProviderInfo } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { QuickAddGrid } from './QuickAddModal';
import { useSidebarChat } from '../hooks/useSidebarChat';
import { usePageCopilotContext } from '../hooks/usePageCopilotContext';

interface StatCardProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  subValue?: string;
  color?: string;
  alert?: boolean;
}

function StatCard({
  icon: Icon,
  label,
  value,
  subValue,
  color = 'text-primary',
  alert,
}: StatCardProps) {
  return (
    <div
      className={`p-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg ${alert ? 'ring-1 ring-error' : ''}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-4 h-4 ${alert ? 'text-error' : color}`} />
        <span className="text-xs text-text-muted dark:text-dark-text-muted">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className={`text-lg font-semibold ${alert ? 'text-error' : 'text-text-primary dark:text-dark-text-primary'}`}
        >
          {value}
        </span>
        {subValue && (
          <span className="text-xs text-text-muted dark:text-dark-text-muted">{subValue}</span>
        )}
      </div>
    </div>
  );
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

// QuickAddSection is now extracted to QuickAddModal.tsx (shared with DashboardPage)

// ---- Compact Chat (StatsPanel Chat tab) ----

const CONTEXT_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  workspace: FolderOpen,
  'coding-agent': Terminal,
  claw: Bot,
  workflow: Layers,
  workflows: Layers,
  agent: Brain,
  agents: Brain,
  tools: Wrench,
  settings: Settings,
};

function ContextBanner() {
  const { context, isLoading: ctxLoading } = usePageContext();
  const [expanded, setExpanded] = useState(false);

  if (ctxLoading || !context.type) return null;

  const Icon = CONTEXT_ICONS[context.type] ?? Activity;
  const label = context.name || context.type;
  const detail = context.path;

  return (
    <button
      data-testid="context-banner"
      onClick={() => setExpanded((v) => !v)}
      className="w-full flex items-center gap-2 px-3 py-1.5 bg-primary/5 border-b border-primary/10 text-xs text-text-secondary dark:text-dark-text-secondary hover:bg-primary/10 transition-colors text-left"
    >
      <Icon className="w-3.5 h-3.5 text-primary shrink-0" />
      <span className="font-medium truncate">{label}</span>
      {detail && !expanded && (
        <span className="text-text-muted dark:text-dark-text-muted truncate ml-auto">
          {detail.length > 25 ? '...' + detail.slice(-25) : detail}
        </span>
      )}
      {detail && expanded && (
        <span className="text-text-muted dark:text-dark-text-muted break-all ml-auto">
          {detail}
        </span>
      )}
    </button>
  );
}

const isBridgeProvider = (p: { id: string; name: string }) =>
  p.id.startsWith('bridge-') || p.name.startsWith('bridge-');

function formatProviderName(p: { id: string; name: string }): string {
  if (p.name === 'Claude Code (Bridge)') return p.name;
  if (p.name.startsWith('bridge-')) {
    const runtime = p.name.replace('bridge-', '');
    return runtime.charAt(0).toUpperCase() + runtime.slice(1);
  }
  return p.name;
}

interface ModelInfo { id: string; name?: string; provider: string; recommended?: boolean }

function CompactProviderSelector() {
  const { provider, model, setProvider, setModel, clearMessages } = useSidebarChat();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [expandedBridge, setExpandedBridge] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch providers + models
  useEffect(() => {
    Promise.all([providersApi.list(), modelsApi.list()]).then(([provData, modData]) => {
      const configured = (provData.providers as ProviderInfo[]).filter((p) => p.isConfigured) ?? [];
      setProviders(configured);
      setModels((modData.models as ModelInfo[]) ?? []);
    }).catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setExpandedBridge(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  // Provider name resolution (localStorage cache from ChatPage)
  const providerNamesCache = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('ownpilot-provider-names') ?? '{}') as Record<string, string>;
    } catch { return {} as Record<string, string>; }
  }, []);

  const selectedProvider = providers.find((p) => p.id === provider);
  const isBridge = selectedProvider
    ? isBridgeProvider(selectedProvider)
    : (providerNamesCache[provider]?.toLowerCase().includes('bridge') || provider.startsWith('bridge-'));
  const providerDisplayName = selectedProvider
    ? formatProviderName(selectedProvider)
    : (providerNamesCache[provider] || provider || 'Select provider');

  // Selected model display
  const selectedModel = models.find((m) => m.id === model && m.provider === provider);
  const modelDisplay = selectedModel
    ? (selectedModel.name || selectedModel.id).split('/').pop() ?? model
    : model && model !== 'default' ? model.split('/').pop() ?? model : '';

  // Group: bridge vs API
  const bridgeProviders = providers.filter(isBridgeProvider);
  const apiProviders = providers.filter((p) => !isBridgeProvider(p));

  // Models grouped by provider
  const modelsByProvider = useMemo(() => {
    const map: Record<string, ModelInfo[]> = {};
    for (const m of models) {
      if (!map[m.provider]) map[m.provider] = [];
      map[m.provider]!.push(m);
    }
    return map;
  }, [models]);

  const selectProviderAndModel = (p: ProviderInfo, m?: ModelInfo) => {
    setProvider(p.id);
    if (m) {
      setModel(m.id);
    } else if (isBridgeProvider(p)) {
      setModel('default');
    } else {
      const provModels = modelsByProvider[p.id];
      const rec = provModels?.find((pm: ModelInfo) => pm.recommended);
      setModel(rec?.id ?? provModels?.[0]?.id ?? 'default');
    }
    setIsOpen(false);
    setExpandedBridge(null);
  };

  const handleNewChat = () => {
    clearMessages();
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="px-3 py-1.5 border-b border-border dark:border-dark-border space-y-1.5">
      {/* Provider button + New Chat */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg flex-1 min-w-0 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors"
        >
          <span className="font-medium text-text-primary dark:text-dark-text-primary truncate flex-1 text-left">
            {providerDisplayName}
          </span>
          {isBridge ? (
            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-accent/10 text-accent">
              <Bot className="w-3 h-3" />
              {modelDisplay || 'CLI'}
            </span>
          ) : modelDisplay ? (
            <span className="shrink-0 text-text-muted dark:text-dark-text-muted text-xs truncate max-w-[100px]">
              / {modelDisplay}
            </span>
          ) : null}
          <ChevronDown className={`w-3.5 h-3.5 text-text-muted shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        <button
          onClick={handleNewChat}
          title="New Chat"
          className="shrink-0 p-1.5 rounded-lg border border-border dark:border-border hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary"
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg shadow-lg dark:shadow-black/50 max-h-72 overflow-y-auto z-50">

          {/* API Section — always visible, TOP position */}
          <div className="border-b border-border dark:border-dark-border">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider bg-bg-secondary/50 dark:bg-dark-bg-secondary/50">
              API — Context Inject
            </div>
            {apiProviders.length > 0 ? (
              apiProviders.map((p) => {
                const provModels = modelsByProvider[p.id] ?? [];
                const isExpanded = expandedBridge === `api-${p.id}`;
                const isSelected = provider === p.id;
                return (
                  <div key={p.id}>
                    <div
                      onClick={() => {
                        if (provModels.length > 0) {
                          setExpandedBridge(isExpanded ? null : `api-${p.id}`);
                        } else {
                          selectProviderAndModel(p);
                        }
                      }}
                      className={`px-3 py-2 text-sm cursor-pointer hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary flex items-center gap-2 ${
                        isSelected ? 'bg-primary/10' : ''
                      }`}
                    >
                      <Cpu className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                      <span className={`font-medium flex-1 truncate ${isSelected ? 'text-primary' : 'text-text-primary dark:text-dark-text-primary'}`}>
                        {p.name}
                      </span>
                      {provModels.length > 0 && (
                        <span className="text-[10px] text-text-muted">{provModels.length}</span>
                      )}
                      {provModels.length > 0 ? (
                        <ChevronRight className={`w-3 h-3 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      ) : (
                        isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                      )}
                    </div>
                    {isExpanded && provModels.length > 0 && (
                      <div className="bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50">
                        {provModels.map((m: ModelInfo) => {
                          const shortName = (m.name || m.id).split('/').pop() ?? m.id;
                          const isModelSelected = provider === p.id && model === m.id;
                          return (
                            <div
                              key={m.id}
                              onClick={() => selectProviderAndModel(p, m)}
                              className={`pl-9 pr-3 py-1.5 text-xs cursor-pointer hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary flex items-center justify-between ${
                                isModelSelected ? 'text-primary font-medium' : 'text-text-secondary dark:text-dark-text-secondary'
                              }`}
                            >
                              <span className="truncate">{shortName}</span>
                              {isModelSelected && <Check className="w-3 h-3 text-primary shrink-0" />}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="px-3 py-2.5 text-xs text-text-muted dark:text-dark-text-muted">
                No API providers configured —{' '}
                <a
                  href="/models?tab=models"
                  className="text-primary hover:underline not-italic font-medium"
                  onClick={() => setIsOpen(false)}
                >
                  add in Settings
                </a>
              </div>
            )}
          </div>

          {/* Bridge Section */}
          {bridgeProviders.length > 0 && (
            <div>
              <div className="px-3 py-1.5 text-[10px] font-semibold text-text-muted dark:text-dark-text-muted uppercase tracking-wider bg-bg-secondary/50 dark:bg-dark-bg-secondary/50">
                Bridge — CLI Spawn
              </div>
              {bridgeProviders.map((p) => {
                const isExpanded = expandedBridge === p.id;
                const provModels = modelsByProvider[p.id] ?? [];
                const isSelected = provider === p.id;
                const runtime = formatProviderName(p);
                return (
                  <div key={p.id}>
                    <div
                      onClick={() => {
                        if (provModels.length > 0) {
                          setExpandedBridge(isExpanded ? null : p.id);
                        } else {
                          selectProviderAndModel(p);
                        }
                      }}
                      className={`px-3 py-2 text-sm cursor-pointer hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary flex items-center gap-2 ${
                        isSelected ? 'bg-primary/10' : ''
                      }`}
                    >
                      <Terminal className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span className={`font-medium flex-1 truncate ${isSelected ? 'text-primary' : 'text-text-primary dark:text-dark-text-primary'}`}>
                        {runtime}
                      </span>
                      {provModels.length > 0 && (
                        <span className="text-[10px] text-text-muted">{provModels.length}</span>
                      )}
                      {provModels.length > 0 ? (
                        <ChevronRight className={`w-3 h-3 text-text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                      ) : (
                        isSelected && <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                      )}
                    </div>
                    {/* Accordion: models for this bridge provider */}
                    {isExpanded && provModels.length > 0 && (
                      <div className="bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50">
                        {provModels.map((m: ModelInfo) => {
                          const shortName = (m.name || m.id).split('/').pop() ?? m.id;
                          const isModelSelected = provider === p.id && model === m.id;
                          return (
                            <div
                              key={m.id}
                              onClick={() => selectProviderAndModel(p, m)}
                              className={`pl-9 pr-3 py-1.5 text-xs cursor-pointer hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary flex items-center justify-between ${
                                isModelSelected ? 'text-primary font-medium' : 'text-text-secondary dark:text-dark-text-secondary'
                              }`}
                            >
                              <span className="truncate">{shortName}</span>
                              {isModelSelected && <Check className="w-3 h-3 text-primary shrink-0" />}
                            </div>
                          );
                        })}
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
  );
}

function CompactChat() {
  const { messages, isStreaming, streamingContent, sendMessage, setContext, cancelStream } = useSidebarChat();
  const { context } = usePageContext();
  const { config } = usePageCopilotContext();
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync page context path + type into sidebar chat store for X-Project-Dir header
  useEffect(() => {
    setContext(context.path ?? null, context.type ?? null);
  }, [context.path, context.type, setContext]);

  // Auto-scroll to bottom on new messages or streaming content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, streamingContent]);

  // Auto-resize textarea
  const adjustTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 80)}px`;
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    sendMessage(trimmed);
  }, [input, isStreaming, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div className="flex flex-col h-full -m-4">
      {/* Context banner */}
      <ContextBanner />
      {/* Provider selector */}
      <CompactProviderSelector />
      {/* Message list */}
      <div
        ref={scrollRef}
        data-testid="chat-message-list"
        className="flex-1 overflow-y-auto px-3 py-3 space-y-2 min-h-0"
      >
        {messages.length === 0 && !isStreaming && config?.suggestions?.length ? (
          <div className="flex flex-col gap-1.5 px-1 py-2">
            {config.suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => { setInput(s); }}
                className="text-left px-2.5 py-1.5 text-xs text-text-secondary dark:text-dark-text-secondary bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        ) : messages.length === 0 && !isStreaming ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Start a conversation...
            </p>
          </div>
        ) : null}
        {messages.map((msg) => {
          const isUser = msg.role === 'user';
          if (msg.isError) {
            return (
              <div key={msg.id} className="flex justify-start">
                <div className="max-w-[90%] px-2.5 py-1.5 rounded-xl rounded-tl-sm bg-error/10 border border-error/30 text-error text-xs break-words">
                  {msg.content}
                </div>
              </div>
            );
          }
          return (
            <div key={msg.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[90%] px-2.5 py-1.5 rounded-xl text-xs break-words whitespace-pre-wrap ${
                  isUser
                    ? 'rounded-tr-sm bg-primary text-white'
                    : 'rounded-tl-sm bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary'
                }`}
              >
                {isUser
                  ? msg.content
                      .replace(/\n---\n\[ATTACHED CONTEXT[\s\S]*$/, '')
                      .replace(/\n---\n\[TOOL CATALOG[\s\S]*$/, '')
                  : <MarkdownContent content={msg.content} compact />}
              </div>
            </div>
          );
        })}
        {/* Streaming / loading indicator */}
        {isStreaming && (
          <div className="flex justify-start items-center gap-1">
            <div className="max-w-[85%] px-2.5 py-1.5 rounded-xl rounded-tl-sm bg-bg-tertiary dark:bg-dark-bg-tertiary text-xs text-text-primary dark:text-dark-text-primary">
              {streamingContent ? (
                <>
                  <span className="break-words whitespace-pre-wrap">
                    {streamingContent.length > 150
                      ? '...' + streamingContent.slice(-150)
                      : streamingContent}
                  </span>
                  <span className="inline-block w-1 h-3 bg-primary ml-0.5 animate-pulse rounded-sm" />
                </>
              ) : (
                <span className="flex items-center gap-1 text-text-muted dark:text-dark-text-muted">
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
                    <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
                    <span className="w-1 h-1 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
                  </span>
                </span>
              )}
            </div>
            <button
              onClick={cancelStream}
              className="p-1 rounded hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors shrink-0"
              title="Stop generating"
            >
              <StopCircle className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
            </button>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="px-3 py-2 border-t border-border dark:border-dark-border shrink-0">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={textareaRef}
            data-testid="chat-input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              adjustTextarea();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Message..."
            rows={1}
            className="flex-1 resize-none bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-primary dark:text-dark-text-primary text-xs rounded-lg px-2.5 py-1.5 border border-border dark:border-dark-border focus:outline-none focus:border-primary placeholder:text-text-muted dark:placeholder:text-dark-text-muted"
          />
          <button
            data-testid="chat-send-btn"
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="p-1.5 rounded-lg bg-primary text-white disabled:opacity-40 hover:bg-primary-dark transition-colors shrink-0"
            aria-label="Send message"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Stats Panel ----

interface StatsPanelProps {
  isCollapsed: boolean;
  onToggle: () => void;
}

type PanelTab = 'stats' | 'chat';

export function StatsPanel({ isCollapsed, onToggle }: StatsPanelProps) {
  const { status: wsStatus, subscribe } = useGateway();
  const [summary, setSummary] = useState<SummaryData | null>(null);
  const [costs, setCosts] = useState<CostsData | null>(null);
  const [providerCount, setProviderCount] = useState(0);
  const [modelCount, setModelCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<PanelTab>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.STATS_PANEL_TAB);
    return saved === 'chat' ? 'chat' : 'stats';
  });

  const handleTabChange = (tab: PanelTab) => {
    setActiveTab(tab);
    localStorage.setItem(STORAGE_KEYS.STATS_PANEL_TAB, tab);
  };

  const debouncedRefresh = useDebouncedCallback(() => fetchStats(), 2000);

  // Fetch stats only when panel is expanded; poll every 30s
  useEffect(() => {
    if (isCollapsed) return;
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => {
      clearInterval(interval);
    };
  }, [isCollapsed]);

  // WS-triggered refresh
  useEffect(() => {
    const unsubs = [
      subscribe('system:notification', debouncedRefresh),
      subscribe('channel:message', debouncedRefresh),
      subscribe('tool:end', debouncedRefresh),
      subscribe('data:changed', debouncedRefresh),
      subscribe('trigger:executed', debouncedRefresh),
    ];
    return () => unsubs.forEach((fn) => fn());
  }, [subscribe, debouncedRefresh]);

  const fetchStats = async () => {
    try {
      const results = await Promise.allSettled([
        summaryApi.get(),
        costsApi.usage(),
        providersApi.list(),
        modelsApi.list(),
      ]);

      if (results[0].status === 'fulfilled') setSummary(results[0].value);
      if (results[1].status === 'fulfilled') setCosts(results[1].value);
      if (results[2].status === 'fulfilled') {
        const providersList = results[2].value.providers as Array<{ isConfigured?: boolean }>;
        setProviderCount(providersList?.filter((p) => p.isConfigured).length ?? 0);
      }
      if (results[3].status === 'fulfilled') {
        setModelCount(results[3].value.models?.length ?? 0);
      }
    } catch {
      // API client handles error reporting
    } finally {
      setIsLoading(false);
    }
  };

  // Collapsed state
  if (isCollapsed) {
    return (
      <aside className="w-12 border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col">
        <button
          onClick={onToggle}
          className="p-3 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
          title="Expand stats panel"
          aria-label="Expand stats panel"
        >
          <PanelRight className="w-5 h-5 text-text-muted dark:text-dark-text-muted" />
        </button>

        <div className="flex-1 flex flex-col items-center gap-2 py-4">
          {summary && summary.tasks.overdue > 0 && (
            <div
              className="p-2 rounded-lg bg-error/10"
              title={`${summary.tasks.overdue} overdue tasks`}
            >
              <AlertCircle className="w-4 h-4 text-error" />
            </div>
          )}
          <div
            className="p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary"
            title={`${summary?.tasks.total ?? 0} tasks`}
          >
            <CheckCircle2 className="w-4 h-4 text-primary" />
          </div>
          <div
            className="p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary"
            title={`${costs?.daily.totalTokens ?? 0} tokens today`}
          >
            <Hash className="w-4 h-4 text-success" />
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-96 border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col overflow-hidden">
      {/* Header with Tabs */}
      <div className="border-b border-border dark:border-dark-border">
        <div className="flex items-center justify-between px-4 pt-3 pb-0">
          <div className="flex gap-1">
            <button
              data-testid="stats-tab"
              onClick={() => handleTabChange('stats')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-t transition-colors ${
                activeTab === 'stats'
                  ? 'text-primary border-b-2 border-primary bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50'
                  : 'text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              Stats
            </button>
            <button
              data-testid="chat-tab"
              onClick={() => handleTabChange('chat')}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-t transition-colors ${
                activeTab === 'chat'
                  ? 'text-primary border-b-2 border-primary bg-bg-tertiary/50 dark:bg-dark-bg-tertiary/50'
                  : 'text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
              }`}
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Chat
            </button>
          </div>
          <button
            onClick={onToggle}
            className="p-1 hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary rounded transition-colors"
            title="Collapse panel"
            aria-label="Collapse panel"
          >
            <ChevronRight className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
          </button>
        </div>
      </div>

      {/* Tab Content */}
      <div
        className={`flex-1 min-h-0 ${activeTab === 'stats' ? 'overflow-y-auto p-4 space-y-6' : 'flex flex-col overflow-hidden p-4'}`}
        data-testid="tab-content"
      >
        {activeTab === 'stats' ? (
          <>
            {isLoading ? (
              <LoadingSpinner size="sm" message="Loading..." />
            ) : (
              <>
                {/* Quick Add */}
                <QuickAddGrid onCreated={fetchStats} />

                {/* Personal Data */}
                {summary && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                      Personal Data
                    </h4>
                    <StatCard
                      icon={CheckCircle2}
                      label="Tasks"
                      value={summary.tasks.total}
                      subValue={
                        summary.tasks.pending > 0 ? `${summary.tasks.pending} pending` : undefined
                      }
                      color="text-primary"
                      alert={summary.tasks.overdue > 0}
                    />
                    {summary.tasks.overdue > 0 && (
                      <div className="px-3 py-2 bg-error/10 rounded-lg text-xs text-error flex items-center gap-2">
                        <AlertCircle className="w-3 h-3" />
                        {summary.tasks.overdue} overdue task{summary.tasks.overdue > 1 ? 's' : ''}
                      </div>
                    )}
                    {summary.tasks.dueToday > 0 && (
                      <div className="px-3 py-2 bg-warning/10 rounded-lg text-xs text-warning flex items-center gap-2">
                        <Calendar className="w-3 h-3" />
                        {summary.tasks.dueToday} due today
                      </div>
                    )}
                    <StatCard
                      icon={FileText}
                      label="Notes"
                      value={summary.notes.total}
                      subValue={summary.notes.pinned > 0 ? `${summary.notes.pinned} pinned` : undefined}
                      color="text-warning"
                    />
                    <StatCard
                      icon={Calendar}
                      label="Events"
                      value={summary.calendar.total}
                      subValue={
                        summary.calendar.upcoming > 0
                          ? `${summary.calendar.upcoming} upcoming`
                          : undefined
                      }
                      color="text-success"
                    />
                    <StatCard
                      icon={Users}
                      label="Contacts"
                      value={summary.contacts.total}
                      color="text-purple-500"
                    />
                    <StatCard
                      icon={Bookmark}
                      label="Bookmarks"
                      value={summary.bookmarks.total}
                      subValue={
                        summary.bookmarks.favorites > 0
                          ? `${summary.bookmarks.favorites} favorites`
                          : undefined
                      }
                      color="text-blue-500"
                    />
                    {summary.habits && (
                      <StatCard
                        icon={Repeat}
                        label="Habits"
                        value={summary.habits.total}
                        subValue={
                          summary.habits.totalToday > 0
                            ? `${summary.habits.completedToday}/${summary.habits.totalToday} today`
                            : undefined
                        }
                        color="text-emerald-500"
                      />
                    )}
                    {summary.expenses && (
                      <StatCard
                        icon={Receipt}
                        label="Expenses"
                        value={summary.expenses.total}
                        subValue={
                          summary.expenses.thisMonth > 0
                            ? `${summary.expenses.thisMonth.toFixed(0)} this month`
                            : undefined
                        }
                        color="text-orange-500"
                      />
                    )}
                  </div>
                )}

                {/* Usage Stats */}
                {costs && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                      API Usage
                    </h4>
                    <StatCard
                      icon={Hash}
                      label="Tokens Today"
                      value={formatNumber(costs.daily.totalTokens)}
                      color="text-primary"
                    />
                    <StatCard
                      icon={DollarSign}
                      label="Cost Today"
                      value={formatCurrency(costs.daily.totalCost)}
                      color="text-success"
                    />
                    <StatCard
                      icon={TrendingUp}
                      label="This Month"
                      value={formatCurrency(costs.monthly.totalCost)}
                      subValue={`${formatNumber(costs.monthly.totalTokens)} tokens`}
                      color="text-text-secondary"
                    />
                  </div>
                )}

                {/* System Info */}
                <div className="space-y-2">
                  <h4 className="text-xs font-medium text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                    System
                  </h4>
                  <StatCard
                    icon={Brain}
                    label="Providers"
                    value={providerCount}
                    subValue="configured"
                    color="text-primary"
                  />
                  <StatCard
                    icon={Cpu}
                    label="Models"
                    value={modelCount}
                    subValue="available"
                    color="text-text-secondary"
                  />
                </div>
              </>
            )}
          </>
        ) : (
          <CompactChat />
        )}
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border dark:border-dark-border">
        <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
          {wsStatus === 'connected' ? (
            <>
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span>Live</span>
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-text-muted" />
              <span>Updates every 30s</span>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
