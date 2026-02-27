/**
 * StickyNoteConfigPanel — Config for annotation sticky notes.
 * Text content + color picker. No execution-related fields.
 */

import { X, StickyNote, Trash2 } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { INPUT_CLS } from '../NodeConfigPanel';

const COLORS = [
  { value: 'yellow', label: 'Yellow', dot: 'bg-yellow-400' },
  { value: 'blue', label: 'Blue', dot: 'bg-blue-400' },
  { value: 'green', label: 'Green', dot: 'bg-green-400' },
  { value: 'pink', label: 'Pink', dot: 'bg-pink-400' },
] as const;

export function StickyNoteConfigPanel({ node, onUpdate, onDelete, onClose }: NodeConfigPanelProps) {
  const data = node.data as Record<string, unknown>;

  return (
    <div className="flex flex-col h-full border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border">
        <StickyNote className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1">
          Sticky Note
        </h3>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Label */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Title
          </label>
          <input
            type="text"
            value={(data.label as string) ?? ''}
            onChange={(e) => onUpdate(node.id, { ...data, label: e.target.value })}
            placeholder="Note title..."
            className={INPUT_CLS}
          />
        </div>

        {/* Text */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Content
          </label>
          <textarea
            value={(data.text as string) ?? ''}
            onChange={(e) => onUpdate(node.id, { ...data, text: e.target.value })}
            placeholder="Write a note..."
            rows={6}
            className={`${INPUT_CLS} resize-y`}
          />
        </div>

        {/* Color */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Color
          </label>
          <div className="flex gap-2">
            {COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => onUpdate(node.id, { ...data, color: c.value })}
                className={`w-8 h-8 rounded-full ${c.dot} border-2 transition-all ${
                  (data.color ?? 'yellow') === c.value
                    ? 'border-text-primary dark:border-dark-text-primary scale-110'
                    : 'border-transparent hover:scale-105'
                }`}
                title={c.label}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="p-4 border-t border-border dark:border-dark-border">
        <button
          onClick={() => onDelete(node.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 rounded-md transition-colors w-full justify-center"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Note
        </button>
      </div>
    </div>
  );
}
