/**
 * WorkflowSourceModal - shows the workflow definition as formatted JSON.
 * Includes Copy, Download, and optional Import actions.
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import type { Edge, Node } from '@xyflow/react';

import { X, Copy, Check, Download, Upload } from '../icons';
import { buildWorkflowDefinition } from './workflowDefinition';

interface WorkflowSourceModalProps {
  workflowName: string;
  nodes: Node[];
  edges: Edge[];
  variables?: Record<string, unknown>;
  onClose: () => void;
  /** When provided, shows an Import button that loads a .workflow.json file */
  onImport?: (json: Record<string, unknown>) => void;
}

export function WorkflowSourceModal({
  workflowName,
  nodes,
  edges,
  variables,
  onClose,
  onImport,
}: WorkflowSourceModalProps) {
  const [copied, setCopied] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const definition = useMemo(
    () => buildWorkflowDefinition(workflowName, nodes, edges, variables),
    [workflowName, nodes, edges, variables]
  );
  const json = useMemo(() => JSON.stringify(definition, null, 2), [definition]);

  const handleCopy = useCallback(() => {
    navigator.clipboard?.writeText(json).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [json]);

  const handleDownload = useCallback(() => {
    const slug =
      workflowName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'workflow';
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.workflow.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [json, workflowName]);

  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setImportError(null);
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string);
          if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
            setImportError('Invalid workflow JSON: must contain "nodes" and "edges" arrays');
            return;
          }
          onImport?.(parsed);
          onClose();
        } catch {
          setImportError('Failed to parse JSON file');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [onImport, onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[85vh] mx-4 flex flex-col bg-bg-secondary dark:bg-dark-bg-secondary rounded-lg border border-border dark:border-dark-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border dark:border-dark-border">
          <h2 className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
            Workflow Source
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors"
            >
              {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors"
            >
              <Download className="w-3 h-3" />
              Download
            </button>
            {onImport && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,.workflow.json"
                  onChange={handleImport}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-text-secondary dark:text-dark-text-secondary hover:text-text-primary dark:hover:text-dark-text-primary bg-bg-tertiary dark:bg-dark-bg-tertiary hover:bg-bg-primary dark:hover:bg-dark-bg-primary border border-border dark:border-dark-border rounded-md transition-colors"
                >
                  <Upload className="w-3 h-3" />
                  Import
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="p-1 text-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <pre className="text-xs font-mono text-text-primary dark:text-dark-text-primary whitespace-pre leading-relaxed">
            {json}
          </pre>
        </div>

        <div className="flex items-center gap-4 px-4 py-2 border-t border-border dark:border-dark-border text-[10px] text-text-muted dark:text-dark-text-muted">
          <span>
            {nodes.length} node{nodes.length !== 1 ? 's' : ''}
          </span>
          <span>
            {edges.length} edge{edges.length !== 1 ? 's' : ''}
          </span>
          <span>{json.length.toLocaleString()} chars</span>
          {importError && <span className="ml-auto text-error">{importError}</span>}
        </div>
      </div>
    </div>
  );
}
