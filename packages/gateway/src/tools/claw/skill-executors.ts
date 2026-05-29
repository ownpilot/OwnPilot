/**
 * Claw Skill Executors — the agent-facing side of the closed learning loop.
 *
 *   claw_save_skill   — deliberately capture a reusable skill (explicit, the
 *                       counterpart to automatic distillation on completion)
 *   claw_recall_skill — search previously learned skills and load their procedures
 *
 * Both run inside a ClawExecutionContext so they can resolve the current claw's
 * config (mission, provider, userId) without interface changes.
 */

import { getErrorMessage, getLLMRouter } from '@ownpilot/core';
import { getClawContext } from '../../services/claw/context.js';
import { getExtensionService } from '../../services/extension/service.js';
import {
  buildLearnedManifest,
  createClawCompleter,
  distillSkillFromRun,
  findLearnedSkills,
} from '../../services/claw/skill-distiller.js';

type ExecResult = { success: boolean; result?: unknown; error?: string };

export async function executeSaveSkill(
  args: Record<string, unknown>,
  userId: string
): Promise<ExecResult> {
  const ctx = getClawContext();
  if (!ctx) return { success: false, error: 'Not running inside a Claw context' };

  const title = (args.title as string)?.trim();
  const procedure = (args.procedure as string)?.trim();
  if (!title) return { success: false, error: 'title is required' };

  const { getClawsRepository } = await import('../../db/repositories/claws.js');
  const config = await getClawsRepository().getById(ctx.clawId, userId);
  if (!config) return { success: false, error: 'Claw config not found' };

  // Explicit body provided: persist it directly.
  if (procedure) {
    try {
      const manifest = buildLearnedManifest(config, title, procedure);
      await getExtensionService().installFromManifest(manifest, userId);
      return { success: true, result: { skillId: manifest.id, name: manifest.name } };
    } catch (err) {
      return { success: false, error: getErrorMessage(err) };
    }
  }

  // No body: distill from this run's trajectory.
  const history = await getClawsRepository().getHistory(ctx.clawId, 50, 0);
  const toolSequence: string[] = [];
  for (const entry of history.entries) {
    for (const tc of entry.toolCalls ?? []) toolSequence.push(tc.tool);
  }

  const picked = await getLLMRouter().pick({
    explicitProvider: config.provider,
    explicitModel: config.model,
    process: 'pulse',
  });

  const result = await distillSkillFromRun({
    config,
    mission: title,
    toolSequence,
    report: `Skill capture requested by the claw for task: ${title}`,
    complete: createClawCompleter(picked.provider, picked.model),
  });

  if (!result) {
    return {
      success: false,
      error: 'Could not distill a skill (too few tool calls or empty distillation)',
    };
  }
  return { success: true, result };
}

export async function executeRecallSkill(
  args: Record<string, unknown>,
  _userId: string
): Promise<ExecResult> {
  const query = (args.query as string)?.trim();
  if (!query) return { success: false, error: 'query is required' };

  const limit = Math.min(Math.max(1, Number(args.limit) || 3), 5);
  const matches = findLearnedSkills(getExtensionService(), query, limit);

  return {
    success: true,
    result: {
      count: matches.length,
      skills: matches.map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description,
        procedure: m.instructions,
      })),
    },
  };
}
