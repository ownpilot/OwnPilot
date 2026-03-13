/**
 * Fleet System Types
 *
 * A Fleet is a coordinated group of workers that run continuously in the background,
 * picking up tasks from a queue and executing them using various engines:
 * - ai-chat: Full Agent engine with tool access (like background agents)
 * - coding-cli: CLI tools (Claude Code, Gemini CLI, Codex)
 * - api-call: Direct AI provider API (lightweight, no tools)
 * - mcp-bridge: MCP server tool calls
 */

// ============================================================================
// Worker Types
// ============================================================================

/** Engine that powers a fleet worker */
export type FleetWorkerType = 'ai-chat' | 'coding-cli' | 'api-call' | 'mcp-bridge';

/** Schedule type for fleet execution */
export type FleetScheduleType = 'continuous' | 'interval' | 'cron' | 'event' | 'on-demand';

/** Task priority */
export type FleetTaskPriority = 'low' | 'normal' | 'high' | 'critical';

/** Task status */
export type FleetTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Fleet session state */
export type FleetSessionState = 'running' | 'paused' | 'stopped' | 'completed' | 'error';

// ============================================================================
// Worker Configuration
// ============================================================================

export interface FleetWorkerConfig {
  /** Unique name within fleet */
  name: string;
  /** Worker engine type */
  type: FleetWorkerType;
  /** Human-readable description */
  description?: string;

  // -- ai-chat config --
  provider?: string;
  model?: string;
  systemPrompt?: string;
  allowedTools?: string[];
  skills?: string[];

  // -- coding-cli config --
  cliProvider?: string; // 'claude-code' | 'codex' | 'gemini-cli' | custom
  cwd?: string;

  // -- mcp-bridge config --
  mcpServer?: string;
  mcpTools?: string[];

  // -- Shared limits --
  maxTurns?: number;
  maxTokens?: number;
  timeoutMs?: number;
  /** Number of parallel instances of this worker (default: 1) */
  count?: number;
}

// ============================================================================
// Fleet Budget
// ============================================================================

export interface FleetBudget {
  maxCostUsd?: number;
  maxCyclesPerHour?: number;
  maxTotalCycles?: number;
}

// ============================================================================
// Fleet Schedule Config
// ============================================================================

export interface FleetScheduleConfig {
  intervalMs?: number;
  cron?: string;
  eventFilters?: string[];
}

// ============================================================================
// Fleet Configuration (persisted)
// ============================================================================

