/**
 * Canonical workflow canvas node-type whitelist.
 *
 * Shared by route-level semantic validation (reject unknown types at save
 * time) and the execution dispatcher (refuse unknown types at run time
 * instead of silently executing them as tool nodes).
 *
 * When adding a node type, also update:
 * - dispatchNode() in workflow-service.ts (executor branch)
 * - validateWorkflowSemantics() in routes/workflow/index.ts (required fields)
 * - copilot-prompt.ts (LLM documentation)
 * - UI: nodeTypes registry, converter, serializers, palettes, config panel
 */
export const WORKFLOW_NODE_TYPES: ReadonlySet<string> = new Set([
  'toolNode',
  'triggerNode',
  'llmNode',
  'conditionNode',
  'codeNode',
  'transformerNode',
  'forEachNode',
  'httpRequestNode',
  'delayNode',
  'switchNode',
  'errorHandlerNode',
  'subWorkflowNode',
  'approvalNode',
  'stickyNoteNode',
  'notificationNode',
  'parallelNode',
  'mergeNode',
  'dataStoreNode',
  'schemaValidatorNode',
  'filterNode',
  'mapNode',
  'aggregateNode',
  'webhookResponseNode',
  'clawNode',
]);
