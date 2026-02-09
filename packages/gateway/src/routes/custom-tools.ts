/**
 * Custom Tools Routes
 *
 * API endpoints for managing LLM-created and user-defined custom tools.
 * Supports full CRUD, enable/disable, approval workflow, and execution.
 */

import { Hono } from 'hono';
import {
  createCustomToolsRepo,
  type CustomToolRecord,
  type ToolPermission,
  type ToolStatus,
} from '../db/repositories/custom-tools.js';
import {
  createDynamicToolRegistry,
  ALL_TOOLS,
  validateToolCode,
  analyzeToolCode,
  calculateSecurityScore,
  type DynamicToolDefinition,
  type ToolDefinition,
  type ToolContext,
  type ToolExecutor,
} from '@ownpilot/core';
import { invalidateAgentCache } from './agents.js';
import {
  registerToolConfigRequirements,
  unregisterDependencies,
} from '../services/api-service-registrar.js';
import { getUserId, apiResponse, apiError, ERROR_CODES, getOptionalIntParam, sanitizeId, sanitizeText, notFoundError, getErrorMessage } from './helpers.js';
import { TOOL_TEMPLATES } from './tool-templates.js';
import { TOOL_ARGS_MAX_SIZE } from '../config/defaults.js';

export const customToolsRoutes = new Hono();

// Create dynamic tool registry for execution, with all built-in tools available via callTool
const dynamicRegistry = createDynamicToolRegistry(ALL_TOOLS);

/**
 * Get the dynamic tool registry (for use by tool-executor.ts to create sandboxed executors)
 */
export function getCustomToolDynamicRegistry() {
  return dynamicRegistry;
}

// Reference to shared registry — set by tool-executor.ts during initialization
let _sharedRegistry: {
  registerCustomTool: (def: ToolDefinition, exec: ToolExecutor, id: string) => unknown;
  unregister: (name: string) => void;
  has: (name: string) => boolean;
  execute: (name: string, args: Record<string, unknown>, context: Omit<ToolContext, 'callId'>) => Promise<{ ok: true; value: { content: unknown; isError?: boolean; metadata?: Record<string, unknown> } } | { ok: false; error: { message: string } }>;
} | null = null;

/**
 * Set the shared ToolRegistry reference so CRUD operations can sync custom tools into it.
 * Called by tool-executor.ts during initialization.
 */
export function setSharedRegistryForCustomTools(registry: typeof _sharedRegistry): void {
  _sharedRegistry = registry;
}

/**
 * Execute a custom tool via the shared ToolRegistry (preferred) or fall back to DynamicToolRegistry.
 * Going through the shared registry ensures middleware, scoped config access, and event emission.
 */
async function executeCustomToolUnified(
  toolName: string,
  args: Record<string, unknown>,
  context: { callId?: string; conversationId?: string; userId?: string }
): Promise<{ content: unknown; isError: boolean; metadata?: Record<string, unknown> }> {
  // Prefer shared registry (has middleware, scoped config, event emission)
  if (_sharedRegistry?.has(toolName)) {
    const result = await _sharedRegistry.execute(toolName, args, {
      conversationId: context.conversationId ?? 'custom-tool-execution',
      userId: context.userId,
    });
    if (result.ok) {
      return {
        content: result.value.content,
        isError: result.value.isError ?? false,
        metadata: result.value.metadata,
      };
    }
    return { content: result.error.message, isError: true };
  }

  // Fallback: direct dynamic registry (shared registry not yet initialized)
  const result = await dynamicRegistry.execute(toolName, args, {
    callId: context.callId ?? `exec_${Date.now()}`,
    conversationId: context.conversationId ?? 'custom-tool-execution',
    userId: context.userId,
  });
  return {
    content: result.content,
    isError: result.isError ?? false,
    metadata: result.metadata,
  };
}

/**
 * Sync database tools with both the dynamic registry (for sandbox execution)
 * and the shared ToolRegistry (for unified access from agents/triggers/plans).
 */
