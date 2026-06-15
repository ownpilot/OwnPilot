/**
 * Agentic Capability Layer — Core Types
 *
 * Types for the unified agent orchestration system that sits on top of
 * claws, souls, crews, coding agents, triggers, channels, workflows,
 * and the 250+ tool registry — exposing them as a single substrate for
 * autonomous agentic execution.
 *
 * Design goals:
 * 1. Every agent type registers its capabilities → CapabilityRegistry
 * 2. Any natural-language task is routed to the optimal executor(s) → AgenticRouter
 * 3. Multi-agent pipelines are auto-composed from registry lookups → OrchestrationComposer
 * 4. Execution is observable across all agent types → AgenticReport
 */

// ============================================================================
// Capability Types
// ============================================================================

/** What kind of executor can handle a capability. */
export type ExecutorKind =
  | 'claw'           // Autonomous claw agent (cyclic/single-shot)
  | 'soul_heartbeat' // Soul heartbeat with scheduled tasks
  | 'crew'           // Multi-agent crew orchestration
  | 'coding_agent'   // External coding agent (Claude Code, Codex, Gemini CLI)
  | 'workflow'       // Visual DAG workflow
  | 'trigger'        // Proactive trigger (schedule/event/condition/webhook)
  | 'channel'        // Communication channel (Telegram/Discord/Slack/Email/etc.)
  | 'direct_llm'     // Direct LLM call without tool orchestration
  | 'sandbox_code'   // Isolated code execution sandbox
  | 'tool_catalog';  // Single tool call from the 250+ tool registry

/**
 * Registered capability on the capability bus.
 * Every agent type advertises what it can do here.
 */
export interface CapabilityEntry {
  /** Unique capability identifier (e.g. "claw:research", "soul:healthcheck"). */
  readonly id: string;
  /** Human-readable name. */
  readonly name: string;
  /** Natural language description of what this capability does. */
  readonly description: string;
  /** Which executor kind fulfills this capability. */
  readonly executorKind: ExecutorKind;
  /** Agent/system identifier that hosts this capability. */
  readonly providerId: string;
  /** Input schema for the capability (JSON Schema). */
  readonly inputSchema?: Record<string, unknown>;
  /** Output shape description. */
  readonly outputDescription?: string;
  /** Estimated cost tier per invocation. */
  readonly costTier?: 'free' | 'cheap' | 'moderate' | 'expensive';
  /** Average latency expectation. */
  readonly latencyTier?: 'instant' | 'fast' | 'medium' | 'slow';
  /** Tags for discovery search. */
  readonly tags: string[];
  /** Whether this capability requires operator approval. */
  readonly requiresApproval: boolean;
  /** When the capability was registered. */
  readonly registeredAt: Date;
  /** Optional metadata for capability-specific configuration. */
  readonly metadata?: Record<string, unknown>;
}

/** Parameters for querying the capability registry. */
export interface CapabilityQuery {
  /** Search tags or free-text keywords. */
  readonly keywords?: string[];
  /** Filter by executor kind. */
  readonly executorKind?: ExecutorKind | ExecutorKind[];
  /** Filter by cost tier. */
  readonly maxCostTier?: 'free' | 'cheap' | 'moderate' | 'expensive';
  /** Filter by provider ID. */
  readonly providerId?: string;
  /** Only capabilities that don't require approval. */
  readonly unattendedOnly?: boolean;
  /** Maximum results. */
  readonly limit?: number;
}

/** Result of a capability lookup. */
export interface CapabilityLookupResult {
  readonly entries: CapabilityEntry[];
  readonly total: number;
  readonly query: CapabilityQuery;
}

// ============================================================================
// Task Types
// ============================================================================

/** Priority for task execution. */
export type TaskPriority = 'low' | 'normal' | 'high' | 'critical';

/** Trigger strategy for a task — when should it run. */
export type TaskTriggerStrategy =
  | { type: 'immediate' }
  | { type: 'scheduled'; cron: string; timezone?: string }
  | { type: 'interval'; intervalMs: number }
  | { type: 'continuous'; minDelayMs?: number; idleDelayMs?: number }
  | { type: 'event'; eventType: string; filters?: Record<string, unknown> }
  | { type: 'condition'; condition: string; checkIntervalMs?: number }
  | { type: 'webhook'; secret?: string };

