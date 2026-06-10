/**
 * Workflow module — DAG-based workflow execution engine.
 *
 * Only the surface other gateway modules consume lives here. The rest of
 * the workflow utilities (template resolver, node executors, foreach
 * executor) are imported directly from their submodule files.
 */

export { topologicalSort } from './dag-utils.js';
export { WORKFLOW_NODE_TYPES } from './node-types.js';
export { resolveTemplates } from './template-resolver.js';
export { WorkflowService, getWorkflowService } from './workflow-service.js';
