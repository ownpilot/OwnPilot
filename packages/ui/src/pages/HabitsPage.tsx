import { useState, useEffect, useCallback, type ComponentType } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useGateway } from '../hooks/useWebSocket';
import {
  Plus,
  Trash2,
  Zap,
  Target,
  CheckCircle2,
  Circle,
  Archive,
  Home,
  ListChecks,
  Repeat,
  Sparkles,
  TrendingUp,
  Activity,
  Calendar,
  Edit,
  RefreshCw,
  AlertTriangle,
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { SkeletonCard } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { useModalClose, useDebouncedCallback } from '../hooks';
import { useAnimatedList } from '../hooks/useAnimatedList';
import { habitsApi, type Habit, type HabitWithTodayStatus } from '../api/endpoints/personal-data';
import { PageHomeTab } from '../components/PageHomeTab';

// ============================================================================
// Streak Colors
// ============================================================================

function streakColor(days: number): string {
  if (days === 0) return 'text-text-muted dark:text-dark-text-muted';
  if (days < 7) return 'text-emerald-400';
  if (days < 30) return 'text-emerald-500';
  return 'text-amber-500'; // 30+ day streak gets gold
}

function streakBg(days: number): string {
  if (days === 0) return 'bg-text-muted/10';
  if (days < 7) return 'bg-emerald-500/10';
  if (days < 30) return 'bg-emerald-500/15';
  return 'bg-amber-500/15';
}

const frequencyLabels: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  weekdays: 'Weekdays',
  custom: 'Custom',
};

// ============================================================================
// Streak Heatmap Component (last 28 days)
// ============================================================================

function StreakHeatmap({ habit }: { habit: Habit }) {
  // Generate last 28 days visual based on streak data
  // Since we don't have per-day log data in the list response,
  // we visualize using streak + total completions as an approximation
  const cells = Array.from({ length: 28 }, (_, i) => {
    const daysAgo = 27 - i;
    // If within current streak, show as completed
    const completed = daysAgo < habit.streakCurrent;
    return completed;
  });

  return (
    <div className="flex gap-[2px]">
      {cells.map((completed, i) => (
        <div
          key={i}
          className={`w-2.5 h-2.5 rounded-[2px] transition-colors ${
            completed ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-border dark:bg-dark-border'
          }`}
          title={`${27 - i} days ago`}
        />
      ))}
    </div>
  );
}

// ============================================================================
// Page
// ============================================================================

