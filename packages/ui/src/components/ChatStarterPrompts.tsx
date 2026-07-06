/**
 * ChatStarterPrompts — "For you" / "Examples" tab bar with starter suggestion chips.
 *
 * Extracted from ChatPage.tsx to reduce the parent's complexity. This component
 * owns the personal-starters cache lifecycle and renders the two-tab layout
 * above the chat input when no messages have been sent yet.
 */

import { useState, useEffect } from 'react';
import { AlertCircle, Settings } from './icons';
import { STORAGE_KEYS } from '../constants/storage-keys';
import {
  EXAMPLE_STARTERS,
  STARTER_MENU_TTL_MS,
  getTextList,
  readStarterMenuCache,
  writeStarterMenuCache,
  type StarterPrompt,
} from '../pages/ChatPage.starters';
import {
  tasksApi,
  goalsApi,
  calendarApi,
  notesApi,
  memoriesApi,
  habitsApi,
} from '../api';
import { ignoreError } from '../utils/ignore-error';

interface ChatStarterPromptsProps {
  /** Whether to show the starter prompts (true when messages is empty) */
  show: boolean;
  onSend: (prompt: string) => void;
  onDraftQuestions: (text: string) => void;
  isLoadingModels: boolean;
  configuredProviders: string[];
  currentProviderName: string;
  model: string;
}

/** Placeholder to satisfy the SetupWizard slot in ChatPage */
export function SetupWizardPlaceholder() {
  return (
    <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg mb-4">
      <div className="flex items-center justify-center gap-2 text-warning mb-2">
        <AlertCircle className="w-5 h-5" />
        <span className="font-medium">Setup Required</span>
      </div>
      <p className="text-sm text-text-muted dark:text-dark-text-muted">
        Configure at least one AI provider to start chatting.
      </p>
    </div>
  );
}

