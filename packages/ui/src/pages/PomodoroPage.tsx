import { useState, useEffect, useCallback, useRef } from 'react';
import { useGateway } from '../hooks/useWebSocket';
import {
  Pause,
  RotateCcw,
  Target,
  CheckCircle2,
  Zap,
} from '../components/icons';
import { useToast } from '../components/ToastProvider';
import { useDebouncedCallback } from '../hooks';
import { pomodoroApi, type PomodoroSession, type PomodoroStats } from '../api/endpoints/personal-data';

// ============================================================================
// Constants
// ============================================================================

const SESSION_TYPES = [
  { type: 'work', label: 'Focus', icon: Target, color: 'text-primary', bg: 'bg-primary', duration: 25 },
  { type: 'short_break', label: 'Short Break', icon: Zap, color: 'text-emerald-500', bg: 'bg-emerald-500', duration: 5 },
  { type: 'long_break', label: 'Long Break', icon: Pause, color: 'text-violet-500', bg: 'bg-violet-500', duration: 15 },
] as const;

// ============================================================================
// Timer Display
// ============================================================================

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ============================================================================
// Page
// ============================================================================

export function PomodoroPage() {
  const toast = useToast();
  const { subscribe } = useGateway();

  const [activeSession, setActiveSession] = useState<PomodoroSession | null>(null);
  const [stats, setStats] = useState<PomodoroStats | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Fetch ----

  const fetchState = useCallback(async () => {
    try {
      const [sessionRes, statsRes] = await Promise.all([
        pomodoroApi.getSession().catch(() => ({ session: null })),
        pomodoroApi.getStats().catch(() => ({ completedSessions: 0, totalWorkMinutes: 0, totalBreakMinutes: 0, interruptions: 0 })),
      ]);
      setActiveSession(sessionRes.session);
      setStats(statsRes as PomodoroStats);

      if (sessionRes.session?.status === 'running') {
        const elapsed = Math.floor((Date.now() - new Date(sessionRes.session.startedAt).getTime()) / 1000);
        const total = sessionRes.session.durationMinutes * 60;
        setTimeLeft(Math.max(0, total - elapsed));
      }
    } catch {
      // API might not be ready
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const debouncedRefresh = useDebouncedCallback(() => fetchState(), 1000);

  useEffect(() => {
    const unsub = subscribe<{ entity: string }>('data:changed', (data) => {
      if (data.entity === 'pomodoro') debouncedRefresh();
    });
    return () => unsub();
  }, [subscribe, debouncedRefresh]);

  // ---- Timer ----

  useEffect(() => {
    if (activeSession?.status === 'running' && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            // Timer complete — auto-complete session
            pomodoroApi.completeSession(activeSession.id).then(() => {
              toast.success('Session completed!');
              fetchState();
            }).catch(() => {});
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
  }, [activeSession, timeLeft, fetchState, toast]);

  // ---- Actions ----

  const handleStart = async (type: string, duration: number) => {
    try {
      await pomodoroApi.startSession({
        type,
        durationMinutes: duration,
      });
      toast.success(`${type === 'work' ? 'Focus' : 'Break'} session started!`);
      fetchState();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to start session');
    }
  };

  const handleComplete = async () => {
    if (!activeSession) return;
    try {
      await pomodoroApi.completeSession(activeSession.id);
      toast.success('Session completed!');
      fetchState();
    } catch {
      toast.error('Failed to complete session');
    }
  };

  const handleInterrupt = async () => {
    if (!activeSession) return;
    try {
      await pomodoroApi.interruptSession(activeSession.id);
      toast.success('Session interrupted');
      fetchState();
    } catch {
      toast.error('Failed to interrupt session');
    }
  };

  // ---- Progress ----

  const totalSeconds = activeSession ? activeSession.durationMinutes * 60 : 0;
  const progress = totalSeconds > 0 ? ((totalSeconds - timeLeft) / totalSeconds) * 100 : 0;
  const activeType = SESSION_TYPES.find((t) => t.type === activeSession?.type);

  // ---- Render ----

  if (loading) {
    return <div className="flex items-center justify-center h-full text-text-muted dark:text-dark-text-muted">Loading...</div>;
  }

  return (
    <div className="h-full flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full space-y-8">
        {/* Timer Circle */}
        <div className="relative flex items-center justify-center">
          <svg className="w-64 h-64 -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="4"
              className="text-border dark:text-dark-border" />
            {activeSession?.status === 'running' && (
              <circle cx="60" cy="60" r="54" fill="none" strokeWidth="4"
                strokeDasharray={`${2 * Math.PI * 54}`}
                strokeDashoffset={`${2 * Math.PI * 54 * (1 - progress / 100)}`}
                strokeLinecap="round"
                className={`${activeType?.color ?? 'text-primary'} transition-all duration-1000`}
                stroke="currentColor" />
            )}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-5xl font-mono font-bold">
              {activeSession?.status === 'running' ? formatTime(timeLeft) : '00:00'}
            </div>
            <div className="text-sm text-text-muted dark:text-dark-text-muted mt-1">
              {activeSession?.status === 'running'
                ? activeType?.label ?? 'Session'
                : 'Ready'}
            </div>
            {activeSession?.taskDescription && (
              <div className="text-xs text-text-muted dark:text-dark-text-muted mt-1 max-w-[180px] truncate">
                {activeSession.taskDescription}
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        {activeSession?.status === 'running' ? (
          <div className="flex items-center justify-center gap-4">
            <button
              onClick={handleComplete}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600 active:scale-95 transition-all"
            >
              <CheckCircle2 className="w-5 h-5" />
              Complete
            </button>
            <button
              onClick={handleInterrupt}
              className="flex items-center gap-2 px-6 py-3 rounded-xl bg-surface dark:bg-dark-surface border border-border dark:border-dark-border text-text-muted dark:text-dark-text-muted hover:text-error transition-colors"
            >
              <RotateCcw className="w-5 h-5" />
              Stop
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-3">
            {SESSION_TYPES.map((st) => (
              <button
                key={st.type}
                onClick={() => handleStart(st.type, st.duration)}
                className={`flex flex-col items-center gap-1.5 px-5 py-3 rounded-xl border border-border dark:border-dark-border hover:border-primary/30 transition-all active:scale-95`}
              >
                <st.icon className={`w-6 h-6 ${st.color}`} />
                <span className="text-xs font-medium">{st.label}</span>
                <span className="text-[10px] text-text-muted dark:text-dark-text-muted">{st.duration} min</span>
              </button>
            ))}
          </div>
        )}

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-3 gap-3 pt-4 border-t border-border dark:border-dark-border">
            <div className="text-center">
              <div className="text-xl font-bold text-primary">{stats.completedSessions}</div>
              <div className="text-[10px] text-text-muted dark:text-dark-text-muted">Sessions</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-emerald-500">{stats.totalWorkMinutes}</div>
              <div className="text-[10px] text-text-muted dark:text-dark-text-muted">Focus min</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-warning">{stats.interruptions}</div>
              <div className="text-[10px] text-text-muted dark:text-dark-text-muted">Interrupts</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
