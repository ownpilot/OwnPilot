/**
 * Coding Agent Tools
 *
 * AI agent tools for delegating coding tasks to external CLI coding agents.
 * Built-in: Claude Code, OpenAI Codex, Google Gemini CLI.
 * Custom: any user-registered CLI tool via 'custom:{name}'.
 *
 * run_coding_task creates a visible session (MiniTerminal auto-opens),
 * waits for completion, and returns the persisted result.
 */

import { type ToolDefinition, type CodingAgentProvider, getErrorMessage } from '@ownpilot/core';
import { getCodingAgentService } from '../services/coding-agent-service.js';
import { getCodingAgentSessionManager } from '../services/coding-agent-sessions.js';
import { codingAgentResultsRepo } from '../db/repositories/coding-agent-results.js';
import {
  startOrchestration,
  continueOrchestration,
  cancelOrchestration,
  getOrchestration,
  listOrchestrations,
} from '../services/coding-agent-orchestrator.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const runCodingTaskDef: ToolDefinition = {
  name: 'run_coding_task',
  workflowUsable: true,
  description: `Delegate a coding task to an external AI coding agent. Creates a visible session that the user can watch in real-time.

Built-in providers:
- **claude-code**: Anthropic Claude Code (best for complex multi-file changes, refactoring)
- **codex**: OpenAI Codex CLI (best for code generation and test writing)
- **gemini-cli**: Google Gemini CLI (best for code analysis and explanation)

Custom providers: use 'custom:{name}' for user-registered CLI tools. Run list_coding_agents to see all available providers.

Each provider uses the user's own API key. The agent runs autonomously in the specified working directory — it can read, edit, and create files. Results are persisted and can be retrieved later with get_task_result or list_task_results.`,
  parameters: {
    type: 'object',
    properties: {
      provider: {
        type: 'string',
        description:
          "Which coding agent to use. Built-in: 'claude-code', 'codex', 'gemini-cli'. Custom: 'custom:{name}'.",
      },
      prompt: {
        type: 'string',
        description:
          'The coding task description — be specific about what files to change and what the expected outcome is',
      },
      cwd: {
        type: 'string',
        description:
          'Working directory for the task (absolute path). The coding agent will operate within this directory.',
      },
      model: {
        type: 'string',
        description:
          'Model override (e.g., "claude-sonnet-4-5-20250929" for Claude Code, "o3" for Codex)',
      },
      max_budget_usd: {
        type: 'number',
        description: 'Maximum cost in USD (default: 1.0). Only enforced by Claude Code SDK.',
      },
      max_turns: {
        type: 'number',
        description: 'Maximum number of agent turns (default: 10). Only used by Claude Code SDK.',
      },
      timeout_seconds: {
        type: 'number',
        description: 'Timeout in seconds (default: 300, max: 1800)',
      },
    },
    required: ['provider', 'prompt'],
  },
  category: 'Coding Agents',
  tags: ['coding', 'agent', 'delegation', 'development'],
  configRequirements: [
    {
      name: 'coding-claude-code',
      displayName: 'Claude Code',
      description: 'Anthropic API key for Claude Code SDK',
      category: 'coding-agents',
      configSchema: [
        {
          name: 'api_key',
          type: 'secret',
          label: 'Anthropic API Key',
          description: 'API key from console.anthropic.com',
          envVar: 'ANTHROPIC_API_KEY',
          required: false,
        },
      ],
    },
    {
      name: 'coding-codex',
      displayName: 'OpenAI Codex',
      description: 'API key for OpenAI Codex CLI',
      category: 'coding-agents',
      configSchema: [
        {
          name: 'api_key',
          type: 'secret',
          label: 'Codex API Key',
          description: 'API key from platform.openai.com (or CODEX_API_KEY)',
          envVar: 'CODEX_API_KEY',
          required: false,
        },
      ],
    },
    {
      name: 'coding-gemini',
      displayName: 'Gemini CLI',
      description: 'API key for Google Gemini CLI',
      category: 'coding-agents',
      configSchema: [
        {
          name: 'api_key',
          type: 'secret',
          label: 'Gemini API Key',
          description: 'API key from aistudio.google.com (or GEMINI_API_KEY)',
          envVar: 'GEMINI_API_KEY',
          required: false,
        },
      ],
    },
  ],
};

