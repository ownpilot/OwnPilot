/**
 * Claw Skill Distiller — the "closed learning loop".
 *
 * After a Claw completes a meaningful task (a successful `claw_complete_report`
 * backed by >= MIN_TOOL_CALLS_FOR_SKILL tool calls), the trajectory is distilled
 * into a reusable AgentSkills.io skill: a structured procedure + pitfalls +
 * verification steps. The skill is persisted via the ExtensionService and can be
 * retrieved into future cycles (see runner injection + `claw_recall_skill`).
 *
 * This mirrors Hermes Agent's headline differentiator — the agent gets
 * measurably better at repeated task types over time, without retraining
 * weights (retrieval-based learning).
 *
 * Design: `distillSkillFromRun` takes an injected `complete` function and an
 * optional ExtensionService so it is unit-testable without a live provider or
 * DB. Production callers use `createClawCompleter` to build the `complete`
 * closure from the resolved provider/model.
 */

import { getErrorMessage, type AIProvider, type ClawConfig } from '@ownpilot/core';
import { getLog } from '../log.js';
import { getExtensionService, type ExtensionService } from '../extension/service.js';
import type { ExtensionManifest } from '../extension/types.js';

const log = getLog('ClawSkillDistiller');

/** Tag every auto-distilled skill carries, for retrieval + filtering. */
export const LEARNED_SKILL_TAG = 'claw-learned';

/** Minimum tool calls in a run before it's worth distilling (Hermes threshold). */
export const MIN_TOOL_CALLS_FOR_SKILL = 5;

/** A single LLM completion: returns the assistant text (empty string on failure). */
export type CompleteFn = (messages: { system: string; user: string }) => Promise<string>;

interface DistillInput {
  config: ClawConfig;
  /** Mission / objective the run was working toward. */
  mission: string;
  /** Ordered tool names the run executed (the trajectory shape). */
  toolSequence: string[];
  /** The completion report content. */
  report: string;
  /** Optional short summary. */
  summary?: string;
  /** Injected LLM completion. */
  complete: CompleteFn;
  /** Override for tests; defaults to the process ExtensionService singleton. */
  extensionService?: ExtensionService;
}

