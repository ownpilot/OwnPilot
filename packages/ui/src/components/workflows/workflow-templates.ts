/**
 * Workflow template catalog.
 *
 * Pure data extracted from TemplateGallery.tsx — the built-in workflow
 * templates (copilot definition format, converted via
 * convertDefinitionToReactFlow) plus their shared type.
 */

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  nodeCount: number;
  definition: {
    name: string;
    nodes: unknown[];
    edges: unknown[];
    variables?: Record<string, unknown>;
  };
}

// Templates use copilot definition format — converted via convertDefinitionToReactFlow.
// LLM nodes use provider/model 'default' — resolved at runtime to the user's configured defaults.
// Tool nodes use full dotted names (core.search_memories, core.list_goals, etc.).

import { SCHEDULING_TEMPLATES } from './templates/scheduling';
import { AUTOMATION_TEMPLATES } from './templates/automation';
import { AI_TEMPLATES } from './templates/ai';
import { INTEGRATION_TEMPLATES } from './templates/integration';
import { DATA_TEMPLATES } from './templates/data';

/**
 * The full template catalog.
 *
 * Definitions live per category under ./templates.
 *
 * NOTE — display order changed with this split. The array used to interleave
 * categories in authoring order; it now runs category by category. That is
 * visible in TemplateGallery's "All" tab, which renders this array directly.
 * The set of templates is unchanged, and every category tab is unaffected.
 * Grouping was chosen over reconstructing the original interleaving because the
 * mechanisms for preserving it (an explicit id order list, or a per-template
 * export) silently drop or misplace any template someone adds later.
 */
export const TEMPLATES: WorkflowTemplate[] = [
  ...SCHEDULING_TEMPLATES,
  ...AUTOMATION_TEMPLATES,
  ...AI_TEMPLATES,
  ...INTEGRATION_TEMPLATES,
  ...DATA_TEMPLATES,
];
