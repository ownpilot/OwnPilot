/**
 * Plan Management Tools
 *
 * AI agent tools for creating, managing, and executing autonomous plans.
 */

import { type ToolDefinition, getServiceRegistry, Services, getErrorMessage } from '@ownpilot/core';
import type { CreateStepInput } from '../db/repositories/plans.js';
import { getPlanExecutor } from '../plans/executor.js';
import { getLog } from '../services/log.js';

const log = getLog('PlanTools');

// =============================================================================
// Tool Definitions
// =============================================================================

const createPlanDef: ToolDefinition = {
  name: 'create_plan',
  description: 'Create a new execution plan with a goal. After creating, add steps with add_plan_step.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Plan name (e.g. "Weekly Report Generation")',
      },
      goal: {
        type: 'string',
        description: 'What this plan aims to achieve',
      },
      description: {
        type: 'string',
        description: 'Detailed description of the plan',
      },
      priority: {
        type: 'number',
        description: 'Priority 1-10 (default: 5)',
      },
    },
    required: ['name', 'goal'],
  },
  category: 'Automation',
};

const addPlanStepDef: ToolDefinition = {
  name: 'add_plan_step',
  description: `Add a step to an existing plan. Steps execute in order by their order number.

Step types:
- tool_call: Runs a tool with arguments. Requires tool_name.
- llm_decision: AI analyzes previous step results. Requires prompt.
- user_input: Pauses plan and asks user a question. Requires question.
- condition: Branches execution based on a condition.
- parallel: Runs multiple tools concurrently.
- loop: Repeats a tool until condition is met.
- sub_plan: Executes another plan as a sub-step.

Steps can depend on other steps (by step ID). Circular dependencies are detected and rejected.
Failed steps retry automatically with exponential backoff (up to max_retries).`,
  parameters: {
    type: 'object',
    properties: {
      plan_id: {
        type: 'string',
        description: 'ID of the plan to add step to',
      },
      order: {
        type: 'number',
        description: 'Step order number (1, 2, 3...). Steps execute in this order unless dependencies override.',
      },
      type: {
        type: 'string',
        description: 'Step type',
        enum: ['tool_call', 'llm_decision', 'user_input', 'condition', 'parallel', 'loop', 'sub_plan'],
      },
      name: {
        type: 'string',
        description: 'Step name (e.g. "Fetch data", "Analyze results")',
      },
      description: {
        type: 'string',
        description: 'What this step does',
      },
      tool_name: {
        type: 'string',
        description: 'For tool_call: name of the tool to run',
      },
      tool_args: {
        type: 'object',
        description: 'For tool_call: arguments to pass to the tool',
      },
      prompt: {
        type: 'string',
        description: 'For llm_decision: prompt for AI to reason about',
      },
      choices: {
        type: 'array',
        description: 'For llm_decision: possible choices the AI can pick from',
        items: { type: 'string' },
      },
      question: {
        type: 'string',
        description: 'For user_input: question to ask the user',
      },
      dependencies: {
        type: 'array',
        description: 'Step IDs that must complete before this step runs. Use to create execution dependencies between steps.',
        items: { type: 'string' },
      },
      max_retries: {
        type: 'number',
        description: 'Maximum retry attempts on failure (default: 3). Uses exponential backoff.',
      },
    },
    required: ['plan_id', 'order', 'type', 'name'],
  },
  category: 'Automation',
};

const listPlansDef: ToolDefinition = {
  name: 'list_plans',
  description: 'List all plans with their status and progress.',
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        description: 'Filter by status',
        enum: ['pending', 'running', 'paused', 'completed', 'failed', 'cancelled'],
      },
    },
  },
  category: 'Automation',
};

const getPlanDetailsDef: ToolDefinition = {
  name: 'get_plan_details',
  description: 'Get detailed info about a plan including all its steps and execution history.',
  parameters: {
    type: 'object',
    properties: {
      plan_id: {
        type: 'string',
        description: 'ID of the plan',
      },
    },
    required: ['plan_id'],
  },
  category: 'Automation',
};

const executePlanDef: ToolDefinition = {
  name: 'execute_plan',
  description: 'Start executing a plan. The plan must have steps and be in pending status. Steps run in order, respecting dependencies. Failed steps retry with exponential backoff. Circular dependencies are detected and rejected. Use get_plan_details to check progress.',
  parameters: {
    type: 'object',
    properties: {
      plan_id: {
        type: 'string',
        description: 'ID of the plan to execute',
      },
    },
    required: ['plan_id'],
  },
  category: 'Automation',
};

const pausePlanDef: ToolDefinition = {
  name: 'pause_plan',
  description: 'Pause a running plan. Can be resumed later.',
  parameters: {
    type: 'object',
    properties: {
      plan_id: {
        type: 'string',
        description: 'ID of the plan to pause',
      },
    },
    required: ['plan_id'],
  },
  category: 'Automation',
};

const deletePlanDef: ToolDefinition = {
  name: 'delete_plan',
  description: 'Delete a plan permanently.',
  parameters: {
    type: 'object',
    properties: {
      plan_id: {
        type: 'string',
        description: 'ID of the plan to delete',
      },
    },
    required: ['plan_id'],
  },
  category: 'Automation',
};

