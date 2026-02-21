/**
 * Tool registry and management
 */

import { randomUUID } from 'node:crypto';
import type { Result } from '../types/result.js';
import { ok, err } from '../types/result.js';
import { ValidationError, NotFoundError, PluginError } from '../types/errors.js';
import { createToolId, type ToolId, type PluginId } from '../types/branded.js';
import { getLog } from '../services/get-log.js';
import { getErrorMessage } from '../services/error-utils.js';
import { CORE_TOOLS, CORE_EXECUTORS } from './core-tool-definitions.js';

const log = getLog('ToolRegistry');
import type {
  ToolDefinition,
  ToolExecutor,
  RegisteredTool,
  ToolContext,
  ToolExecutionResult,
  ToolCall,
  ToolResult,
  ToolProvider,
  ToolMiddleware,
  ToolMiddlewareContext,
  ToolSource,
  ToolTrustLevel,
  ToolConfigRequirement,
} from './types.js';
import { logToolCall, logToolResult } from './debug.js';
import { validateToolCall } from './tool-validation.js';
import type { ConfigCenter } from '../services/config-center.js';
import { getBaseName, qualifyToolName } from './tool-namespace.js';
import {
  getEventBus,
  getEventSystem,
  createEvent,
  EventTypes,
  type ToolRegisteredData,
  type ToolExecutedData,
} from '../events/index.js';

// Re-export types for consumers
export type {
  ToolDefinition, ToolExecutor, RegisteredTool, ToolContext, ToolExecutionResult,
  ToolCall, ToolResult, ToolProvider, ToolMiddleware, ToolMiddlewareContext,
  ToolSource, ToolTrustLevel, ToolConfigRequirement,
};

/**
 * Tool registry for managing available tools
 */
/**
 * Registration metadata for tools. Allows specifying source, trust level, and other metadata.
 */
export interface ToolRegistrationMetadata {
  source?: ToolSource;
  pluginId?: PluginId;
  customToolId?: string;
  trustLevel?: ToolTrustLevel;
  providerName?: string;
}

/**
 * Callback type for config auto-registration when tools with configRequirements are registered.
 */