export interface FleetConfig {
  id: string;
  userId: string;
  name: string;
  description?: string;
  /** High-level mission for the fleet */
  mission: string;
  scheduleType: FleetScheduleType;
  scheduleConfig?: FleetScheduleConfig;
  workers: FleetWorkerConfig[];
  budget?: FleetBudget;
  /** Max parallel workers (default: 5) */
  concurrencyLimit: number;
  autoStart: boolean;
  /** Default AI provider for workers */
  provider?: string;
  /** Default model for workers */
  model?: string;
  /** Shared context available to all workers */
  sharedContext?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Fleet Task
// ============================================================================

export interface FleetTask {
  id: string;
  fleetId: string;
  title: string;
  description: string;
  /** Worker name to assign, or undefined for auto-assignment */
  assignedWorker?: string;
  priority: FleetTaskPriority;
  status: FleetTaskStatus;
  /** Task-specific input data */
  input?: Record<string, unknown>;
  /** Result output */
  output?: string;
  /** Task IDs that must complete before this one */
  dependsOn?: string[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  retries: number;
  maxRetries: number;
}

// ============================================================================
// Fleet Session (runtime state)
// ============================================================================

export interface FleetSession {
  id: string;
  fleetId: string;
  state: FleetSessionState;
  startedAt: Date;
  stoppedAt?: Date;
  cyclesCompleted: number;
  tasksCompleted: number;
  tasksFailed: number;
  totalCostUsd: number;
  activeWorkers: number;
  sharedContext: Record<string, unknown>;
}

// ============================================================================
// Fleet Worker Result
// ============================================================================

export interface FleetWorkerResult {
  id: string;
  sessionId: string;
  workerId: string;
  workerName: string;
  workerType: FleetWorkerType;
  taskId?: string;
  success: boolean;
  output: string;
  toolCalls?: Array<{ name: string; args: unknown; result: unknown }>;
  tokensUsed?: { prompt: number; completion: number };
  costUsd?: number;
  durationMs: number;
  error?: string;
  executedAt: Date;
}

// ============================================================================
// Input Types (for create/update)
// ============================================================================

export interface CreateFleetInput {
  userId: string;
  name: string;
  description?: string;
  mission: string;
  scheduleType?: FleetScheduleType;
  scheduleConfig?: FleetScheduleConfig;
  workers: FleetWorkerConfig[];
  budget?: FleetBudget;
  concurrencyLimit?: number;
  autoStart?: boolean;
  provider?: string;
  model?: string;
  sharedContext?: Record<string, unknown>;
}

export interface UpdateFleetInput {
  name?: string;
  description?: string;
  mission?: string;
  scheduleType?: FleetScheduleType;
  scheduleConfig?: FleetScheduleConfig;
  workers?: FleetWorkerConfig[];
  budget?: FleetBudget;
  concurrencyLimit?: number;
  autoStart?: boolean;
  provider?: string;
  model?: string;
  sharedContext?: Record<string, unknown>;
}

export interface CreateFleetTaskInput {
  title: string;
  description: string;
  assignedWorker?: string;
  priority?: FleetTaskPriority;
  input?: Record<string, unknown>;
  dependsOn?: string[];
  maxRetries?: number;
}

// ============================================================================
// Default Limits
// ============================================================================

export const DEFAULT_FLEET_LIMITS = {
  concurrencyLimit: 5,
  maxCyclesPerHour: 60,
  maxTotalCycles: 10_000,
  maxCostUsd: 50,
  workerTimeoutMs: 300_000, // 5 min per worker task
  maxTaskRetries: 3,
} as const;

// ============================================================================
// Service Interface
// ============================================================================

export interface IFleetService {
  // CRUD
  createFleet(input: CreateFleetInput): Promise<FleetConfig>;
  getFleet(fleetId: string, userId: string): Promise<FleetConfig | null>;
  listFleets(userId: string): Promise<FleetConfig[]>;
  updateFleet(
    fleetId: string,
    userId: string,
    updates: UpdateFleetInput
  ): Promise<FleetConfig | null>;
  deleteFleet(fleetId: string, userId: string): Promise<boolean>;

  // Lifecycle
  startFleet(fleetId: string, userId: string): Promise<FleetSession>;
  pauseFleet(fleetId: string, userId: string): Promise<boolean>;
  resumeFleet(fleetId: string, userId: string): Promise<boolean>;
  stopFleet(fleetId: string, userId: string): Promise<boolean>;

  // Tasks
  addTask(fleetId: string, userId: string, task: CreateFleetTaskInput): Promise<FleetTask>;
  addTasks(
    fleetId: string,
    userId: string,
    tasks: CreateFleetTaskInput[]
  ): Promise<FleetTask[]>;
  getTask(taskId: string): Promise<FleetTask | null>;
  listTasks(fleetId: string, status?: string): Promise<FleetTask[]>;
  cancelTask(taskId: string): Promise<boolean>;

  // Queries
  getSession(fleetId: string): Promise<FleetSession | null>;
  listSessions(userId: string): Promise<FleetSession[]>;
  getWorkerHistory(
    fleetId: string,
    limit?: number,
    offset?: number
  ): Promise<{ entries: FleetWorkerResult[]; total: number }>;

  // Communication
  broadcastToFleet(fleetId: string, message: string): Promise<void>;

  // Service lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
}
