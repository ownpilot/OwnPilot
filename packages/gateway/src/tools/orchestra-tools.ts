/**
 * Orchestra Tools
 *
 * AI-callable tools for multi-agent collaboration:
 * - delegate_to_agent: Delegate a task to a named specialist agent
 * - create_orchestra_plan: Create a multi-agent execution plan
 * - execute_orchestra_plan: Execute a plan with dependency management
 * - check_orchestra: Check status of a running plan execution
 */

import type { ToolDefinition, OrchestraPlan, AgentTask } from '@ownpilot/core';
import { getErrorMessage, DEFAULT_ORCHESTRA_LIMITS } from '@ownpilot/core';
import { getOrchestraEngine } from '../services/orchestra-engine.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const delegateToAgentDef: ToolDefinition = {
  name: 'delegate_to_agent',
  workflowUsable: true,
  description: `Delegate a subtask to a specialized named agent. The agent will be looked up by name from the system's agent roster and will use its specialized system prompt and preferred AI model.

Use this when a task requires specific expertise that a named agent is better suited for:
- "Code Assistant" for coding tasks
- "Research Assistant" for research and analysis
- "Creative Writer" for creative content
- "Data Analyst" for data processing

The delegated agent runs as a subagent with full tool access. By default, this tool waits for the result before returning.`,
  parameters: {
    type: 'object',
    properties: {
      agent_name: {
        type: 'string',
        description:
          'Name of the agent to delegate to (e.g., "Code Assistant", "Research Assistant")',
      },
      task: {
        type: 'string',
        description: 'Detailed description of what the agent should accomplish',
      },
      context: {
        type: 'string',
        description: 'Optional additional context from the current conversation',
      },
      wait_for_result: {
        type: 'boolean',
        description:
          'If true (default), waits for the agent to finish. If false, returns immediately with a subagent ID for later retrieval.',
      },
    },
    required: ['agent_name', 'task'],
  },
  category: 'Orchestra',
  tags: ['delegate', 'agent', 'orchestra', 'collaborate', 'specialist'],
};

const executeOrchestraPlanDef: ToolDefinition = {
  name: 'execute_orchestra_plan',
  workflowUsable: true,
  description: `Execute a multi-agent orchestra plan. The plan defines multiple tasks, each assigned to a named agent, with optional dependencies between tasks.

Strategies:
- "sequential": Tasks run one after another in order
- "parallel": All tasks run simultaneously
- "dag": Tasks run as soon as their dependencies complete (directed acyclic graph)

Each task's agent gets the results from its dependency tasks as context.

Example plan:
{
  "description": "Research and write a report",
  "strategy": "dag",
  "tasks": [
    { "id": "research", "agentName": "Research Assistant", "input": "Research topic X" },
    { "id": "analyze", "agentName": "Data Analyst", "input": "Analyze findings", "dependsOn": ["research"] },
    { "id": "write", "agentName": "Creative Writer", "input": "Write report", "dependsOn": ["research", "analyze"] }
  ]
}`,
  parameters: {
    type: 'object',
    properties: {
      description: {
        type: 'string',
        description: 'Short description of what the plan accomplishes',
      },
      strategy: {
        type: 'string',
        enum: ['sequential', 'parallel', 'dag'],
        description: 'Execution strategy: sequential, parallel, or dag (dependency graph)',
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'Unique task ID within the plan' },
            agentName: { type: 'string', description: 'Name of the agent to execute this task' },
            input: { type: 'string', description: 'Task description for the agent' },
            dependsOn: {
              type: 'array',
              items: { type: 'string' },
              description: 'Task IDs that must complete before this task starts',
            },
            optional: {
              type: 'boolean',
              description: 'If true, failure does not block other tasks',
            },
          },
          required: ['id', 'agentName', 'input'],
        },
        description: `Tasks to execute (max ${DEFAULT_ORCHESTRA_LIMITS.maxTasks})`,
      },
      max_duration_ms: {
        type: 'number',
        description: 'Maximum total duration in milliseconds (default: 300000 = 5 minutes)',
      },
    },
    required: ['description', 'strategy', 'tasks'],
  },
  category: 'Orchestra',
  tags: ['orchestra', 'plan', 'multi-agent', 'pipeline', 'dag'],
};

const checkOrchestraDef: ToolDefinition = {
  name: 'check_orchestra',
  workflowUsable: true,
  description:
    'Check the status of a running or completed orchestra plan execution. Returns task progress and results.',
  parameters: {
    type: 'object',
    properties: {
      execution_id: {
        type: 'string',
        description: 'The orchestra execution ID returned by execute_orchestra_plan',
      },
    },
    required: ['execution_id'],
  },
  category: 'Orchestra',
  tags: ['orchestra', 'status', 'check'],
};

const listAgentsDef: ToolDefinition = {
  name: 'list_available_agents',
  workflowUsable: true,
  description:
    'List all available named agents that can be delegated to. Shows agent name, description, and preferred model (if configured).',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'Orchestra',
  tags: ['agents', 'list', 'orchestra', 'delegate'],
};