interface DistillResult {
  skillId: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Slugify a mission into an AgentSkills-compatible name: lowercase alphanumeric
 * + single hyphens, no leading/trailing hyphen, bounded length. The result is
 * prefixed with `claw-learned-` and capped at 64 chars (the frontmatter limit).
 */
export function slugifyMission(mission: string): string {
  const body = mission
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 48)
    .replace(/-+$/g, '');
  const safe = body || 'task';
  return `${LEARNED_SKILL_TAG}-${safe}`.slice(0, 64).replace(/-+$/g, '');
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Build the system/user prompt pair for distillation. Pure. */
export function buildDistillMessages(input: {
  mission: string;
  toolSequence: string[];
  report: string;
  summary?: string;
}): { system: string; user: string } {
  const system = [
    'You are a skill distiller for an autonomous agent. Given a completed task',
    'and the sequence of tools used, write a concise, reusable SKILL.md *body*',
    '(no YAML frontmatter) that a future agent can follow to accomplish the same',
    'type of task faster and more reliably.',
    '',
    'Output ONLY markdown with exactly these sections:',
    '## When to use',
    '## Procedure (numbered steps)',
    '## Pitfalls',
    '## Verification',
    '',
    'Be specific and general at once: capture the reusable procedure, not the',
    'one-off details of this particular run. Keep it under 400 words.',
  ].join('\n');

  const user = [
    `Task / mission:\n${input.mission}`,
    '',
    `Tools used, in order:\n${input.toolSequence.length ? input.toolSequence.join(' -> ') : '(none recorded)'}`,
    '',
    `Outcome report:\n${truncate(input.report, 4000)}`,
    input.summary ? `\nSummary:\n${truncate(input.summary, 1000)}` : '',
  ].join('\n');

  return { system, user };
}

/** Build the AgentSkills manifest for a distilled skill. Pure. */
export function buildLearnedManifest(
  config: ClawConfig,
  mission: string,
  instructions: string
): ExtensionManifest {
  const name = slugifyMission(mission);
  return {
    id: name,
    name,
    version: '1.0.0',
    description: truncate(`Learned by claw "${config.name}": ${mission}`, 1024),
    format: 'agentskills',
    tools: [],
    instructions,
    tags: [LEARNED_SKILL_TAG, config.id],
    category: 'productivity',
    author: { name: `claw-${slugifyMission(config.id).replace(`${LEARNED_SKILL_TAG}-`, '')}` },
  };
}

// ---------------------------------------------------------------------------
// Distillation
// ---------------------------------------------------------------------------

/**
 * Distill a completed claw run into a reusable skill. Returns the created skill
 * descriptor, or `null` when the run is too small, the LLM returns nothing, or
 * persistence fails. Never throws — this runs fire-and-forget off the
 * completion path and must not break it.
 */
export async function distillSkillFromRun(input: DistillInput): Promise<DistillResult | null> {
  try {
    if (input.config.learnSkills === false) return null;
    if (input.toolSequence.length < MIN_TOOL_CALLS_FOR_SKILL) return null;

    const instructions = (await input.complete(buildDistillMessages(input))).trim();
    if (!instructions) {
      log.warn(`[${input.config.id}] Distillation produced no content; skipping`);
      return null;
    }

    const manifest = buildLearnedManifest(input.config, input.mission, instructions);
    const svc = input.extensionService ?? getExtensionService();
    // installFromManifest upserts on id, so re-distilling the same mission
    // updates the existing learned skill instead of duplicating it.
    await svc.installFromManifest(manifest, input.config.userId);

    log.info(`[${input.config.id}] Distilled learned skill "${manifest.name}"`);
    return { skillId: manifest.id, name: manifest.name };
  } catch (err) {
    log.warn(`[${input.config.id}] Skill distillation failed: ${getErrorMessage(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

interface LearnedSkillMatch {
  id: string;
  name: string;
  description: string;
  instructions: string;
  score: number;
}

function tokenize(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 2)
    )
  );
}

/**
 * Find learned skills relevant to a query, ranked by keyword overlap. Cheap and
 * dependency-free (no embeddings) so it can run at claw start and inside the
 * `claw_recall_skill` tool. Only considers skills tagged `claw-learned`.
 */
export function findLearnedSkills(
  service: Pick<ExtensionService, 'getEnabledMetadata' | 'getById'>,
  query: string,
  limit = 3
): LearnedSkillMatch[] {
  const learned = service
    .getEnabledMetadata()
    .filter((m) => (m.keywords ?? []).includes(LEARNED_SKILL_TAG));
  if (learned.length === 0) return [];

  const qTokens = tokenize(query);
  const scored = learned
    .map((m) => {
      const hay = new Set(tokenize(`${m.name} ${m.description} ${(m.keywords ?? []).join(' ')}`));
      const score = qTokens.reduce((acc, t) => acc + (hay.has(t) ? 1 : 0), 0);
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));

  return scored.map(({ m, score }) => {
    const rec = service.getById(m.id);
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      instructions: rec?.manifest.instructions ?? '',
      score,
    };
  });
}

/**
 * Build a `CompleteFn` backed by the resolved provider/model. Mirrors the
 * one-shot completion pattern used by extension generation
 * (`routes/extensions/generation.ts`).
 */
export function createClawCompleter(provider: string, model: string): CompleteFn {
  return async ({ system, user }) => {
    try {
      const { getProviderApiKey, NATIVE_PROVIDERS } = await import('../agent/cache.js');
      const { createProvider, getProviderConfig } = await import('@ownpilot/core');

      const apiKey = await getProviderApiKey(provider);
      if (!apiKey) return '';

      const cfg = getProviderConfig(provider);
      const instance = createProvider({
        provider: (NATIVE_PROVIDERS.has(provider) ? provider : 'openai') as AIProvider,
        apiKey,
        baseUrl: cfg?.baseUrl,
        headers: cfg?.headers,
      });

      const result = await instance.complete({
        model: { model, maxTokens: 2048, temperature: 0.4 },
        messages: [
          { role: 'system' as const, content: system },
          { role: 'user' as const, content: user },
        ],
      });

      return result.ok ? (result.value.content ?? '') : '';
    } catch (err) {
      log.warn(`Distiller completion failed: ${getErrorMessage(err)}`);
      return '';
    }
  };
}
