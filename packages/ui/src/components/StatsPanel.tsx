/**
 * Stats Panel Component
 *
 * Right sidebar displaying real-time stats:
 * - Personal data counts (tasks, notes, etc.)
 * - Token/cost usage (actual data)
 * - Provider/model info
 */

import { useState, useEffect, useRef, useCallback } from 'react';
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
  Link,
  Zap,
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

function CompactProviderSelector() {
  const { provider, model, setProvider, setModel } = useSidebarChat();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    providersApi.list().then((data) => {
      const configured = (data.providers as ProviderInfo[]).filter((p) => p.isConfigured) ?? [];
      setProviders(configured);
    }).catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const selectedProvider = providers.find((p) => p.id === provider);
  const isBridge = selectedProvider ? isBridgeProvider(selectedProvider) : provider.startsWith('bridge-');
  const providerDisplayName = selectedProvider ? formatProviderName(selectedProvider) : (provider || 'Auto');
  const modelShort = isBridge
    ? (selectedProvider?.name ?? provider)
        .replace('bridge-', '')
        .replace('Claude Code (Bridge)', 'claude')
        .toUpperCase()
        .slice(0, 8)
    : model && model !== 'default'
    ? (model.split('/').pop()?.slice(0, 8).toUpperCase() ?? 'AUTO')
    : 'AUTO';

  const bridgeProviders = providers.filter(isBridgeProvider);
  const apiProviders = providers.filter((p) => !isBridgeProvider(p));

  const selectProvider = (p: ProviderInfo) => {
    setProvider(p.id);
    if (isBridgeProvider(p)) {
      setModel('default');
    }
    setIsOpen(false);
  };

  const ProviderIcon = isBridge ? Link : Zap;

  return (
    <div ref={dropdownRef} className="relative px-3 py-1.5 border-b border-border dark:border-dark-border">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 text-[11px] bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-md w-full hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors"
      >
        <ProviderIcon className={`w-3 h-3 shrink-0 ${isBridge ? 'text-green-500' : 'text-blue-500'}`} />
        <span className="font-medium text-text-primary dark:text-dark-text-primary truncate flex-1 text-left">
          {providerDisplayName}
        </span>
        <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-accent/10 text-accent">
          {modelShort}
        </span>
        <ChevronDown className="w-3 h-3 text-text-muted dark:text-dark-text-muted shrink-0" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg shadow-lg max-h-48 overflow-y-auto z-50">
          {bridgeProviders.length > 0 && (
            <>
              <div className="px-2 py-1 text-[10px] text-text-muted dark:text-dark-text-muted uppercase tracking-wider">
                Bridge
              </div>
              {bridgeProviders.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectProvider(p)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
                >
                  <Link className="w-3 h-3 text-green-500 shrink-0" />
                  <span className="truncate flex-1 text-left text-text-primary dark:text-dark-text-primary">
                    {formatProviderName(p)}
                  </span>
                  {provider === p.id && <Check className="w-3 h-3 text-primary shrink-0" />}
                </button>
              ))}
            </>
          )}
          {apiProviders.length > 0 && (
            <>
              <div
                className={`px-2 py-1 text-[10px] text-text-muted dark:text-dark-text-muted uppercase tracking-wider${bridgeProviders.length > 0 ? ' border-t border-border dark:border-dark-border' : ''}`}
              >
                API
              </div>
              {apiProviders.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectProvider(p)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
                >
                  <Zap className="w-3 h-3 text-blue-500 shrink-0" />
                  <span className="truncate flex-1 text-left text-text-primary dark:text-dark-text-primary">
                    {p.name}
                  </span>
                  {provider === p.id && <Check className="w-3 h-3 text-primary shrink-0" />}
                </button>
              ))}
            </>
          )}
          {providers.length === 0 && (
            <div className="px-3 py-3 text-xs text-text-muted dark:text-dark-text-muted text-center">
              No providers configured
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
    <aside className="w-80 border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col overflow-hidden">
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