export function ChatStarterPrompts({
  show,
  onSend,
  onDraftQuestions,
  isLoadingModels,
  configuredProviders,
  currentProviderName,
  model,
}: ChatStarterPromptsProps) {
  const [starterTab, setStarterTab] = useState<'personal' | 'examples'>('personal');
  const [personalStarters, setPersonalStarters] = useState<StarterPrompt[]>(() => {
    const cached = readStarterMenuCache();
    return cached?.personalPrompts ?? [];
  });
  const [starterMenuCachedAt, setStarterMenuCachedAt] = useState<number | null>(() => {
    const cached = readStarterMenuCache();
    return cached?.createdAt ?? null;
  });

  // Load personal starters on mount
  useEffect(() => {
    let cancelled = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const cached = readStarterMenuCache();
    if (cached) {
      setPersonalStarters(cached.personalPrompts);
      setStarterMenuCachedAt(cached.createdAt);
      refreshTimer = setTimeout(
        () => ignoreError(loadPersonalStarters(), 'chat:refreshPersonalStarters'),
        Math.max(cached.expiresAt - Date.now(), 1_000)
      );
    }

    const today = new Date();
    const weekFromNow = new Date(today);
    weekFromNow.setDate(today.getDate() + 7);
    const isoDate = (date: Date) => date.toISOString().slice(0, 10);

    async function loadPersonalStarters() {
      const [tasksRes, goalsRes, calendarRes, notesRes, memoriesRes, habitsRes] =
        await Promise.allSettled([
          tasksApi.list({ status: ['pending', 'in_progress'] }),
          goalsApi.list({ status: 'active' }),
          calendarApi.list({ start: isoDate(today), end: isoDate(weekFromNow) }),
          notesApi.list({ limit: '5' }),
          memoriesApi.list({ limit: '5' }),
          habitsApi.getToday(),
        ]);

      if (cancelled) return;

      const prompts: StarterPrompt[] = [];
      if (tasksRes.status === 'fulfilled' && tasksRes.value.length > 0) {
        const highPriority = tasksRes.value
          .filter((task) => task.priority === 'urgent' || task.priority === 'high')
          .slice(0, 3);
        const taskNames = getTextList(
          (highPriority.length ? highPriority : tasksRes.value).map((task) => task.title)
        );
        prompts.push({
          icon: '✅',
          label: `${tasksRes.value.length} open task${tasksRes.value.length === 1 ? '' : 's'}`,
          detail: taskNames || 'Prioritize what is active',
          source: 'personal',
          prompt: `Look at my current open tasks, especially these: ${taskNames || 'the highest priority ones'}. Help me prioritize them, pick the next concrete action, and identify anything I should defer.`,
        });
      }

      if (goalsRes.status === 'fulfilled' && goalsRes.value.goals.length > 0) {
        const goal = [...goalsRes.value.goals].sort((a, b) => b.priority - a.priority)[0]!;
        prompts.push({
          icon: '🎯',
          label: 'Advance a goal',
          detail: `${goal.title}${goal.progress ? ` (${goal.progress}% done)` : ''}`,
          source: 'personal',
          prompt: `Help me make progress on this goal: "${goal.title}". Review what I know about it, identify the next milestone, and give me a focused action plan for the next 7 days.`,
        });
      }

      if (calendarRes.status === 'fulfilled' && calendarRes.value.length > 0) {
        const eventNames = getTextList(calendarRes.value.map((event) => event.title));
        prompts.push({
          icon: '📅',
          label: 'Prep my week',
          detail: eventNames || 'Upcoming calendar events',
          source: 'personal',
          prompt: `Review my upcoming calendar for the next 7 days, especially: ${eventNames}. Help me prepare, spot conflicts, and turn meetings/events into a practical checklist.`,
        });
      }

      if (habitsRes.status === 'fulfilled' && habitsRes.value.total > 0) {
        const incomplete = habitsRes.value.habits.filter((habit) => !habit.completedToday);
        prompts.push({
          icon: '🌱',
          label: 'Check habits',
          detail:
            incomplete.length > 0
              ? `${incomplete.length} still open today`
              : 'All habits done today',
          source: 'personal',
          prompt:
            incomplete.length > 0
              ? `My unfinished habits today are: ${getTextList(
                  incomplete.map((habit) => habit.name),
                  5
                )}. Help me fit them into the rest of the day without overloading myself.`
              : 'Review my habit progress for today and suggest how to keep the streak going tomorrow.',
        });
      }

      if (notesRes.status === 'fulfilled' && notesRes.value.length > 0) {
        const noteTitles = getTextList(notesRes.value.map((note) => note.title));
        prompts.push({
          icon: '🗂️',
          label: 'Connect my notes',
          detail: noteTitles || 'Recent notes',
          source: 'personal',
          prompt: `Look at my recent notes, including: ${noteTitles}. Find patterns, summarize the useful parts, and suggest follow-up actions or tags.`,
        });
      }

      if (memoriesRes.status === 'fulfilled' && memoriesRes.value.memories.length > 0) {
        prompts.push({
          icon: '🧠',
          label: 'Use my memory',
          detail: `${memoriesRes.value.memories.length} recent memories`,
          source: 'personal',
          prompt:
            'Use my saved memories and preferences to recommend how I should work with you today. Be specific: tone, planning style, likely priorities, and what you should remember to avoid.',
        });
      }

      const nextPrompts = prompts.slice(0, 6);
      writeStarterMenuCache(nextPrompts);
      setPersonalStarters(nextPrompts);
      setStarterMenuCachedAt(Date.now());
      if (!cancelled) {
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(
          () => ignoreError(loadPersonalStarters(), 'chat:refreshPersonalStarters'),
          STARTER_MENU_TTL_MS
        );
      }
    }

    if (!cached) {
      ignoreError(loadPersonalStarters(), 'chat:loadPersonalStarters');
    }

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, []);

  const showSetupWizard =
    show &&
    !isLoadingModels &&
    configuredProviders.length === 0 &&
    localStorage.getItem(STORAGE_KEYS.SETUP_COMPLETE) !== 'true';

  const showNoProviders =
    show &&
    !isLoadingModels && configuredProviders.length === 0;

  if (!show) return null;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md">
          <h3 className="text-xl font-medium text-text-primary dark:text-dark-text-primary mb-2">
            Welcome to OwnPilot
          </h3>

          {showSetupWizard ? (
            <SetupWizardPlaceholder />
          ) : showNoProviders ? (
            <NoProvidersMessage />
          ) : (
            <DefaultWelcome
              currentProviderName={currentProviderName}
              model={model}
            />
          )}

          <StarterGrid
            starterTab={starterTab}
            personalStarters={personalStarters}
            starterMenuCachedAt={starterMenuCachedAt}
            onSend={onSend}
            onDraftQuestions={onDraftQuestions}
            onTabChange={setStarterTab}
          />
        </div>
      </div>
    </div>
  );
}