/** Output routing for task results. */
export interface TaskOutputRouting {
  /** Store in memory/knowledge graph. */
  memory?: boolean;
  /** Notify via channel. */
  channel?: { provider: string; chatId: string };
  /** Send to another agent's inbox. */
  agentInbox?: string[];
  /** Post results to a webhook URL. */
  webhook?: string;
  /** Save as an artifact. */
  artifact?: { name: string; tags?: string[] };
  /** Broadcast to a crew. */
  crewBroadcast?: string;
}

/** A universal task description — the currency of the agentic layer. */
export interface AgenticTask {
  /** Unique task identifier. */
  readonly id: string;
  /** Short task name/title. */
  readonly name: string;
  /** Full natural language task description. */
  readonly description: string;
  /** Optional system prompt override for the agent. */
  readonly prompt?: string;
  /** Expected output format/type. */
  readonly expectedOutput?: string;
  /** Priority level. */
  readonly priority?: TaskPriority;
  /** Trigger strategy for when to execute. */
  readonly trigger?: TaskTriggerStrategy;
  /** Output routing. */
  readonly outputRouting?: TaskOutputRouting;
  /** Execution constraints. */
  readonly constraints?: {
    /** Max cost in USD. */
    readonly maxCostUsd?: number;
    /** Max wall-clock time in ms. */
    readonly timeoutMs?: number;
    /** Max LLM turns. */
    readonly maxTurns?: number;
    /** Max tool calls. */
    readonly maxToolCalls?: number;
    /** Whether code execution is allowed. */
    readonly allowCodeExecution?: boolean;
    /** Whether external network access is allowed. */
    readonly allowNetwork?: boolean;
    /** Required filesystem scopes. */
    readonly filesystemScopes?: string[];
  };
  /** Provider preference (model, provider id). */
  readonly providerPreference?: {
    readonly providerId?: string;
    readonly modelId?: string;
  };
  /** Chain input: context from a prior task result. */
  readonly chainInput?: Record<string, unknown>;
}

/** Execution plan — how the system will execute a task. */
export interface ExecutionPlan {
  /** Task this plan was generated for. */
  readonly task: AgenticTask;
  /** Ordered list of execution steps. */
  readonly steps: ExecutionStep[];
  /** Estimated total cost. */
  readonly estimatedCostUsd?: number;
  /** Estimated total duration in ms. */
  readonly estimatedDurationMs?: number;
  /** Whether operator approval is needed before any step. */
  readonly requiresApproval: boolean;
  /** Fallback strategy on failure. */
  readonly fallbackStrategy: 'abort' | 'retry' | 'fallback_executor' | 'escalate';
  /** When the plan was generated. */
  readonly createdAt: Date;
}

/** Single execution step in a plan. */
export interface ExecutionStep {
  /** Step number in sequence. */
  readonly index: number;
  /** Which executor kind runs this step. */
  readonly executorKind: ExecutorKind;
  /** Capability ID to invoke. */
  readonly capabilityId: string;
  /** Provider/agent that will execute this step. */
  readonly providerId: string;
  /** Step-specific parameters. */
  readonly params: Record<string, unknown>;
  /** Steps that must complete before this one. */
  readonly dependsOn: number[];
  /** Timeout for this step. */
  readonly timeoutMs?: number;
  /** Whether this step can be retried on failure. */
  readonly retryOnFailure?: boolean;
}

// ============================================================================
// Execution Result Types
// ============================================================================

/** Status of a single execution step. */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'timed_out';

/** Result of a single execution step. */
export interface StepResult {
  readonly step: ExecutionStep;
  readonly status: StepStatus;
  readonly output: unknown;
  readonly error?: string;
  readonly durationMs: number;
  readonly costUsd?: number;
  readonly tokensUsed?: { input: number; output: number };
  readonly startedAt: Date;
  readonly completedAt: Date | null;
}

/** Overall execution status. */
export type ExecutionStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'partially_completed'
  | 'cancelled'
  | 'escalated';

