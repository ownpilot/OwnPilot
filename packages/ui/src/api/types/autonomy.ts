// Autonomy, Pulse System, and Pulse Directives types

export interface AutonomyLevel {
  level: number;
  name: string;
  description: string;
}

export interface AutonomyConfig {
  userId: string;
  level: number;
  allowedTools: string[];
  blockedTools: string[];
  dailyBudget: number;
  dailySpend: number;
  maxCostPerAction: number;
  budgetResetAt: string;
  notificationThreshold: number;
  auditEnabled: boolean;
}

export interface PendingApproval {
  id: string;
  userId: string;
  category: string;
  type: string;
  description: string;
  params: Record<string, unknown>;
  risk: {
    level: string;
    score: number;
    factors: string[];
  };
  status: string;
  createdAt: string;
  expiresAt: string;
}

// ---- Pulse System ----

export interface PulseEngineConfig {
  userId: string;
  enabled: boolean;
  minIntervalMs: number;
  maxIntervalMs: number;
  maxActions: number;
  quietHoursStart: number;
  quietHoursEnd: number;
}

export interface PulseStatus {
  running: boolean;
  enabled: boolean;
  config: PulseEngineConfig;
  activePulse: { pulseId: string; stage: string; startedAt: number } | null;
  lastPulse?: { pulsedAt: string; signalsFound: number; urgencyScore: number };
}

export interface PulseActivity {
  status: 'started' | 'stage' | 'completed' | 'error';
  stage: string;
  pulseId: string | null;
  startedAt: number | null;
  signalsFound?: number;
  actionsExecuted?: number;
  durationMs?: number;
  error?: string;
}

export interface PulseLogEntry {
  id: string;
  userId: string;
  pulsedAt: string;
  durationMs: number;
  signalsFound: number;
  llmCalled: boolean;
  actionsCount: number;
  actions: PulseActionResult[];
  reportMsg: string | null;
  error: string | null;
  manual: boolean;
  signalIds: string[];
  urgencyScore: number;
}

export interface PulseActionResult {
  type: string;
  success: boolean;
  output?: unknown;
  error?: string;
  skipped?: boolean;
}

export interface PulseStats {
  totalPulses: number;
  llmCallRate: number;
  avgDurationMs: number;
  actionsExecuted: number;
}

// ---- Pulse Directives ----

export interface RuleThresholds {
  staleDays: number;
  deadlineDays: number;
  activityDays: number;
  lowProgressPct: number;
  memoryMaxCount: number;
  memoryMinImportance: number;
  triggerErrorMin: number;
}

export interface ActionCooldowns {
  create_memory: number;
  update_goal_progress: number;
  send_notification: number;
  run_memory_cleanup: number;
}

export interface PulseDirectives {
  disabledRules: string[];
  blockedActions: string[];
  customInstructions: string;
  template: string;
  ruleThresholds: RuleThresholds;
  actionCooldowns: ActionCooldowns;
}

export interface PulseRuleDefinition {
  id: string;
  label: string;
  description: string;
  thresholdKey: string | null;
}

export interface PulseActionType {
  id: string;
  label: string;
}
