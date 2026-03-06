/**
 * Extensions Eval Routes
 *
 * POST /:id/eval/run                 — Run a test query with/without skill active
 * POST /:id/eval/grade               — Grade a response with LLM
 * POST /:id/eval/optimize-description — Generate and score alternative descriptions
 */

import { Hono } from 'hono';
import {
  createProvider,
  getProviderConfig as coreGetProviderConfig,
  getServiceRegistry,
  Services,
  type AIProvider,
} from '@ownpilot/core';
import type { ExtensionService } from '../../services/extension-service.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  notFoundError,
  getErrorMessage,
  parseJsonBody,
} from '../helpers.js';
import { resolveProviderAndModel, getApiKey } from '../settings.js';
import { localProvidersRepo } from '../../db/repositories/index.js';
import { getLog } from '../../services/log.js';

const log = getLog('ExtensionEval');

export const evalRoutes = new Hono();

/** Providers with native SDK support */
const NATIVE_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'groq',
  'mistral',
  'xai',
  'together',
  'fireworks',
  'perplexity',
]);

const getExtService = () => getServiceRegistry().get(Services.Extension) as ExtensionService;

// ---------------------------------------------------------------------------
// Shared: create a provider instance
// ---------------------------------------------------------------------------

async function buildProvider(providerOverride?: string, modelOverride?: string) {
  const resolved = await resolveProviderAndModel(
    providerOverride ?? 'default',
    modelOverride ?? 'default'
  );
  if (!resolved.provider || !resolved.model) {
    return { provider: null, model: null, error: 'No AI provider configured.' };
  }
  const localProv = await localProvidersRepo.getProvider(resolved.provider);
  const apiKey = localProv
    ? localProv.apiKey || 'local-no-key'
    : await getApiKey(resolved.provider);
  if (!apiKey) {
    return {
      provider: null,
      model: null,
      error: `API key not configured for: ${resolved.provider}`,
    };
  }
  const providerConfig = coreGetProviderConfig(resolved.provider);
  const providerType = NATIVE_PROVIDERS.has(resolved.provider) ? resolved.provider : 'openai';
  const instance = createProvider({
    provider: providerType as AIProvider,
    apiKey,
    baseUrl: providerConfig?.baseUrl,
    headers: providerConfig?.headers,
  });
  return { provider: instance, model: resolved.model, error: null };
}

// ---------------------------------------------------------------------------
// POST /:id/eval/run
// ---------------------------------------------------------------------------

evalRoutes.post('/:id/eval/run', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getExtService();
  const pkg = service.getById(id);
  if (!pkg || pkg.userId !== userId) return notFoundError(c, 'Extension', id);

  const body = await parseJsonBody<{ query: string; withSkill: boolean }>(c);
  if (!body?.query) {
    return apiError(c, { code: ERROR_CODES.VALIDATION_ERROR, message: 'query is required' }, 400);
  }

  const { provider, model, error } = await buildProvider();
  if (!provider || !model) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: error ?? 'No provider' }, 500);
  }

  // Build system prompt (with or without the skill)
  let systemPrompt = 'You are a helpful AI assistant.';
  if (body.withSkill) {
    const sections = service.getSystemPromptSectionsForIds([id]);
    if (sections.length) {
      systemPrompt += '\n\n' + sections.join('\n\n');
    }
  }

  const start = Date.now();
  try {
    const result = await provider.complete({
      model: { model, maxTokens: 1024, temperature: 0.7 },
      messages: [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: body.query },
      ],
    });

    if (!result.ok) {
      return apiError(
        c,
        {
          code: ERROR_CODES.EXECUTION_ERROR,
          message: 'LLM call failed: ' + (result.error?.message ?? 'unknown'),
        },
        500
      );
    }

    return apiResponse(c, {
      response: result.value.content ?? '',
      durationMs: Date.now() - start,
    });
  } catch (err) {
    log.error('eval/run failed', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/eval/grade
// ---------------------------------------------------------------------------

evalRoutes.post('/:id/eval/grade', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getExtService();
  const pkg = service.getById(id);
  if (!pkg || pkg.userId !== userId) return notFoundError(c, 'Extension', id);

  const body = await parseJsonBody<{
    query: string;
    response: string;
    expectedKeywords: string[];
    notes: string;
  }>(c);

  if (!body?.query || !body?.response) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'query and response are required' },
      400
    );
  }

  const { provider, model, error } = await buildProvider();
  if (!provider || !model) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: error ?? 'No provider' }, 500);
  }

  const prompt = `You are evaluating whether an AI response is helpful and relevant.

Query: ${body.query}

Response: ${body.response}

Expected keywords: ${(body.expectedKeywords ?? []).join(', ') || '(none)'}

Notes: ${body.notes || '(none)'}

Grade the response on a scale of 0-1 based on:
- Relevance to the query
- Presence of expected keywords
- Overall helpfulness

Return ONLY valid JSON: {"score": 0.85, "passed": true, "feedback": "Brief explanation"}`;

  try {
    const result = await provider.complete({
      model: { model, maxTokens: 256, temperature: 0 },
      messages: [{ role: 'user' as const, content: prompt }],
    });

    if (!result.ok) {
      return apiError(c, { code: ERROR_CODES.EXECUTION_ERROR, message: 'Grading LLM failed' }, 500);
    }

    const text = (result.value.content ?? '').trim();
    let parsed: { score: number; passed: boolean; feedback: string };
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch?.[0] ?? text);
    } catch {
      parsed = { score: 0.5, passed: true, feedback: text };
    }

    return apiResponse(c, parsed);
  } catch (err) {
    log.error('eval/grade failed', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});

