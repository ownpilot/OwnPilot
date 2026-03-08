// Workflows types

export type WorkflowStatus = 'active' | 'inactive';
export type WorkflowLogStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'awaiting_approval';
export type NodeExecutionStatus = 'pending' | 'running' | 'success' | 'error' | 'skipped';

export interface WorkflowToolNodeData {
  toolName: string;
  toolArgs: Record<string, unknown>;
  label: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface WorkflowTriggerNodeData {
  triggerType: 'manual' | 'schedule' | 'event' | 'condition' | 'webhook';
  label: string;
  cron?: string;
  timezone?: string;
  eventType?: string;
  condition?: string;
  threshold?: number;
  webhookPath?: string;
  triggerId?: string;
}

export interface WorkflowLlmNodeData {
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
}

export interface WorkflowConditionNodeData {
  label: string;
  expression: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface WorkflowCodeNodeData {
  label: string;
  language: 'javascript' | 'python' | 'shell';
  code: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface WorkflowTransformerNodeData {
  label: string;
  expression: string;
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export interface WorkflowForEachNodeData {
  label: string;
  arrayExpression: string;
  itemVariable?: string;
  maxIterations?: number;
  onError?: 'stop' | 'continue';
  description?: string;
  retryCount?: number;
  timeoutMs?: number;
}

export type WorkflowNodeData =
  | WorkflowToolNodeData
  | WorkflowTriggerNodeData
  | WorkflowLlmNodeData
  | WorkflowConditionNodeData
  | WorkflowCodeNodeData
  | WorkflowTransformerNodeData
  | WorkflowForEachNodeData;

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

export interface Workflow {
  id: string;
  name: string;
  description: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  status: WorkflowStatus;
  variables: Record<string, unknown>;
  inputSchema: InputParameter[];
  lastRun: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
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
  startedAt: string;
  completedAt: string | null;
}

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: number;
  nodes: unknown[];
  edges: unknown[];
  variables: Record<string, unknown>;
  createdAt: string;
}

export type WorkflowApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface WorkflowApproval {
  id: string;
  workflowLogId: string;
  workflowId: string;
  nodeId: string;
  userId: string;
  status: WorkflowApprovalStatus;
  context: Record<string, unknown>;
  message: string | null;
  decidedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface WorkflowProgressEvent {
  type:
    | 'started'
    | 'node_start'
    | 'node_complete'
    | 'node_error'
    | 'node_retry'
    | 'done'
    | 'error'
    | 'foreach_iteration_start'
    | 'foreach_iteration_complete';
  nodeId?: string;
  toolName?: string;
  status?: NodeExecutionStatus;
  output?: unknown;
  resolvedArgs?: Record<string, unknown>;
  branchTaken?: string;
  error?: string;
  durationMs?: number;
  logId?: string;
  logStatus?: WorkflowLogStatus;
  iterationIndex?: number;
  iterationTotal?: number;
  retryAttempt?: number;
}