function syncToolToRegistry(tool: CustomToolRecord): void {
  if (tool.status === 'active') {
    // Register in dynamic registry (handles sandbox execution)
    const dynamicTool: DynamicToolDefinition = {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as DynamicToolDefinition['parameters'],
      code: tool.code,
      category: tool.category,
      permissions: tool.permissions as DynamicToolDefinition['permissions'],
      requiresApproval: tool.requiresApproval,
    };
    dynamicRegistry.register(dynamicTool);

    // Also register in shared ToolRegistry (for unified tool access)
    if (_sharedRegistry && !_sharedRegistry.has(tool.name)) {
      const def: ToolDefinition = {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters as ToolDefinition['parameters'],
        category: tool.category ?? 'Custom',
        configRequirements: tool.requiredApiKeys?.map(k => ({
          name: k.name,
          displayName: k.displayName,
          description: k.description,
          category: k.category,
          docsUrl: k.docsUrl,
        })),
      };
      const executor = (args: Record<string, unknown>, context: ToolContext) =>
        dynamicRegistry.execute(tool.name, args, context);
      _sharedRegistry.registerCustomTool(def, executor, tool.id);
    }
  } else {
    // Unregister from both registries
    dynamicRegistry.unregister(tool.name);
    if (_sharedRegistry?.has(tool.name)) {
      _sharedRegistry.unregister(tool.name);
    }
  }
}

// =============================================================================
// ROUTES
// =============================================================================

/**
 * Get custom tools statistics
 */
customToolsRoutes.get('/stats', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const stats = await repo.getStats();

  return apiResponse(c, stats);
});

/**
 * List custom tools with filtering
 */
customToolsRoutes.get('/', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));

  const status = c.req.query('status') as ToolStatus | undefined;
  const category = c.req.query('category');
  const createdBy = c.req.query('createdBy') as 'user' | 'llm' | undefined;
  const limit = getOptionalIntParam(c, 'limit', 1, 100);
  const offset = getOptionalIntParam(c, 'offset', 0);

  const tools = await repo.list({ status, category, createdBy, limit, offset });

  return apiResponse(c, {
      tools,
      count: tools.length,
    });
});

/**
 * Get pending approval tools
 */
customToolsRoutes.get('/pending', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const tools = await repo.getPendingApproval();

  return apiResponse(c, {
      tools,
      count: tools.length,
    });
});

/**
 * GET /custom-tools/templates - Get tool templates for safe starting points
 * NOTE: Must be registered BEFORE /:id to avoid Hono route shadowing
 */
customToolsRoutes.get('/templates', (c) => {
  const category = c.req.query('category');

  let templates = TOOL_TEMPLATES;
  if (category) {
    templates = templates.filter(t => t.category.toLowerCase() === category.toLowerCase());
  }

  return apiResponse(c, {
    templates: templates.map(t => ({
      id: t.id,
      name: t.name,
      displayName: t.displayName,
      description: t.description,
      category: t.category,
      permissions: t.permissions,
      parameters: t.parameters,
      code: t.code,
      requiredApiKeys: t.requiredApiKeys,
    })),
    count: templates.length,
    categories: [...new Set(TOOL_TEMPLATES.map(t => t.category))],
  });
});

/**
 * Get a specific custom tool
 */
customToolsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.get(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  return apiResponse(c, tool);
});

/**
 * Create a new custom tool
 */
customToolsRoutes.post('/', async (c) => {
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, createCustomToolSchema } = await import('../middleware/validation.js');
  const body = validateBody(createCustomToolSchema, rawBody) as {
    name: string;
    description: string;
    parameters: CustomToolRecord['parameters'];
    code: string;
    category?: string;
    permissions?: ToolPermission[];
    requiresApproval?: boolean;
    createdBy?: 'user' | 'llm';
    metadata?: Record<string, unknown>;
    requiredApiKeys?: CustomToolRecord['requiredApiKeys'];
  };

  // Validate code using centralized validator
  const codeValidation = validateToolCode(body.code);
  if (!codeValidation.valid) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Tool code validation failed: ${codeValidation.errors[0]}` }, 400);
  }

  const repo = createCustomToolsRepo(getUserId(c));

  // Check if tool name already exists
  const existing = await repo.getByName(body.name);
  if (existing) {
    return apiError(c, { code: ERROR_CODES.ALREADY_EXISTS, message: `Tool with name '${sanitizeText(body.name)}' already exists` }, 409);
  }

  const tool = await repo.create({
    name: body.name,
    description: body.description,
    parameters: body.parameters,
    code: body.code,
    category: body.category,
    permissions: body.permissions,
    requiresApproval: body.requiresApproval,
    createdBy: body.createdBy ?? 'user',
    metadata: body.metadata,
    requiredApiKeys: body.requiredApiKeys,
  });

  // Register config dependencies in Config Center
  if (body.requiredApiKeys?.length) {
    await registerToolConfigRequirements(tool.name, tool.id, 'custom', body.requiredApiKeys);
  }

  // Sync to dynamic registry if active
  syncToolToRegistry(tool);

  // Invalidate agent cache so new tool is available
  invalidateAgentCache();

  return apiResponse(c, tool, 201);
});

/**
 * Update a custom tool
 */
customToolsRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const rawBody = await c.req.json().catch(() => null);
  const { validateBody, updateCustomToolSchema } = await import('../middleware/validation.js');
  const body = validateBody(updateCustomToolSchema, rawBody) as {
    name?: string;
    description?: string;
    parameters?: CustomToolRecord['parameters'];
    code?: string;
    category?: string;
    permissions?: ToolPermission[];
    requiresApproval?: boolean;
    metadata?: Record<string, unknown>;
    requiredApiKeys?: CustomToolRecord['requiredApiKeys'];
  };

  const repo = createCustomToolsRepo(getUserId(c));

  // Validate code if provided (centralized validator)
  if (body.code) {
    const codeValidation = validateToolCode(body.code);
    if (!codeValidation.valid) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Tool code validation failed: ${codeValidation.errors[0]}` }, 400);
    }
  }

  const tool = await repo.update(id, body);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  // Re-register config dependencies if changed
  if (body.requiredApiKeys !== undefined) {
    await unregisterDependencies(id);
    if (body.requiredApiKeys?.length) {
      await registerToolConfigRequirements(tool.name, id, 'custom', body.requiredApiKeys);
    }
  }

  // Re-sync to dynamic registry
  syncToolToRegistry(tool);

  // Invalidate agent cache so tool changes take effect
  invalidateAgentCache();

  return apiResponse(c, tool);
});

