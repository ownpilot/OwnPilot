/**
 * Extensions Audit Routes
 *
 * LLM-powered security analysis for skills and extensions.
 * Combines static pattern analysis with deep semantic review.
 *
 * POST /:id/audit        — Audit an installed extension
 * POST /audit-manifest   — Audit a manifest before installation
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
import type { ExtensionManifest } from '../../services/extension-types.js';
import {
  auditSkillSecurity,
  buildLlmAuditPrompt,
  parseLlmAuditResponse,
  type SkillLlmAuditResult,
} from '../../services/skill-security-audit.js';
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

const log = getLog('ExtensionAudit');

export const auditRoutes = new Hono();

/** Providers with native SDK support (others use OpenAI-compatible) */
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

// =============================================================================
// POST /:id/audit — Audit an installed extension
// =============================================================================

auditRoutes.post('/:id/audit', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getExtService();
  const pkg = service.getById(id);

  if (!pkg || pkg.userId !== userId) {
    return notFoundError(c, 'Extension', id);
  }

  const body = (await parseJsonBody<{ provider?: string; model?: string }>(c)) ?? {};

  // Run static analysis
  const staticAnalysis = auditSkillSecurity(pkg.manifest);

  // Run LLM analysis
  const llmAnalysis = await runLlmAudit(pkg.manifest, staticAnalysis, body.provider, body.model);

  return apiResponse(c, {
    extensionId: pkg.id,
    extensionName: pkg.name,
    format: pkg.format,
    staticAnalysis,
    llmAnalysis: llmAnalysis.result,
    llmError: llmAnalysis.error,
  });
});

// =============================================================================
// POST /audit-manifest — Audit a manifest before installation
// =============================================================================

auditRoutes.post('/audit-manifest', async (c) => {
  const body = (await parseJsonBody<{
    manifest: ExtensionManifest;
    provider?: string;
    model?: string;
  }>(c)) as { manifest?: ExtensionManifest; provider?: string; model?: string } | null;

  if (!body?.manifest || !body.manifest.id || !body.manifest.name) {
    return apiError(
      c,
      {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'manifest with id and name is required',
      },
      400
    );
  }

  // Run static analysis
  const staticAnalysis = auditSkillSecurity(body.manifest);

  // Run LLM analysis
  const llmAnalysis = await runLlmAudit(body.manifest, staticAnalysis, body.provider, body.model);

  return apiResponse(c, {
    extensionId: body.manifest.id,
    extensionName: body.manifest.name,
    format: body.manifest.format ?? 'ownpilot',
    staticAnalysis,
    llmAnalysis: llmAnalysis.result,
    llmError: llmAnalysis.error,
  });
});

// =============================================================================
// Shared LLM Audit Logic
// =============================================================================

async function runLlmAudit(
  manifest: ExtensionManifest,
  staticResult: ReturnType<typeof auditSkillSecurity>,
  providerOverride?: string,
  modelOverride?: string
): Promise<{ result: SkillLlmAuditResult | null; error: string | null }> {
  try {
    // 1. Resolve provider/model
    const resolved = await resolveProviderAndModel(
      providerOverride ?? 'default',
      modelOverride ?? 'default'
    );
    if (!resolved.provider || !resolved.model) {
      return {
        result: null,
        error: 'No AI provider configured. Set up a provider in Settings for LLM analysis.',
      };
    }

    // 2. Get API key
    const localProv = await localProvidersRepo.getProvider(resolved.provider);
    const apiKey = localProv
      ? localProv.apiKey || 'local-no-key'
      : await getApiKey(resolved.provider);
    if (!apiKey) {
      return {
        result: null,
        error: `API key not configured for provider: ${resolved.provider}`,
      };
    }

    // 3. Create provider instance
    const providerConfig = coreGetProviderConfig(resolved.provider);
    const providerType = NATIVE_PROVIDERS.has(resolved.provider) ? resolved.provider : 'openai';

    const providerInstance = createProvider({
      provider: providerType as AIProvider,
      apiKey,
      baseUrl: providerConfig?.baseUrl,
      headers: providerConfig?.headers,
    });

    // 4. Build prompt and call LLM
    const prompt = buildLlmAuditPrompt(manifest, staticResult);

    const result = await providerInstance.complete({
      model: { model: resolved.model, maxTokens: 4096, temperature: 0.3 },
      messages: [{ role: 'user' as const, content: prompt }],
    });

    if (!result.ok) {
      return {
        result: null,
        error: 'LLM call failed: ' + (result.error?.message || 'unknown error'),
      };
    }

    const text = result.value.content;
    if (!text) {
      return { result: null, error: 'LLM returned empty response' };
    }

    // 5. Parse structured response
    const auditResult = parseLlmAuditResponse(text);

    log.info('LLM audit completed', {
      skillId: manifest.id,
      verdict: auditResult.verdict,
      trustScore: auditResult.trustScore,
      riskCount: auditResult.risks.length,
    });

    return { result: auditResult, error: null };
  } catch (error) {
    log.error('LLM audit failed:', error);
    return { result: null, error: getErrorMessage(error) };
  }
}