// ---------------------------------------------------------------------------
// POST /:id/eval/optimize-description
// ---------------------------------------------------------------------------

evalRoutes.post('/:id/eval/optimize-description', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getExtService();
  const pkg = service.getById(id);
  if (!pkg || pkg.userId !== userId) return notFoundError(c, 'Extension', id);

  const body = await parseJsonBody<{
    currentDescription: string;
    testQueries: string[];
    iterations?: number;
  }>(c);

  if (!body?.testQueries?.length) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'testQueries array is required' },
      400
    );
  }

  const numIterations = Math.min(Math.max(body.iterations ?? 3, 1), 5);
  const { provider, model, error } = await buildProvider();
  if (!provider || !model) {
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: error ?? 'No provider' }, 500);
  }

  const skillName = pkg.name;
  const results: Array<{ description: string; triggerAccuracy: number; reasoning: string }> = [];

  try {
    for (let i = 0; i < numIterations; i++) {
      // Step 1: Generate a proposed description
      const prevDesc =
        i === 0
          ? body.currentDescription || 'No description'
          : (results[i - 1]?.description ?? 'No description');
      const descPrompt = `You are improving the trigger description for an AI skill named "${skillName}".

Current description: ${prevDesc}

Test queries that should trigger this skill:
${body.testQueries.map((q, idx) => `${idx + 1}. ${q}`).join('\n')}

Write an improved description (1-3 sentences) that would cause the AI to recognize these queries as relevant to this skill.
Respond with ONLY the description text, no explanation.`;

      const descResult = await provider.complete({
        model: { model, maxTokens: 200, temperature: 0.8 },
        messages: [{ role: 'user' as const, content: descPrompt }],
      });

      if (!descResult.ok) continue;

      const newDesc = (descResult.value.content ?? '').trim();

      // Step 2: Grade each query for trigger accuracy
      const grades = await Promise.all(
        body.testQueries.map(async (query) => {
          const gradePrompt = `Skill: "${skillName}"
Description: ${newDesc}

User query: "${query}"

Would this skill be relevant for this query? Answer only "yes" or "no".`;
          const gradeResult = await provider.complete({
            model: { model, maxTokens: 10, temperature: 0 },
            messages: [{ role: 'user' as const, content: gradePrompt }],
          });
          if (!gradeResult.ok) return false;
          return /^yes/i.test((gradeResult.value.content ?? '').trim());
        })
      );

      const triggerAccuracy = grades.filter(Boolean).length / body.testQueries.length;

      results.push({
        description: newDesc,
        triggerAccuracy,
        reasoning: `Triggers ${grades.filter(Boolean).length}/${body.testQueries.length} test queries.`,
      });
    }

    // Pick best iteration
    const best = results.reduce(
      (prev, curr) => (curr.triggerAccuracy > (prev?.triggerAccuracy ?? -1) ? curr : prev),
      results[0] ?? { description: body.currentDescription, triggerAccuracy: 0, reasoning: '' }
    );

    return apiResponse(c, { iterations: results, best });
  } catch (err) {
    log.error('eval/optimize-description failed', err);
    return apiError(c, { code: ERROR_CODES.INTERNAL_ERROR, message: getErrorMessage(err) }, 500);
  }
});