/**
 * Delete a custom tool
 */
customToolsRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  // Get tool name for unregistering
  const tool = await repo.get(id);
  if (tool) {
    dynamicRegistry.unregister(tool.name);
    if (_sharedRegistry?.has(tool.name)) {
      _sharedRegistry.unregister(tool.name);
    }
  }

  // Unregister API dependencies
  await unregisterDependencies(id);

  const deleted = await repo.delete(id);
  if (!deleted) {
    return notFoundError(c, 'Custom tool', id);
  }

  // Invalidate agent cache so tool removal takes effect
  invalidateAgentCache();

  return apiResponse(c, { deleted: true });
});

// =============================================================================
// STATUS MANAGEMENT
// =============================================================================

/**
 * Enable a custom tool
 */
customToolsRoutes.post('/:id/enable', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.enable(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  syncToolToRegistry(tool);

  // Invalidate agent cache so enabled tool becomes available
  invalidateAgentCache();

  return apiResponse(c, tool);
});

/**
 * Disable a custom tool
 */
customToolsRoutes.post('/:id/disable', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.disable(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  syncToolToRegistry(tool);

  // Invalidate agent cache so disabled tool is removed
  invalidateAgentCache();

  return apiResponse(c, tool);
});

/**
 * Approve a pending tool
 */
customToolsRoutes.post('/:id/approve', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.get(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  if (tool.status !== 'pending_approval') {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: `Tool is not pending approval. Current status: ${tool.status}` }, 400);
  }

  const approved = await repo.approve(id);
  if (approved) {
    syncToolToRegistry(approved);
    // Invalidate agent cache so approved tool becomes available
    invalidateAgentCache();
  }

  return apiResponse(c, approved);
});

/**
 * Reject a pending tool
 */
customToolsRoutes.post('/:id/reject', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.get(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  if (tool.status !== 'pending_approval') {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: `Tool is not pending approval. Current status: ${tool.status}` }, 400);
  }

  const rejected = await repo.reject(id);

  return apiResponse(c, rejected);
});

// =============================================================================
// EXECUTION
// =============================================================================

/**
 * Execute a custom tool
 */
