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

import { type ToolCall, getServiceRegistry, Services, getBaseName } from '@ownpilot/core';
import { getResourceRegistry } from '../services/resource-registry.js';
import { getApprovalManager, assessRisk, type ActionCategory } from '../autonomy/index.js';
import { getTriggerEngine } from '../triggers/engine.js';
import { getLog } from '../services/log.js';

const log = getLog('Orchestrator');

function safeJsonParse(raw: string, fallback: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

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
  const memoryService = getServiceRegistry().get(Services.Memory);
  const goalService = getServiceRegistry().get(Services.Goal);

  const maxMemories = options.maxMemories ?? 10;
  const maxGoals = options.maxGoals ?? 5;

  // Strip previously injected sections to prevent accumulation.
  // The context-injection middleware calls this function on every request,
  // passing the agent's current systemPrompt which already contains sections
  // from the previous invocation. Without stripping, memories/goals/autonomy
  // sections duplicate on each request, bloating the prompt indefinitely.
  const injectedHeaders = [
    '\n---\n## User Context (from memory)',
    '\n---\n## Active Goals',
    '\n---\n## Available Data Resources',
    '\n---\n## Autonomy Level:',
  ];
  let cleanPrompt = basePrompt;
  let earliestIndex = cleanPrompt.length;
  for (const header of injectedHeaders) {
    const idx = cleanPrompt.indexOf(header);
    if (idx >= 0 && idx < earliestIndex) {
      earliestIndex = idx;
    }
  }
  if (earliestIndex < cleanPrompt.length) {
    cleanPrompt = cleanPrompt.slice(0, earliestIndex);
  }

  const sections: string[] = [cleanPrompt];
  let memoriesUsed = 0;
  let goalsUsed = 0;

  // === Parallel fetch: memories + goals ===
  const [memories, goals] = await Promise.all([
    memoryService.listMemories(options.userId, {
      limit: maxMemories,
      orderBy: 'importance',
    }),
    goalService.listGoals(options.userId, { status: 'active', limit: maxGoals }),
  ]);

  // === MEMORIES SECTION ===
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
  if (goals.length > 0) {
    goalsUsed = goals.length;
    const goalLines: string[] = ['## Active Goals'];

    // Fetch all goal steps in parallel (avoids N+1 sequential queries)
    const allSteps = await Promise.all(
      goals.map(g => goalService.getSteps(options.userId, g.id).catch(() => []))
    );

    for (let i = 0; i < goals.length; i++) {
      const goal = goals[i]!;
      const progressStr = `${Math.round(goal.progress)}%`;
      const dueStr = goal.dueDate ? ` (due: ${goal.dueDate})` : '';
      goalLines.push(`- **${goal.title}** [${progressStr}]${dueStr}`);
      if (goal.description) {
        goalLines.push(`  ${goal.description}`);
      }

      // Include pending steps (already fetched in parallel)
      const pendingSteps = allSteps[i]!.filter((s) => s.status === 'pending' || s.status === 'in_progress');
      if (pendingSteps.length > 0) {
        goalLines.push('  Next steps:');
        pendingSteps.slice(0, 3).forEach((s) => {
          goalLines.push(`  - [ ] ${s.title}`);
        });
      }
    }

    sections.push('\n---\n' + goalLines.join('\n'));
  }

  // === AVAILABLE RESOURCES ===
  const registry = getResourceRegistry();
  const resourceSummary = registry.getSummary();

  if (resourceSummary.length > 0) {
    const resourceLines: string[] = ['## Available Data Resources'];
    for (const r of resourceSummary) {
      resourceLines.push(`- **${r.displayName}** (\`${r.name}\`): ${r.description}`);
      resourceLines.push(`  Capabilities: ${r.capabilities.join(', ')}`);
    }
    sections.push('\n---\n' + resourceLines.join('\n'));
  }

  // === AUTONOMY GUIDANCE ===
  const approvalManager = getApprovalManager();
  const config = approvalManager.getUserConfig(options.userId);

  const autonomyLevelNames = ['Manual', 'Assisted', 'Supervised', 'Autonomous', 'Full'];
  const levelName = autonomyLevelNames[config.level] ?? 'Unknown';

  const autonomyBehavior: Record<number, string> = {
    0: 'Ask for explicit permission before taking any action.',
    1: 'Perform read-only operations freely. Ask permission for any modifications.',
    2: 'Perform most operations freely. Ask permission for destructive or irreversible actions.',
    3: 'Operate autonomously. Only ask for truly destructive actions.',
    4: 'Full autonomy. Take action immediately. The user trusts your judgment.',
  };

  sections.push(
    `\n---\n## Autonomy Level: ${levelName}\n` +
      `${autonomyBehavior[config.level] ?? autonomyBehavior[2]}\n` +
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
    safeJsonParse(toolCall.arguments || '{}', {}),
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

  return categoryMap[toolName] ?? categoryMap[getBaseName(toolName)] ?? 'tool_execution';
}

/**
 * Evaluate and execute triggers after a chat message
 */
export async function evaluateTriggers(
  userId: string,
  message: string,
  response: string
): Promise<{ triggered: string[]; pending: string[]; executed: string[] }> {
  const triggerService = getServiceRegistry().get(Services.Trigger);
  const triggers = await triggerService.listTriggers(userId, { enabled: true });
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
        log.warn(`[Orchestrator] Failed to execute trigger ${trigger.id}:`, error);
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
 * Extract and store memories from a conversation.
 *
 * Parses <memories> tags embedded by the AI in its response,
 * then stores them via batchRemember() for dedup-safe persistence.
 */
export async function extractMemories(
  userId: string,
  _message: string,
  response: string
): Promise<number> {
  const { extractMemoriesFromResponse } = await import('../utils/memory-extraction.js');
  const { memories } = extractMemoriesFromResponse(response);

  if (memories.length === 0) return 0;

  const memoryService = getServiceRegistry().get(Services.Memory);
  const result = await memoryService.batchRemember(
    userId,
    memories.map(m => ({
      type: m.type,
      content: m.content,
      source: 'conversation',
      importance: m.importance ?? 0.7,
    })),
  );

  return result.created;
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
  const goalService = getServiceRegistry().get(Services.Goal);
  const activeGoals = await goalService.getActive(userId);

  for (const goal of activeGoals) {
    const steps = await goalService.getSteps(userId, goal.id);
    const pendingSteps = steps.filter((s) => s.status === 'pending' || s.status === 'in_progress');

    for (const step of pendingSteps) {
      // Check if step title is mentioned in response as completed
      if (
        response.toLowerCase().includes(step.title.toLowerCase()) &&
        (response.includes('completed') ||
          response.includes('done') ||
          response.includes('finished'))
      ) {
        // completeStep auto-recalculates goal progress
        await goalService.completeStep(userId, step.id);
      }
    }
  }
}

/**
 * Get orchestrator stats for a user
 */
export async function getOrchestratorStats(userId: string): Promise<{
  totalMemories: number;
  activeGoals: number;
  activeTriggers: number;
  pendingApprovals: number;
  autonomyLevel: number;
}> {
  const memoryService = getServiceRegistry().get(Services.Memory);
  const goalService = getServiceRegistry().get(Services.Goal);
  const triggerService = getServiceRegistry().get(Services.Trigger);
  const approvalManager = getApprovalManager();

  const config = approvalManager.getUserConfig(userId);
  const pending = approvalManager.getPendingActions(userId);

  const [memoryStats, activeGoals, activeTriggers] = await Promise.all([
    memoryService.getStats(userId),
    goalService.getActive(userId),
    triggerService.listTriggers(userId, { enabled: true }),
  ]);

  return {
    totalMemories: memoryStats.total,
    activeGoals: activeGoals.length,
    activeTriggers: activeTriggers.length,
    pendingApprovals: pending.length,
    autonomyLevel: config.level,
  };
}
