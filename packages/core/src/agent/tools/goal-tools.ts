/**
 * Goal Tools
 *
 * Goal management operations for the autonomous AI assistant.
 * Allows the AI to create, track, and manage long-term objectives.
 * Definitions only - executors are in gateway package.
 */

import type { ToolDefinition } from '../types.js';

// ============================================================================
// GOAL MANAGEMENT TOOLS
// ============================================================================

/**
 * Create a new goal
 */
export const createGoalTool: ToolDefinition = {
  name: 'create_goal',
  description: `Create a new goal to track long-term objectives.
Use this when the user:
- Expresses a desire to achieve something
- Sets a deadline or target
- Wants to track progress on a project
- Mentions learning something new

Goals can have sub-goals (parent_id) for complex objectives.
Priority is 1-10 (10 = most important).`,
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Clear, actionable goal title (e.g., "Learn Spanish basics")',
      },
      description: {
        type: 'string',
        description: 'Detailed description of what success looks like',
      },
      priority: {
        type: 'number',
        description: 'Priority 1-10 (10 = highest). Default: 5',
      },
      dueDate: {
        type: 'string',
        description: 'Target completion date (ISO format: YYYY-MM-DD)',
      },
      parentId: {
        type: 'string',
        description: 'Parent goal ID for sub-goals',
      },
    },
    required: ['title'],
  },
};

/**
 * List goals
 */
export const listGoalsTool: ToolDefinition = {
  name: 'list_goals',
  description: `List current goals, optionally filtered by status.
Use this to:
- Review what the user is working towards
- Check progress on objectives
- Find goals that need attention`,
  parameters: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'paused', 'completed', 'abandoned'],
        description: 'Filter by goal status. Default: active',
      },
      limit: {
        type: 'number',
        description: 'Maximum goals to return (default: 10)',
      },
    },
    required: [],
  },
};

/**
 * Update a goal
 */
export const updateGoalTool: ToolDefinition = {
  name: 'update_goal',
  description: `Update a goal's status, progress, or details.
Use this when:
- User reports progress on a goal
- User wants to pause or abandon a goal
- Goal details need to be changed
- Goal is completed`,
  parameters: {
    type: 'object',
    properties: {
      goalId: {
        type: 'string',
        description: 'The ID of the goal to update',
      },
      status: {
        type: 'string',
        enum: ['active', 'paused', 'completed', 'abandoned'],
        description: 'New status for the goal',
      },
      progress: {
        type: 'number',
        description: 'Progress percentage (0-100)',
      },
      title: {
        type: 'string',
        description: 'Updated title',
      },
      description: {
        type: 'string',
        description: 'Updated description',
      },
      priority: {
        type: 'number',
        description: 'Updated priority (1-10)',
      },
      dueDate: {
        type: 'string',
        description: 'Updated due date (ISO format)',
      },
    },
    required: ['goalId'],
  },
};

/**
 * Decompose a goal into steps
 */
export const decomposeGoalTool: ToolDefinition = {
  name: 'decompose_goal',
  description: `Break down a goal into actionable steps.
Use this to help the user:
- Plan how to achieve a goal
- Create a roadmap for complex objectives
- Identify concrete next actions

Steps are ordered and can have dependencies.`,
  parameters: {
    type: 'object',
    properties: {
      goalId: {
        type: 'string',
        description: 'The ID of the goal to decompose',
      },
      steps: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Step title (actionable verb phrase)',
            },
            description: {
              type: 'string',
              description: 'Detailed description of the step',
            },
          },
          required: ['title'],
        },
        description: 'Array of steps to add to the goal',
      },
    },
    required: ['goalId', 'steps'],
  },
};

/**
 * Get next actions
 */
export const getNextActionsTool: ToolDefinition = {
  name: 'get_next_actions',
  description: `Get the next actionable steps across all active goals.
Returns steps that:
- Belong to active goals
- Are pending or in progress
- Have no uncompleted dependencies

Use this to help the user decide what to work on next.`,
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum actions to return (default: 5)',
      },
    },
    required: [],
  },
};

/**
 * Complete a step
 */
export const completeStepTool: ToolDefinition = {
  name: 'complete_step',
  description: `Mark a goal step as completed.
Use this when the user reports completing a task related to a goal.
This automatically updates the parent goal's progress.`,
  parameters: {
    type: 'object',
    properties: {
      stepId: {
        type: 'string',
        description: 'The ID of the step to complete',
      },
      result: {
        type: 'string',
        description: 'Optional: notes about what was accomplished',
      },
    },
    required: ['stepId'],
  },
};

/**
 * Get goal details
 */
export const getGoalDetailsTool: ToolDefinition = {
  name: 'get_goal_details',
  description: `Get detailed information about a specific goal including its steps.
Use this to review a goal's full context and progress.`,
  parameters: {
    type: 'object',
    properties: {
      goalId: {
        type: 'string',
        description: 'The ID of the goal',
      },
    },
    required: ['goalId'],
  },
};

/**
 * Get goal statistics
 */
export const goalStatsTool: ToolDefinition = {
  name: 'goal_stats',
  description: `Get statistics about the user's goals.
Shows total goals, completion rates, and trends.
Useful for motivation and progress reviews.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

// ============================================================================
// EXPORT ALL GOAL TOOLS
// ============================================================================

export const GOAL_TOOLS: ToolDefinition[] = [
  createGoalTool,
  listGoalsTool,
  updateGoalTool,
  decomposeGoalTool,
  getNextActionsTool,
  completeStepTool,
  getGoalDetailsTool,
  goalStatsTool,
];

/**
 * Get tool names for goal operations
 */
export const GOAL_TOOL_NAMES = GOAL_TOOLS.map((t) => t.name);
