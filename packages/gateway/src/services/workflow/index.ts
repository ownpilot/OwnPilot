/**
 * Workflow module — DAG-based workflow execution engine.
 *
 * Re-exports all public types, utilities, and the WorkflowService class.
 */

export type { WorkflowProgressEvent, ToolExecutionResult } from './types.js';
export {
  topologicalSort,
  getDownstreamNodes,
  getDownstreamNodesByHandle,
  getForEachBodyNodes,
} from './dag-utils.js';
export {
  resolveTemplates,
  deepResolve,
  resolveStringTemplates,
  resolveTemplatePath,
  getNestedValue,
} from './template-resolver.js';
export {
  toToolExecResult,
  resolveWorkflowToolName,
  executeNode,
  executeLlmNode,
  executeConditionNode,
  executeCodeNode,
  executeTransformerNode,
} from './node-executors.js';
export { executeForEachNode } from './foreach-executor.js';
export { WorkflowService, getWorkflowService } from './workflow-service.js';
