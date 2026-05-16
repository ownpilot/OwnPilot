/**
 * Meta-Tool Executors
 *
 * Tools that operate on the registry itself. These are the LLM's "discovery"
 * and "indirection" layer: instead of exposing every tool natively, the model
 * uses these to find/inspect/invoke any tool by name.
 *
 *  - executeUseTool          — single-tool dispatch w/ alias resolution + perm check
 *  - executeBatchUseTool     — parallel multi-tool dispatch
 *  - executeSearchTools      — keyword/category search across the registry
 *  - executeInspectToolSource — return source code for custom / built-in tools
 *  - executeGetToolHelp      — one-or-many tool parameter help
 */

import type { ToolRegistry } from '@ownpilot/core';
import {
  applyToolLimits,
  formatFullToolHelp,
  buildToolHelpText,
  validateRequiredParams,
  getBaseName,
  TOOL_SEARCH_TAGS,
  type ToolExecutionResult as CoreToolResult,
  type ToolContext,
} from '@ownpilot/core';
import { createCustomToolsRepo } from '../../db/repositories/custom-tools.js';
import { getToolSource } from '../../services/tool-source.js';
import { getErrorMessage, truncate } from '../../routes/helpers.js';
import {
  TOOL_ARGS_MAX_SIZE,
  MAX_BATCH_TOOL_CALLS,
  AI_META_TOOL_NAMES,
} from '../../config/defaults.js';
import { getLog } from '../../services/log.js';
import { checkToolPermission } from '../../services/tool-permission-service.js';
import { resolveToolAlias } from './aliases.js';
import { findSimilarTools } from './utils.js';

const log = getLog('AgentTools');

/**
 * Shared use_tool executor — validates, caps, executes a single tool by name.
 * Used by both agent and chat tool registration paths.
 */