customToolsRoutes.post('/:id/execute', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null) as { arguments?: Record<string, unknown> };

  const repo = createCustomToolsRepo(getUserId(c));
  const tool = await repo.get(id);

  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  if (tool.status !== 'active') {
    return apiError(c, { code: ERROR_CODES.INVALID_REQUEST, message: `Tool is not active. Current status: ${tool.status}` }, 400);
  }

  // Validate arguments size to prevent abuse
  const argsStr = JSON.stringify(body.arguments ?? {});
  if (argsStr.length > TOOL_ARGS_MAX_SIZE) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Arguments payload too large (max 100KB)' }, 400);
  }

  // Ensure tool is registered
  syncToolToRegistry(tool);

  const startTime = Date.now();
  try {
    const result = await executeCustomToolUnified(
      tool.name,
      body.arguments ?? {},
      {
        conversationId: 'direct-execution',
        userId: getUserId(c),
      }
    );
    const duration = Date.now() - startTime;

    // Record usage
    await repo.recordUsage(id);

    // Record in audit trail
    recordExecution(id, body.arguments ?? {}, result, duration);

    return apiResponse(c, {
        tool: tool.name,
        result: result.content,
        isError: result.isError,
        duration,
        metadata: result.metadata,
      });
  } catch (execError) {
    const duration = Date.now() - startTime;
    const errorResult = {
      content: getErrorMessage(execError, 'Execution failed'),
      isError: true as const,
    };

    // Record failure in audit trail
    recordExecution(id, body.arguments ?? {}, errorResult, duration);

    return apiResponse(c, {
      tool: tool.name,
      result: errorResult.content,
      isError: true,
      duration,
      metadata: {},
    });
  }
});

/**
 * GET /custom-tools/:id/executions - View execution audit trail
 */
customToolsRoutes.get('/:id/executions', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(getUserId(c));

  const tool = await repo.get(id);
  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  const limit = getOptionalIntParam(c, 'limit', 1, 100) ?? 50;
  const trail = executionAuditTrail.get(id) ?? [];
  const recent = trail.slice(-limit).reverse(); // Most recent first

  return apiResponse(c, {
    tool: tool.name,
    toolId: id,
    executions: recent,
    totalRecorded: trail.length,
  });
});

/**
 * Test a tool without saving (dry run)
 */