export type ConfigRegistrationHandler = (
  toolName: string,
  toolId: string,
  source: ToolSource,
  requirements: readonly ToolConfigRequirement[],
) => Promise<void>;

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();
  private readonly pluginTools = new Map<string, Set<string>>();
  /** Reverse index: base name → Set of qualified names that share that base name */
  private readonly baseNameIndex = new Map<string, Set<string>>();
  private _configCenter?: ConfigCenter;
  private readonly globalMiddleware: ToolMiddleware[] = [];
  private readonly perToolMiddleware = new Map<string, ToolMiddleware[]>();
  private readonly hookUnsubs: (() => void)[] = [];
  private _onConfigRegistration?: ConfigRegistrationHandler;

  /**
   * Register a tool
   */
  register(
    definition: ToolDefinition,
    executor: ToolExecutor,
    metadataOrPluginId?: PluginId | ToolRegistrationMetadata
  ): Result<ToolId, ValidationError> {
    // Backward compat: string = old pluginId param
    const metadata: ToolRegistrationMetadata = typeof metadataOrPluginId === 'string'
      ? { source: 'plugin', pluginId: metadataOrPluginId, trustLevel: 'semi-trusted' }
      : metadataOrPluginId ?? {};

    // Validate tool name
    if (!definition.name || definition.name.length > 128) {
      return err(new ValidationError('Tool name must be 1-128 characters'));
    }

    if (!/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(definition.name)) {
      return err(
        new ValidationError('Tool name must start with a letter and contain only alphanumeric characters, underscores, and dots')
      );
    }

    // Check for duplicate
    if (this.tools.has(definition.name)) {
      return err(new ValidationError(`Tool already registered: ${definition.name}`));
    }

    const toolId = createToolId(definition.name);
    const pluginId = metadata.pluginId;
    const source: ToolSource = metadata.source ?? (pluginId ? 'plugin' : 'core');
    const trustLevel: ToolTrustLevel = metadata.trustLevel
      ?? (source === 'plugin' ? 'semi-trusted' : source === 'custom' ? 'sandboxed' : 'trusted');

    const tool: RegisteredTool = {
      id: toolId,
      definition,
      executor,
      pluginId,
      source,
      trustLevel,
      customToolId: metadata.customToolId,
      providerName: metadata.providerName,
    };

    this.tools.set(definition.name, tool);

    // Track base name → qualified name mapping
    const baseName = getBaseName(definition.name);
    let baseNameSet = this.baseNameIndex.get(baseName);
    if (!baseNameSet) {
      baseNameSet = new Set();
      this.baseNameIndex.set(baseName, baseNameSet);
    }
    baseNameSet.add(definition.name);

    // Track plugin association
    if (pluginId) {
      let pluginToolSet = this.pluginTools.get(pluginId);
      if (!pluginToolSet) {
        pluginToolSet = new Set();
        this.pluginTools.set(pluginId, pluginToolSet);
      }
      pluginToolSet.add(definition.name);
    }

    // Emit tool registered event
    getEventBus().emit(createEvent<ToolRegisteredData>(
      EventTypes.TOOL_REGISTERED, 'tool', 'tool-registry',
      { name: definition.name, source, pluginId: pluginId ?? undefined },
    ));

    // Auto-register config requirements (fire-and-forget)
    if (definition.configRequirements?.length && this._onConfigRegistration) {
      this._onConfigRegistration(definition.name, toolId, source, definition.configRequirements)
        .catch(e => log.warn(`Config registration failed for ${definition.name}:`, e));
    }

    return ok(toolId);
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    // Try exact match first, then resolve from base name
    const resolved = this.tools.has(name) ? name : this.resolveToQualified(name);
    if (!resolved) return false;

    const tool = this.tools.get(resolved);
    if (!tool) return false;

    this.tools.delete(resolved);

    // Remove from base name index
    const baseName = getBaseName(resolved);
    const baseNameSet = this.baseNameIndex.get(baseName);
    if (baseNameSet) {
      baseNameSet.delete(resolved);
      if (baseNameSet.size === 0) this.baseNameIndex.delete(baseName);
    }

    // Remove from plugin tracking (use resolved name, not raw input)
    if (tool.pluginId) {
      const pluginToolSet = this.pluginTools.get(tool.pluginId);
      if (pluginToolSet) {
        pluginToolSet.delete(resolved);
        if (pluginToolSet.size === 0) {
          this.pluginTools.delete(tool.pluginId);
        }
      }
    }

    return true;
  }

  /**
   * Replace executor for an existing tool.
   * Used to override placeholder implementations with real ones (e.g., Gmail, Media services).
   */
  updateExecutor(name: string, executor: ToolExecutor): boolean {
    const tool = this.get(name);
    if (!tool) return false;

    tool.executor = executor;
    return true;
  }

  /**
   * Unregister all tools from a plugin
   */
  unregisterPlugin(pluginId: PluginId): number {
    const pluginToolSet = this.pluginTools.get(pluginId);
    if (!pluginToolSet) return 0;

    let count = 0;
    for (const name of pluginToolSet) {
      this.tools.delete(name);
      // Remove from base name index
      const baseName = getBaseName(name);
      const baseSet = this.baseNameIndex.get(baseName);
      if (baseSet) {
        baseSet.delete(name);
        if (baseSet.size === 0) this.baseNameIndex.delete(baseName);
      }
      count++;
    }

    this.pluginTools.delete(pluginId);
    return count;
  }

  // ─── Namespace resolution ───────────────────────────────────────────

  /**
   * Resolve all qualified names that share a given base name.
   * @example resolveBaseName('read_file') // ['core.read_file']
   * @example resolveBaseName('send_message') // ['core.send_message', 'plugin.telegram.send_message']
   */
  resolveBaseName(baseName: string): string[] {
    return [...(this.baseNameIndex.get(baseName) ?? [])];
  }

  /**
   * Resolve a name (qualified or base) to a single qualified name.
   * Returns undefined if not found or if base name is ambiguous (multiple matches).
   */
  private resolveToQualified(name: string): string | undefined {
    if (this.tools.has(name)) return name;
    const qualified = this.baseNameIndex.get(name);
    if (qualified && qualified.size === 1) return qualified.values().next().value;
    return undefined;
  }

  // ─── Core lookup methods ──────────────────────────────────────────

  /**
   * Get a tool by name (supports both qualified and unambiguous base names)
   */
  get(name: string): RegisteredTool | undefined {
    const resolved = this.resolveToQualified(name);
    return resolved ? this.tools.get(resolved) : undefined;
  }

  /**
   * Check if a tool exists (supports both qualified and unambiguous base names)
   */
  has(name: string): boolean {
    return this.resolveToQualified(name) !== undefined;
  }

  /**
   * Get all tool definitions
   */
  getDefinitions(): readonly ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Get a single tool definition by name (supports both qualified and base names)
   */
  getDefinition(name: string): ToolDefinition | undefined {
    return this.get(name)?.definition;
  }

  /**
   * Get tool definitions by names (supports both qualified and base names)
   */
  getDefinitionsByNames(names: readonly string[]): readonly ToolDefinition[] {
    return names
      .map((name) => this.get(name)?.definition)
      .filter((d): d is ToolDefinition => d !== undefined);
  }

  /**
   * Get all tool names
   */
  getNames(): readonly string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get all tools as definition+executor pairs.
   * Used to provide callable tools to dynamic tool sandboxes.
   */
  getAllTools(): Array<{ definition: ToolDefinition; executor: ToolExecutor }> {
    return Array.from(this.tools.values()).map((t) => ({
      definition: t.definition,
      executor: t.executor,
    }));
  }

  /**
   * Get tools for a specific plugin
   */
  getPluginTools(pluginId: PluginId): readonly RegisteredTool[] {
    const names = this.pluginTools.get(pluginId);
    if (!names) return [];

    return Array.from(names)
      .map((name) => this.tools.get(name))
      .filter((t): t is RegisteredTool => t !== undefined);
  }

  /**
   * Execute a tool
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: Omit<ToolContext, 'callId'>
  ): Promise<Result<ToolExecutionResult, NotFoundError | PluginError>> {
    const resolved = this.resolveToQualified(name);
    const tool = resolved ? this.tools.get(resolved) : undefined;
    if (!tool || !resolved) {
      return err(new NotFoundError('Tool', name));
    }
    name = resolved;

    // Scoped config access for non-trusted tools
    const allowedServices = tool.definition.configRequirements?.map(r => r.name);
    const isRestricted = tool.trustLevel !== 'trusted';

    const fullContext: ToolContext = {
      ...context,
      callId: randomUUID(),
      pluginId: tool.pluginId,
      workspaceDir: context.workspaceDir ?? this._workspaceDir,
      source: tool.source,
      trustLevel: tool.trustLevel,
      // Config Center accessors - scoped for plugin/custom tools
      getApiKey: this._configCenter
        ? (serviceName: string) => {
            if (isRestricted && allowedServices && !allowedServices.includes(serviceName)) {
              log.warn(`Tool '${name}' tried to access undeclared service '${serviceName}'`);
              return undefined;
            }
            return this._configCenter!.getApiKey(serviceName);
          }
        : undefined,
      getServiceConfig: this._configCenter
        ? (serviceName: string) => {
            if (isRestricted && allowedServices && !allowedServices.includes(serviceName)) {
              return null;
            }
            return this._configCenter!.getServiceConfig(serviceName);
          }
        : undefined,
      getConfigEntry: this._configCenter
        ? (serviceName: string, entryLabel?: string) => {
            if (isRestricted && allowedServices && !allowedServices.includes(serviceName)) {
              return null;
            }
            return this._configCenter!.getConfigEntry(serviceName, entryLabel);
          }
        : undefined,
      getConfigEntries: this._configCenter
        ? (serviceName: string) => {
            if (isRestricted && allowedServices && !allowedServices.includes(serviceName)) {
              return [];
            }
            return this._configCenter!.getConfigEntries(serviceName);
          }
        : undefined,
      getFieldValue: this._configCenter
        ? (serviceName: string, fieldName: string, entryLabel?: string) => {
            if (isRestricted && allowedServices && !allowedServices.includes(serviceName)) {
              return undefined;
            }
            return this._configCenter!.getFieldValue(serviceName, fieldName, entryLabel);
          }
        : undefined,
    };

    const startTime = Date.now();
    try {
      // Run before hooks (replaces runBeforeMiddleware)
      const hookBus = getEventSystem().hooks;
      const beforeCtx = await hookBus.call('tool:before-execute', {
        toolName: name,
        args,
        conversationId: context.conversationId,
        userId: context.userId,
        source: tool.source,
        trustLevel: tool.trustLevel,
        pluginId: tool.pluginId,
      });

      // Check if hook cancelled the execution
      if (beforeCtx.cancelled) {
        return err(new PluginError(
          tool.pluginId ?? 'core',
          `Tool execution cancelled by hook`,
        ));
      }

      // Use potentially modified args from hooks
      let result = await tool.executor(beforeCtx.data.args, fullContext);

      // Run after hooks (replaces runAfterMiddleware)
      const afterCtx = await hookBus.call('tool:after-execute', {
        toolName: name,
        args: beforeCtx.data.args,
        result,
        conversationId: context.conversationId,
        userId: context.userId,
        source: tool.source,
        trustLevel: tool.trustLevel,
        pluginId: tool.pluginId,
      });
      result = afterCtx.data.result;

      // Emit tool executed event (success)
      getEventBus().emit(createEvent<ToolExecutedData>(
        EventTypes.TOOL_EXECUTED, 'tool', 'tool-registry',
        { name, duration: Date.now() - startTime, success: true, conversationId: context.conversationId },
      ));

      return ok(result);
    } catch (error) {
      const message = getErrorMessage(error);

      // Emit tool executed event (failure)
      getEventBus().emit(createEvent<ToolExecutedData>(
        EventTypes.TOOL_EXECUTED, 'tool', 'tool-registry',
        { name, duration: Date.now() - startTime, success: false, error: message, conversationId: context.conversationId },
      ));

      return err(new PluginError(tool.pluginId ?? 'core', `Tool execution failed: ${message}`));
    }
  }

  /**
   * Set the workspace directory for file operations
   */
  setWorkspaceDir(workspaceDir: string | undefined): void {
    this._workspaceDir = workspaceDir;
  }

  /**
   * Get the workspace directory
   */
  getWorkspaceDir(): string | undefined {
    return this._workspaceDir;
  }

  /**
   * Set the Config Center for centralized service configuration.
   * Tools can then access configs via context.getApiKey(), context.getConfigEntry(), etc.
   */
  setConfigCenter(center: ConfigCenter): void {
    this._configCenter = center;
  }

  /**
   * Set a callback that fires when a tool with configRequirements is registered.
   * Used by the gateway to auto-register config service definitions in Config Center.
   */
  setConfigRegistrationHandler(handler: ConfigRegistrationHandler): void {
    this._onConfigRegistration = handler;
  }

  /**
   * Register all tools from a plugin into the shared registry.
   * Plugin tools are marked as 'semi-trusted' with scoped config access.
   */
  registerPluginTools(
    pluginId: PluginId,
    tools: Map<string, { definition: ToolDefinition; executor: ToolExecutor }>
  ): void {
    for (const [, { definition, executor }] of tools) {
      const qName = qualifyToolName(definition.name, 'plugin', pluginId);
      this.register({ ...definition, name: qName }, executor, {
        source: 'plugin',
        pluginId,
        trustLevel: 'semi-trusted',
        providerName: `plugin:${pluginId}`,
      });
    }
  }

  /**
   * Unregister all tools from a plugin (e.g. when plugin is disabled).
   * Alias for unregisterPlugin for clarity in the unified API.
   */
  unregisterPluginTools(pluginId: PluginId): number {
    return this.unregisterPlugin(pluginId);
  }

  /**
   * Register all tools from an MCP server into the shared registry.
   * MCP tools are marked as 'semi-trusted' with the 'mcp' namespace.
   */
  registerMcpTools(
    serverName: string,
    tools: Map<string, { definition: ToolDefinition; executor: ToolExecutor }>
  ): void {
    const pid = `mcp:${serverName}` as PluginId;
    for (const [, { definition, executor }] of tools) {
      const qName = qualifyToolName(definition.name, 'mcp', serverName);
      this.register({ ...definition, name: qName }, executor, {
        source: 'mcp',
        pluginId: pid,
        trustLevel: 'semi-trusted',
        providerName: `mcp:${serverName}`,
      });
    }
  }

  /**
   * Unregister all tools from an MCP server (e.g. when disconnecting).
   */
  unregisterMcpTools(serverName: string): number {
    return this.unregisterPlugin(`mcp:${serverName}` as PluginId);
  }

  /**
   * Register a custom (user/LLM-created) tool with sandboxed trust level.
   */
  registerCustomTool(
    definition: ToolDefinition,
    executor: ToolExecutor,
    customToolId: string
  ): Result<ToolId, ValidationError> {
    const qName = qualifyToolName(definition.name, 'custom');
    return this.register({ ...definition, name: qName }, executor, {
      source: 'custom',
      customToolId,
      trustLevel: 'sandboxed',
      providerName: 'custom-tools',
    });
  }

  /**
   * Get all tools from a specific source.
   */
  getToolsBySource(source: ToolSource): readonly RegisteredTool[] {
    return Array.from(this.tools.values()).filter(t => t.source === source);
  }

  /**
   * Get tools that require a specific Config Center service.
   */
  getToolsRequiringService(serviceName: string): readonly RegisteredTool[] {
    return Array.from(this.tools.values())
      .filter(t => t.definition.configRequirements?.some(r => r.name === serviceName));
  }

  /**
   * Get full registered tool metadata (source, trustLevel, etc.) by name.
   */
  getRegisteredTool(name: string): RegisteredTool | undefined {
    return this.get(name);
  }

  /**
   * Get the current Config Center (if set).
   */
  getConfigCenter(): ConfigCenter | undefined {
    return this._configCenter;
  }

  private _workspaceDir: string | undefined;

  /**
   * Execute a tool call from the model
   */
  async executeToolCall(
    toolCall: ToolCall,
    conversationId: string,
    userId?: string,
    extraContext?: Partial<Pick<ToolContext, 'requestApproval' | 'executionPermissions'>>,
  ): Promise<ToolResult> {
    const startTime = Date.now();
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.arguments);
    } catch {
      const errorContent = `Error: Invalid JSON arguments: ${toolCall.arguments}`;
      logToolResult({
        toolCallId: toolCall.id,
        name: toolCall.name,
        success: false,
        resultPreview: errorContent,
        resultLength: errorContent.length,
        durationMs: Date.now() - startTime,
        error: 'Invalid JSON arguments',
      });
      return {
        toolCallId: toolCall.id,
        content: errorContent,
        isError: true,
      };
    }

    // Validate tool call (existence + fuzzy name match + parameter schema)
    const validation = validateToolCall(this, toolCall.name, args);

    let effectiveName = toolCall.name;

    if (!validation.valid) {
      if (validation.correctedName) {
        // Auto-corrected tool name — re-validate params against corrected tool
        effectiveName = validation.correctedName;
        const revalidation = validateToolCall(this, effectiveName, args);
        if (!revalidation.valid) {
          const errorContent = `Error: Tool '${toolCall.name}' auto-corrected to '${effectiveName}', but parameter errors remain: ${revalidation.errors.map(e => e.message).join('; ')}${revalidation.helpText ?? ''}`;
          logToolResult({
            toolCallId: toolCall.id,
            name: toolCall.name,
            success: false,
            resultPreview: errorContent.substring(0, 500),
            resultLength: errorContent.length,
            durationMs: Date.now() - startTime,
            error: 'Parameter validation failed',
          });
          return { toolCallId: toolCall.id, content: errorContent, isError: true };
        }
      } else {
        // Tool not found or param errors — return helpful error
        const errorContent = `Error: ${validation.errors.map(e => e.message).join('; ')}${validation.helpText ?? ''}`;
        logToolResult({
          toolCallId: toolCall.id,
          name: toolCall.name,
          success: false,
          resultPreview: errorContent.substring(0, 500),
          resultLength: errorContent.length,
          durationMs: Date.now() - startTime,
          error: 'Tool call validation failed',
        });
        return { toolCallId: toolCall.id, content: errorContent, isError: true };
      }
    }

    // Log the tool call with arguments
    logToolCall({
      id: toolCall.id,
      name: effectiveName,
      arguments: args,
      approved: true, // It's already approved if we're here
    });

    const result = await this.execute(effectiveName, args, {
      conversationId,
      userId,
      requestApproval: extraContext?.requestApproval,
      executionPermissions: extraContext?.executionPermissions,
    });

    const durationMs = Date.now() - startTime;

    if (!result.ok) {
      const errorContent = `Error: ${result.error.message}`;
      logToolResult({
        toolCallId: toolCall.id,
        name: toolCall.name,
        success: false,
        resultPreview: errorContent,
        resultLength: errorContent.length,
        durationMs,
        error: result.error.message,
      });
      return {
        toolCallId: toolCall.id,
        content: errorContent,
        isError: true,
      };
    }

    // Convert result content to string (handle undefined/null cases)
    const rawContent = result.value.content;
    const content =
      rawContent === undefined || rawContent === null
        ? ''
        : typeof rawContent === 'string'
          ? rawContent
          : JSON.stringify(rawContent);

    // Log successful tool result
    logToolResult({
      toolCallId: toolCall.id,
      name: toolCall.name,
      success: !result.value.isError,
      resultPreview: content.substring(0, 500),
      resultLength: content.length,
      durationMs,
      error: result.value.isError ? content : undefined,
    });

    return {
      toolCallId: toolCall.id,
      content,
      isError: result.value.isError,
    };
  }

  /**
   * Execute multiple tool calls in parallel
   */
  async executeToolCalls(
    toolCalls: readonly ToolCall[],
    conversationId: string,
    userId?: string
  ): Promise<readonly ToolResult[]> {
    const settled = await Promise.allSettled(
      toolCalls.map((tc) => this.executeToolCall(tc, conversationId, userId))
    );
    return settled.map((outcome, i) => {
      if (outcome.status === 'fulfilled') return outcome.value;
      return {
        toolCallId: toolCalls[i]?.id ?? 'unknown',
        content: `Tool execution failed: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`,
        isError: true,
      };
    });
  }

  /**
   * Get registry statistics
   */
  getStats(): { totalTools: number; pluginTools: number; coreTools: number } {
    let pluginToolCount = 0;
    for (const tool of this.tools.values()) {
      if (tool.pluginId) pluginToolCount++;
    }

    return {
      totalTools: this.tools.size,
      pluginTools: pluginToolCount,
      coreTools: this.tools.size - pluginToolCount,
    };
  }

  // ==========================================================================
  // Provider & Middleware
  // ==========================================================================

  /**
   * Register all tools from a ToolProvider at once.
   * Duplicates are silently skipped (same as register).
   */
  registerProvider(provider: ToolProvider): void {
    for (const { definition, executor } of provider.getTools()) {
      const source = provider.source ?? 'gateway';
      let qName: string;
      if (source === 'plugin' && provider.pluginId) {
        qName = qualifyToolName(definition.name, 'plugin', provider.pluginId);
      } else if (source === 'custom') {
        qName = qualifyToolName(definition.name, 'custom');
      } else {
        // core and gateway sources both get core. prefix
        qName = qualifyToolName(definition.name, 'core');
      }
      this.register({ ...definition, name: qName }, executor, {
        source,
        pluginId: provider.pluginId,
        trustLevel: provider.trustLevel ?? 'trusted',
        providerName: provider.name,
      });
    }
  }

  /**
   * Add a global middleware that runs for every tool execution.
   */
  use(middleware: ToolMiddleware): void {
    this.globalMiddleware.push(middleware);

    // Bridge to hook bus
    const hookBus = getEventSystem().hooks;
    if (middleware.before) {
      const unsub = hookBus.tap('tool:before-execute', async (ctx) => {
        const mwCtx: ToolMiddlewareContext = {
          toolName: ctx.data.toolName,
          args: ctx.data.args,
          conversationId: ctx.data.conversationId,
          userId: ctx.data.userId,
          source: ctx.data.source,
          trustLevel: ctx.data.trustLevel,
          pluginId: ctx.data.pluginId,
        };
        await middleware.before!(mwCtx);
        // Write back any modifications
        ctx.data.args = mwCtx.args;
      });
      this.hookUnsubs.push(unsub);
    }
    if (middleware.after) {
      const unsub = hookBus.tap('tool:after-execute', async (ctx) => {
        const mwCtx: ToolMiddlewareContext = {
          toolName: ctx.data.toolName,
          args: ctx.data.args,
          conversationId: ctx.data.conversationId,
          userId: ctx.data.userId,
          source: ctx.data.source,
          trustLevel: ctx.data.trustLevel,
          pluginId: ctx.data.pluginId,
        };
        ctx.data.result = await middleware.after!(mwCtx, ctx.data.result);
      });
      this.hookUnsubs.push(unsub);
    }
  }

  /**
   * Add a middleware that only runs for a specific tool.
   */
  useFor(toolName: string, middleware: ToolMiddleware): void {
    let list = this.perToolMiddleware.get(toolName);
    if (!list) {
      list = [];
      this.perToolMiddleware.set(toolName, list);
    }
    list.push(middleware);

    // Bridge to hook bus with tool name filter
    const hookBus = getEventSystem().hooks;
    if (middleware.before) {
      const unsub = hookBus.tap('tool:before-execute', async (ctx) => {
        if (ctx.data.toolName !== toolName) return;
        const mwCtx: ToolMiddlewareContext = {
          toolName: ctx.data.toolName,
          args: ctx.data.args,
          conversationId: ctx.data.conversationId,
          userId: ctx.data.userId,
          source: ctx.data.source,
          trustLevel: ctx.data.trustLevel,
          pluginId: ctx.data.pluginId,
        };
        await middleware.before!(mwCtx);
        ctx.data.args = mwCtx.args;
      }, 20); // per-tool runs after global (priority 20 > default 10)
      this.hookUnsubs.push(unsub);
    }
    if (middleware.after) {
      const unsub = hookBus.tap('tool:after-execute', async (ctx) => {
        if (ctx.data.toolName !== toolName) return;
        const mwCtx: ToolMiddlewareContext = {
          toolName: ctx.data.toolName,
          args: ctx.data.args,
          conversationId: ctx.data.conversationId,
          userId: ctx.data.userId,
          source: ctx.data.source,
          trustLevel: ctx.data.trustLevel,
          pluginId: ctx.data.pluginId,
        };
        ctx.data.result = await middleware.after!(mwCtx, ctx.data.result);
      }, 20);
      this.hookUnsubs.push(unsub);
    }
  }

  /**
   * Collect all middleware that applies to a given tool name.
   */
  private getMiddleware(toolName: string): ToolMiddleware[] {
    const perTool = this.perToolMiddleware.get(toolName) ?? [];
    return [...this.globalMiddleware, ...perTool];
  }

  /**
   * Run middleware 'before' hooks. Modifies context.args in-place if middleware changes them.
   */
  private async runBeforeMiddleware(
    middleware: ToolMiddleware[],
    ctx: ToolMiddlewareContext,
  ): Promise<void> {
    for (const mw of middleware) {
      if (mw.before) {
        await mw.before(ctx);
      }
    }
  }

  /**
   * Run middleware 'after' hooks. Returns possibly-transformed result.
   */
  private async runAfterMiddleware(
    middleware: ToolMiddleware[],
    ctx: ToolMiddlewareContext,
    result: ToolExecutionResult,
  ): Promise<ToolExecutionResult> {
    let current = result;
    for (const mw of middleware) {
      if (mw.after) {
        current = await mw.after(ctx, current);
      }
    }
    return current;
  }

  /**
   * Clear all tools
   */
  clear(): void {
    this.tools.clear();
    this.pluginTools.clear();
    this.baseNameIndex.clear();
    this.globalMiddleware.length = 0;
    this.perToolMiddleware.clear();
    // Unsubscribe all hook handlers
    for (const unsub of this.hookUnsubs) {
      unsub();
    }
    this.hookUnsubs.length = 0;
  }
}

/**
 * Create a global tool registry instance
 */
export function createToolRegistry(): ToolRegistry {
  return new ToolRegistry();
}


// Core tool definitions (extracted for maintainability)
export { CORE_TOOLS, CORE_EXECUTORS } from './core-tool-definitions.js';

/**
 * Register core tools in a registry
 */
export function registerCoreTools(registry: ToolRegistry): void {
  for (const tool of CORE_TOOLS) {
    const executor = CORE_EXECUTORS[tool.name];
    if (executor) {
      const qName = qualifyToolName(tool.name, 'core');
      registry.register({ ...tool, name: qName }, executor);
    }
  }
}