// ---- Sub-components ----

function SetupWizardPlaceholder() {
  return (
    <div className="p-4 bg-warning/10 border border-warning/20 rounded-lg mb-4">
      <div className="flex items-center justify-center gap-2 text-warning mb-2">
        <AlertCircle className="w-5 h-5" />
        <span className="font-medium">Setup Required</span>
      </div>
      <p className="text-sm text-text-muted dark:text-dark-text-muted">
        Configure at least one AI provider to start chatting.
      </p>
    </div>
  );
}

function NoProvidersMessage() {
  return (
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
  );
}

function DefaultWelcome({
  currentProviderName,
  model,
}: {
  currentProviderName: string;
  model: string;
}) {
  return (
    <>
      <p className="text-text-muted dark:text-dark-text-muted mb-2">
        Start a conversation by typing a message below.
      </p>
      <p className="text-sm text-text-muted dark:text-dark-text-muted mb-4">
        Currently using:{' '}
        <span className="font-medium text-primary">{currentProviderName}</span> /{' '}
        <span className="font-mono">{model}</span>
      </p>
    </>
  );
}

interface StarterGridProps {
  starterTab: 'personal' | 'examples';
  personalStarters: StarterPrompt[];
  starterMenuCachedAt: number | null;
  onSend: (prompt: string) => void;
  onDraftQuestions: (text: string) => void;
  onTabChange: (tab: 'personal' | 'examples') => void;
}

function StarterGrid({
  starterTab,
  personalStarters,
  starterMenuCachedAt,
  onSend,
  onDraftQuestions,
  onTabChange,
}: StarterGridProps) {
  return (
    <div className="max-w-2xl mx-auto">
      {/* Tab bar */}
      <div className="inline-flex items-center gap-1 p-1 mb-3 rounded-lg bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border">
        {([
          { id: 'personal' as const, label: 'For you', count: personalStarters.length },
          { id: 'examples' as const, label: 'Examples', count: EXAMPLE_STARTERS.length },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
              starterTab === tab.id
                ? 'bg-bg-primary dark:bg-dark-bg-primary text-primary shadow-sm'
                : 'text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
            }`}
          >
            {tab.label}
            {tab.count > 0 && <span className="ml-1 opacity-60">{tab.count}</span>}
          </button>
        ))}
      </div>

      {starterTab === 'personal' && personalStarters.length === 0 && (
        <div className="mb-3 rounded-lg border border-border dark:border-dark-border bg-bg-secondary/60 dark:bg-dark-bg-secondary/60 px-4 py-3 text-sm text-text-muted dark:text-dark-text-muted">
          Add tasks, goals, notes, calendar events, memories, or habits and this area
          will turn into personalized starter questions. The menu is cached for at
          least 1 hour, so New Chat keeps the same suggestions.
        </div>
      )}

      {/* Starter chips */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {(starterTab === 'personal' && personalStarters.length > 0
          ? personalStarters
          : EXAMPLE_STARTERS
        )
          .slice(0, starterTab === 'personal' ? 4 : 6)
          .map((item) => (
            <button
              key={`${item.source}-${item.label}`}
              onClick={() => onSend(item.prompt)}
              className="flex items-start gap-3 px-3 py-3 text-left rounded-xl border border-border dark:border-dark-border hover:border-primary/40 dark:hover:border-primary/40 hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-all group"
            >
              <span className="text-base shrink-0 mt-0.5">{item.icon}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-text-secondary dark:text-dark-text-secondary group-hover:text-text-primary dark:group-hover:text-dark-text-primary transition-colors">
                  {item.label}
                </span>
                <span className="block text-xs text-text-muted dark:text-dark-text-muted truncate">
                  {item.detail}
                </span>
              </span>
            </button>
          ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
        <span>
          {starterTab === 'personal' && starterMenuCachedAt
            ? `Personalized menu cached at ${new Date(starterMenuCachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'Personalized suggestions refresh hourly when data is available'}
        </span>
        <span className="hidden sm:inline">•</span>
        <button
          type="button"
          onClick={() =>
            onDraftQuestions(
              'Ask me 5 sharp questions based on my tasks, notes, calendar, goals, memories, and habits. Use my real data where available, and explain why each question matters.'
            )
          }
          className="text-primary hover:underline"
        >
          Draft custom questions
        </button>
      </div>
    </div>
  );
}
