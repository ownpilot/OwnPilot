/**
 * Mini Pomodoro Timer
 *
 * Compact timer widget for the global header bar.
 * Shows only when a pomodoro session is actively running.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useGateway } from '../hooks/useWebSocket';
import { useDebouncedCallback } from '../hooks';
import { pomodoroApi, type PomodoroSession } from '../api/endpoints/personal-data';
import { Target, Zap, Pause } from './icons';

const TYPE_CONFIG = {
  work: { icon: Target, color: 'text-primary', bg: 'bg-primary/10', ring: 'ring-primary/30', label: 'Focus' },
  short_break: { icon: Zap, color: 'text-emerald-500', bg: 'bg-emerald-500/10', ring: 'ring-emerald-500/30', label: 'Break' },
  long_break: { icon: Pause, color: 'text-violet-500', bg: 'bg-violet-500/10', ring: 'ring-violet-500/30', label: 'Break' },
} as const;

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function MiniPomodoro() {
  const navigate = useNavigate();
  const location = useLocation();
  const { subscribe } = useGateway();

  const [session, setSession] = useState<PomodoroSession | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Don't show on the Pomodoro page itself
  const isOnPomodoroPage = location.pathname === '/pomodoro';

  const fetchSession = useCallback(async () => {
    try {
      const res = await pomodoroApi.getSession();
      const s = res.session;
      setSession(s);

      if (s?.status === 'running') {
        const elapsed = Math.floor((Date.now() - new Date(s.startedAt).getTime()) / 1000);
        const remaining = Math.max(0, s.durationMinutes * 60 - elapsed);
        setTimeLeft(remaining);
      } else {
        setTimeLeft(0);
      }
    } catch {
      // API not ready
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // WebSocket updates
  const debouncedRefresh = useDebouncedCallback(() => fetchSession(), 1000);

  useEffect(() => {
    const unsub = subscribe<{ entity: string }>('data:changed', (data) => {
      if (data.entity === 'pomodoro') debouncedRefresh();
    });
    return () => unsub();
  }, [subscribe, debouncedRefresh]);

  // Countdown
  useEffect(() => {
    if (session?.status !== 'running') return;

    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          fetchSession(); // Refresh when timer hits 0
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [session, fetchSession]);

  // Nothing to show
  if (!session || session.status !== 'running' || isOnPomodoroPage) return null;

  const config = TYPE_CONFIG[session.type as keyof typeof TYPE_CONFIG] ?? TYPE_CONFIG.work;
  const Icon = config.icon;
  const progress = session.durationMinutes * 60 > 0
    ? ((session.durationMinutes * 60 - timeLeft) / (session.durationMinutes * 60)) * 100
    : 0;

  return (
    <button
      onClick={() => navigate('/pomodoro')}
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg ${config.bg} ring-1 ${config.ring} hover:ring-2 transition-all cursor-pointer group`}
      title={`${config.label} — ${formatTime(timeLeft)} remaining. Click to open Pomodoro.`}
    >
      {/* Tiny progress ring */}
      <div className="relative w-5 h-5 shrink-0">
        <svg className="w-5 h-5 -rotate-90" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2"
            className="text-black/5 dark:text-white/5" stroke="currentColor" />
          <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2"
            strokeDasharray={`${2 * Math.PI * 8}`}
            strokeDashoffset={`${2 * Math.PI * 8 * (1 - progress / 100)}`}
            strokeLinecap="round"
            className={`${config.color} transition-all duration-1000`}
            stroke="currentColor" />
        </svg>
        <Icon className={`w-2.5 h-2.5 ${config.color} absolute inset-0 m-auto`} />
      </div>

      {/* Time */}
      <span className={`text-xs font-mono font-semibold ${config.color} tabular-nums`}>
        {formatTime(timeLeft)}
      </span>
    </button>
  );
}
