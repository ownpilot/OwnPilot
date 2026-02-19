/**
 * Output Tree Browser — shows upstream node execution outputs as clickable trees.
 * Users can click field paths to insert {{nodeId.output.path}} templates.
 * Delegates tree rendering to JsonTreeView.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from '../icons';
import { JsonTreeView, typeColors, detectType } from './JsonTreeView';
import type { ToolNodeData, ToolNodeType } from './ToolNode';

interface OutputTreeBrowserProps {
  upstreamNodes: ToolNodeType[];
  onInsert: (template: string) => void;
}

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

function UpstreamNodeSection({ node, onInsert }: { node: ToolNodeType; onInsert: (t: string) => void }) {
  const [isOpen, setIsOpen] = useState(true);
  const data = node.data as ToolNodeData;
  const output = data.executionOutput;
  const hasOutput = output !== undefined && output !== null;

  return (
    <div className="rounded-md border border-border dark:border-dark-border overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-text-primary dark:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary transition-colors"
      >
        {isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
        <span className="truncate">{data.label || data.toolName}</span>
        {hasOutput && (
          <span className={`ml-auto px-1 py-0.5 text-[9px] font-medium rounded ${typeColors[detectType(output)]}`}>
            {detectType(output)}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="px-1 py-1 bg-bg-secondary dark:bg-dark-bg-secondary">
          {!hasOutput ? (
            <p className="px-2 py-1.5 text-[10px] text-text-muted dark:text-dark-text-muted italic">
              Run workflow to see output fields
            </p>
          ) : (
            <JsonTreeView
              data={output}
              pathPrefix={`${node.id}.output`}
              onClickPath={onInsert}
            />
          )}
        </div>
      )}
    </div>
  );
}
