/**
 * ConcurrencyBar — Live LLM slot visualizer
 *
 * Shows a row of slot boxes representing concurrent LLM call capacity.
 * Each box shows the claw name when active, or empty/idle when free.
 * Queued claws appear as amber waiting badges.
 * Uses keyframe animations for state transitions.
 */

import { memo } from 'react';
import { Zap, Clock } from '../../components/icons';

interface Slot {
  slotIdx: number;
  agentId: string;
  label: string;
  state: 'active' | 'queued' | 'free';
}

const SlotBox = memo(function SlotBox({ slot }: { slot: Slot }) {
  if (slot.state === 'active') {
    return (
      <div className="group relative animate-slot-active">
        <div className="relative w-28 h-8 rounded-lg bg-green-500/20 border border-green-500/50 flex items-center px-2.5 gap-2 overflow-hidden shadow-[0_0_8px_rgba(34,197,94,0.15)]">
          {/* Pulsing indicator */}
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span
            className="text-xs font-semibold text-green-300 truncate drop-shadow-sm"
            title={slot.label}
          >
            {slot.label.length > 17 ? slot.label.slice(0, 16) + '…' : slot.label}
          </span>
        </div>
      </div>
    );
  }

  if (slot.state === 'queued') {
    return (
      <div className="animate-slot-queued">
        <div className="w-24 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center px-2.5 gap-1.5 shadow-[0_0_8px_rgba(245,158,11,0.1)]">
          <Clock className="w-3 h-3 text-amber-400 shrink-0" />
          <span className="text-xs font-medium text-amber-300 truncate" title={slot.label}>
            {slot.label.length > 15 ? slot.label.slice(0, 14) + '…' : slot.label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      title={`Slot ${slot.slotIdx + 1} — idle`}
      className="w-16 h-8 rounded-lg border border-dashed border-gray-700/60 flex items-center justify-center bg-gray-800/20"
    >
      <span className="text-[11px] text-gray-600 font-mono">{slot.slotIdx + 1}</span>
    </div>
  );
});

export const ConcurrencyBar = memo(function ConcurrencyBar({
  maxSlots,
  active,
  queued,
  slots,
  onIncrease,
  onDecrease,
}: {
  maxSlots: number;
  active: number;
  queued: number;
  slots: Slot[];
  onIncrease?: () => void;
  onDecrease?: () => void;
}) {
  return (
    <div className="flex items-center gap-4 px-6 py-2.5 bg-[#0c0c18] dark:bg-[#080810] border-b border-[#1c1c30]">
      {/* Left: LLM Slots label */}
      <div className="flex items-center gap-2 shrink-0">
        <Zap className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-widest">LLM</span>
      </div>

      {/* Divider */}
      <div className="h-4 w-px bg-gray-700/50 shrink-0" />

      {/* Slot boxes */}
      <div className="flex items-center gap-2">
        {slots.map((slot) => (
          <SlotBox key={slot.slotIdx} slot={slot} />
        ))}
      </div>

      {/* Utilization bar + count */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Mini utilization bar */}
        <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${maxSlots > 0 ? (active / maxSlots) * 100 : 0}%`,
              background:
                active === maxSlots
                  ? 'linear-gradient(90deg, #f59e0b, #ef4444)'
                  : active > 0
                    ? 'linear-gradient(90deg, #22c55e, #34d399)'
                    : '#374151',
            }}
          />
        </div>

        <span className="text-xs tabular-nums">
          <span className="text-green-400 font-bold">{active}</span>
          <span className="text-gray-500 mx-px">/</span>
          <span className="text-gray-500">{maxSlots}</span>
        </span>

        {queued > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-amber-400 font-medium animate-pulse">
            <Clock className="w-3 h-3" />
            <span>{queued}</span>
          </span>
        )}
      </div>

      {/* Controls */}
      {onIncrease && onDecrease && (
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={onDecrease}
            disabled={maxSlots <= 1}
            className="w-6 h-6 rounded text-sm font-bold text-gray-500 hover:text-gray-300 hover:bg-gray-800 disabled:opacity-20 disabled:cursor-not-allowed border border-gray-700/50 transition-all"
            title="Decrease max slots"
          >
            −
          </button>
          <button
            onClick={onIncrease}
            disabled={maxSlots >= 10}
            className="w-6 h-6 rounded text-sm font-bold text-gray-500 hover:text-gray-300 hover:bg-gray-800 disabled:opacity-20 disabled:cursor-not-allowed border border-gray-700/50 transition-all"
            title="Increase max slots"
          >
            +
          </button>
        </div>
      )}
    </div>
  );
});
