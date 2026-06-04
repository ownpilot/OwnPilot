/**
 * Custom Tools Execution & Generation Routes
 *
 * Tool execution, testing, audit trail, and meta-tool executors for LLM.
 * Endpoints: POST /:id/execute, GET /:id/executions, POST /test
 * Exports: executeCustomToolTool, executeActiveCustomTool, getActiveCustomToolDefinitions
 */

import { LOCAL_OWNER_ID } from '../../config/defaults.js';
import { Hono } from 'hono';
import {
  createCustomToolsRepo,
  type CustomToolRecord,
  type ToolPermission,
} from '../../db/repositories/custom/tools.js';
import {
  createDynamicToolRegistry,
  ALL_TOOLS,
  validateToolCode,
  type DynamicToolDefinition,
} from '@ownpilot/core';
import {
  syncToolToRegistry,
  executeCustomToolUnified,
} from '../../services/custom/tool-registry.js';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  getOptionalIntParam,
  notFoundError,
  getErrorMessage,
  parseJsonBody,
} from '../helpers.js';
import { TOOL_ARGS_MAX_SIZE } from '../../config/defaults.js';

export const generationRoutes = new Hono();

// =============================================================================
// EXECUTION
// =============================================================================

/**
 * Execute a custom tool
 */
generationRoutes.post('/:id/execute', async (c) => {
  const id = c.req.param('id');
  const body = (await parseJsonBody(c)) as {
    arguments?: Record<string, unknown>;
  } | null;
  if (!body) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON body' }, 400);
  }

  const repo = createCustomToolsRepo(LOCAL_OWNER_ID);
  const tool = await repo.get(id);

  if (!tool) {
    return notFoundError(c, 'Custom tool', id);
  }

  if (tool.status !== 'active') {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `Tool is not active. Current status: ${tool.status}`,
      },
      400
    );
  }

  // Validate arguments size to prevent abuse
  const argsStr = JSON.stringify(body.arguments ?? {});
  if (argsStr.length > TOOL_ARGS_MAX_SIZE) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_INPUT, message: 'Arguments payload too large (max 100KB)' },
      400
    );
  }

  // Ensure tool is registered
  syncToolToRegistry(tool);

  const startTime = Date.now();
  try {
    const result = await executeCustomToolUnified(tool.name, body.arguments ?? {}, {
      conversationId: 'direct-execution',
      userId: LOCAL_OWNER_ID,
    });
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
generationRoutes.get('/:id/executions', async (c) => {
  const id = c.req.param('id');
  const repo = createCustomToolsRepo(LOCAL_OWNER_ID);

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
generationRoutes.post('/test', async (c) => {
  const body = (await parseJsonBody(c)) as {
    name: string;
    description: string;
    parameters: CustomToolRecord['parameters'];
    code: string;
    permissions?: ToolPermission[];
    testArguments?: Record<string, unknown>;
  } | null;
  if (!body) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Invalid JSON body' }, 400);
  }

  // Validate required fields
  if (!body.name || !body.description || !body.parameters || !body.code) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: 'Missing required fields: name, description, parameters, code',
      },
      400
    );
  }

  // Validate code using centralized validator
  const codeValidation = validateToolCode(body.code);
  if (!codeValidation.valid) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_INPUT,
        message: `Tool code validation failed: ${codeValidation.errors[0]}`,
      },
      400
    );
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
    const result = await testRegistry.execute(body.name, body.testArguments ?? {}, {
      callId: `test_${Date.now()}`,
      conversationId: 'test-execution',
      userId: LOCAL_OWNER_ID,
    });
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

// =============================================================================
// EXECUTION AUDIT TRAIL
// =============================================================================

/** In-memory execution audit trail (per tool, capped) */
const executionAuditTrail = new Map<
  string,
  Array<{
    timestamp: string;
    argsHash: string;
    resultSummary: string;
    duration: number;
    success: boolean;
    error?: string;
  }>
>();

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
  const argsHash =
    argsStr.length > 0
      ? `sha256:${Buffer.from(argsStr).toString('base64').slice(0, 16)}...`
      : 'empty';

  // Summarize result
  const resultStr =
    typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
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

// =============================================================================
// META-TOOL EXECUTORS (For LLM to create/manage custom tools)
// =============================================================================
// Moved to tools/custom-tools.ts. Re-exported here for legacy callers.
export {
  executeCustomToolTool,
  executeActiveCustomTool,
  getActiveCustomToolDefinitions,
} from '../../tools/custom-tools.js';