const listCodingAgentsDef: ToolDefinition = {
  name: 'list_coding_agents',
  workflowUsable: true,
  description:
    'List available coding agents (built-in and custom) with their status (installed, configured, version). Check this before delegating a coding task.',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'Coding Agents',
  tags: ['coding', 'agent', 'status'],
};

const getTaskResultDef: ToolDefinition = {
  name: 'get_task_result',
  workflowUsable: true,
  description:
    'Get the result of a previously executed coding agent task by its result ID. Returns the full output, status, cost, and duration.',
  parameters: {
    type: 'object',
    properties: {
      result_id: {
        type: 'string',
        description: 'The result ID to fetch',
      },
    },
    required: ['result_id'],
  },
  category: 'Coding Agents',
  tags: ['coding', 'agent', 'result'],
};

const listTaskResultsDef: ToolDefinition = {
  name: 'list_task_results',
  workflowUsable: true,
  description:
    'List recent coding agent task results. Returns summaries including provider, prompt, success status, duration, and cost.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 10, max: 50)',
      },
    },
  },
  category: 'Coding Agents',
  tags: ['coding', 'agent', 'result', 'history'],
};

// =============================================================================
// Orchestration Tool Definitions
// =============================================================================

const orchestrateCodingTaskDef: ToolDefinition = {
  name: 'orchestrate_coding_task',
  workflowUsable: true,
  description: `Start a multi-step coding orchestration. OwnPilot's AI analyzer chains CLI tool sessions together — it spawns a session, analyzes the output, decides the next step, and continues until the goal is achieved.

Use this for complex tasks that require multiple rounds of work:
- "Build a REST API with auth, tests, and docs"
- "Refactor the payment module and update all tests"
- "Set up CI/CD pipeline with linting, testing, and deployment"

The orchestrator works autonomously in auto_mode, or pauses after each step for user review. Returns the orchestration run ID for tracking progress.`,
  parameters: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description: 'High-level goal to achieve — the orchestrator will break this into steps',
      },
      provider: {
        type: 'string',
        description:
          "CLI tool to use: 'claude-code', 'codex', or 'gemini-cli'. Default: 'claude-code'.",
      },
      cwd: {
        type: 'string',
        description: 'Working directory (absolute path) for the CLI tool to operate in',
      },
      auto_mode: {
        type: 'boolean',
        description:
          'If true, the orchestrator continues autonomously without pausing. If false (default), pauses after each step for review.',
      },
      max_steps: {
        type: 'number',
        description: 'Maximum number of steps (default: 10, max: 20)',
      },
      model: {
        type: 'string',
        description: 'Model override for the CLI tool (optional)',
      },
    },
    required: ['goal', 'cwd'],
  },
  category: 'Coding Agents',
  tags: ['coding', 'agent', 'orchestration', 'multi-step', 'automation'],
};

const checkOrchestrationDef: ToolDefinition = {
  name: 'check_orchestration',
  workflowUsable: true,
  description:
    'Check the status of an orchestration run. Returns current status, step progress, and the latest analysis.',
  parameters: {
    type: 'object',
    properties: {
      run_id: {
        type: 'string',
        description: 'The orchestration run ID',
      },
    },
    required: ['run_id'],
  },
  category: 'Coding Agents',
  tags: ['coding', 'agent', 'orchestration', 'status'],
};

const continueOrchestrationDef: ToolDefinition = {
  name: 'continue_orchestration',
  workflowUsable: true,
  description:
    'Continue a paused orchestration run by providing the next instruction. Only works when the run is in "waiting_user" status.',
  parameters: {
    type: 'object',
    properties: {
      run_id: {
        type: 'string',
        description: 'The orchestration run ID',
      },
      response: {
        type: 'string',
        description: 'Your instruction or response to continue the orchestration',
      },
    },
    required: ['run_id', 'response'],
  },
  category: 'Coding Agents',
  tags: ['coding', 'agent', 'orchestration', 'continue'],
};

