/**
 * Scheduler Integration
 *
 * Connects the core scheduler with:
 * - Agent for prompt-based task execution
 * - Tool registry for direct tool execution
 * - Channel manager for notifications
 */

import { join } from 'node:path';
import {
  SCHEDULER_CHECK_INTERVAL_MS,
  SCHEDULER_DEFAULT_TIMEOUT_MS,
  SCHEDULER_MAX_HISTORY_PER_TASK,
} from '../config/defaults.js';
import {
  createScheduler,
  createSchedulerNotificationBridge,
  type Scheduler,
  type ScheduledTask,
  type TaskExecutionResult,
  type SchedulerNotificationBridge,
  type TaskNotificationEvent,
} from '@ownpilot/core';
import type { NotificationRequest } from '@ownpilot/core';
import { getChannelService } from '@ownpilot/core';
import { getOrCreateDefaultAgent } from '../routes/agents.js';
import { getDataPaths } from '../paths/index.js';
import { getLog } from '../services/log.js';

const log = getLog('Scheduler');

// Singleton scheduler instance
let schedulerInstance: Scheduler | null = null;
let notificationBridge: SchedulerNotificationBridge | null = null;

/**
 * Execute a scheduled task
 * This is the task executor that handles prompt and tool tasks
 */
async function executeScheduledTask(task: ScheduledTask): Promise<TaskExecutionResult> {
  const startedAt = new Date().toISOString();

  try {
    if (task.payload.type === 'prompt') {
      // Execute prompt using agent
      const agent = await getOrCreateDefaultAgent();
      const result = await agent.chat(task.payload.prompt);

      if (result.ok) {
        return {
          taskId: task.id,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          result: result.value.content,
          modelUsed: result.value.model,
          tokenUsage: result.value.usage
            ? {
                input: result.value.usage.promptTokens,
                output: result.value.usage.completionTokens,
                total: result.value.usage.totalTokens,
              }
            : undefined,
        };
      } else {
        return {
          taskId: task.id,
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
          error: result.error.message,
        };
      }
    } else if (task.payload.type === 'tool') {
      // Execute tool directly
      const toolPayload = task.payload as { type: 'tool'; toolName: string; args: Record<string, unknown> };
      const agent = await getOrCreateDefaultAgent();
      const tools = agent.getTools();
      const tool = tools.find((t) => t.name === toolPayload.toolName);

      if (!tool) {
        return {
          taskId: task.id,
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
          error: `Tool not found: ${toolPayload.toolName}`,
        };
      }

      // Execute the tool via agent chat with specific instruction
      const toolInstruction = `Execute the tool "${toolPayload.toolName}" with arguments: ${JSON.stringify(toolPayload.args)}. Return only the tool result.`;
      const result = await agent.chat(toolInstruction);

      if (result.ok) {
        return {
          taskId: task.id,
          status: 'completed',
          startedAt,
          completedAt: new Date().toISOString(),
          result: result.value.content,
        };
      } else {
        return {
          taskId: task.id,
          status: 'failed',
          startedAt,
          completedAt: new Date().toISOString(),
          error: result.error.message,
        };
      }
    } else if (task.payload.type === 'workflow') {
      // Execute workflow steps sequentially
      const results: unknown[] = [];

      for (const step of task.payload.steps) {
        const stepTask: ScheduledTask = {
          ...task,
          name: `${task.name} - ${step.name}`,
          payload: step.payload,
        };

        const stepResult = await executeScheduledTask(stepTask);
        results.push(stepResult.result);

        if (stepResult.status === 'failed') {
          return {
            taskId: task.id,
            status: 'failed',
            startedAt,
            completedAt: new Date().toISOString(),
            error: `Step "${step.name}" failed: ${stepResult.error}`,
            result: results,
          };
        }
      }

      return {
        taskId: task.id,
        status: 'completed',
        startedAt,
        completedAt: new Date().toISOString(),
        result: results,
      };
    }

    return {
      taskId: task.id,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      error: `Unknown task type: ${(task.payload as { type: string }).type}`,
    };
  } catch (error) {
    return {
      taskId: task.id,
      status: 'failed',
      startedAt,
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Handle notification events from the scheduler
 * Sends notifications to configured channels
 */
async function handleSchedulerNotification(
  event: TaskNotificationEvent,
  notification: NotificationRequest
): Promise<void> {
  const { task } = event;
  const channels = task.notifyChannels ?? notification.channels ?? [];

  if (channels.length === 0) {
    log.info('[Scheduler] No notification channels configured for task:', task.name);
    return;
  }

  // Format message
  const message = `${notification.content.title}\n\n${notification.content.body}`;

  // Send to each configured channel
  const service = getChannelService();
  for (const channelId of channels) {
    try {
      // Check if it's a specific channel ID first
      let targetPluginId: string | undefined;
      let targetPlatform: string | undefined;
      const directChannel = service.getChannel(channelId);

      if (directChannel) {
        targetPluginId = channelId;
        targetPlatform = directChannel.getPlatform();
      } else {
        // Try to find a connected channel of that platform type
        const byPlatform = service.listChannels().filter((ch) => ch.platform === channelId);
        const connected = byPlatform.find((ch) => ch.status === 'connected');
        if (connected) {
          targetPluginId = connected.pluginId;
          targetPlatform = connected.platform;
        }
      }

      if (targetPluginId) {
        try {
          await service.send(targetPluginId, {
            platformChatId: targetPluginId,
            text: message,
          });
          log.info(`[Scheduler] Notification sent to ${targetPlatform}:${targetPluginId}`);
        } catch (sendError) {
          log.warn(`[Scheduler] Failed to send to ${targetPlatform}:${targetPluginId}`, sendError);
        }
      } else {
        log.warn(`[Scheduler] Channel not found or not connected: ${channelId}`);
      }
    } catch (error) {
      log.error(`[Scheduler] Failed to send notification to ${channelId}:`, error);
    }
  }
}

/**
 * Initialize the scheduler
 */
export async function initializeScheduler(): Promise<Scheduler> {
  if (schedulerInstance) {
    return schedulerInstance;
  }

  // Create scheduler with platform-specific data paths
  const paths = getDataPaths();
  const schedulerDir = join(paths.data, 'scheduler');

  schedulerInstance = createScheduler({
    tasksFilePath: join(schedulerDir, 'tasks.json'),
    historyFilePath: join(schedulerDir, 'history.json'),
    checkInterval: SCHEDULER_CHECK_INTERVAL_MS,
    defaultTimeout: SCHEDULER_DEFAULT_TIMEOUT_MS,
    maxHistoryPerTask: SCHEDULER_MAX_HISTORY_PER_TASK,
  });

  // Set task executor
  schedulerInstance.setTaskExecutor(executeScheduledTask);

  // Create notification bridge
  notificationBridge = createSchedulerNotificationBridge(handleSchedulerNotification);
  schedulerInstance.setNotificationBridge(notificationBridge);

  // Initialize and start
  await schedulerInstance.initialize();
  schedulerInstance.start();

  log.info('[Scheduler] Initialized and started');
  return schedulerInstance;
}

/**
 * Get the scheduler instance
 */
export function getScheduler(): Scheduler | null {
  return schedulerInstance;
}

/**
 * Get the notification bridge
 */
export function getNotificationBridge(): SchedulerNotificationBridge | null {
  return notificationBridge;
}

/**
 * Stop the scheduler
 */
export function stopScheduler(): void {
  if (schedulerInstance) {
    schedulerInstance.stop();
    log.info('[Scheduler] Stopped');
  }
}