customToolsRoutes.post('/test', async (c) => {
  const body = await c.req.json().catch(() => null) as {
    name: string;
    description: string;
    parameters: CustomToolRecord['parameters'];
    code: string;
    permissions?: ToolPermission[];
    testArguments?: Record<string, unknown>;
  };

  // Validate required fields
  if (!body.name || !body.description || !body.parameters || !body.code) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Missing required fields: name, description, parameters, code' }, 400);
  }

  // Validate code using centralized validator
  const codeValidation = validateToolCode(body.code);
  if (!codeValidation.valid) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Tool code validation failed: ${codeValidation.errors[0]}` }, 400);
  }

  // Create temporary registry for testing, with all built-in tools available via callTool
  const testRegistry = createDynamicToolRegistry(ALL_TOOLS);

  const testTool: DynamicToolDefinition = {
    name: body.name,
    description: body.description,
    parameters: body.parameters as DynamicToolDefinition['parameters'],
    code: body.code,
    permissions: body.permissions,
  };

  testRegistry.register(testTool);

  const startTime = Date.now();
  try {
    const result = await testRegistry.execute(
      body.name,
      body.testArguments ?? {},
      {
        callId: `test_${Date.now()}`,
        conversationId: 'test-execution',
        userId: getUserId(c),
      }
    );
    const duration = Date.now() - startTime;

    return apiResponse(c, {
        tool: body.name,
        result: result.content,
        isError: result.isError,
        duration,
        metadata: result.metadata,
        testMode: true,
      });
  } catch (execError) {
    const duration = Date.now() - startTime;
    return apiResponse(c, {
      tool: body.name,
      result: getErrorMessage(execError, 'Execution failed'),
      isError: true,
      duration,
      metadata: {},
      testMode: true,
    });
  }
});

/**
 * POST /custom-tools/validate - Deep code analysis for tool review
 * Returns security validation, warnings, code statistics, security score,
 * data flow risks, best practices, and suggested permissions.
 * LLM can use this to verify tool code before creating it.
 */
customToolsRoutes.post('/validate', async (c) => {
  const body = await c.req.json().catch(() => null) as {
    code: string;
    name?: string;
    permissions?: string[];
  };

  if (!body.code || typeof body.code !== 'string') {
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
customToolsRoutes.post('/llm-review', async (c) => {
  const body = await c.req.json().catch(() => null) as {
    code: string;
    name?: string;
    description?: string;
    permissions?: string[];
  };

  if (!body.code || typeof body.code !== 'string') {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'code is required' }, 400);
  }

  // Run static analysis first
  const analysis = analyzeToolCode(body.code, body.permissions);
  const score = calculateSecurityScore(body.code, body.permissions);

  // Build the review prompt for LLM
  const reviewPrompt = buildLlmReviewPrompt(body.code, body.name, body.description, body.permissions, analysis, score);

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

// =============================================================================
// EXECUTION AUDIT TRAIL
// =============================================================================

/** In-memory execution audit trail (per tool, capped) */
const executionAuditTrail = new Map<string, Array<{
  timestamp: string;
  argsHash: string;
  resultSummary: string;
  duration: number;
  success: boolean;
  error?: string;
}>>();

const MAX_AUDIT_ENTRIES_PER_TOOL = 100;

/**
 * Record a tool execution in the audit trail.
 */
function recordExecution(
  toolId: string,
  args: Record<string, unknown>,
  result: { content: unknown; isError: boolean },
  duration: number
): void {
  if (!executionAuditTrail.has(toolId)) {
    executionAuditTrail.set(toolId, []);
  }
  const trail = executionAuditTrail.get(toolId)!;

  // Hash args for privacy (don't store raw arguments)
  const argsStr = JSON.stringify(args);
  const argsHash = argsStr.length > 0
    ? `sha256:${Buffer.from(argsStr).toString('base64').slice(0, 16)}...`
    : 'empty';

  // Summarize result
  const resultStr = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
  const resultSummary = resultStr.length > 200 ? resultStr.slice(0, 200) + '...' : resultStr;

  trail.push({
    timestamp: new Date().toISOString(),
    argsHash,
    resultSummary: result.isError ? `ERROR: ${resultSummary}` : resultSummary,
    duration,
    success: !result.isError,
    error: result.isError ? resultSummary : undefined,
  });

  // Cap entries
  if (trail.length > MAX_AUDIT_ENTRIES_PER_TOOL) {
    trail.splice(0, trail.length - MAX_AUDIT_ENTRIES_PER_TOOL);
  }
}


/**
 * POST /custom-tools/templates/:id/create - Create a tool from a template
 */
customToolsRoutes.post('/templates/:templateId/create', async (c) => {
  const templateId = c.req.param('templateId');
  const body = await c.req.json().catch(() => null) as {
    name?: string;
    description?: string;
    code?: string;
    permissions?: ToolPermission[];
    requiredApiKeys?: CustomToolRecord['requiredApiKeys'];
  };

  const template = TOOL_TEMPLATES.find(t => t.id === templateId);
  if (!template) {
    return notFoundError(c, 'Template', templateId);
  }

  // Merge template with overrides
  const toolName = body.name ?? template.name;
  const toolCode = body.code ?? template.code;

  // Validate the final code
  const codeValidation = validateToolCode(toolCode);
  if (!codeValidation.valid) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: `Tool code validation failed: ${codeValidation.errors[0]}` }, 400);
  }

  const repo = createCustomToolsRepo(getUserId(c));

  // Check duplicate
  const existing = await repo.getByName(toolName);
  if (existing) {
    return apiError(c, { code: ERROR_CODES.ALREADY_EXISTS, message: `Tool with name '${toolName}' already exists` }, 409);
  }

  const tool = await repo.create({
    name: toolName,
    description: body.description ?? template.description,
    parameters: template.parameters as CustomToolRecord['parameters'],
    code: toolCode,
    category: template.category,
    permissions: (body.permissions ?? template.permissions) as ToolPermission[],
    requiresApproval: false,
    createdBy: 'user',
    requiredApiKeys: body.requiredApiKeys ?? template.requiredApiKeys,
  });

  // Register config dependencies
  if (tool.requiredApiKeys?.length) {
    await registerToolConfigRequirements(tool.name, tool.id, 'custom', tool.requiredApiKeys);
  }

  syncToolToRegistry(tool);
  invalidateAgentCache();

  return apiResponse(c, tool, 201);
});

/**
 * Get active tools for LLM context
 * Returns tools in a format suitable for LLM tool definitions
 */
customToolsRoutes.get('/active/definitions', async (c) => {
  const repo = createCustomToolsRepo(getUserId(c));
  const tools = await repo.getActiveTools();

  const definitions = tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    category: tool.category ?? 'Custom',
    requiresConfirmation: tool.requiresApproval,
  }));

  return apiResponse(c, {
      tools: definitions,
      count: definitions.length,
    });
});

// =============================================================================
// META-TOOL EXECUTORS (For LLM to create/manage custom tools)
// =============================================================================

import type { ToolExecutionResult as BaseToolExecutionResult } from '../services/tool-executor.js';

interface ToolExecutionResult extends BaseToolExecutionResult {
  requiresApproval?: boolean;
  requiresConfirmation?: boolean;
  pendingToolId?: string;
}

// Code validation is now centralized in @ownpilot/core (validateToolCode, MAX_TOOL_CODE_SIZE)

/**
 * Execute custom tool management tools (meta-tools)
 * Used by LLM to create, list, delete, and toggle custom tools
 */
export async function executeCustomToolTool(
  toolId: string,
  params: Record<string, unknown>,
  userId = 'default'
): Promise<ToolExecutionResult> {
  const repo = createCustomToolsRepo(userId);

  try {
    switch (toolId) {
      case 'create_tool': {
        const { name, description, parameters: parametersInput, code, category, permissions, required_api_keys } = params as {
          name: string;
          description: string;
          parameters: string | { type: 'object'; properties: Record<string, unknown>; required?: string[] };
          code: string;
          category?: string;
          permissions?: string[];
          required_api_keys?: Array<{ name: string; displayName?: string; description?: string; category?: string; docsUrl?: string }>;
        };

        // Validate required fields
        if (!name || !description || !parametersInput || !code) {
          return { success: false, error: 'Missing required fields: name, description, parameters, code' };
        }

        // Enforce length limits (same as Zod schema)
        if (typeof name !== 'string' || name.length > 100) {
          return { success: false, error: 'Tool name must be a string with max 100 characters' };
        }
        if (typeof description !== 'string' || description.length > 2000) {
          return { success: false, error: 'Description must be a string with max 2000 characters' };
        }
        if (typeof code !== 'string' || code.length > 50000) {
          return { success: false, error: 'Code must be a string with max 50000 characters' };
        }
        if (category !== undefined && (typeof category !== 'string' || category.length > 50)) {
          return { success: false, error: 'Category must be a string with max 50 characters' };
        }

        // Validate permissions enum
        const VALID_PERMISSIONS = ['network', 'filesystem', 'database', 'shell', 'email', 'scheduling', 'local'];
        if (permissions) {
          if (!Array.isArray(permissions) || permissions.length > 7) {
            return { success: false, error: 'Permissions must be an array with max 7 entries' };
          }
          const invalid = permissions.filter(p => !VALID_PERMISSIONS.includes(p));
          if (invalid.length > 0) {
            return { success: false, error: `Invalid permissions: ${invalid.join(', ')}. Allowed: ${VALID_PERMISSIONS.join(', ')}` };
          }
        }

        // Parse parameters if it's a JSON string
        let parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
        if (typeof parametersInput === 'string') {
          try {
            parameters = JSON.parse(parametersInput);
          } catch {
            return { success: false, error: 'Invalid JSON in parameters field. Must be a valid JSON Schema object.' };
          }
        } else {
          parameters = parametersInput;
        }

        // Validate parameters structure
        if (!parameters || typeof parameters !== 'object' || parameters.type !== 'object') {
          return { success: false, error: 'Parameters must be a JSON Schema object with type: "object"' };
        }

        // Validate tool name format
        if (!/^[a-z][a-z0-9_]*$/.test(name)) {
          return {
            success: false,
            error: 'Tool name must start with lowercase letter and contain only lowercase letters, numbers, and underscores',
          };
        }

        // Check if tool already exists
        const existing = await repo.getByName(name);
        if (existing) {
          return { success: false, error: `Tool with name '${sanitizeText(name)}' already exists` };
        }

        // Validate code using centralized validator
        const codeValidation = validateToolCode(code);
        if (!codeValidation.valid) {
          return { success: false, error: `Tool code validation failed: ${codeValidation.errors[0]}` };
        }

        // Parse required_api_keys
        const requiredApiKeys = required_api_keys?.length ? required_api_keys : undefined;

        // Create the tool (LLM-created tools may need approval for dangerous permissions)
        const tool = await repo.create({
          name,
          description,
          parameters,
          code,
          category,
          permissions: (permissions ?? []) as ToolPermission[],
          requiresApproval: true, // All LLM-created tools require approval before each execution
          createdBy: 'llm',
          requiredApiKeys,
        });

        // Register config dependencies in Config Center
        if (requiredApiKeys?.length) {
          await registerToolConfigRequirements(tool.name, tool.id, 'custom', requiredApiKeys);
        }

        // If pending approval, notify user
        if (tool.status === 'pending_approval') {
          return {
            success: true,
            requiresApproval: true,
            pendingToolId: tool.id,
            result: {
              message: `Tool '${sanitizeText(name)}' created but requires user approval before it can be used. It has been flagged for review because it requests dangerous permissions (${permissions?.map(p => sanitizeId(p)).join(', ')}).`,
              toolId: tool.id,
              status: tool.status,
            },
          };
        }

        // Sync to registry if active
        syncToolToRegistry(tool);

        // Invalidate agent cache so new tool becomes available
        invalidateAgentCache();

        return {
          success: true,
          result: {
            message: `Tool '${sanitizeText(name)}' created successfully and is ready to use.`,
            toolId: tool.id,
            status: tool.status,
            description: tool.description,
          },
        };
      }

      case 'list_custom_tools': {
        const { category, status } = params as {
          category?: string;
          status?: string;
        };

        // Validate status enum if provided
        const VALID_STATUSES = ['active', 'disabled', 'pending_approval', 'rejected'];
        if (status && !VALID_STATUSES.includes(status)) {
          return { success: false, error: `Invalid status '${status}'. Allowed: ${VALID_STATUSES.join(', ')}` };
        }

        // Validate category length
        if (category && (typeof category !== 'string' || category.length > 50)) {
          return { success: false, error: 'Category must be a string with max 50 characters' };
        }

        const tools = await repo.list({
          category,
          status: status as ToolStatus | undefined,
        });

        const stats = await repo.getStats();

        return {
          success: true,
          result: {
            message: `Found ${tools.length} custom tool(s).`,
            tools: tools.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
              status: t.status,
              category: t.category,
              createdBy: t.createdBy,
              usageCount: t.usageCount,
            })),
            stats: {
              total: stats.total,
              active: stats.active,
              pendingApproval: stats.pendingApproval,
            },
          },
        };
      }

      case 'delete_custom_tool': {
        const { name, confirm } = params as { name: string; confirm?: boolean };

        if (!name || typeof name !== 'string' || name.length > 100) {
          return { success: false, error: 'Tool name must be a non-empty string with max 100 characters' };
        }
        if (confirm !== undefined && typeof confirm !== 'boolean') {
          return { success: false, error: 'confirm must be a boolean' };
        }

        const tool = await repo.getByName(name);
        if (!tool) {
          return { success: false, error: `Tool '${sanitizeText(name)}' not found` };
        }

        // PROTECTION: LLM cannot delete user-created tools
        // Only tools created by LLM can be deleted by LLM
        if (tool.createdBy === 'user') {
          return {
            success: false,
            error: `Cannot delete tool '${sanitizeText(name)}' - this tool was created by the user and is protected. Only the user can delete it through the UI or API. If the user explicitly asked you to delete it, please inform them they need to delete it manually from the Custom Tools page.`,
          };
        }

        // For LLM-created tools, still require explicit confirmation
        if (!confirm) {
          return {
            success: false,
            requiresConfirmation: true,
            error: `Are you sure you want to delete the tool '${sanitizeText(name)}'? Call delete_custom_tool again with confirm: true to proceed.`,
          };
        }

        // Unregister from both registries
        dynamicRegistry.unregister(name);
        if (_sharedRegistry?.has(name)) {
          _sharedRegistry.unregister(name);
        }

        // Unregister API dependencies
        await unregisterDependencies(tool.id);

        // Delete from database
        const deleted = await repo.delete(tool.id);

        // Invalidate agent cache so tool removal takes effect
        if (deleted) {
          invalidateAgentCache();
        }

        return {
          success: deleted,
          result: deleted
            ? { message: `Tool '${sanitizeText(name)}' deleted successfully.` }
            : { message: `Failed to delete tool '${sanitizeText(name)}'.` },
        };
      }

      case 'toggle_custom_tool': {
        const { name, enabled } = params as { name: string; enabled: boolean };

        if (!name || typeof name !== 'string' || name.length > 100) {
          return { success: false, error: 'Tool name must be a non-empty string with max 100 characters' };
        }
        if (typeof enabled !== 'boolean') {
          return { success: false, error: 'enabled must be a boolean value (true or false)' };
        }

        const tool = await repo.getByName(name);
        if (!tool) {
          return { success: false, error: `Tool '${sanitizeText(name)}' not found` };
        }

        const updated = enabled ? await repo.enable(tool.id) : await repo.disable(tool.id);
        if (updated) {
          syncToolToRegistry(updated);
          // Invalidate agent cache so status change takes effect
          invalidateAgentCache();
        }

        return {
          success: true,
          result: {
            message: `Tool '${sanitizeText(name)}' ${enabled ? 'enabled' : 'disabled'} successfully.`,
            status: updated?.status,
          },
        };
      }

      case 'update_custom_tool': {
        const { name, description, parameters, code, category, permissions } = params as {
          name: string;
          description?: string;
          parameters?: string;
          code?: string;
          category?: string;
          permissions?: ToolPermission[];
        };

        if (!name || typeof name !== 'string' || name.length > 100) {
          return { success: false, error: 'Tool name must be a non-empty string with max 100 characters' };
        }

        const tool = await repo.getByName(name);
        if (!tool) {
          return { success: false, error: `Tool '${sanitizeText(name)}' not found` };
        }

        // Build update object (only provided fields)
        const updateFields: Record<string, unknown> = {};

        if (description !== undefined && typeof description === 'string' && description.trim()) {
          updateFields.description = description.trim();
        }

        if (code !== undefined && typeof code === 'string' && code.trim()) {
          const codeValidation = validateToolCode(code);
          if (!codeValidation.valid) {
            return { success: false, error: `Tool code validation failed: ${codeValidation.errors[0]}` };
          }
          updateFields.code = code;
        }

        if (parameters !== undefined) {
          try {
            const parsed = typeof parameters === 'string' ? JSON.parse(parameters) : parameters;
            if (!parsed || typeof parsed !== 'object' || parsed.type !== 'object') {
              return { success: false, error: 'Parameters must be a valid JSON Schema with type "object"' };
            }
            updateFields.parameters = parsed;
          } catch {
            return { success: false, error: 'Failed to parse parameters JSON' };
          }
        }

        if (category !== undefined && typeof category === 'string' && category.trim()) {
          updateFields.category = category.trim();
        }

        if (permissions !== undefined && Array.isArray(permissions)) {
          updateFields.permissions = permissions;
        }

        if (Object.keys(updateFields).length === 0) {
          return { success: false, error: 'No fields provided to update. Provide at least one of: description, parameters, code, category, permissions.' };
        }

        const updated = await repo.update(tool.id, updateFields);
        if (!updated) {
          return { success: false, error: `Failed to update tool '${sanitizeText(name)}'` };
        }

        // Re-sync to dynamic registry
        syncToolToRegistry(updated);

        // Invalidate agent cache so tool changes take effect
        invalidateAgentCache();

        return {
          success: true,
          result: {
            message: `Tool '${sanitizeText(name)}' updated successfully (v${updated.version}).`,
            version: updated.version,
            status: updated.status,
            updatedFields: Object.keys(updateFields),
          },
        };
      }

      default:
        return { success: false, error: `Unknown custom tool operation: ${sanitizeId(toolId)}` };
    }
  } catch (error) {
    const message = getErrorMessage(error);
    return { success: false, error: message };
  }
}

/**
 * Execute an active custom tool by name
 * Used when LLM calls a dynamically created tool
 */
export async function executeActiveCustomTool(
  toolName: string,
  params: Record<string, unknown>,
  userId = 'default',
  context?: { callId?: string; conversationId?: string }
): Promise<ToolExecutionResult> {
  const repo = createCustomToolsRepo(userId);

  // Find tool by name
  const tool = await repo.getByName(toolName);
  if (!tool) {
    return { success: false, error: `Custom tool '${sanitizeText(toolName)}' not found` };
  }

  // Check if tool is active
  if (tool.status !== 'active') {
    if (tool.status === 'pending_approval') {
      return {
        success: false,
        requiresApproval: true,
        pendingToolId: tool.id,
        error: `Tool '${sanitizeText(toolName)}' is pending approval. Please approve it in the Custom Tools page before use.`,
      };
    }
    return { success: false, error: `Tool '${sanitizeText(toolName)}' is ${sanitizeId(tool.status)}` };
  }

  // Ensure tool is registered
  syncToolToRegistry(tool);

  try {
    // Execute via shared registry (middleware, scoped config, events)
    const result = await executeCustomToolUnified(toolName, params, {
      callId: context?.callId,
      conversationId: context?.conversationId ?? 'agent-execution',
      userId,
    });

    // Record usage
    await repo.recordUsage(tool.id);

    return {
      success: !result.isError,
      result: result.content,
      error: result.isError ? String(result.content) : undefined,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return { success: false, error: message };
  }
}

/**
 * Get all active custom tool definitions for LLM
 */
export async function getActiveCustomToolDefinitions(userId = 'default'): Promise<ToolDefinition[]> {
  const repo = createCustomToolsRepo(userId);
  const tools = await repo.getActiveTools();

  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters as ToolDefinition['parameters'],
    category: t.category ?? 'Custom',
    requiresConfirmation: t.requiresApproval,
  }));
}

