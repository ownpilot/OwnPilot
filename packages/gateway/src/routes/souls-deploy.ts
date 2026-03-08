/**
 * Soul Deploy Route
 *
 * POST /deploy — Atomic agent + soul + trigger creation.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { getSoulsRepository } from '../db/repositories/souls.js';
import { agentsRepo } from '../db/repositories/agents.js';
import { createTriggersRepository } from '../db/repositories/triggers.js';
import { getAdapterSync } from '../db/adapters/index.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage } from './helpers.js';

export const soulDeployRoutes = new Hono();

soulDeployRoutes.post('/deploy', async (c) => {
  try {
    const body = await c.req.json<{
      identity: {
        name: string;
        emoji?: string;
        role?: string;
        personality?: string;
        voice?: { tone?: string; language?: string; quirks?: string[] };
        boundaries?: string[];
      };
      purpose?: {
        mission?: string;
        goals?: string[];
        expertise?: string[];
        toolPreferences?: string[];
      };
      autonomy?: {
        level?: number;
        allowedActions?: string[];
        blockedActions?: string[];
        requiresApproval?: string[];
        maxCostPerCycle?: number;
        maxCostPerDay?: number;
        maxCostPerMonth?: number;
      };
      heartbeat?: {
        enabled?: boolean;
        interval?: string;
        checklist?: unknown[];
        selfHealingEnabled?: boolean;
        maxDurationMs?: number;
      };
      relationships?: {
        delegates?: string[];
        peers?: string[];
        channels?: string[];
      };
      evolution?: {
        evolutionMode?: 'manual' | 'supervised' | 'autonomous';
        coreTraits?: string[];
        mutableTraits?: string[];
      };
      bootSequence?: {
        onStart?: string[];
        onHeartbeat?: string[];
        onMessage?: string[];
      };
      provider?: string;
      model?: string;
      skillAccess?: {
        allowed: string[];
        blocked?: string[];
      };
    }>();

    // Validate autonomy.level range
    const autonomyLevel = body.autonomy?.level;
    if (
      autonomyLevel !== undefined &&
      (typeof autonomyLevel !== 'number' ||
        !Number.isInteger(autonomyLevel) ||
        autonomyLevel < 0 ||
        autonomyLevel > 4)
    ) {
      return apiError(
        c,
        { code: ERROR_CODES.VALIDATION_ERROR, message: 'autonomy.level must be an integer 0–4' },
        400
      );
    }

    // Get default provider/model if not specified
    const { settingsRepo } = await import('../db/repositories/index.js');
    const defaultProvider = settingsRepo.get<string>('default_ai_provider');
    const defaultModel = settingsRepo.get<string>('default_ai_model');

    const agentProvider = body.provider || defaultProvider || 'default';
    const agentModel = body.model || defaultModel || 'default';

    const agentId = randomUUID();
    let agentName = body.identity?.name ?? 'Unnamed Agent';

    // 1+2. Create agent + soul atomically in a DB transaction.
    // Retries up to 5 times on duplicate name conflict.
    let soul;
    let attempts = 0;
    let lastError: unknown = null;
    const adapter = getAdapterSync();

    while (!soul && attempts < 5) {
      try {
        const soulRepo = getSoulsRepository();
        soul = await adapter.transaction(async () => {
          await agentsRepo.create({
            id: agentId,
            name: agentName,
            systemPrompt: '',
            provider: agentProvider,
            model: agentModel,
          });
          return soulRepo.create({
            agentId,
            identity: {
              name: agentName,
              emoji: body.identity?.emoji ?? '🤖',
              role: body.identity?.role ?? 'Agent',
              personality: body.identity?.personality ?? 'Helpful and professional',
              voice: {
                tone: body.identity?.voice?.tone ?? 'neutral',
                language: (body.identity?.voice?.language as 'en' | 'tr' | 'both') ?? 'en',
                quirks: body.identity?.voice?.quirks ?? [],
              },
              boundaries: body.identity?.boundaries ?? [],
            },
            purpose: {
              mission: body.purpose?.mission ?? 'Assist with tasks',
              goals: body.purpose?.goals ?? [],
              expertise: body.purpose?.expertise ?? [],
              toolPreferences: body.purpose?.toolPreferences ?? [],
            },
            autonomy: {
              level: (body.autonomy?.level as 0 | 1 | 2 | 3 | 4) ?? 3,
              allowedActions: body.autonomy?.allowedActions ?? [
                'search_web',
                'create_note',
                'read_url',
                'search_memories',
              ],
              blockedActions: body.autonomy?.blockedActions ?? ['delete_data', 'execute_code'],
              requiresApproval: body.autonomy?.requiresApproval ?? ['send_message_to_user'],
              maxCostPerCycle: body.autonomy?.maxCostPerCycle ?? 0.5,
              maxCostPerDay: body.autonomy?.maxCostPerDay ?? 5.0,
              maxCostPerMonth: body.autonomy?.maxCostPerMonth ?? 100.0,
              pauseOnConsecutiveErrors: 5,
              pauseOnBudgetExceeded: true,
              notifyUserOnPause: true,
            },
            heartbeat: {
              enabled: body.heartbeat?.enabled ?? false,
              interval: body.heartbeat?.interval ?? '0 */6 * * *',
              checklist: (body.heartbeat?.checklist as []) ?? [],
              selfHealingEnabled: body.heartbeat?.selfHealingEnabled ?? false,
              maxDurationMs: body.heartbeat?.maxDurationMs ?? 120000,
            },
            relationships: {
              delegates: body.relationships?.delegates ?? [],
              peers: body.relationships?.peers ?? [],
              channels: body.relationships?.channels ?? [],
            },
            evolution: {
              version: 1,
              evolutionMode: body.evolution?.evolutionMode ?? 'supervised',
              coreTraits: body.evolution?.coreTraits ?? [],
              mutableTraits: body.evolution?.mutableTraits ?? [],
              learnings: [],
              feedbackLog: [],
            },
            bootSequence: {
              onStart: body.bootSequence?.onStart ?? [],
              onHeartbeat: body.bootSequence?.onHeartbeat ?? ['read_inbox'],
              onMessage: body.bootSequence?.onMessage ?? [],
            },
            provider: {
              providerId: agentProvider,
              modelId: agentModel,
            },
            skillAccess: {
              allowed: body.skillAccess?.allowed ?? [],
              blocked: body.skillAccess?.blocked ?? [],
            },
          });
        });
      } catch (txErr) {
        lastError = txErr;
        const errorMessage = getErrorMessage(txErr).toLowerCase();
        if (errorMessage.includes('duplicate') && errorMessage.includes('name')) {
          attempts++;
          const randomSuffix = Math.floor(Math.random() * 10000)
            .toString()
            .padStart(4, '0');
          agentName = `${body.identity?.name ?? 'Unnamed Agent'} (${randomSuffix})`;
        } else {
          break; // Non-name error — don't retry
        }
      }
    }

    if (!soul) {
      return apiError(
        c,
        {
          code: ERROR_CODES.INTERNAL_ERROR,
          message: `Failed to deploy agent: ${getErrorMessage(lastError)}`,
        },
        500
      );
    }

    // 3. Create heartbeat trigger if enabled and interval is valid
    const CRON_REGEX =
      /^[\*0-9,\-\/]+\s+[\*0-9,\-\/]+\s+[\*0-9,\-\/]+\s+[\*0-9,\-\/]+\s+[\*0-9,\-\/]+$/;
    if (
      body.heartbeat?.enabled &&
      body.heartbeat?.interval &&
      !CRON_REGEX.test(body.heartbeat.interval.trim())
    ) {
      return apiError(
        c,
        {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'heartbeat.interval must be a valid cron expression (e.g. "0 */6 * * *")',
        },
        400
      );
    }

    let triggerCreated = false;
    if (body.heartbeat?.enabled && body.heartbeat?.interval?.trim()) {
      const triggerRepo = createTriggersRepository();
      try {
        await triggerRepo.create({
          name: `${agentName} Heartbeat`,
          type: 'schedule' as never,
          config: { expression: body.heartbeat.interval } as never,
          action: { type: 'run_heartbeat', agentId } as never,
          enabled: true,
        });
        triggerCreated = true;
      } catch (_triggerError) {
        // Trigger creation failure is non-fatal — agent still deployed
      }
    }

    return apiResponse(
      c,
      {
        agentId,
        soul,
        provider: agentProvider,
        model: agentModel,
        triggerCreated,
      },
      201
    );
  } catch (err) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
