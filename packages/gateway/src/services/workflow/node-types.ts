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

/**
 * Node types that must never run on the jobified (queue-backed) path and are
 * always executed synchronously via dispatchNode.
 *
 * Lives here rather than inside WorkflowService so the invariant it half of
 * can be asserted in a test: **every** type in WORKFLOW_NODE_TYPES must either
 * have a case in `executeNodeInline` (workflow-node-job-handler.ts) or appear
 * in this set. A type in neither reaches the handler's `default:` branch.
 *
 * That gap is not hypothetical. `clawNode` fell through to the toolNode
 * executor and was patched by adding it here — fixing the instance but not the
 * class. `transformerNode` then hit the same path: a registered type with a
 * real executor, absent from this set, silently running as a tool node with an
 * undefined toolName. `node-types.test.ts` now enforces the parity.
 */
export const SYNC_ONLY_NODE_TYPES: ReadonlySet<string> = new Set([
  'forEachNode',
  'errorHandlerNode',
  'triggerNode',
  'stickyNoteNode',
  'approvalNode',
  'parallelNode',
  'subWorkflowNode',
  // Spawns an autonomous agent via dispatchNode → executeClawNode.
  'clawNode',
]);
