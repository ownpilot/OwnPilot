/**
 * Workflow Generator Service Interface
 *
 * LLM-powered workflow generation from natural language descriptions.
 * Structured decomposition: goal -> subtasks -> agents -> DAG.
 */

export interface DecompositionMetrics {
  depth: number;
  totalNodes: number;
  avgComplexity: number;
  maxComplexity: number;
  estimatedCost: number;
  estimatedQuality: number;
  coherenceScore: number;
}

export interface SubTask {
  id: string;
  name: string;
  description: string;
  complexity: number;
  requiredTools: string[];
  requiredCapabilities: string[];
  dependencies: string[];
  agentRole?: string;
}

export interface GeneratedWorkflow {
  name: string;
  description: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  variables: Record<string, unknown>;
  metrics: DecompositionMetrics;
  subtasks: SubTask[];
}

export interface WorkflowGenerateOptions {
  provider?: string;
  model?: string;
  availableTools?: string[];
  maxDepth?: number;
  maxNodes?: number;
  includeReview?: boolean;
}

export interface IWorkflowGeneratorService {
  /** Generate a complete workflow from a natural-language goal */
  generate(
    goal: string,
    userId: string,
    options?: WorkflowGenerateOptions,
    onProgress?: (event: { phase: string; message: string; progress: number }) => void,
  ): Promise<GeneratedWorkflow>;

  /** Decompose a goal into subtasks (step 1 of generation) */
  decompose(goal: string, userId: string, options?: WorkflowGenerateOptions): Promise<SubTask[]>;

  /** Review and validate a generated workflow */
  review(
    workflow: GeneratedWorkflow,
    userId: string,
  ): Promise<{ valid: boolean; issues: string[]; suggestions: string[] }>;

  /** List generation history */
  listHistory(
    userId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{
    items: Array<{ id: string; goal: string; status: string; createdAt: string }>;
    total: number;
  }>;
}
