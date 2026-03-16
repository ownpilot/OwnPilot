/**
 * WebhookResponseConfigPanel — Config for webhook response (terminal) nodes.
 * Sends an HTTP response back to the webhook caller.
 */

import { X, Send, Trash2 } from '../../icons';
import type { NodeConfigPanelProps } from '../NodeConfigPanel';
import { INPUT_CLS } from '../NodeConfigPanel';

export function WebhookResponseConfigPanel({
  node,
  upstreamNodes: _upstreamNodes,
  onUpdate,
  onDelete,
  onClose,
}: NodeConfigPanelProps) {
  const data = node.data as Record<string, unknown>;

  return (
    <div className="flex flex-col h-full border-l border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border dark:border-dark-border">
        <Send className="w-4 h-4 text-rose-600 dark:text-rose-400" />
        <h3 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary flex-1">
          Webhook Response
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
            placeholder="Webhook Response"
            className={INPUT_CLS}
          />
        </div>

        {/* Status Code */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Status Code
          </label>
          <input
            type="number"
            value={(data.statusCode as number) ?? 200}
            onChange={(e) =>
              onUpdate(node.id, { ...data, statusCode: Number(e.target.value) || 200 })
            }
            min={100}
            max={599}
            className={INPUT_CLS}
          />
        </div>

        {/* Body */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Body
          </label>
          <textarea
            value={(data.body as string) ?? ''}
            onChange={(e) => onUpdate(node.id, { ...data, body: e.target.value })}
            placeholder='{"success": true, "data": {{node_1.output}}}'
            rows={4}
            className={`${INPUT_CLS} resize-y font-mono text-xs`}
          />
          <p className="text-[10px] text-text-muted">
            {'Supports {{template}} expressions for dynamic content'}
          </p>
        </div>

        {/* Content-Type */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Content-Type
          </label>
          <input
            type="text"
            value={(data.contentType as string) ?? 'application/json'}
            onChange={(e) =>
              onUpdate(node.id, { ...data, contentType: e.target.value || 'application/json' })
            }
            placeholder="application/json"
            className={INPUT_CLS}
          />
        </div>

        {/* Headers */}
        <div className="space-y-1">
          <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted">
            Headers
          </label>
          <textarea
            value={(data.headers as string) ?? ''}
            onChange={(e) => onUpdate(node.id, { ...data, headers: e.target.value || undefined })}
            placeholder={'X-Custom-Header: value\nX-Request-Id: {{node_1.output.id}}'}
            rows={3}
            className={`${INPUT_CLS} resize-y font-mono text-xs`}
          />
          <p className="text-[10px] text-text-muted">
            One header per line, format: Header-Name: value
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
