/**
 * StickyNoteNode — Annotation-only node for documenting workflows.
 * Not executed. Yellow/blue/green/pink background, no connection handles.
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

const colorStyles: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  yellow: {
    bg: 'bg-yellow-50 dark:bg-yellow-950/30',
    border: 'border-yellow-300 dark:border-yellow-700',
    text: 'text-yellow-900 dark:text-yellow-100',
    icon: 'text-yellow-600 dark:text-yellow-400',
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-300 dark:border-blue-700',
    text: 'text-blue-900 dark:text-blue-100',
    icon: 'text-blue-600 dark:text-blue-400',
  },
  green: {
    bg: 'bg-green-50 dark:bg-green-950/30',
    border: 'border-green-300 dark:border-green-700',
    text: 'text-green-900 dark:text-green-100',
    icon: 'text-green-600 dark:text-green-400',
  },
  pink: {
    bg: 'bg-pink-50 dark:bg-pink-950/30',
    border: 'border-pink-300 dark:border-pink-700',
    text: 'text-pink-900 dark:text-pink-100',
    icon: 'text-pink-600 dark:text-pink-400',
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
        relative min-w-[160px] max-w-[280px] rounded-lg border-2 shadow-sm
        ${style.bg} ${style.border}
        ${selected ? 'ring-2 ring-primary ring-offset-1' : ''}
        transition-all duration-200
      `}
    >
      {/* No handles — sticky notes are not connected */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-2 mb-1">
          <StickyNote className={`w-3.5 h-3.5 shrink-0 ${style.icon}`} />
          <span className={`font-medium text-sm truncate ${style.text}`}>
            {(data.label as string) || 'Note'}
          </span>
        </div>
        {data.text && (
          <p
            className={`text-xs ${style.text} opacity-80 whitespace-pre-wrap line-clamp-6`}
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
