/**
 * Facade for the workflow template catalog.
 *
 * Preserves the original import path used by `workflow-copilot-prompt.ts`
 * (dynamic `import('./workflow-template-ideas.js')`) while the actual
 * data lives in per-category modules under `./workflow-templates/`.
 */

export { WORKFLOW_TEMPLATE_IDEAS } from './workflow-templates/index.js';
export type { WorkflowTemplateIdea } from './workflow-templates/index.js';