export async function executeUseTool(
  tools: ToolRegistry,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<CoreToolResult> {
  const { arguments: toolArgs } = args as {
    tool_name: string;
    arguments: Record<string, unknown>;
  };
  let tool_name = (args as { tool_name: string }).tool_name;

  // Alias resolution — auto-fix common LLM hallucinations
  if (!tools.has(tool_name)) {
    const resolved = resolveToolAlias(tool_name);
    if (resolved && tools.has(resolved)) {
      log.info(`Tool alias resolved: ${tool_name} → ${resolved}`);
      tool_name = resolved;
    }
  }

  // Check if tool exists — suggest similar names if not
  if (!tools.has(tool_name)) {
    const similar = findSimilarTools(tools, tool_name);
    const hint =
      similar.length > 0
        ? `\n\nDid you mean one of these?\n${similar.map((s) => `  • ${s}`).join('\n')}\n\nCall get_tool_help("tool_name") to see parameters, then retry with the correct name.`
        : '\n\nUse search_tools("keyword") to find the correct tool name.';
    return { content: `Tool '${tool_name}' not found.${hint}`, isError: true };
  }

  // Centralized permission check — enforces tool groups, exec perms, CLI policies, skill restrictions
  const perm = await checkToolPermission(context.userId ?? 'default', tool_name, {
    source: 'chat',
    executionPermissions: context.executionPermissions,
  });
  if (!perm.allowed) {
    return { content: `Tool '${tool_name}' is not available: ${perm.reason}`, isError: true };
  }

  // Pre-validate required parameters before execution
  const missingError = validateRequiredParams(tools, tool_name, toolArgs || {});
  if (missingError) {
    return { content: `${missingError}${buildToolHelpText(tools, tool_name)}`, isError: true };
  }

  try {
    // Validate tool arguments payload size
    const argsStr = JSON.stringify(toolArgs ?? {});
    if (argsStr.length > TOOL_ARGS_MAX_SIZE) {
      return { content: 'Tool arguments payload too large (max 100KB)', isError: true };
    }

    // Apply max limits for list-returning tools (e.g. cap list_emails limit to 50)
    const cappedArgs = applyToolLimits(tool_name, toolArgs);
    // Forward the parent context so inner tools inherit executionPermissions, requestApproval, etc.
    const result = await tools.execute(tool_name, cappedArgs, context);
    if (result.ok) {
      return result.value;
    }
    // Include parameter help on execution error so LLM can retry correctly
    return { content: result.error.message + buildToolHelpText(tools, tool_name), isError: true };
  } catch (error) {
    const msg = getErrorMessage(error, 'Tool execution failed');
    return { content: msg + buildToolHelpText(tools, tool_name), isError: true };
  }
}

/**
 * Shared batch_use_tool executor — validates and executes multiple tools in parallel.
 * Used by both agent and chat tool registration paths.
 */
export async function executeBatchUseTool(
  tools: ToolRegistry,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<CoreToolResult> {
  const { calls } = args as {
    calls: Array<{ tool_name: string; arguments: Record<string, unknown> }>;
  };

  if (!calls?.length) {
    return { content: 'Provide a "calls" array with at least one tool call.', isError: true };
  }

  if (calls.length > MAX_BATCH_TOOL_CALLS) {
    return {
      content: `Batch size ${calls.length} exceeds maximum of ${MAX_BATCH_TOOL_CALLS}. Split into smaller batches.`,
      isError: true,
    };
  }

  // Execute all tool calls in parallel
  const results = await Promise.allSettled(
    calls.map(async (call, idx) => {
      const { arguments: toolArgs } = call;
      let tool_name = call.tool_name;

      // Alias resolution
      if (!tools.has(tool_name)) {
        const resolved = resolveToolAlias(tool_name);
        if (resolved && tools.has(resolved)) {
          log.info(`Tool alias resolved: ${tool_name} → ${resolved}`);
          tool_name = resolved;
        }
      }

      // Check tool exists
      if (!tools.has(tool_name)) {
        const similar = findSimilarTools(tools, tool_name);
        const hint = similar.length > 0 ? ` Did you mean: ${similar.join(', ')}?` : '';
        return { idx, tool_name, ok: false, content: `Tool '${tool_name}' not found.${hint}` };
      }

      // Validate required params
      const missingError = validateRequiredParams(tools, tool_name, toolArgs || {});
      if (missingError) {
        return { idx, tool_name, ok: false, content: missingError };
      }

      try {
        // Validate tool arguments payload size
        const argsStr = JSON.stringify(toolArgs ?? {});
        if (argsStr.length > TOOL_ARGS_MAX_SIZE) {
          return {
            idx,
            tool_name,
            ok: false,
            content: 'Tool arguments payload too large (max 100KB)',
          };
        }

        const cappedArgs = applyToolLimits(tool_name, toolArgs);
        // Forward the parent context so inner tools inherit executionPermissions, etc.
        const result = await tools.execute(tool_name, cappedArgs, context);
        if (result.ok) {
          return {
            idx,
            tool_name,
            ok: true,
            content:
              typeof result.value.content === 'string'
                ? result.value.content
                : JSON.stringify(result.value.content, null, 2),
          };
        }
        return { idx, tool_name, ok: false, content: result.error.message };
      } catch (error) {
        const msg = getErrorMessage(error, 'Execution failed');
        return { idx, tool_name, ok: false, content: msg };
      }
    })
  );

  // Format combined results
  const sections = results.map((r, i) => {
    const call = calls[i]!;
    if (r.status === 'fulfilled') {
      const v = r.value;
      const status = v.ok ? '✓' : '✗';
      return `### ${i + 1}. ${call.tool_name} ${status}\n${v.content}`;
    }
    return `### ${i + 1}. ${call.tool_name} ✗\nUnexpected error: ${r.reason}`;
  });

  const hasErrors = results.some(
    (r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)
  );

  return {
    content: `[Batch: ${calls.length} tool calls]\n\n${sections.join('\n\n---\n\n')}`,
    isError:
      hasErrors &&
      results.every((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)),
  };
}

/**
 * Shared handler for search_tools meta-tool
 */
export async function executeSearchTools(
  tools: ToolRegistry,
  args: Record<string, unknown>
): Promise<CoreToolResult> {
  const {
    query,
    category: filterCategory,
    include_params,
  } = args as { query: string; category?: string; include_params?: boolean };
  const allDefs = tools.getDefinitions();
  const q = query.trim().toLowerCase();

  const showAll = q === 'all' || q === '*';
  const queryWords = q.split(/\s+/).filter(Boolean);

  const matches = allDefs.filter((d) => {
    if (AI_META_TOOL_NAMES.includes(d.name as (typeof AI_META_TOOL_NAMES)[number])) return false;
    if (filterCategory && d.category?.toLowerCase() !== filterCategory.toLowerCase()) return false;
    if (showAll) return true;

    const baseName = getBaseName(d.name);
    const tags = TOOL_SEARCH_TAGS[baseName] ?? d.tags ?? [];
    const searchBlob = [
      baseName.toLowerCase().replace(/[_\-]/g, ' '),
      d.name.toLowerCase().replace(/[_.]/g, ' '),
      d.name.toLowerCase(),
      d.description.toLowerCase(),
      (d.category ?? '').toLowerCase(),
      ...tags.map((tag) => tag.toLowerCase()),
    ].join(' ');
    return queryWords.every((word) => searchBlob.includes(word));
  });

  if (matches.length === 0) {
    return {
      content: `No tools found for "${query}". Tips:\n- Search by individual keywords: "email" or "send"\n- Use multiple words for AND search: "email send" finds send_email\n- Use "all" to list every available tool\n- Try broad keywords: "task", "file", "web", "memory", "note", "calendar"`,
    };
  }

  if (include_params !== false) {
    const sections = matches.map((d) => formatFullToolHelp(tools, d.name));
    return {
      content: [
        `Found ${matches.length} tool(s) for "${query}" (with parameters):`,
        '',
        ...sections.join('\n\n---\n\n').split('\n'),
      ].join('\n'),
    };
  }

  const lines = matches.map((d) => `- **${d.name}**: ${truncate(d.description, 100)}`);
  return { content: [`Found ${matches.length} tool(s) for "${query}":`, '', ...lines].join('\n') };
}

/**
 * Shared handler for inspect_tool_source meta-tool
 */
export async function executeInspectToolSource(
  tools: ToolRegistry,
  userId: string,
  args: Record<string, unknown>
): Promise<CoreToolResult> {
  const { tool_name } = args as { tool_name: string };
  if (!tool_name || typeof tool_name !== 'string') {
    return { content: 'Provide a "tool_name" parameter.', isError: true };
  }

  const customToolsRepo = createCustomToolsRepo(userId);
  const baseName = getBaseName(tool_name);

  // 1. Check if it's a custom tool (DB stores base names)
  const customTool = await customToolsRepo.getByName(baseName);
  if (customTool) {
    const sections: string[] = [
      `## Tool: ${customTool.name}`,
      `**Category:** ${customTool.category ?? 'Custom'}`,
      `**Type:** custom (v${customTool.version}, created by ${customTool.createdBy})`,
      `**Status:** ${customTool.status}`,
      '',
      '### Description',
      customTool.description,
      '',
      '### Parameters',
      '```json',
      JSON.stringify(customTool.parameters, null, 2),
      '```',
      '',
      '### Source Code',
      '```javascript',
      customTool.code,
      '```',
    ];
    if (customTool.permissions?.length) {
      sections.push('', `**Permissions:** ${customTool.permissions.join(', ')}`);
    }
    sections.push(
      '',
      '### Improvement Tips',
      '- You can update this tool directly with `update_custom_tool`.'
    );
    return { content: sections.join('\n') };
  }

  // 2. Check if it's a built-in tool
  const def = tools.getDefinition(tool_name);
  if (def) {
    const source = getToolSource(tool_name);
    const sections: string[] = [
      `## Tool: ${def.name}`,
      `**Category:** ${def.category ?? 'Unknown'}`,
      `**Type:** built-in`,
      '',
      '### Description',
      def.description,
      '',
      '### Parameters',
      '```json',
      JSON.stringify(def.parameters, null, 2),
      '```',
    ];
    if (source) {
      sections.push('', '### Source Code', '```typescript', source, '```');
    } else {
      sections.push('', '*Source code not available for this tool.*');
    }
    sections.push(
      '',
      '### Improvement Tips',
      '- Built-in tools cannot be modified directly. Use `create_tool` to create an improved custom version that overrides or extends this tool.'
    );
    return { content: sections.join('\n') };
  }

  // 3. Not found — suggest similar tools
  const similar = findSimilarTools(tools, tool_name);
  const hint =
    similar.length > 0
      ? `\n\nDid you mean one of these?\n${similar.map((s) => `  - ${s}`).join('\n')}`
      : '\n\nUse search_tools("keyword") to find the correct tool name.';
  return { content: `Tool '${tool_name}' not found.${hint}`, isError: true };
}

/**
 * Shared handler for get_tool_help meta-tool
 */
export async function executeGetToolHelp(
  tools: ToolRegistry,
  args: Record<string, unknown>
): Promise<CoreToolResult> {
  const { tool_name, tool_names } = args as { tool_name?: string; tool_names?: string[] };

  const names: string[] = tool_names?.length ? tool_names : tool_name ? [tool_name] : [];
  if (names.length === 0) {
    return {
      content: 'Provide either "tool_name" (string) or "tool_names" (array) parameter.',
      isError: true,
    };
  }

  const results: string[] = [];
  const notFound: string[] = [];
  for (const name of names) {
    if (!tools.getDefinition(name)) {
      notFound.push(name);
      continue;
    }
    results.push(formatFullToolHelp(tools, name));
  }

  if (notFound.length > 0) {
    const similar = notFound.flatMap((n) => findSimilarTools(tools, n));
    const hintText =
      similar.length > 0
        ? `\nDid you mean one of these?\n${[...new Set(similar)].map((s) => `  • ${s}`).join('\n')}\n\nUse search_tools("keyword") to find the correct tool name.`
        : '\nUse search_tools("keyword") to discover available tools.';
    results.push(`Tools not found: ${notFound.join(', ')}${hintText}`);
  }

  return {
    content: results.join('\n\n---\n\n'),
    isError: notFound.length > 0 && notFound.length === names.length,
  };
}
