/**
 * TemplateValidator — validates {{nodeId.output.field}} references in template strings.
 * Shows inline warnings for broken references (unknown node IDs, aliases).
 */

import { useMemo } from 'react';
import { AlertTriangle } from '../icons';
import type { ToolNodeType } from './ToolNode';

interface TemplateValidatorProps {
  /** The template string to validate */
  value: string;
  /** Available upstream nodes */
  upstreamNodes: ToolNodeType[];
}

interface ValidationIssue {
  template: string;
  reason: string;
}

const TEMPLATE_RE = /\{\{(.+?)\}\}/g;

/** Extract all template expressions from a string */
function extractTemplates(value: string): string[] {
  const templates: string[] = [];
  let match;
  while ((match = TEMPLATE_RE.exec(value)) !== null) {
    templates.push(match[1]!.trim());
  }
  return templates;
}

/** Validate template references against known upstream nodes and aliases */
function validateTemplates(templates: string[], upstreamNodes: ToolNodeType[]): ValidationIssue[] {
  const nodeIds = new Set(upstreamNodes.map((n) => n.id));
  const aliases = new Set<string>();
  for (const n of upstreamNodes) {
    const alias = (n.data as Record<string, unknown>).outputAlias as string | undefined;
    if (alias) aliases.add(alias);
  }

  const issues: ValidationIssue[] = [];

  for (const tmpl of templates) {
    const parts = tmpl.split('.');
    const root = parts[0]!;

    // Built-in namespaces — always valid
    if (root === 'variables' || root === 'inputs') continue;

    // Check if root matches a node ID or alias
    if (nodeIds.has(root) || aliases.has(root)) continue;

    // Unknown reference
    issues.push({
      template: `{{${tmpl}}}`,
      reason: `"${root}" is not an upstream node or alias`,
    });
  }

  return issues;
}

export function TemplateValidator({ value, upstreamNodes }: TemplateValidatorProps) {
  const issues = useMemo(() => {
    if (!value) return [];
    const templates = extractTemplates(value);
    if (templates.length === 0) return [];
    return validateTemplates(templates, upstreamNodes);
  }, [value, upstreamNodes]);

  if (issues.length === 0) return null;

  return (
    <div className="mt-1 space-y-0.5">
      {issues.map((issue, i) => (
        <div
          key={i}
          className="flex items-start gap-1.5 px-2 py-1 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded"
        >
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>
            <code className="font-mono">{issue.template}</code> — {issue.reason}
          </span>
        </div>
      ))}
    </div>
  );
}
