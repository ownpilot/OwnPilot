/**
 * Assistant Orchestrator
 *
 * This is the critical integration layer that connects:
 * - Memories (context injection)
 * - Goals (task awareness)
 * - Autonomy (action approval)
 * - Triggers (proactive behavior)
 *
 * It wraps the Agent to provide a fully autonomous personal AI assistant.
 */

import type { ToolCall } from '@ownpilot/core';
import { MemoriesRepository } from '../db/repositories/memories.js';
import { GoalsRepository } from '../db/repositories/goals.js';
import { TriggersRepository } from '../db/repositories/triggers.js';
import { getApprovalManager, assessRisk, type ActionCategory } from '../autonomy/index.js';
import { getTriggerEngine } from '../triggers/engine.js';

export interface OrchestratorOptions {
  userId: string;
  agentId?: string;
  /** Maximum memories to inject into context */
  maxMemories?: number;
  /** Maximum goals to inject into context */
  maxGoals?: number;
  /** Whether to check triggers after each message */
  enableTriggers?: boolean;
  /** Whether to enforce autonomy checks */
  enableAutonomy?: boolean;
}

export interface EnhancedChatResult {
  memoriesUsed: number;
  goalsUsed: number;
  toolCallsApproved: number;
  toolCallsBlocked: number;
  triggersEvaluated: number;
}

/**
 * Build an enhanced system prompt with user context
 */
export async function buildEnhancedSystemPrompt(
  basePrompt: string,
  options: OrchestratorOptions
): Promise<{ prompt: string; stats: { memoriesUsed: number; goalsUsed: number } }> {
  const memoriesRepo = new MemoriesRepository(options.userId);
  const goalsRepo = new GoalsRepository(options.userId);

  const maxMemories = options.maxMemories ?? 10;
  const maxGoals = options.maxGoals ?? 5;

  const sections: string[] = [basePrompt];
  let memoriesUsed = 0;
  let goalsUsed = 0;

  // === MEMORIES SECTION ===
  const memories = memoriesRepo.list({
    limit: maxMemories,
    orderBy: 'importance',
  });

  if (memories.length > 0) {
    memoriesUsed = memories.length;
    const memoryLines: string[] = [];

    // Group by type
    const facts = memories.filter((m) => m.type === 'fact');
    const preferences = memories.filter((m) => m.type === 'preference');
    const events = memories.filter((m) => m.type === 'event');

    if (facts.length > 0) {
      memoryLines.push('**Known Facts:**');
      facts.forEach((m) => memoryLines.push(`- ${m.content}`));
    }

    if (preferences.length > 0) {
      memoryLines.push('**User Preferences:**');
      preferences.forEach((m) => memoryLines.push(`- ${m.content}`));
    }

    if (events.length > 0) {
      memoryLines.push('**Recent Events:**');
      events.forEach((m) => memoryLines.push(`- ${m.content}`));
    }

    if (memoryLines.length > 0) {
      sections.push('\n---\n## User Context (from memory)\n' + memoryLines.join('\n'));
    }
  }

  // === GOALS SECTION ===
  const goals = goalsRepo.list({ status: 'active', limit: maxGoals });

  if (goals.length > 0) {
    goalsUsed = goals.length;
    const goalLines: string[] = ['## Active Goals'];

    for (const goal of goals) {
      const progressStr = `${Math.round(goal.progress)}%`;
      const dueStr = goal.dueDate ? ` (due: ${goal.dueDate})` : '';
      goalLines.push(`- **${goal.title}** [${progressStr}]${dueStr}`);
      if (goal.description) {
        goalLines.push(`  ${goal.description}`);
      }

      // Include pending steps
      const steps = goalsRepo.getSteps(goal.id);
      const pendingSteps = steps.filter((s) => s.status === 'pending' || s.status === 'in_progress');
      if (pendingSteps.length > 0) {
        goalLines.push('  Next steps:');
        pendingSteps.slice(0, 3).forEach((s) => {
          goalLines.push(`  - [ ] ${s.title}`);
        });
      }
    }

    sections.push('\n---\n' + goalLines.join('\n'));
  }

  // === AUTONOMY GUIDANCE ===
  const approvalManager = getApprovalManager();
  const config = approvalManager.getUserConfig(options.userId);

  const autonomyLevelNames = ['Manual', 'Assisted', 'Supervised', 'Autonomous', 'Full'];
  const levelName = autonomyLevelNames[config.level] ?? 'Unknown';

  sections.push(
    `\n---\n## Autonomy Level: ${levelName}\n` +
      `- You can ${config.level >= 2 ? 'automatically' : 'suggest'} executing low-risk actions.\n` +
      `- ${config.level >= 3 ? 'You can execute' : 'Ask for approval for'} high-risk actions.\n` +
      `- Daily budget remaining: $${(config.dailyBudget - config.dailySpend).toFixed(2)}`
  );

  return {
    prompt: sections.join('\n'),
    stats: { memoriesUsed, goalsUsed },
  };
}