export function HabitsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { confirm } = useDialog();
  const toast = useToast();
  const { subscribe } = useGateway();

  type TabId = 'home' | 'habits';

  // Skip home preference from localStorage
  const SKIP_HOME_KEY = 'ownpilot:habits:skipHome';
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

  const tabParam = searchParams.get('tab') as TabId | null;
  const activeTab: TabId =
    tabParam && (['home', 'habits'] as string[]).includes(tabParam) ? tabParam : 'home';
  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  // Auto-redirect to habits if skipHome is enabled and no explicit tab param
  useEffect(() => {
    if (skipHome && !tabParam) {
      const params = new URLSearchParams(searchParams);
      params.set('tab', 'habits');
      navigate({ search: params.toString() }, { replace: true });
    }
  }, [skipHome, tabParam, searchParams, navigate]);

  const [habits, setHabits] = useState<Habit[]>([]);
  const [todayHabits, setTodayHabits] = useState<HabitWithTodayStatus[]>([]);
  const [todayProgress, setTodayProgress] = useState({ total: 0, completed: 0, rate: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editHabit, setEditHabit] = useState<Habit | null>(null);
  const [filter, setFilter] = useState<'active' | 'archived'>('active');
  const [selectedHabit, setSelectedHabit] = useState<Habit | null>(null);
  const [habitStats, setHabitStats] = useState<Record<string, unknown> | null>(null);
  const { animatedItems, handleDelete: animatedDelete } = useAnimatedList(habits);

  // ---- Data fetching ----

  const fetchHabits = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [listRes, todayRes] = await Promise.all([
        habitsApi.list({ archived: filter === 'archived' ? 'true' : 'false' }),
        habitsApi.getToday(),
      ]);
      setHabits(listRes.habits ?? []);
      setTodayHabits(todayRes.habits ?? []);
      setTodayProgress({
        total: todayRes.total ?? 0,
        completed: todayRes.completed ?? 0,
        rate: todayRes.percentage ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load habits');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    fetchHabits();
  }, [fetchHabits]);

  const debouncedRefresh = useDebouncedCallback(() => fetchHabits(), 2000);

  useEffect(() => {
    const unsub = subscribe<{ entity: string }>('data:changed', (data) => {
      if (data.entity === 'habit') debouncedRefresh();
    });
    return () => unsub();
  }, [subscribe, debouncedRefresh]);

  // ---- Actions ----

  const handleLog = async (habitId: string) => {
    try {
      await habitsApi.log(habitId);
      toast.success('Habit logged!');
      fetchHabits();
    } catch {
      toast.error('Failed to log habit');
    }
  };

  const handleDelete = async (habit: Habit) => {
    const ok = await confirm({
      title: 'Delete Habit',
      message: `Permanently delete "${habit.name}" and all its logs?`,
      confirmText: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await animatedDelete(habit.id, async () => {
        await habitsApi.delete(habit.id);
      });
      toast.success('Habit deleted');
      fetchHabits();
    } catch {
      toast.error('Failed to delete habit');
    }
  };

  const handleArchive = async (habit: Habit) => {
    try {
      await habitsApi.archive(habit.id);
      toast.success('Habit archived');
      fetchHabits();
    } catch {
      toast.error('Failed to archive');
    }
  };

  const handleUnarchive = async (habit: Habit) => {
    try {
      await habitsApi.update(habit.id, { isArchived: false });
      toast.success('Habit restored');
      fetchHabits();
    } catch {
      toast.error('Failed to restore');
    }
  };

  const openDetails = async (habit: Habit) => {
    setSelectedHabit(habit);
    try {
      const stats = await habitsApi.getStats(habit.id);
      setHabitStats(stats);
    } catch {
      setHabitStats(null);
    }
  };

  // ---- Stats ----

  const activeCount = habits.filter((h) => !h.isArchived).length;
  const bestStreak = Math.max(0, ...habits.map((h) => h.streakLongest));
  const totalCompletions = habits.reduce((s, h) => s + h.totalCompletions, 0);

  // ---- Tabs ----

  const tabs: Array<{ id: TabId; label: string; icon: ComponentType<{ className?: string }> }> = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'habits', label: 'Habits', icon: ListChecks },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="shrink-0 border-b border-border dark:border-dark-border px-4 bg-surface dark:bg-dark-surface">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text dark:hover:text-dark-text'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
          {/* Quick stats in tab bar */}
          <div className="ml-auto flex items-center gap-3 text-xs text-text-muted dark:text-dark-text-muted">
            <span>{activeCount} active</span>
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-500" />
              {todayProgress.completed}/{todayProgress.total} today
            </span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'home' && (
          <PageHomeTab
            heroIcons={[
              { icon: Repeat, color: 'text-primary bg-primary/10' },
              { icon: Zap, color: 'text-amber-500 bg-amber-500/10' },
              { icon: TrendingUp, color: 'text-emerald-500 bg-emerald-500/10' },
            ]}
            title="Build Better Habits"
            subtitle="Track daily routines, build streaks, and let your AI help you stay consistent with habit tracking."
            cta={{
              label: 'Create Habit',
              icon: Plus,
              onClick: () => {
                setTab('habits');
                setShowCreate(true);
              },
            }}
            skipHomeChecked={skipHome}
            onSkipHomeChange={handleSkipHomeChange}
            skipHomeLabel="Skip this screen and go directly to Habits"
            features={[
              {
                icon: Zap,
                color: 'text-amber-500 bg-amber-500/10',
                title: 'Streak Tracking',
                description:
                  'Build momentum with automatic streak counting. See your current and longest streaks at a glance.',
              },
              {
                icon: Calendar,
                color: 'text-emerald-500 bg-emerald-500/10',
                title: 'Flexible Scheduling',
                description:
                  'Daily, weekdays, weekly, or custom frequency. Set target counts and units.',
              },
              {
                icon: Sparkles,
                color: 'text-violet-500 bg-violet-500/10',
                title: 'AI Coaching',
                description:
                  'Your AI can log habits, check streaks, and motivate you during conversations.',
              },
              {
                icon: Activity,
                color: 'text-primary bg-primary/10',
                title: 'Progress Insights',
                description:
                  'Track completion rates, total completions, and visualize your consistency over time.',
              },
            ]}
            steps={[
              {
                title: 'Create a habit',
                detail: 'Click "Create Habit" and set name, frequency, and target.',
              },
              { title: 'Log daily', detail: 'Check off habits as you complete them each day.' },
              {
                title: 'Build streaks',
                detail: 'Watch your streak grow as you maintain consistency.',
              },
              {
                title: 'Track progress',
                detail: 'View stats, completion rates, and your longest streaks.',
              },
            ]}
          >
            {/* Today's habits preview */}
            {todayHabits.length > 0 && (
              <div className="rounded-xl border border-border dark:border-dark-border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Today&apos;s Progress</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    {todayProgress.completed}/{todayProgress.total}
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-2 rounded-full bg-border dark:bg-dark-border overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                    style={{
                      width: `${todayProgress.total > 0 ? (todayProgress.completed / todayProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                <div className="space-y-1.5">
                  {todayHabits.slice(0, 5).map((h) => (
                    <div key={h.id} className="flex items-center gap-2.5 text-sm">
                      <button
                        onClick={() => !h.completedToday && handleLog(h.id)}
                        className={`shrink-0 transition-transform active:scale-90 ${
                          h.completedToday
                            ? 'text-emerald-500'
                            : 'text-text-muted dark:text-dark-text-muted hover:text-primary'
                        }`}
                      >
                        {h.completedToday ? (
                          <CheckCircle2 className="w-4.5 h-4.5" />
                        ) : (
                          <Circle className="w-4.5 h-4.5" />
                        )}
                      </button>
                      <span className={h.completedToday ? 'line-through opacity-50' : ''}>
                        {h.name}
                      </span>
                      {h.streakCurrent > 0 && (
                        <span
                          className={`ml-auto flex items-center gap-0.5 text-xs font-medium ${streakColor(h.streakCurrent)}`}
                        >
                          <Zap className="w-3 h-3" />
                          {h.streakCurrent}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </PageHomeTab>
        )}

        {activeTab === 'habits' && (
          <>
            {/* Filters */}
            <div className="flex gap-2 px-6 py-3 border-b border-border dark:border-dark-border">
              {(['active', 'archived'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    filter === f
                      ? 'bg-primary text-white'
                      : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary'
                  }`}
                >
                  {f === 'active' ? `Active (${activeCount})` : 'Archived'}
                </button>
              ))}
              <div className="flex-1" />
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                New Habit
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 animate-fade-in-up">
              {loading ? (
                <div className="space-y-3">
                  <SkeletonCard />
                  <SkeletonCard />
                  <SkeletonCard />
                </div>
              ) : error ? (
                <EmptyState
                  icon={AlertTriangle}
                  title="Failed to load habits"
                  description={error}
                  variant="card"
                  action={{
                    label: 'Try Again',
                    onClick: fetchHabits,
                    icon: RefreshCw,
                  }}
                />
              ) : habits.length === 0 ? (
                <EmptyState
                  icon={Target}
                  title={filter === 'archived' ? 'No archived habits' : 'No habits yet'}
                  description={
                    filter === 'archived'
                      ? 'Archive habits you no longer track to keep your list clean.'
                      : 'Create your first habit to start building consistent routines and track your progress.'
                  }
                  variant="card"
                  iconBgColor="bg-emerald-500/10 dark:bg-emerald-500/20"
                  iconColor="text-emerald-500"
                  action={
                    filter === 'active'
                      ? { label: 'Create Habit', icon: Plus, onClick: () => setShowCreate(true) }
                      : undefined
                  }
                />
              ) : (
                <div className="space-y-3">
                  {animatedItems.map(({ item: habit, animClass }) => (
                    <div key={habit.id} className={animClass}>
                      <div className="flex items-start gap-4 p-4 rounded-xl bg-surface dark:bg-dark-surface border border-border dark:border-dark-border hover:border-primary/30 transition-all group">
                        {/* Check-in button */}
                        {!habit.isArchived && (
                          <button
                            onClick={() => handleLog(habit.id)}
                            className="mt-1 shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/20 active:scale-95 transition-all"
                            title="Log completion"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            Check In
                          </button>
                        )}

                        {/* Content */}
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => openDetails(habit)}
                              className="font-medium hover:text-primary transition-colors text-left"
                            >
                              {habit.name}
                            </button>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary">
                              {frequencyLabels[habit.frequency] ?? habit.frequency}
                            </span>
                            {habit.category && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted">
                                {habit.category}
                              </span>
                            )}
                            {habit.targetCount > 1 && (
                              <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
                                {habit.targetCount}x{habit.unit ? `/${habit.unit}` : ''}
                              </span>
                            )}
                          </div>

                          {habit.description && (
                            <p className="text-xs text-text-muted dark:text-dark-text-muted line-clamp-1">
                              {habit.description}
                            </p>
                          )}

                          {/* Streak + Stats Row */}
                          <div className="flex items-center gap-4">
                            {/* Current Streak Badge */}
                            <div
                              className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${streakBg(habit.streakCurrent)} ${streakColor(habit.streakCurrent)}`}
                            >
                              <Zap className="w-3 h-3" />
                              {habit.streakCurrent}d streak
                            </div>
                            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
                              Best: {habit.streakLongest}d
                            </span>
                            <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
                              {habit.totalCompletions} total
                            </span>
                            {/* Streak Heatmap */}
                            <div className="hidden sm:block ml-auto">
                              <StreakHeatmap habit={habit} />
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditHabit(habit)}
                            className="p-1.5 rounded hover:bg-primary/10 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
                            title="Edit"
                          >
                            <Edit className="w-3.5 h-3.5" />
                          </button>
                          {habit.isArchived ? (
                            <button
                              onClick={() => handleUnarchive(habit)}
                              className="p-1.5 rounded hover:bg-primary/10 text-text-muted dark:text-dark-text-muted hover:text-primary transition-colors"
                              title="Restore"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              onClick={() => handleArchive(habit)}
                              className="p-1.5 rounded hover:bg-amber-500/10 text-text-muted dark:text-dark-text-muted hover:text-amber-500 transition-colors"
                              title="Archive"
                            >
                              <Archive className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button
                            onClick={() => handleDelete(habit)}
                            className="p-1.5 rounded hover:bg-error/10 text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Summary footer */}
                  <div className="flex items-center justify-center gap-6 py-4 text-xs text-text-muted dark:text-dark-text-muted">
                    <span>{activeCount} habits</span>
                    <span>Best streak: {bestStreak}d</span>
                    <span>{totalCompletions} total completions</span>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Detail Panel */}
      {selectedHabit && (
        <HabitDetailPanel
          habit={selectedHabit}
          stats={habitStats}
          onClose={() => {
            setSelectedHabit(null);
            setHabitStats(null);
          }}
          onLog={() => {
            handleLog(selectedHabit.id);
          }}
        />
      )}

      {/* Create/Edit Modal */}
      {(showCreate || editHabit) && (
        <HabitModal
          habit={editHabit}
          onClose={() => {
            setShowCreate(false);
            setEditHabit(null);
          }}
          onSaved={() => {
            setShowCreate(false);
            setEditHabit(null);
            fetchHabits();
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Habit Detail Panel
// ============================================================================

function HabitDetailPanel({
  habit,
  stats,
  onClose,
  onLog,
}: {
  habit: Habit;
  stats: Record<string, unknown> | null;
  onClose: () => void;
  onLog: () => void;
}) {
  const { onBackdropClick } = useModalClose(onClose);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onBackdropClick}
    >
      <div className="w-full max-w-lg mx-4 rounded-xl bg-white dark:bg-zinc-900 border border-border dark:border-dark-border shadow-2xl animate-fade-in-up max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border dark:border-dark-border">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">{habit.name}</h2>
              {habit.description && (
                <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
                  {habit.description}
                </p>
              )}
            </div>
            {!habit.isArchived && (
              <button
                onClick={onLog}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 active:scale-95 transition-all"
              >
                <CheckCircle2 className="w-4 h-4" />
                Check In
              </button>
            )}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="px-5 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="text-center p-3 rounded-lg bg-amber-500/10">
            <div className="flex items-center justify-center gap-1 text-amber-600 dark:text-amber-400 mb-1">
              <Zap className="w-4 h-4" />
            </div>
            <div className="text-xl font-bold text-amber-600 dark:text-amber-400">
              {habit.streakCurrent}
            </div>
            <div className="text-[10px] text-text-muted dark:text-dark-text-muted">
              Current Streak
            </div>
          </div>
          <div className="text-center p-3 rounded-lg bg-emerald-500/10">
            <div className="flex items-center justify-center gap-1 text-emerald-600 dark:text-emerald-400 mb-1">
              <TrendingUp className="w-4 h-4" />
            </div>
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
              {habit.streakLongest}
            </div>
            <div className="text-[10px] text-text-muted dark:text-dark-text-muted">Best Streak</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-primary/10">
            <div className="flex items-center justify-center gap-1 text-primary mb-1">
              <Target className="w-4 h-4" />
            </div>
            <div className="text-xl font-bold text-primary">{habit.totalCompletions}</div>
            <div className="text-[10px] text-text-muted dark:text-dark-text-muted">Total Done</div>
          </div>
          <div className="text-center p-3 rounded-lg bg-violet-500/10">
            <div className="flex items-center justify-center gap-1 text-violet-600 dark:text-violet-400 mb-1">
              <Activity className="w-4 h-4" />
            </div>
            <div className="text-xl font-bold text-violet-600 dark:text-violet-400">
              {stats && typeof stats.completionRate === 'number'
                ? `${Math.round(stats.completionRate as number)}%`
                : '—'}
            </div>
            <div className="text-[10px] text-text-muted dark:text-dark-text-muted">
              Completion Rate
            </div>
          </div>
        </div>

        {/* Streak Heatmap (larger) */}
        <div className="px-5 pb-4">
          <h3 className="text-xs font-medium text-text-muted dark:text-dark-text-muted mb-2">
            Last 28 Days
          </h3>
          <div className="flex gap-[3px] flex-wrap">
            {Array.from({ length: 28 }, (_, i) => {
              const daysAgo = 27 - i;
              const completed = daysAgo < habit.streakCurrent;
              const date = new Date();
              date.setDate(date.getDate() - daysAgo);
              const label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
              return (
                <div
                  key={i}
                  className={`w-5 h-5 rounded transition-colors ${
                    completed
                      ? 'bg-emerald-500 dark:bg-emerald-400'
                      : 'bg-border dark:bg-dark-border'
                  }`}
                  title={`${label}${completed ? ' - Completed' : ''}`}
                />
              );
            })}
          </div>
        </div>

        {/* Details */}
        <div className="px-5 pb-4 space-y-2 text-sm">
          <div className="flex justify-between py-1.5 border-t border-border dark:border-dark-border">
            <span className="text-text-muted dark:text-dark-text-muted">Frequency</span>
            <span className="font-medium capitalize">{habit.frequency}</span>
          </div>
          {habit.targetCount > 1 && (
            <div className="flex justify-between py-1.5">
              <span className="text-text-muted dark:text-dark-text-muted">Target</span>
              <span className="font-medium">
                {habit.targetCount}x{habit.unit ? ` ${habit.unit}` : ''}
              </span>
            </div>
          )}
          {habit.category && (
            <div className="flex justify-between py-1.5">
              <span className="text-text-muted dark:text-dark-text-muted">Category</span>
              <span className="font-medium">{habit.category}</span>
            </div>
          )}
          <div className="flex justify-between py-1.5">
            <span className="text-text-muted dark:text-dark-text-muted">Created</span>
            <span className="font-medium">{new Date(habit.createdAt).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border dark:border-dark-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-text-muted dark:text-dark-text-muted hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Create/Edit Modal
// ============================================================================

function HabitModal({
  habit,
  onClose,
  onSaved,
}: {
  habit: Habit | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { onBackdropClick } = useModalClose(onClose);

  const [name, setName] = useState(habit?.name ?? '');
  const [description, setDescription] = useState(habit?.description ?? '');
  const [frequency, setFrequency] = useState(habit?.frequency ?? 'daily');
  const [targetCount, setTargetCount] = useState(habit?.targetCount ?? 1);
  const [unit, setUnit] = useState(habit?.unit ?? '');
  const [category, setCategory] = useState(habit?.category ?? '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || undefined,
        frequency,
        targetCount,
        unit: unit.trim() || undefined,
        category: category.trim() || undefined,
      };
      if (habit) {
        await habitsApi.update(habit.id, body);
        toast.success('Habit updated');
      } else {
        await habitsApi.create(body);
        toast.success('Habit created');
      }
      onSaved();
    } catch {
      toast.error(habit ? 'Failed to update habit' : 'Failed to create habit');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full px-3 py-2 rounded-lg border border-border dark:border-dark-border bg-bg-tertiary dark:bg-dark-bg-tertiary text-sm text-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onBackdropClick}
    >
      <div className="w-full max-w-md mx-4 rounded-xl bg-white dark:bg-zinc-900 border border-border dark:border-dark-border shadow-2xl animate-fade-in-up">
        <div className="px-5 py-4 border-b border-border dark:border-dark-border">
          <h2 className="text-lg font-semibold">{habit ? 'Edit Habit' : 'New Habit'}</h2>
          <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
            {habit ? 'Update your habit settings' : 'Define a routine to track consistently'}
          </p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
              Habit Name *
            </label>
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Morning exercise, Read 30 min, Meditate"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
              Description
            </label>
            <input
              className={inputClass}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details about this habit"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
                Frequency
              </label>
              <select
                className={inputClass}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
                Target Count
              </label>
              <input
                type="number"
                min={1}
                className={inputClass}
                value={targetCount}
                onChange={(e) => setTargetCount(Number(e.target.value) || 1)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
                Unit
              </label>
              <input
                className={inputClass}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="e.g., minutes, pages, glasses"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary dark:text-dark-text-secondary mb-1.5">
                Category
              </label>
              <input
                className={inputClass}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., health, learning"
              />
            </div>
          </div>
        </div>
        <div className="px-5 py-3 border-t border-border dark:border-dark-border flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-text-muted dark:text-dark-text-muted hover:bg-bg-secondary dark:hover:bg-dark-bg-secondary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : habit ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
