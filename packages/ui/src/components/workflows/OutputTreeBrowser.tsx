/**
 * Output Tree Browser — shows upstream node execution outputs as clickable trees.
 * Users can click field paths to insert {{nodeId.output.path}} templates.
 * Delegates tree rendering to JsonTreeView. Shows expected output shape hints
 * for nodes that haven't been executed yet.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from '../icons';
import { JsonTreeView, typeColors, detectType } from './JsonTreeView';
import type { ToolNodeData, ToolNodeType } from './ToolNode';

interface OutputTreeBrowserProps {
  upstreamNodes: ToolNodeType[];
  onInsert: (template: string) => void;
}

/** Expected output shape hints by node type (shown before execution) */
const OUTPUT_HINTS: Record<string, { type: string; description: string; fields?: string[] }> = {
  tool: { type: 'object', description: 'Tool-specific result object', fields: ['result', 'error'] },
  llm: { type: 'string', description: 'AI response text' },
  http_request: {
    type: 'object',
    description: 'HTTP response',
    fields: ['status', 'statusText', 'headers', 'body'],
  },
  code: { type: 'any', description: 'Return value of the code function' },
  transformer: { type: 'any', description: 'Result of the JavaScript expression' },
  condition: { type: 'boolean', description: 'true/false branch result' },
  switch: { type: 'string', description: 'Matched case label' },
  for_each: { type: 'array', description: 'Array of per-item results' },
  delay: { type: 'string', description: 'Delay completion timestamp' },
  sub_workflow: { type: 'object', description: 'Sub-workflow final outputs' },
  notification: { type: 'object', description: 'Notification delivery result' },
  approval: {
    type: 'object',
    description: 'Approval decision',
    fields: ['approved', 'approvedBy', 'approvedAt'],
  },
};

export function OutputTreeBrowser({ upstreamNodes, onInsert }: OutputTreeBrowserProps) {
  if (upstreamNodes.length === 0) return null;

  return (
    <div>
      <label className="block text-xs font-medium text-text-muted dark:text-dark-text-muted mb-1.5">
        Upstream Outputs
      </label>
      <div className="space-y-1">
        {upstreamNodes.map((node) => (
          <UpstreamNodeSection key={node.id} node={node} onInsert={onInsert} />
        ))}
      </div>
    </div>
  );
}

function UpstreamNodeSection({
  node,
  onInsert,
}: {
  node: ToolNodeType;
  onInsert: (t: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(true);
  const data = node.data as ToolNodeData;
  const rawData = data as unknown as Record<string, unknown>;
  const alias = rawData.outputAlias as string | undefined;
  const nodeType = (node.type as string) ?? '';
  const output = data.executionOutput;
  const hasOutput = output !== undefined && output !== null;
  const pathRoot = alias || node.id;

  return (
    <div className="rounded-md border border-border dark:border-dark-border overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-text-primary dark:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary transition-colors"
      >
        {isOpen ? (
          <ChevronDown className="w-3 h-3 shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 shrink-0" />
        )}
        <span className="truncate">
          {data.label || data.toolName}
          {alias && (
            <span className="ml-1 text-[10px] text-primary font-normal">{`(${alias})`}</span>
          )}
        </span>
        {hasOutput && (
          <span
            className={`ml-auto px-1 py-0.5 text-[9px] font-medium rounded ${typeColors[detectType(output)]}`}
          >
            {detectType(output)}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="px-1 py-1 bg-bg-secondary dark:bg-dark-bg-secondary">
          {hasOutput ? (
            <JsonTreeView data={output} pathPrefix={`${pathRoot}.output`} onClickPath={onInsert} />
          ) : (
            <OutputShapeHint nodeType={nodeType} pathRoot={pathRoot} onInsert={onInsert} />
          )}
        </div>
      )}
    </div>
  );
}

/** Shows expected output shape hints when no execution data is available */
function OutputShapeHint({
  nodeType,
  pathRoot,
  onInsert,
}: {
  nodeType: string;
  pathRoot: string;
  onInsert: (t: string) => void;
}) {
  const hint = OUTPUT_HINTS[nodeType];

  return (
    <div className="px-2 py-1.5 space-y-1">
      <div
        className="text-[10px] text-text-muted dark:text-dark-text-muted cursor-pointer hover:text-primary transition-colors"
        onClick={() => onInsert(`{{${pathRoot}.output}}`)}
        title={`Insert {{${pathRoot}.output}}`}
      >
        <code className="font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded">
          {`{{${pathRoot}.output}}`}
        </code>
        {hint && (
          <span className="ml-1.5 italic">
            {hint.description} ({hint.type})
          </span>
        )}
      </div>
      {hint?.fields?.map((field) => (
        <div
          key={field}
          className="text-[10px] text-text-muted dark:text-dark-text-muted cursor-pointer hover:text-primary transition-colors pl-2"
          onClick={() => onInsert(`{{${pathRoot}.output.${field}}}`)}
          title={`Insert {{${pathRoot}.output.${field}}}`}
        >
          <code className="font-mono bg-bg-tertiary dark:bg-dark-bg-tertiary px-1 rounded">
            {`{{${pathRoot}.output.${field}}}`}
          </code>
        </div>
      ))}
      {!hint && (
        <p className="text-[10px] text-text-muted dark:text-dark-text-muted italic">
          Run workflow to see detailed output fields
        </p>
      )}
    </div>
  );
}
