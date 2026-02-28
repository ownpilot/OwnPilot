/**
 * ParallelConfigPanel — Config for parallel execution nodes.
 * Branch count (2-10), branch labels, output alias.
 */

import { X, Columns, Trash2 } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { INPUT_CLS, OutputAliasField } from '../NodeConfigPanel';

export function ParallelConfigPanel({ node, onUpdate, onDelete, onClose }: NodeConfigPanelProps) {
  const data = node.data as Record<string, unknown>;
  const branchCount = (data.branchCount as number) || 2;
  const branchLabels = (data.branchLabels as string[]) ?? [];

  const updateBranchCount = (count: number) => {
    const clamped = Math.max(2, Math.min(10, count));
    // Adjust labels array to match count
    const newLabels = Array.from({ length: clamped }, (_, i) => branchLabels[i] ?? `Branch ${i}`);
    onUpdate(node.id, { ...data, branchCount: clamped, branchLabels: newLabels });
  };

  const updateBranchLabel = (index: number, label: string) => {
    const newLabels = [...branchLabels];
    while (newLabels.length < branchCount) newLabels.push(`Branch ${newLabels.length}`);
    newLabels[index] = label;
    onUpdate(node.id, { ...data, branchLabels: newLabels });
  };

  return (
    <div className="flex flex-col h-full border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border">
        <Columns className="w-4 h-4 text-teal-600 dark:text-teal-400" />
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1">
          Parallel Branches
        </h3>
        <button
          onClick={onClose}
          className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Label */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Label
          </label>
          <input
            type="text"
            value={(data.label as string) ?? ''}
            onChange={(e) => onUpdate(node.id, { ...data, label: e.target.value })}
            placeholder="Parallel"
            className={INPUT_CLS}
          />
        </div>

        {/* Branch count */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Branch Count
          </label>
          <input
            type="number"
            min={2}
            max={10}
            value={branchCount}
            onChange={(e) => updateBranchCount(parseInt(e.target.value) || 2)}
            className={INPUT_CLS}
          />
          <p className="text-[10px] text-text-muted">2 to 10 branches</p>
        </div>

        {/* Branch labels */}
        <div className="space-y-2">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Branch Labels
          </label>
          {Array.from({ length: branchCount }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-text-muted w-6 text-right">{i}:</span>
              <input
                type="text"
                value={branchLabels[i] ?? `Branch ${i}`}
                onChange={(e) => updateBranchLabel(i, e.target.value)}
                className={`${INPUT_CLS} flex-1`}
              />
            </div>
          ))}
          <p className="text-[10px] text-text-muted">
            {'Connect each branch output (branch-0, branch-1, ...) to downstream nodes'}
          </p>
        </div>

        {/* Description */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Description
          </label>
          <input
            type="text"
            value={(data.description as string) ?? ''}
            onChange={(e) =>
              onUpdate(node.id, { ...data, description: e.target.value || undefined })
            }
            placeholder="Optional description..."
            className={INPUT_CLS}
          />
        </div>

        <OutputAliasField data={data} nodeId={node.id} onUpdate={onUpdate} />
      </div>

      <div className="p-4 border-t border-border dark:border-dark-border">
        <button
          onClick={() => onDelete(node.id)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/10 rounded-md transition-colors w-full justify-center"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete Node
        </button>
      </div>
    </div>
  );
}