/** Full execution report for observability. */
export interface AgenticReport {
  /** Unique execution ID. */
  readonly id: string;
  /** The task that was executed. */
  readonly task: AgenticTask;
  /** The plan that was followed. */
  readonly plan: ExecutionPlan;
  /** Results from each step. */
  readonly stepResults: StepResult[];
  /** Overall execution status. */
  readonly status: ExecutionStatus;
  /** Total cost in USD. */
  readonly totalCostUsd: number;
  /** Total wall-clock time in ms. */
  readonly totalDurationMs: number;
  /** Total tokens consumed across all steps. */
  readonly totalTokens: { input: number; output: number };
  /** Error message if the overall execution failed. */
  readonly error?: string;
  /** When execution started. */
  readonly startedAt: Date;
  /** When execution completed (or failed). */
  readonly completedAt: Date | null;
  /** Human-readable summary of what happened. */
  readonly summary: string;
}

// ============================================================================
// Registry & Router Interfaces
// ============================================================================

/** Interface for the capability registry. */
export interface ICapabilityRegistry {
  /** Register a capability. */
  register(entry: CapabilityEntry): void;
  /** Unregister a capability by ID. */
  unregister(id: string): boolean;
  /** Query capabilities matching the given query. */
  query(query: CapabilityQuery): CapabilityLookupResult;
  /** Get a single capability by ID. */
  get(id: string): CapabilityEntry | undefined;
  /** Get all registered capabilities. */
  getAll(): CapabilityEntry[];
  /** Get capabilities for a specific provider. */
  getByProvider(providerId: string): CapabilityEntry[];
  /** Get capabilities by executor kind. */
  getByKind(kind: ExecutorKind): CapabilityEntry[];
  /** Search capabilities by keyword. */
  search(keywords: string[], limit?: number): CapabilityEntry[];
  /** Number of registered capabilities. */
  readonly size: number;
  /** Listen for registry changes. */
  on(event: 'register' | 'unregister', listener: (entry: CapabilityEntry) => void): () => void;
}

/** Task analysis result from the router. */
export interface TaskAnalysis {
  /** The analyzed task. */
  readonly task: AgenticTask;
  /** Suggested executor kind(s). */
  readonly suggestedKinds: ExecutorKind[];
  /** Required capabilities. */
  readonly requiredCapabilities: CapabilityEntry[];
  /** Whether this task requires multi-step orchestration. */
  readonly requiresOrchestration: boolean;
  /** Whether code execution is likely needed. */
  readonly likelyNeedsCodeExecution: boolean;
  /** Whether external data access is likely needed. */
  readonly likelyNeedsExternalData: boolean;
  /** Confidence score (0-1). */
  readonly confidence: number;
  /** Reasoning for the analysis. */
  readonly reasoning: string;
}

/** Interface for the agentic router. */
export interface IAgenticRouter {
  /** Analyze a task and suggest the optimal execution strategy. */
  analyze(task: Omit<AgenticTask, 'id'>): Promise<TaskAnalysis>;
  /** Generate an execution plan for a task. */
  plan(task: AgenticTask): Promise<ExecutionPlan>;
  /** Route a task to the optimal executor and return a plan. */
  route(task: Omit<AgenticTask, 'id'>): Promise<{ analysis: TaskAnalysis; plan: ExecutionPlan }>;
}

/** Interface for the agentic orchestrator (top-level coordinator). */
export interface IAgenticOrchestrator {
  /** Execute a task end-to-end and produce a report. */
  execute(task: Omit<AgenticTask, 'id'>): Promise<AgenticReport>;
  /** Cancel a running execution. */
  cancel(executionId: string): Promise<boolean>;
  /** Get the status of an execution. */
  getStatus(executionId: string): Promise<ExecutionStatus | null>;
  /** Get the full report for an execution. */
  getReport(executionId: string): Promise<AgenticReport | null>;
  /** List recent executions. */
  listExecutions(limit?: number, offset?: number): Promise<AgenticReport[]>;
  /** Get the execution stats. */
  getStats(): Promise<{
    totalExecutions: number;
    activeExecutions: number;
    totalCostUsd: number;
    successRate: number;
    byExecutorKind: Record<string, number>;
  }>;
}
