/**
 * StickyNoteNode — Annotation-only node for documenting workflows.
 * Not executed. Flat colored background, slightly tilted with shadow,
 * italic text, and NO connection handles.
 */

import { memo, useCallback } from 'react';
import { type Node, type NodeProps } from '@xyflow/react';
import { StickyNote } from '../icons';

export interface StickyNoteNodeData extends Record<string, unknown> {
  label: string;
  text?: string;
  color?: 'yellow' | 'blue' | 'green' | 'pink';
}

export type StickyNoteNodeType = Node<StickyNoteNodeData>;

const colorStyles: Record<
  string,
  { bg: string; text: string; icon: string; shadow: string; corner: string }
> = {
  yellow: {
    bg: 'bg-yellow-100 dark:bg-yellow-900/50',
    text: 'text-yellow-900 dark:text-yellow-100',
    icon: 'text-yellow-600 dark:text-yellow-400',
    shadow: 'shadow-yellow-200/50 dark:shadow-yellow-800/30',
    corner: 'bg-yellow-200/80 dark:bg-yellow-800/50',
  },
  blue: {
    bg: 'bg-blue-100 dark:bg-blue-900/50',
    text: 'text-blue-900 dark:text-blue-100',
    icon: 'text-blue-600 dark:text-blue-400',
    shadow: 'shadow-blue-200/50 dark:shadow-blue-800/30',
    corner: 'bg-blue-200/80 dark:bg-blue-800/50',
  },
  green: {
    bg: 'bg-green-100 dark:bg-green-900/50',
    text: 'text-green-900 dark:text-green-100',
    icon: 'text-green-600 dark:text-green-400',
    shadow: 'shadow-green-200/50 dark:shadow-green-800/30',
    corner: 'bg-green-200/80 dark:bg-green-800/50',
  },
  pink: {
    bg: 'bg-pink-100 dark:bg-pink-900/50',
    text: 'text-pink-900 dark:text-pink-100',
    icon: 'text-pink-600 dark:text-pink-400',
    shadow: 'shadow-pink-200/50 dark:shadow-pink-800/30',
    corner: 'bg-pink-200/80 dark:bg-pink-800/50',
  },
};

function StickyNoteNodeComponent({ data, selected }: NodeProps<StickyNoteNodeType>) {
  const color = (data.color as string) || 'yellow';
  const style = colorStyles[color] ?? colorStyles.yellow!;

  // Prevent ReactFlow drag when clicking inside the node content area
  const stopPropagation = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className={`
        relative min-w-[140px] max-w-[260px] rounded shadow-lg
        ${style.bg} ${style.shadow}
        ${selected ? 'ring-2 ring-primary ring-offset-1' : ''}
        transition-all duration-200
      `}
      style={{ transform: 'rotate(-2deg)' }}
    >
      {/* No handles -- sticky notes are not connected */}

      {/* Folded corner effect */}
      <div
        className={`absolute top-0 right-0 w-5 h-5 ${style.corner}`}
        style={{
          clipPath: 'polygon(100% 0, 0 0, 100% 100%)',
        }}
      />

      <div className="px-3 py-3">
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-1.5">
          <StickyNote className={`w-3.5 h-3.5 shrink-0 ${style.icon}`} />
          <span className={`font-semibold text-sm truncate ${style.text}`}>
            {(data.label as string) || 'Note'}
          </span>
        </div>

        {/* Text content — italic for handwritten feel */}
        {data.text && (
          <p
            className={`text-xs ${style.text} opacity-75 whitespace-pre-wrap line-clamp-6 italic leading-relaxed`}
            onMouseDown={stopPropagation}
          >
            {data.text as string}
          </p>
        )}
      </div>
    </div>
  );
}

export const StickyNoteNode = memo(StickyNoteNodeComponent);
