/**
 * NotificationConfigPanel — Config for notification nodes.
 * Message template, severity selector, output alias.
 */

import { useCallback } from 'react';
import { X, Bell, Trash2 } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { INPUT_CLS, OutputAliasField, RetryTimeoutFields } from '../NodeConfigPanel';
import { OutputTreeBrowser } from '../OutputTreeBrowser';
import { TemplateValidator } from '../TemplateValidator';

const SEVERITIES = ['info', 'warning', 'error', 'success'] as const;

export function NotificationConfigPanel({
  node,
  upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
}: NodeConfigPanelProps) {
  const data = node.data as Record<string, unknown>;
  const message = (data.message as string) ?? '';

  const injectTemplate = useCallback(
    (template: string) => {
      const updated = message + template;
      onUpdate(node.id, { ...data, message: updated });
    },
    [message, data, node.id, onUpdate]
  );

  return (
    <div className="flex flex-col h-full border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border">
        <Bell className="w-4 h-4 text-purple-600 dark:text-purple-400" />
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1">
          Notification
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
            placeholder="Notification"
            className={INPUT_CLS}
          />
        </div>

        {/* Message */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Message
          </label>
          <textarea
            value={message}
            onChange={(e) => onUpdate(node.id, { ...data, message: e.target.value })}
            placeholder="Notification message... Supports {{node_2.output}} templates"
            rows={4}
            className={`${INPUT_CLS} resize-y`}
          />
          <p className="text-[10px] text-text-muted">
            {'Supports {{template}} expressions for dynamic content'}
          </p>
          <TemplateValidator value={message} upstreamNodes={upstreamNodes} />
        </div>

        {/* Severity */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Severity
          </label>
          <select
            value={(data.severity as string) ?? 'info'}
            onChange={(e) => onUpdate(node.id, { ...data, severity: e.target.value })}
            className={INPUT_CLS}
          >
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
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

        {/* Upstream outputs browser */}
        {upstreamNodes.length > 0 && (
          <OutputTreeBrowser upstreamNodes={upstreamNodes} onInsert={injectTemplate} />
        )}

        <OutputAliasField data={data} nodeId={node.id} onUpdate={onUpdate} />
        <RetryTimeoutFields data={data} nodeId={node.id} onUpdate={onUpdate} />
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
