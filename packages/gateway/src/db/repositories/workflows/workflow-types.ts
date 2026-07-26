/**
 * Workflow Types
 *
 * Domain types for visual DAG tool pipelines.
 * Stores ReactFlow-compatible nodes/edges and execution logs.
 *
 * Note: These types are defined here separately from the repository so that
 * consumers only need to import the types without loading the full repository.
 */

// parseJsonField function type for use in row mappers
type ParseJsonFieldFn = <T>(json: string, fallback: T) => T;

// ============================================================================
// Enums
// ============================================================================

export type WorkflowStatus = 'active' | 'inactive';
export type WorkflowLogStatus =
  'running' | 'completed' | 'failed' | 'cancelled' | 'awaiting_approval';
export type NodeExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

// ============================================================================
// Node Data Types
// ============================================================================

export interface ToolNodeData {
  toolName: string;
  toolArgs: Record<string, unknown>;
  label: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface TriggerNodeData {
  triggerType: 'manual' | 'schedule' | 'event' | 'condition' | 'webhook';
  label: string;
  cron?: string;
  timezone?: string;
  eventType?: string;
  filters?: Record<string, unknown>;
  condition?: string;
  threshold?: number;
  checkInterval?: number;
  webhookPath?: string;
  webhookSecret?: string;
  triggerId?: string;
}

export interface LlmNodeData {
  label: string;
  provider: string;
  model: string;
  systemPrompt?: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
  retryCount?: number;
  timeoutMs?: number;
  /** When 'json', instructs the LLM to return valid JSON and parses the response */
  responseFormat?: 'text' | 'json';
  /** Multi-turn context messages inserted between system and user messages */
  conversationMessages?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface ConditionNodeData {
  label: string;
  /** JS expression evaluated against upstream outputs — must return truthy/falsy */
  expression: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface CodeNodeData {
  label: string;
  language: 'javascript' | 'python' | 'shell';
  /** The script source code */
  code: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface TransformerNodeData {
  label: string;
  /** JS expression that transforms input data. `data` variable holds upstream output. */
  expression: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface ForEachNodeData {
  label: string;
  /** Template expression resolving to an array, e.g. "{{node_1.output}}" */
  arrayExpression: string;
  /** Optional alias for the current item (e.g. "issue" → use {{issue}} in body nodes) */
  itemVariable?: string;
  /** Safety cap on iterations. Default: 100 */
  maxIterations?: number;
  /** Error strategy: 'stop' aborts on first error, 'continue' collects errors */
  onError?: 'stop' | 'continue';
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface HttpRequestNodeData {
  label: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** URL template — supports {{node_id.output}} expressions */
  url: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  /** Request body (JSON string or raw text) — template-resolved */
  body?: string;
  bodyType?: 'json' | 'text' | 'form';
  auth?: {
    type: 'none' | 'bearer' | 'basic' | 'apiKey';
    token?: string;
    username?: string;
    password?: string;
    /** API key header name (default: X-API-Key) */
    headerName?: string;
  };
  /** Response body size limit in bytes (default: 1MB) */
  maxResponseSize?: number;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface DelayNodeData {
  label: string;
  /** Duration value — supports template expressions */
  duration: string;
  unit: 'seconds' | 'minutes' | 'hours';
  description?: string;
}

export interface SwitchNodeData {
  label: string;
  /** JS expression evaluated to produce a switch value */
  expression: string;
  /** Named cases: each has a label (handle ID) and a value to match against */
  cases: Array<{ label: string; value: string }>;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

interface ErrorHandlerNodeData {
  label: string;
  description?: string;
  continueOnSuccess?: boolean;
  outputAlias?: string;
}

interface SubWorkflowNodeData {
  label: string;
  subWorkflowId?: string;
  subWorkflowName?: string;
  inputMapping?: Record<string, string>;
  maxDepth?: number;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

interface ApprovalNodeData {
  label: string;
  approvalMessage?: string;
  timeoutMinutes?: number;
  description?: string;
}

interface StickyNoteNodeData {
  label: string;
  text?: string;
  color?: string;
}

interface NotificationNodeData {
  label: string;
  message?: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

interface ParallelNodeData {
  label: string;
  branchCount: number;
  branchLabels?: string[];
  description?: string;
}

interface MergeNodeData {
  label: string;
  mode?: 'waitAll' | 'firstCompleted';
  description?: string;
}

export interface DataStoreNodeData {
  label: string;
  operation: 'get' | 'set' | 'delete' | 'list' | 'has';
  key?: string;
  value?: unknown;
  namespace?: string;
  description?: string;
}

export interface SchemaValidatorNodeData {
  label: string;
  schema: Record<string, unknown>;
  strict?: boolean;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface FilterNodeData {
  label: string;
  arrayExpression: string;
  condition: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface MapNodeData {
  label: string;
  arrayExpression: string;
  expression: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface AggregateNodeData {
  label: string;
  arrayExpression: string;
  operation: 'sum' | 'count' | 'avg' | 'min' | 'max' | 'groupBy' | 'flatten' | 'unique';
  field?: string;
  description?: string;
}

export interface WebhookResponseNodeData {
  label: string;
  statusCode?: number;
  body?: string;
  headers?: Record<string, string>;
  contentType?: string;
  description?: string;
}

export type WorkflowNodeData =
  | ToolNodeData
  | TriggerNodeData
  | LlmNodeData
  | ConditionNodeData
  | CodeNodeData
  | TransformerNodeData
  | ForEachNodeData
  | HttpRequestNodeData
  | DelayNodeData
  | SwitchNodeData
  | ErrorHandlerNodeData
  | SubWorkflowNodeData
  | ApprovalNodeData
  | StickyNoteNodeData
  | NotificationNodeData
  | ParallelNodeData
  | MergeNodeData
  | DataStoreNodeData
  | SchemaValidatorNodeData
  | FilterNodeData
  | MapNodeData
  | AggregateNodeData
  | WebhookResponseNodeData
  | Record<string, unknown>;

// ============================================================================
// Graph Types
// ============================================================================

export interface WorkflowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

export interface InputParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required: boolean;
  defaultValue?: string;
  description?: string;
}

// ============================================================================
// Domain Models
// ============================================================================

export interface Workflow {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: WorkflowStatus;
  variables: Record<string, unknown>;
  inputSchema: InputParameter[];
  lastRun: Date | null;
  runCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NodeResult {
  nodeId: string;
  status: NodeExecutionStatus;
  output?: unknown;
  resolvedArgs?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  /** For condition nodes: 'true'/'false'. For switch nodes: matched case label or 'default'. */
  branchTaken?: string;
  /** For forEach nodes: number of iterations completed */
  iterationCount?: number;
  /** For forEach nodes: total items in the source array */
  totalItems?: number;
  /** Number of retry attempts (0 = succeeded on first try) */
  retryAttempts?: number;
}

export interface WorkflowLog {
  id: string;
  workflowId: string | null;
  workflowName: string | null;
  status: WorkflowLogStatus;
  nodeResults: Record<string, NodeResult>;
  error: string | null;
  durationMs: number | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, unknown>;
  createdAt: Date;
}

// ============================================================================
// Input Types
// ============================================================================

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status?: WorkflowStatus;
  variables?: Record<string, unknown>;
  inputSchema?: InputParameter[];
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  status?: WorkflowStatus;
  variables?: Record<string, unknown>;
  inputSchema?: InputParameter[];
}

// ============================================================================
// Row Types (DB snake_case)
// ============================================================================

export interface WorkflowRow {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  nodes: string;
  edges: string;
  status: WorkflowStatus;
  variables: string;
  input_schema: string;
  last_run: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowVersionRow {
  id: string;
  workflow_id: string;
  version: number;
  nodes: string;
  edges: string;
  variables: string;
  created_at: string;
}

export interface WorkflowLogRow {
  id: string;
  workflow_id: string | null;
  workflow_name: string | null;
  status: WorkflowLogStatus;
  node_results: string;
  error: string | null;
  duration_ms: number | null;
  started_at: string;
  completed_at: string | null;
}

// ============================================================================
// Row Mappers
// ============================================================================

/**
 * Mapper for WorkflowRow → Workflow.
 * Extracted so consumers of workflow-types.ts can re-use it without
 * importing the full repository.
 */
export function mapWorkflowRow(row: WorkflowRow, parseJson: ParseJsonFieldFn): Workflow {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    nodes: parseJson(row.nodes, []),
    edges: parseJson(row.edges, []),
    status: row.status,
    variables: parseJson(row.variables, {}),
    inputSchema: parseJson(row.input_schema, []),
    lastRun: row.last_run ? new Date(row.last_run) : null,
    runCount: row.run_count,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

/**
 * Mapper for WorkflowVersionRow → WorkflowVersion.
 */
export function mapWorkflowVersionRow(
  row: WorkflowVersionRow,
  parseJson: ParseJsonFieldFn
): WorkflowVersion {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    version: row.version,
    nodes: parseJson(row.nodes, []),
    edges: parseJson(row.edges, []),
    variables: parseJson(row.variables, {}),
    createdAt: new Date(row.created_at),
  };
}

/**
 * Mapper for WorkflowLogRow → WorkflowLog.
 */
export function mapWorkflowLogRow(row: WorkflowLogRow, parseJson: ParseJsonFieldFn): WorkflowLog {
  return {
    id: row.id,
    workflowId: row.workflow_id,
    workflowName: row.workflow_name,
    status: row.status,
    nodeResults: parseJson(row.node_results, {}),
    error: row.error,
    durationMs: row.duration_ms,
    startedAt: new Date(row.started_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
  };
}