/**
 * Check if a tool call should be allowed based on autonomy settings
 */
export async function checkToolCallApproval(
  userId: string,
  toolCall: ToolCall,
  context: Record<string, unknown> = {}
): Promise<{
  approved: boolean;
  requiresApproval: boolean;
  reason?: string;
  risk?: ReturnType<typeof assessRisk>;
}> {
  const approvalManager = getApprovalManager();
  const config = approvalManager.getUserConfig(userId);

  // Map tool name to action category
  const category = mapToolToCategory(toolCall.name);

  // Assess risk
  const risk = assessRisk(
    category,
    toolCall.name,
    JSON.parse(toolCall.arguments || '{}'),
    context,
    config
  );

  // If no approval required, auto-approve
  if (!risk.requiresApproval) {
    return { approved: true, requiresApproval: false, risk };
  }

  // Check if tool is explicitly allowed
  if (config.allowedTools.includes(toolCall.name)) {
    return { approved: true, requiresApproval: false, risk };
  }

  // Check if tool is explicitly blocked
  if (config.blockedTools.includes(toolCall.name)) {
    return {
      approved: false,
      requiresApproval: true,
      reason: `Tool "${toolCall.name}" is blocked by your autonomy settings.`,
      risk,
    };
  }

  // For supervised/autonomous levels, auto-approve medium risk
  if (config.level >= 2 && risk.level !== 'critical' && risk.level !== 'high') {
    return { approved: true, requiresApproval: false, risk };
  }

  // For autonomous/full levels, auto-approve high risk too
  if (config.level >= 3 && risk.level !== 'critical') {
    return { approved: true, requiresApproval: false, risk };
  }

  // Full autonomy: approve everything except critical
  if (config.level >= 4 && risk.level !== 'critical') {
    return { approved: true, requiresApproval: false, risk };
  }

  // Requires user approval
  return {
    approved: false,
    requiresApproval: true,
    reason: `Tool "${toolCall.name}" requires approval (risk: ${risk.level})`,
    risk,
  };
}

/**
 * Map tool name to action category for risk assessment
 */
function mapToolToCategory(toolName: string): ActionCategory {
  const categoryMap: Record<string, ActionCategory> = {
    // Data tools
    create_memory: 'data_modification',
    delete_memory: 'data_modification',
    create_goal: 'data_modification',
    delete_goal: 'data_modification',
    create_task: 'data_modification',
    delete_task: 'data_modification',
    create_note: 'data_modification',
    delete_note: 'data_modification',

    // Communication tools
    send_email: 'external_communication',
    send_notification: 'external_communication',
    send_message: 'external_communication',

    // External tools
    fetch_url: 'api_call',
    search_web: 'api_call',
    http_request: 'api_call',

    // System tools
    execute_code: 'system_command',
    run_script: 'system_command',
    file_write: 'file_operation',
    file_delete: 'file_operation',

    // Financial tools
    make_payment: 'financial',
    transfer_funds: 'financial',
    create_subscription: 'financial',
  };

  return categoryMap[toolName] ?? 'tool_execution';
}

/**
 * Evaluate and execute triggers after a chat message
 */
export async function evaluateTriggers(
  userId: string,
  message: string,
  response: string
): Promise<{ triggered: string[]; pending: string[]; executed: string[] }> {
  const triggersRepo = new TriggersRepository(userId);
  const triggers = triggersRepo.list({ enabled: true });
  const triggerEngine = getTriggerEngine({ userId });

  const triggered: string[] = [];
  const pending: string[] = [];
  const executed: string[] = [];

  for (const trigger of triggers) {
    let shouldFire = false;

    if (trigger.type === 'condition') {
      // Check message-based conditions
      const condition = trigger.config as { condition?: string };

      if (condition.condition?.includes('message_contains:')) {
        const keyword = condition.condition.replace('message_contains:', '').trim();
        if (message.toLowerCase().includes(keyword.toLowerCase())) {
          shouldFire = true;
        }
      }

      if (condition.condition?.includes('response_contains:')) {
        const keyword = condition.condition.replace('response_contains:', '').trim();
        if (response.toLowerCase().includes(keyword.toLowerCase())) {
          shouldFire = true;
        }
      }
    }

    // Event-based triggers for chat_completed
    if (trigger.type === 'event') {
      const event = trigger.config as { eventType?: string };
      if (event.eventType === 'chat_completed') {
        shouldFire = true;
      }
    }

    if (shouldFire) {
      triggered.push(trigger.id);

      // Execute the trigger action via the TriggerEngine
      try {
        const result = await triggerEngine.fireTrigger(trigger.id);
        if (result.success) {
          executed.push(trigger.id);
        } else {
          pending.push(trigger.id); // Failed execution, mark as pending
        }
      } catch (error) {
        console.warn(`[Orchestrator] Failed to execute trigger ${trigger.id}:`, error);
        pending.push(trigger.id);
      }
    }
  }

  // Emit chat_completed event for any additional event-based triggers
  await triggerEngine.emit('chat_completed', {
    userId,
    messageLength: message.length,
    responseLength: response.length,
  });

  return { triggered, pending, executed };
}

