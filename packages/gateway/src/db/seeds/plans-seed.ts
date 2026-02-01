/**
 * Example Plans Seed
 *
 * Creates example plans with steps to demonstrate the plans system.
 * Only creates plans that don't already exist.
 */

import { PlansRepository, type CreatePlanInput, type CreateStepInput } from '../repositories/plans.js';
import { getLog } from '../../services/log.js';

const log = getLog('PlanSeed');

interface ExamplePlan {
  plan: CreatePlanInput;
  steps: Omit<CreateStepInput, 'orderNum'>[];
}

const EXAMPLE_PLANS: ExamplePlan[] = [
  {
    plan: {
      name: 'Weekly Goal Review',
      goal: 'Review all active goals, identify stale ones, and generate a progress report',
      description: 'Automated weekly review of goal progress with AI-generated insights',
      priority: 7,
    },
    steps: [
      {
        type: 'tool_call',
        name: 'Fetch active goals',
        description: 'Get all active goals with their progress',
        config: {
          toolName: 'list_goals',
          toolArgs: { status: 'active', limit: 20 },
        },
      },
      {
        type: 'tool_call',
        name: 'Get next actions',
        description: 'Fetch suggested next actions across all goals',
        config: {
          toolName: 'get_next_actions',
          toolArgs: { limit: 10 },
        },
      },
      {
        type: 'llm_decision',
        name: 'Analyze progress',
        description: 'AI reviews the goals and actions to generate insights',
        config: {
          prompt: 'Based on the goal data from previous steps, identify: 1) Goals that are on track, 2) Goals that need attention, 3) Suggested priorities for the coming week. Provide a concise summary.',
          choices: ['goals_healthy', 'needs_attention', 'critical_intervention'],
        },
      },
    ],
  },
  {
    plan: {
      name: 'Daily Memory Digest',
      goal: 'Summarize recent memories and identify patterns',
      description: 'Reviews memories added in the last 24 hours and creates a digest',
      priority: 5,
    },
    steps: [
      {
        type: 'tool_call',
        name: 'List recent memories',
        description: 'Get memories from the last 24 hours',
        config: {
          toolName: 'list_memories',
          toolArgs: { limit: 20 },
        },
      },
      {
        type: 'llm_decision',
        name: 'Generate digest',
        description: 'AI summarizes the memories into a daily digest',
        config: {
          prompt: 'Create a concise daily digest from the memories listed above. Group by type (facts, preferences, events) and highlight any important patterns or changes.',
        },
      },
    ],
  },
  {
    plan: {
      name: 'Task Cleanup',
      goal: 'Find and handle overdue or stale tasks',
      description: 'Identifies tasks that are overdue or have not been updated recently',
      priority: 6,
    },
    steps: [
      {
        type: 'tool_call',
        name: 'List pending tasks',
        description: 'Get all pending tasks',
        config: {
          toolName: 'list_tasks',
          toolArgs: { status: 'pending', limit: 30 },
        },
      },
      {
        type: 'llm_decision',
        name: 'Identify stale tasks',
        description: 'AI identifies which tasks are overdue or stale',
        config: {
          prompt: 'Review the task list. Identify tasks that appear overdue or stale. For each stale task, suggest whether to: keep (still relevant), reschedule, or close.',
          choices: ['all_current', 'some_stale', 'many_stale'],
        },
      },
    ],
  },
];

export async function seedExamplePlans(userId = 'default'): Promise<{
  created: number;
  skipped: number;
}> {
  const repo = new PlansRepository(userId);
  const existing = await repo.list({ limit: 100 });
  const existingNames = new Set(existing.map((p) => p.name));

  let created = 0;
  let skipped = 0;

  for (const example of EXAMPLE_PLANS) {
    if (existingNames.has(example.plan.name)) {
      skipped++;
      continue;
    }

    try {
      const plan = await repo.create(example.plan);

      // Add steps
      for (let i = 0; i < example.steps.length; i++) {
        const step = example.steps[i]!;
        await repo.addStep(plan.id, {
          ...step,
          orderNum: i + 1,
        });
      }

      created++;
    } catch (error) {
      log.error(`[Plans Seed] Failed to create plan "${example.plan.name}":`, error);
      skipped++;
    }
  }

  return { created, skipped };
}