const cancelOrchestrationDef: ToolDefinition = {
  name: 'cancel_orchestration',
  workflowUsable: true,
  description: 'Cancel a running or paused orchestration run.',
  parameters: {
    type: 'object',
    properties: {
      run_id: {
        type: 'string',
        description: 'The orchestration run ID to cancel',
      },
    },
    required: ['run_id'],
  },
  category: 'Coding Agents',
  tags: ['coding', 'agent', 'orchestration', 'cancel'],
};

const listOrchestrationsDef: ToolDefinition = {
  name: 'list_orchestrations',
  workflowUsable: true,
  description:
    'List recent orchestration runs with their status, step count, and goal summary.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Max results (default: 10)',
      },
    },
  },
  category: 'Coding Agents',
  tags: ['coding', 'agent', 'orchestration', 'list'],
};

export const CODING_AGENT_TOOLS: ToolDefinition[] = [
  runCodingTaskDef,
  listCodingAgentsDef,
  getTaskResultDef,
  listTaskResultsDef,
  orchestrateCodingTaskDef,
  checkOrchestrationDef,
  continueOrchestrationDef,
  cancelOrchestrationDef,
  listOrchestrationsDef,
];

// =============================================================================
// Executor
// =============================================================================

export async function executeCodingAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const service = getCodingAgentService();

  switch (toolName) {
    case 'run_coding_task': {
      try {
        const provider = args.provider as CodingAgentProvider;
        const prompt = args.prompt as string;
        const timeoutSeconds = args.timeout_seconds as number | undefined;
        const timeoutMs = timeoutSeconds ? Math.min(timeoutSeconds, 1800) * 1000 : 300_000;

        // Create a visible session (MiniTerminal auto-opens via WS broadcast)
        const session = await service.createSession(
          {
            provider,
            prompt,
            cwd: args.cwd as string | undefined,
            model: args.model as string | undefined,
            mode: 'auto',
            timeout: timeoutMs,
            maxTurns: args.max_turns as number | undefined,
            maxBudgetUsd: args.max_budget_usd as number | undefined,
            source: 'ai-tool',
          },
          userId
        );

        // Wait for the session to complete
        const mgr = getCodingAgentSessionManager();
        const completedSession = await mgr.waitForCompletion(session.id, userId, timeoutMs);

        // Fetch the persisted result from DB
        const result = await codingAgentResultsRepo.getBySessionId(session.id, userId);

        if (result) {
          return {
            success: result.success,
            result: {
              resultId: result.id,
              sessionId: session.id,
              output: truncateOutput(result.output, 8000),
              provider: result.provider,
              model: result.model,
              durationMs: result.durationMs,
              costUsd: result.costUsd,
              exitCode: result.exitCode,
            },
            error: result.success ? undefined : (result.error ?? 'Task failed'),
          };
        }

        // Fallback: result not persisted yet (race condition or DB error)
        return {
          success: completedSession.state === 'completed',
          result: {
            sessionId: session.id,
            state: completedSession.state,
            exitCode: completedSession.exitCode,
          },
          error:
            completedSession.state !== 'completed'
              ? `Session ended with state: ${completedSession.state}`
              : undefined,
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'list_coding_agents': {
      const status = await service.getStatus();
      return { success: true, result: status };
    }

    case 'get_task_result': {
      try {
        const resultId = args.result_id as string;
        if (!resultId) return { success: false, error: 'result_id is required' };

        const result = await codingAgentResultsRepo.getById(resultId, userId);
        if (!result) return { success: false, error: `Result ${resultId} not found` };

        return {
          success: true,
          result: {
            id: result.id,
            provider: result.provider,
            prompt: result.prompt,
            cwd: result.cwd,
            model: result.model,
            success: result.success,
            output: truncateOutput(result.output, 8000),
            exitCode: result.exitCode,
            error: result.error,
            durationMs: result.durationMs,
            costUsd: result.costUsd,
            mode: result.mode,
            createdAt: result.createdAt,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'list_task_results': {
      try {
        const limit = Math.min(Math.max((args.limit as number) || 10, 1), 50);
        const results = await codingAgentResultsRepo.list(userId, limit);

        return {
          success: true,
          result: results.map((r) => ({
            id: r.id,
            provider: r.provider,
            prompt: r.prompt.length > 100 ? r.prompt.slice(0, 100) + '...' : r.prompt,
            success: r.success,
            durationMs: r.durationMs,
            costUsd: r.costUsd,
            exitCode: r.exitCode,
            createdAt: r.createdAt,
          })),
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'orchestrate_coding_task': {
      try {
        const goal = args.goal as string;
        const cwd = args.cwd as string;
        if (!goal || !cwd) return { success: false, error: 'goal and cwd are required' };

        const maxSteps = args.max_steps
          ? Math.min(Math.max(args.max_steps as number, 1), 20)
          : undefined;

        const run = await startOrchestration(
          {
            goal,
            provider: ((args.provider as string) ?? 'claude-code') as CodingAgentProvider,
            cwd,
            autoMode: (args.auto_mode as boolean) ?? false,
            maxSteps,
            model: args.model as string | undefined,
          },
          userId
        );

        return {
          success: true,
          result: {
            runId: run.id,
            status: run.status,
            goal: run.goal,
            provider: run.provider,
            autoMode: run.autoMode,
            maxSteps: run.maxSteps,
            message: run.autoMode
              ? 'Orchestration started in auto-mode. Use check_orchestration to monitor progress.'
              : 'Orchestration started. It will pause after each step for your review. Use continue_orchestration to proceed.',
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'check_orchestration': {
      try {
        const runId = args.run_id as string;
        if (!runId) return { success: false, error: 'run_id is required' };

        const run = await getOrchestration(runId, userId);
        if (!run) return { success: false, error: `Orchestration ${runId} not found` };

        return {
          success: true,
          result: {
            runId: run.id,
            status: run.status,
            goal: run.goal,
            provider: run.provider,
            currentStep: run.currentStep,
            totalSteps: run.steps.length,
            maxSteps: run.maxSteps,
            autoMode: run.autoMode,
            totalDurationMs: run.totalDurationMs,
            steps: run.steps.map((s) => ({
              index: s.index,
              status: s.status,
              summary: s.analysis?.summary ?? s.outputSummary,
              goalComplete: s.analysis?.goalComplete,
              confidence: s.analysis?.confidence,
              hasErrors: s.analysis?.hasErrors,
              durationMs: s.durationMs,
              nextPrompt: s.analysis?.nextPrompt,
              userQuestion: s.analysis?.userQuestion,
            })),
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'continue_orchestration': {
      try {
        const runId = args.run_id as string;
        const response = args.response as string;
        if (!runId || !response) return { success: false, error: 'run_id and response are required' };

        const run = await continueOrchestration(runId, userId, response);
        if (!run) {
          return {
            success: false,
            error: `Orchestration ${runId} not found or not in waiting_user status`,
          };
        }

        return {
          success: true,
          result: {
            runId: run.id,
            status: run.status,
            message: 'Orchestration resumed with your response.',
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'cancel_orchestration': {
      try {
        const runId = args.run_id as string;
        if (!runId) return { success: false, error: 'run_id is required' };

        const cancelled = await cancelOrchestration(runId, userId);
        return {
          success: cancelled,
          result: cancelled ? { message: 'Orchestration cancelled' } : undefined,
          error: cancelled ? undefined : `Orchestration ${runId} not found`,
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'list_orchestrations': {
      try {
        const limit = Math.min(Math.max((args.limit as number) || 10, 1), 50);
        const runs = await listOrchestrations(userId, limit);

        return {
          success: true,
          result: runs.map((r) => ({
            runId: r.id,
            goal: r.goal.length > 80 ? r.goal.slice(0, 80) + '...' : r.goal,
            status: r.status,
            provider: r.provider,
            stepsCompleted: r.steps.filter((s) => s.status === 'completed').length,
            maxSteps: r.maxSteps,
            autoMode: r.autoMode,
            totalDurationMs: r.totalDurationMs,
            createdAt: r.createdAt,
          })),
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    default:
      return { success: false, error: `Unknown coding agent tool: ${toolName}` };
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Truncate output to avoid huge tool results in LLM context */
function truncateOutput(output: string, maxLen: number): string {
  if (output.length <= maxLen) return output;
  const half = Math.floor(maxLen / 2) - 20;
  return output.slice(0, half) + '\n\n... [output truncated] ...\n\n' + output.slice(-half);
}