/**
 * Extract and store memories from a conversation
 */
export async function extractMemories(
  userId: string,
  message: string,
  _response: string
): Promise<number> {
  const memoriesRepo = new MemoriesRepository(userId);

  // Simple pattern-based memory extraction
  // In a real implementation, this would use the LLM to extract facts
  const patterns = [
    // "My name is X" pattern
    { regex: /my name is (\w+)/i, type: 'fact' as const, template: "User's name is $1" },
    // "I live in X" pattern
    { regex: /i live in ([^,.]+)/i, type: 'fact' as const, template: 'User lives in $1' },
    // "I like X" pattern
    { regex: /i (?:like|love|prefer) ([^,.]+)/i, type: 'preference' as const, template: 'User likes $1' },
    // "I don't like X" pattern
    { regex: /i (?:don't like|hate|dislike) ([^,.]+)/i, type: 'preference' as const, template: "User doesn't like $1" },
    // "I work as X" pattern
    { regex: /i work as (?:a |an )?([^,.]+)/i, type: 'fact' as const, template: 'User works as $1' },
    // "I'm X years old" pattern
    { regex: /i'?m (\d+) years old/i, type: 'fact' as const, template: 'User is $1 years old' },
  ];

  let extracted = 0;

  for (const pattern of patterns) {
    const match = message.match(pattern.regex);
    if (match) {
      const content = pattern.template.replace('$1', match[1] ?? '');

      // Check for duplicates using search
      const existing = memoriesRepo.search(content.substring(0, 20), { type: pattern.type, limit: 1 });
      if (existing.length === 0) {
        memoriesRepo.create({
          type: pattern.type,
          content,
          source: 'conversation',
          importance: 0.7,
        });
        extracted++;
      }
    }
  }

  return extracted;
}

/**
 * Update goal progress based on conversation
 */
export async function updateGoalProgress(
  userId: string,
  _message: string,
  response: string,
  _toolCalls?: readonly ToolCall[]
): Promise<void> {
  const goalsRepo = new GoalsRepository(userId);
  const activeGoals = goalsRepo.list({ status: 'active' });

  for (const goal of activeGoals) {
    const steps = goalsRepo.getSteps(goal.id);
    const pendingSteps = steps.filter((s) => s.status === 'pending' || s.status === 'in_progress');

    for (const step of pendingSteps) {
      // Check if step title is mentioned in response as completed
      if (
        response.toLowerCase().includes(step.title.toLowerCase()) &&
        (response.includes('completed') ||
          response.includes('done') ||
          response.includes('finished'))
      ) {
        goalsRepo.updateStep(step.id, { status: 'completed' });
        goalsRepo.recalculateProgress(goal.id);
      }
    }
  }
}

/**
 * Get orchestrator stats for a user
 */
export function getOrchestratorStats(userId: string): {
  totalMemories: number;
  activeGoals: number;
  activeTriggers: number;
  pendingApprovals: number;
  autonomyLevel: number;
} {
  const memoriesRepo = new MemoriesRepository(userId);
  const goalsRepo = new GoalsRepository(userId);
  const triggersRepo = new TriggersRepository(userId);
  const approvalManager = getApprovalManager();

  const config = approvalManager.getUserConfig(userId);
  const pending = approvalManager.getPendingActions(userId);

  return {
    totalMemories: memoriesRepo.getStats().total,
    activeGoals: goalsRepo.list({ status: 'active' }).length,
    activeTriggers: triggersRepo.list({ enabled: true }).length,
    pendingApprovals: pending.length,
    autonomyLevel: config.level,
  };
}
