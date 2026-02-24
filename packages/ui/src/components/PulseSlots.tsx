import { useState, useEffect, useCallback } from 'react';
import { useGateway } from '../hooks/useWebSocket';
import { Check, X } from './icons';
import type { PulseActivity } from '../api';

// --- Slot Types & Constants ---

export type SlotStatus = 'idle' | 'running' | 'done' | 'error';
export type SlotCategory = 'gather' | 'eval' | 'decide' | 'execute' | 'report';

export interface SlotState {
  status: SlotStatus;
  category: SlotCategory | null;
  label: string;
  startedAt: number | null;
}

export const SLOT_COUNT = 12;

const IDLE_SLOT: SlotState = { status: 'idle', category: null, label: '', startedAt: null };

const STAGE_SLOTS: Record<string, { count: number; category: SlotCategory; labels: string[] }> = {
  starting:   { count: 1, category: 'gather',  labels: ['Init'] },
  gathering:  { count: 4, category: 'gather',  labels: ['Goals', 'Memory', 'Activity', 'Health'] },
  evaluating: { count: 5, category: 'eval',    labels: ['Rules', 'Goals', 'Deadlines', 'Activity', 'Progress'] },
  deciding:   { count: 1, category: 'decide',  labels: ['LLM'] },
  executing:  { count: 4, category: 'execute', labels: ['Act 1', 'Act 2', 'Act 3', 'Act 4'] },
  reporting:  { count: 1, category: 'report',  labels: ['Report'] },
};

const CATEGORY_STYLES: Record<SlotCategory, { bg: string; border: string; shadow: string; dot: string }> = {
  gather:  { bg: 'bg-blue-500/20',    border: 'border-blue-500/50',    shadow: 'shadow-[0_0_8px_rgba(59,130,246,0.3)]',  dot: 'bg-blue-400' },
  eval:    { bg: 'bg-violet-500/20',   border: 'border-violet-500/50',  shadow: 'shadow-[0_0_8px_rgba(139,92,246,0.3)]',  dot: 'bg-violet-400' },
  decide:  { bg: 'bg-amber-500/20',    border: 'border-amber-500/50',   shadow: 'shadow-[0_0_8px_rgba(245,158,11,0.3)]',  dot: 'bg-amber-400' },
  execute: { bg: 'bg-emerald-500/20',  border: 'border-emerald-500/50', shadow: 'shadow-[0_0_8px_rgba(16,185,129,0.3)]',  dot: 'bg-emerald-400' },
  report:  { bg: 'bg-cyan-500/20',     border: 'border-cyan-500/50',    shadow: 'shadow-[0_0_8px_rgba(6,182,212,0.3)]',   dot: 'bg-cyan-400' },
};

// --- Pure state machine ---

export function handlePulseSlotUpdate(data: PulseActivity, slots: SlotState[]): SlotState[] {
  if (data.status === 'started') {
    return Array(SLOT_COUNT).fill(null).map(() => ({ ...IDLE_SLOT }));
  }

  if (data.status === 'completed') {
    return slots.map(s => s.status === 'running' ? { ...s, status: 'done' as const } : s);
  }

  if (data.status === 'error') {
    return slots.map(s => s.status === 'running' ? { ...s, status: 'error' as const } : s);
  }

  if (data.status === 'stage') {
    const next = slots.map(s => s.status === 'running' ? { ...s, status: 'done' as const } : s);
    const stageInfo = STAGE_SLOTS[data.stage];
    if (!stageInfo) return next;

    let assigned = 0;
    for (let i = 0; i < SLOT_COUNT && assigned < stageInfo.count; i++) {
      if (next[i]!.status === 'idle') {
        next[i]! = {
          status: 'running',
          category: stageInfo.category,
          label: stageInfo.labels[assigned] || `Task ${assigned + 1}`,
          startedAt: Date.now(),
        };
        assigned++;
      }
    }
    return next;
  }

  return slots;
}

// --- Custom hook ---

function makeIdleSlots(): SlotState[] {
  return Array(SLOT_COUNT).fill(null).map(() => ({ ...IDLE_SLOT }));
}

export function usePulseSlots() {
  const { subscribe } = useGateway();
  const [slots, setSlots] = useState<SlotState[]>(makeIdleSlots);

  // Fade done/error slots back to idle after 2s
  useEffect(() => {
    const hasFading = slots.some(s => s.status === 'done' || s.status === 'error');
    if (!hasFading) return;

    const timer = setTimeout(() => {
      setSlots(prev => prev.map(s =>
        (s.status === 'done' || s.status === 'error') ? { ...IDLE_SLOT } : s
      ));
    }, 2000);

    return () => clearTimeout(timer);
  }, [slots]);

  // Subscribe to pulse:activity WS events
  const handleActivity = useCallback((data: PulseActivity) => {
    setSlots(prev => handlePulseSlotUpdate(data, prev));
  }, []);

  useEffect(() => {
    return subscribe('pulse:activity', handleActivity);
  }, [subscribe, handleActivity]);

  return { slots };
}

// --- Visual component ---

export function PulseSlotGrid({ slots, compact }: { slots: SlotState[]; compact?: boolean }) {
  const size = compact ? 'w-6 h-6' : 'w-7 h-7';
  const dotSize = compact ? 'w-1.5 h-1.5' : 'w-2 h-2';
  const iconSize = compact ? 'w-2.5 h-2.5' : 'w-3 h-3';
  const gap = compact ? 'gap-1' : 'gap-1.5';

  return (
    <div className={`flex items-center ${gap} flex-wrap justify-center`}>
      {slots.map((slot, i) => {
        const styles = slot.category ? CATEGORY_STYLES[slot.category] : null;
        const isIdle = slot.status === 'idle';
        const isRunning = slot.status === 'running';
        const isDone = slot.status === 'done';
        const isError = slot.status === 'error';

        let staggerIndex = 0;
        if (isRunning) {
          for (let j = 0; j < i; j++) {
            if (slots[j]!.status === 'running' && slots[j]!.category === slot.category) {
              staggerIndex++;
            }
          }
        }

        return (
          <div
            key={i}
            title={slot.label ? `${slot.label}${slot.category ? ` (${slot.category})` : ''}` : `Slot ${i + 1}`}
            className={[
              `${size} rounded-lg border transition-all duration-500 ease-in-out flex items-center justify-center`,
              isIdle && 'bg-bg-tertiary/30 dark:bg-dark-bg-tertiary/30 border-dashed border-border/20 dark:border-dark-border/20',
              isRunning && styles && `${styles.bg} ${styles.border} ${styles.shadow} animate-pulse`,
              isDone && 'bg-success/20 border-success/40 shadow-[0_0_8px_rgba(34,197,94,0.3)]',
              isError && 'bg-error/20 border-error/40 shadow-[0_0_8px_rgba(239,68,68,0.3)]',
            ].filter(Boolean).join(' ')}
            style={{ transitionDelay: isRunning ? `${staggerIndex * 120}ms` : '0ms' }}
          >
            {isRunning && styles && (
              <div className={`${dotSize} rounded-full ${styles.dot}`} />
            )}
            {isDone && <Check className={`${iconSize} text-success`} />}
            {isError && <X className={`${iconSize} text-error`} />}
          </div>
        );
      })}
    </div>
  );
}
