/**
 * Pulse Management Tools
 *
 * AI agent tools for managing the Autonomy Engine (Pulse System).
 */

import { type ToolDefinition, getErrorMessage } from '@ownpilot/core';
import { getAutonomyEngine } from '../autonomy/engine.js';

// =============================================================================
// Tool Definitions
// =============================================================================

const getPulseStatusDef: ToolDefinition = {
  name: 'get_pulse_status',
  workflowUsable: false,
  description:
    'Get the current status of the Autonomy Engine: whether it is running, its settings, and information about the last pulse cycle.',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'Automation',
};

const runPulseNowDef: ToolDefinition = {
  name: 'run_pulse_now',
  workflowUsable: false,
  description:
    'Manually trigger a pulse cycle. The engine will gather context, evaluate signals, and optionally invoke the LLM to decide on actions.',
  parameters: {
    type: 'object',
    properties: {},
  },
  category: 'Automation',
};

const updatePulseSettingsDef: ToolDefinition = {
  name: 'update_pulse_settings',
  workflowUsable: false,
  description:
    'Update Autonomy Engine settings. Can enable/disable the engine, change the pulse interval, or set quiet hours.',
  parameters: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Enable or disable the Autonomy Engine',
      },
      min_interval_minutes: {
        type: 'number',
        description: 'Minimum pulse interval in minutes (default: 5)',
      },
      max_interval_minutes: {
        type: 'number',
        description: 'Maximum pulse interval in minutes (default: 15)',
      },
      max_actions: {
        type: 'number',
        description: 'Maximum actions per pulse cycle (default: 5)',
      },
      quiet_hours_start: {
        type: 'number',
        description: 'Start of quiet hours (hour 0-23, default: 22)',
      },
      quiet_hours_end: {
        type: 'number',
        description: 'End of quiet hours (hour 0-23, default: 7)',
      },
    },
  },
  category: 'Automation',
};

const getPulseHistoryDef: ToolDefinition = {
  name: 'get_pulse_history',
  workflowUsable: false,
  description: 'Get recent pulse cycle logs showing signals detected, actions taken, and outcomes.',
  parameters: {
    type: 'object',
    properties: {
      limit: {
        type: 'number',
        description: 'Number of entries to return (default: 10, max: 50)',
      },
    },
  },
  category: 'Automation',
};

export const PULSE_TOOLS: ToolDefinition[] = [
  getPulseStatusDef,
  runPulseNowDef,
  updatePulseSettingsDef,
  getPulseHistoryDef,
];

// =============================================================================
// Executor
// =============================================================================

export async function executePulseTool(
  toolName: string,
  args: Record<string, unknown>,
  userId = 'default'
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  const engine = getAutonomyEngine();

  switch (toolName) {
    case 'get_pulse_status': {
      const status = engine.getStatus();
      return {
        success: true,
        result: {
          running: status.running,
          enabled: status.enabled,
          minIntervalMinutes: status.config.minIntervalMs / 60_000,
          maxIntervalMinutes: status.config.maxIntervalMs / 60_000,
          maxActions: status.config.maxActions,
          quietHours: `${status.config.quietHoursStart}:00 - ${status.config.quietHoursEnd}:00`,
          lastPulse: status.lastPulse
            ? {
                pulsedAt: status.lastPulse.pulsedAt.toISOString(),
                signalsFound: status.lastPulse.signalsFound,
                urgencyScore: status.lastPulse.urgencyScore,
              }
            : null,
        },
      };
    }

    case 'run_pulse_now': {
      try {
        const result = await engine.runPulse(userId, true);
        return {
          success: true,
          result: {
            pulseId: result.pulseId,
            signalsFound: result.signalsFound,
            llmCalled: result.llmCalled,
            actionsExecuted: result.actionsExecuted.length,
            reportMessage: result.reportMessage,
            urgencyScore: result.urgencyScore,
            durationMs: result.durationMs,
            error: result.error,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'update_pulse_settings': {
      try {
        engine.updateSettings({
          enabled: args.enabled as boolean | undefined,
          minIntervalMs: args.min_interval_minutes
            ? (args.min_interval_minutes as number) * 60_000
            : undefined,
          maxIntervalMs: args.max_interval_minutes
            ? (args.max_interval_minutes as number) * 60_000
            : undefined,
          maxActions: args.max_actions as number | undefined,
          quietHoursStart: args.quiet_hours_start as number | undefined,
          quietHoursEnd: args.quiet_hours_end as number | undefined,
        });

        const status = engine.getStatus();
        return {
          success: true,
          result: {
            message: 'Pulse settings updated.',
            running: status.running,
            enabled: status.enabled,
            minIntervalMinutes: status.config.minIntervalMs / 60_000,
            maxIntervalMinutes: status.config.maxIntervalMs / 60_000,
            maxActions: status.config.maxActions,
            quietHours: `${status.config.quietHoursStart}:00 - ${status.config.quietHoursEnd}:00`,
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    case 'get_pulse_history': {
      const limit = Math.min(Math.max(1, (args.limit as number) || 10), 50);
      try {
        const logs = await engine.getRecentLogs(userId, limit);
        const stats = await engine.getStats(userId);
        return {
          success: true,
          result: {
            stats: {
              totalPulses: stats.totalPulses,
              llmCallRate: `${(stats.llmCallRate * 100).toFixed(1)}%`,
              avgDurationMs: Math.round(stats.avgDurationMs),
              actionsExecuted: stats.actionsExecuted,
            },
            recentLogs: logs.map((entry) => ({
              id: entry.id,
              pulsedAt: entry.pulsedAt.toISOString(),
              durationMs: entry.durationMs,
              signalsFound: entry.signalsFound,
              llmCalled: entry.llmCalled,
              actionsCount: entry.actionsCount,
              reportMsg: entry.reportMsg,
              error: entry.error,
              manual: entry.manual,
            })),
          },
        };
      } catch (e) {
        return { success: false, error: getErrorMessage(e) };
      }
    }

    default:
      return { success: false, error: `Unknown pulse tool: ${toolName}` };
  }
}