export const PLAN_TOOLS: ToolDefinition[] = [
  createPlanDef,
  addPlanStepDef,
  listPlansDef,
  getPlanDetailsDef,
  executePlanDef,
  pausePlanDef,
  deletePlanDef,
];

// =============================================================================
// Executor
// =============================================================================

export async function executePlanTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const service = getServiceRegistry().get(Services.Plan);

  switch (toolName) {
    case 'create_plan': {
      const plan = await service.createPlan(userId, {
        name: args.name as string,
        goal: args.goal as string,
        description: args.description as string | undefined,
        priority: (args.priority as number) ?? 5,
      });

      return {
        success: true,
        result: {
          id: plan.id,
          name: plan.name,
          goal: plan.goal,
          status: plan.status,
          message: `Plan "${plan.name}" created. Add steps with add_plan_step.`,
        },
      };
    }

    case 'add_plan_step': {
      const planId = args.plan_id as string;
      const type = args.type as string;

      const stepConfig: Record<string, unknown> = {};
      if (type === 'tool_call') {
        stepConfig.toolName = args.tool_name;
        stepConfig.toolArgs = args.tool_args ?? {};
      } else if (type === 'llm_decision') {
        stepConfig.prompt = args.prompt;
        stepConfig.choices = args.choices;
      } else if (type === 'user_input') {
        stepConfig.question = args.question;
        stepConfig.inputType = 'text';
      }

      const stepInput: CreateStepInput = {
        orderNum: (args.order as number) ?? 1,
        type: type as CreateStepInput['type'],
        name: args.name as string,
        description: args.description as string | undefined,
        config: stepConfig,
        dependencies: (args.dependencies as string[]) ?? [],
        maxRetries: (args.max_retries as number) ?? 3,
      };

      try {
        const step = await service.addStep(userId, planId, stepInput);
        return {
          success: true,
          result: {
            stepId: step.id,
            planId,
            name: step.name,
            type: step.type,
            order: step.orderNum,
            message: `Step "${step.name}" added to plan.`,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'list_plans': {
      const plans = await service.listPlans(userId, {
        status: args.status as string | undefined as never,
        limit: 50,
      });

      return {
        success: true,
        result: plans.map((p) => ({
          id: p.id,
          name: p.name,
          goal: p.goal,
          status: p.status,
          progress: p.progress,
          totalSteps: p.totalSteps,
          currentStep: p.currentStep,
          createdAt: p.createdAt.toISOString(),
          startedAt: p.startedAt?.toISOString() ?? null,
          completedAt: p.completedAt?.toISOString() ?? null,
          error: p.error,
        })),
      };
    }

    case 'get_plan_details': {
      const planId = args.plan_id as string;
      const plan = await service.getPlan(userId, planId);
      if (!plan) {
        return { success: false, error: `Plan not found: ${planId}` };
      }

      const steps = await service.getSteps(userId, planId);
      const history = await service.getHistory(userId, planId, 20);

      return {
        success: true,
        result: {
          id: plan.id,
          name: plan.name,
          goal: plan.goal,
          description: plan.description,
          status: plan.status,
          progress: plan.progress,
          totalSteps: plan.totalSteps,
          currentStep: plan.currentStep,
          steps: steps.map((s) => ({
            id: s.id,
            order: s.orderNum,
            type: s.type,
            name: s.name,
            status: s.status,
            result: s.result,
            error: s.error,
            durationMs: s.durationMs,
          })),
          recentHistory: history.slice(0, 10).map((h) => ({
            event: h.eventType,
            stepId: h.stepId,
            time: h.createdAt.toISOString(),
          })),
        },
      };
    }

    case 'execute_plan': {
      const planId = args.plan_id as string;
      const plan = await service.getPlan(userId, planId);
      if (!plan) {
        return { success: false, error: `Plan not found: ${planId}` };
      }
      if (plan.status !== 'pending') {
        return { success: false, error: `Plan status is "${plan.status}", must be "pending" to execute.` };
      }

      const steps = await service.getSteps(userId, planId);
      if (steps.length === 0) {
        return { success: false, error: 'Plan has no steps. Add steps with add_plan_step first.' };
      }

      const executor = getPlanExecutor({ userId });
      try {
        // Start execution in background (non-blocking)
        executor.execute(planId).catch((e) => {
          log.error(`[Plans] Execution failed for ${planId}:`, e);
        });

        return {
          success: true,
          result: {
            id: planId,
            name: plan.name,
            status: 'running',
            totalSteps: steps.length,
            message: `Plan "${plan.name}" execution started with ${steps.length} steps.`,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'pause_plan': {
      const planId = args.plan_id as string;
      const plan = await service.getPlan(userId, planId);
      if (!plan) {
        return { success: false, error: `Plan not found: ${planId}` };
      }

      const executor = getPlanExecutor({ userId });
      try {
        await executor.pause(planId);
        return {
          success: true,
          result: { id: planId, message: `Plan "${plan.name}" paused.` },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'delete_plan': {
      const planId = args.plan_id as string;
      const deleted = await service.deletePlan(userId, planId);
      if (!deleted) {
        return { success: false, error: `Plan not found: ${planId}` };
      }
      return { success: true, result: { id: planId, message: 'Plan deleted.' } };
    }

    default:
      return { success: false, error: `Unknown plan tool: ${toolName}` };
  }
}
