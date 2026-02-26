/**
 * Custom Tools Analysis Routes
 *
 * Code validation, security analysis, and LLM review.
 * Endpoints: POST /validate, POST /llm-review
 */

import { Hono } from 'hono';
import { analyzeToolCode, calculateSecurityScore } from '@ownpilot/core';
import { apiResponse, apiError, ERROR_CODES, parseJsonBody } from '../helpers.js';

export const analysisRoutes = new Hono();

/**
 * POST /custom-tools/validate - Deep code analysis for tool review
 * Returns security validation, warnings, code statistics, security score,
 * data flow risks, best practices, and suggested permissions.
 * LLM can use this to verify tool code before creating it.
 */
analysisRoutes.post('/validate', async (c) => {
  const body = (await parseJsonBody(c)) as {
    code: string;
    name?: string;
    permissions?: string[];
  } | null;

  if (!body?.code || typeof body.code !== 'string') {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'code is required' }, 400);
  }

  const analysis = analyzeToolCode(body.code, body.permissions);

  // Additional permission-aware warnings
  const permissionWarnings: string[] = [];
  if (analysis.stats.usesFetch && !body.permissions?.includes('network')) {
    permissionWarnings.push('Code uses fetch() but "network" permission is not requested');
  }

  return apiResponse(c, {
    valid: analysis.valid,
    errors: analysis.errors,
    warnings: [...analysis.warnings, ...permissionWarnings],
    stats: analysis.stats,
    securityScore: analysis.securityScore,
    dataFlowRisks: analysis.dataFlowRisks,
    bestPractices: analysis.bestPractices,
    suggestedPermissions: analysis.suggestedPermissions,
    recommendations: generateRecommendations(analysis, body.permissions),
  });
});

/**
 * POST /custom-tools/llm-review - Request LLM security review of tool code
 * Sends tool code and context to the configured LLM for security assessment.
 * Returns structured review with risks, improvements, and overall assessment.
 */
analysisRoutes.post('/llm-review', async (c) => {
  const body = (await parseJsonBody(c)) as {
    code: string;
    name?: string;
    description?: string;
    permissions?: string[];
  } | null;

  if (!body?.code || typeof body.code !== 'string') {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'code is required' }, 400);
  }

  // Run static analysis first
  const analysis = analyzeToolCode(body.code, body.permissions);
  const score = calculateSecurityScore(body.code, body.permissions);

  // Build the review prompt for LLM
  const reviewPrompt = buildLlmReviewPrompt(
    body.code,
    body.name,
    body.description,
    body.permissions,
    analysis,
    score
  );

  return apiResponse(c, {
    staticAnalysis: {
      valid: analysis.valid,
      errors: analysis.errors,
      warnings: analysis.warnings,
      securityScore: score,
      dataFlowRisks: analysis.dataFlowRisks,
      bestPractices: analysis.bestPractices,
      suggestedPermissions: analysis.suggestedPermissions,
    },
    llmReviewPrompt: reviewPrompt,
    note: 'Pass the llmReviewPrompt to your LLM for a detailed security review. The static analysis above provides immediate automated checks.',
  });
});

/**
 * Generate improvement recommendations based on code analysis
 */
function generateRecommendations(
  analysis: ReturnType<typeof analyzeToolCode>,
  permissions?: string[]
): string[] {
  const recs: string[] = [];

  if (!analysis.stats.returnsValue) {
    recs.push('Add a return statement to provide output to the LLM');
  }
  if (analysis.stats.usesFetch && !analysis.stats.hasAsyncCode) {
    recs.push('fetch() requires await — make sure to use async/await');
  }
  if (analysis.stats.lineCount > 100) {
    recs.push('Consider splitting complex logic into helper functions within the code');
  }
  if (!analysis.stats.usesUtils && (permissions?.includes('network') || analysis.stats.usesFetch)) {
    recs.push('Use utils.getApiKey("service") to securely retrieve API keys from Config Center');
  }
  if (analysis.stats.usesFetch) {
    recs.push('Wrap fetch() calls in try/catch and validate response.ok before parsing');
  }

  // Add recommendations based on security score
  if (analysis.securityScore.category === 'dangerous') {
    recs.push('Security score is low — review permissions and reduce code complexity');
  }

  // Add recommendations from best practices violations
  for (const violation of analysis.bestPractices.violated) {
    recs.push(violation);
  }

  return [...new Set(recs)]; // Deduplicate
}

/**
 * Build a prompt for LLM-based security review of tool code.
 */
function buildLlmReviewPrompt(
  code: string,
  name?: string,
  description?: string,
  permissions?: string[],
  analysis?: ReturnType<typeof analyzeToolCode>,
  score?: ReturnType<typeof calculateSecurityScore>
): string {
  return `You are a security reviewer for custom tool code that runs in a sandboxed JavaScript VM.
Review the following tool code for security issues, logic errors, and improvement opportunities.

TOOL: ${name ?? 'unnamed'}
DESCRIPTION: ${description ?? 'none provided'}
PERMISSIONS: ${permissions?.join(', ') || 'none'}
SECURITY SCORE: ${score?.score ?? 'unknown'}/100 (${score?.category ?? 'unknown'})
STATIC ANALYSIS ERRORS: ${analysis?.errors.length ? analysis.errors.join('; ') : 'none'}
STATIC ANALYSIS WARNINGS: ${analysis?.warnings.length ? analysis.warnings.join('; ') : 'none'}

CODE:
\`\`\`javascript
${code}
\`\`\`

Please provide:
1. SECURITY ASSESSMENT: Are there any security risks? (high/medium/low/none)
2. POTENTIAL RISKS: List specific security concerns
3. LOGIC REVIEW: Any bugs or logic errors?
4. IMPROVEMENT SUGGESTIONS: How to make the code safer/better
5. PERMISSION REVIEW: Are the declared permissions appropriate?
6. OVERALL VERDICT: safe / needs-review / unsafe`;
}
