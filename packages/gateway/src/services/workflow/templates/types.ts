/**
 * Shared shape for every entry in the Workflow Copilot's template catalog.
 *
 * Categories live in sibling files (`content.ts`, `data.ts`, etc.) and the
 * barrel index assembles them into `WORKFLOW_TEMPLATE_IDEAS`. Difficulty is
 * a fixed enum so the copilot prompt can filter or color-code suggestions.
 */
export interface WorkflowTemplateIdea {
  id: string;
  name: string;
  description: string;
  category: string;
  /** Human-readable flow description, e.g. "Trigger → LLM → Notification". */
  nodes: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}