// =============================================================================
// Exports
// =============================================================================

export const ORCHESTRA_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  delegateToAgentDef,
  executeOrchestraPlanDef,
  checkOrchestraDef,
  listAgentsDef,
];

export const ORCHESTRA_TOOL_NAMES = ORCHESTRA_TOOL_DEFINITIONS.map((t) => t.name);

// =============================================================================
// Executor
// =============================================================================

export async function executeOrchestraTool(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  conversationId: string
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const engine = getOrchestraEngine();

  try {
    switch (toolName) {
      case 'delegate_to_agent': {
        const agentName = args.agent_name as string;
        const task = args.task as string;
        const context = args.context as string | undefined;
        const waitForResult = args.wait_for_result !== false;

        if (!agentName || !task) {
          return { success: false, error: 'agent_name and task are required' };
        }

        const result = await engine.delegateToAgent(
          { agentName, task, context, waitForResult },
          conversationId,
          userId
        );

        return { success: !result.error, result };
      }

      case 'execute_orchestra_plan': {
        const description = args.description as string;
        const strategy = args.strategy as string;
        const tasks = args.tasks as AgentTask[];
        const maxDuration = args.max_duration_ms as number | undefined;

        if (!description || !strategy || !tasks || !Array.isArray(tasks)) {
          return { success: false, error: 'description, strategy, and tasks are required' };
        }

        // Validate tasks
        for (const task of tasks) {
          if (!task.id || !task.agentName || !task.input) {
            return {
              success: false,
              error: `Each task must have id, agentName, and input. Invalid task: ${JSON.stringify(task)}`,
            };
          }
        }

        // Validate DAG (no cycles)
        if (strategy === 'dag') {
          const cycleCheck = detectCycle(tasks);
          if (cycleCheck) {
            return { success: false, error: `Dependency cycle detected: ${cycleCheck}` };
          }
        }

        const plan: OrchestraPlan = {
          description,
          strategy: strategy as OrchestraPlan['strategy'],
          tasks,
          maxDuration,
        };

        const execution = await engine.executePlan(plan, conversationId, userId);

        return {
          success: execution.state === 'completed',
          result: {
            executionId: execution.id,
            state: execution.state,
            totalDurationMs: execution.totalDurationMs,
            taskResults: execution.taskResults.map((r) => ({
              taskId: r.taskId,
              agentName: r.agentName,
              success: r.success,
              output: r.output,
              toolsUsed: r.toolsUsed,
              durationMs: r.durationMs,
              error: r.error,
            })),
            error: execution.error,
          },
        };
      }

      case 'check_orchestra': {
        const executionId = args.execution_id as string;
        if (!executionId) {
          return { success: false, error: 'execution_id is required' };
        }

        const execution = engine.getExecution(executionId);
        if (!execution) {
          return { success: false, error: `Execution not found: ${executionId}` };
        }

        return {
          success: true,
          result: {
            executionId: execution.id,
            state: execution.state,
            description: execution.plan.description,
            strategy: execution.plan.strategy,
            totalTasks: execution.plan.tasks.length,
            completedTasks: execution.taskResults.length,
            totalDurationMs: execution.totalDurationMs,
            taskResults: execution.taskResults.map((r) => ({
              taskId: r.taskId,
              agentName: r.agentName,
              success: r.success,
              durationMs: r.durationMs,
              error: r.error,
            })),
            error: execution.error,
          },
        };
      }

      case 'list_available_agents': {
        // Import AgentsRepository here to avoid circular deps
        const { AgentsRepository } = await import('../db/repositories/agents.js');
        const repo = new AgentsRepository();
        const agents = await repo.getAll();

        const agentList = agents.map((a) => ({
          name: a.name,
          hasSystemPrompt: !!a.systemPrompt,
          preferredProvider: extractField(a.config, 'preferredProvider'),
          preferredModel: extractField(a.config, 'preferredModel'),
        }));

        return { success: true, result: { agents: agentList, total: agentList.length } };
      }

      default:
        return { success: false, error: `Unknown orchestra tool: ${toolName}` };
    }
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function extractField(config: Record<string, unknown>, key: string): string | undefined {
  const value = config?.[key];
  return typeof value === 'string' && value !== 'default' ? value : undefined;
}

/** Detect cycles in task dependency graph using DFS */
function detectCycle(tasks: AgentTask[]): string | null {
  const taskIds = new Set(tasks.map((t) => t.id));
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const adjMap = new Map<string, string[]>();

  for (const task of tasks) {
    adjMap.set(task.id, task.dependsOn ?? []);
  }

  function dfs(id: string): string | null {
    if (inStack.has(id)) return id;
    if (visited.has(id)) return null;

    visited.add(id);
    inStack.add(id);

    for (const dep of adjMap.get(id) ?? []) {
      if (!taskIds.has(dep)) continue;
      const cycle = dfs(dep);
      if (cycle) return `${id} → ${cycle}`;
    }

    inStack.delete(id);
    return null;
  }

  for (const task of tasks) {
    const cycle = dfs(task.id);
    if (cycle) return cycle;
  }

  return null;
}
