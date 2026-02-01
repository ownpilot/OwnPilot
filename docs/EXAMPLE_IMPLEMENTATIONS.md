# Example Implementations - Isolated Service Architecture

## Overview

This document provides **concrete code examples** for the isolated service architecture. These examples demonstrate how to implement and use each service.

---

## 1. Database ACL Service

### Interface Definition

```typescript
// packages/gateway/src/services/database-acl/types.ts

export enum TableAccessLevel {
  LOCKED = 'locked',      // System tables, read-only via API
  PROTECTED = 'protected', // Plugin tables, only plugin can write
  USER = 'user',          // User custom tables, full access
}

export interface TableMetadata {
  tableName: string;
  accessLevel: TableAccessLevel;
  ownerId?: string; // plugin_id for protected tables
  schemaDefinition: ColumnDefinition[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: unknown;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  violatedTable?: string;
}

export interface IDatabaseACL {
  // Table management
  createPluginTable(pluginId: string, tableDef: PluginDatabaseTable): Promise<void>;
  dropPluginTable(pluginId: string, tableName: string): Promise<void>;
  getTableMetadata(tableName: string): Promise<TableMetadata | null>;
  listTables(accessLevel?: TableAccessLevel): Promise<TableMetadata[]>;
  
  // Access control
  canRead(tableName: string, requesterId: string, requesterType: 'user' | 'plugin' | 'system'): Promise<boolean>;
  canWrite(tableName: string, requesterId: string, requesterType: 'user' | 'plugin' | 'system'): Promise<boolean>;
  canDelete(tableName: string, requesterId: string, requesterType: 'user' | 'plugin' | 'system'): Promise<boolean>;
  
  // Query validation
  validateQuery(query: string, requesterId: string, requesterType: 'user' | 'plugin' | 'system'): Promise<ValidationResult>;
}
```

### Implementation

```typescript
// packages/gateway/src/services/database-acl/service.ts

import { getEventBus, createEvent, EventTypes } from '@ownpilot/core/events';
import type { IDatabaseACL, TableMetadata, ValidationResult, TableAccessLevel } from './types.js';
import type { PluginDatabaseTable } from '@ownpilot/core/plugins';

export class DatabaseACLService implements IDatabaseACL {
  private tableCache = new Map<string, TableMetadata>();
  private cacheExpiry = 60000; // 1 minute
  private lastCacheUpdate = 0;

  constructor(
    private db: any, // Your database connection
  ) {}

  async initialize(): Promise<void> {
    // Create table_metadata table if not exists
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS table_metadata (
        table_name TEXT PRIMARY KEY,
        access_level TEXT NOT NULL CHECK(access_level IN ('locked', 'protected', 'user')),
        owner_id TEXT,
        schema_definition JSONB NOT NULL,
        is_system BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Populate with system tables if empty
    const count = await this.db.query('SELECT COUNT(*) as count FROM table_metadata');
    if (count[0].count === 0) {
      await this.populateSystemTables();
    }

    // Load cache
    await this.refreshCache();
  }

  private async populateSystemTables(): Promise<void> {
    const systemTables = [
      'conversations', 'messages', 'agents', 'settings', 'request_logs',
      'channels', 'channel_messages', 'costs', 'tasks', 'notes', 'bookmarks',
      'calendar_events', 'contacts', 'expenses', 'memories', 'goals',
      'goal_steps', 'triggers', 'trigger_history', 'plans', 'plan_steps',
      'plan_history', 'plugins', 'custom_tools', 'pomodoro_sessions',
      'pomodoro_settings', 'habits', 'habit_logs', 'captures', 'projects',
      'reminders', 'oauth_integrations', 'media_provider_settings',
      'user_model_configs', 'local_providers', 'local_models',
      'config_services', 'config_service_entries', 'custom_data_tables',
      'custom_data_records', 'workspaces', 'file_workspaces',
    ];

    for (const tableName of systemTables) {
      const schema = await this.getTableSchema(tableName);
      await this.db.execute(
        `INSERT INTO table_metadata (table_name, access_level, schema_definition, is_system)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (table_name) DO NOTHING`,
        [tableName, 'locked', JSON.stringify(schema), true]
      );
    }
  }

  private async getTableSchema(tableName: string): Promise<ColumnDefinition[]> {
    // Query PostgreSQL information_schema to get table structure
    const columns = await this.db.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_name = $1
      ORDER BY ordinal_position
    `, [tableName]);

    return columns.map((col: any) => ({
      name: col.column_name,
      type: col.data_type,
      nullable: col.is_nullable === 'YES',
      defaultValue: col.column_default,
    }));
  }

  private async refreshCache(): Promise<void> {
    const tables = await this.db.query('SELECT * FROM table_metadata');
    this.tableCache.clear();
    for (const table of tables) {
      this.tableCache.set(table.table_name, {
        tableName: table.table_name,
        accessLevel: table.access_level,
        ownerId: table.owner_id,
        schemaDefinition: table.schema_definition,
        isSystem: table.is_system,
        createdAt: table.created_at,
        updatedAt: table.updated_at,
      });
    }
    this.lastCacheUpdate = Date.now();
  }

  async getTableMetadata(tableName: string): Promise<TableMetadata | null> {
    // Refresh cache if expired
    if (Date.now() - this.lastCacheUpdate > this.cacheExpiry) {
      await this.refreshCache();
    }
    return this.tableCache.get(tableName) || null;
  }

  async listTables(accessLevel?: TableAccessLevel): Promise<TableMetadata[]> {
    await this.refreshCache();
    const tables = Array.from(this.tableCache.values());
    if (accessLevel) {
      return tables.filter(t => t.accessLevel === accessLevel);
    }
    return tables;
  }

  async createPluginTable(pluginId: string, tableDef: PluginDatabaseTable): Promise<void> {
    // Check if table already exists
    const existing = await this.getTableMetadata(tableDef.name);
    if (existing) {
      throw new Error(`Table ${tableDef.name} already exists`);
    }

    // Create the table
    const columnDefs = tableDef.columns.map(col => {
      let def = `${col.name} ${this.mapColumnType(col.type)}`;
      if (col.required) def += ' NOT NULL';
      if (col.defaultValue !== undefined) {
        def += ` DEFAULT ${this.formatDefaultValue(col.defaultValue)}`;
      }
      return def;
    }).join(', ');

    await this.db.execute(`CREATE TABLE ${tableDef.name} (${columnDefs})`);

    // Register in metadata
    const schema = await this.getTableSchema(tableDef.name);
    await this.db.execute(
      `INSERT INTO table_metadata (table_name, access_level, owner_id, schema_definition, is_system)
       VALUES ($1, $2, $3, $4, $5)`,
      [tableDef.name, 'protected', pluginId, JSON.stringify(schema), false]
    );

    // Refresh cache
    await this.refreshCache();

    // Emit event
    getEventBus().emit(createEvent(
      'database.table_created',
      'system',
      'database-acl',
      { tableName: tableDef.name, pluginId, schema }
    ));
  }

  async dropPluginTable(pluginId: string, tableName: string): Promise<void> {
    const metadata = await this.getTableMetadata(tableName);
    if (!metadata) {
      throw new Error(`Table ${tableName} does not exist`);
    }

    if (metadata.accessLevel === 'locked') {
      throw new Error(`Cannot drop locked table ${tableName}`);
    }

    if (metadata.accessLevel === 'protected' && metadata.ownerId !== pluginId) {
      throw new Error(`Plugin ${pluginId} does not own table ${tableName}`);
    }

    // Drop the table
    await this.db.execute(`DROP TABLE IF EXISTS ${tableName}`);

    // Remove from metadata
    await this.db.execute('DELETE FROM table_metadata WHERE table_name = $1', [tableName]);

    // Refresh cache
    await this.refreshCache();

    // Emit event
    getEventBus().emit(createEvent(
      'database.table_dropped',
      'system',
      'database-acl',
      { tableName, pluginId }
    ));
  }

  async canRead(tableName: string, requesterId: string, requesterType: 'user' | 'plugin' | 'system'): Promise<boolean> {
    const metadata = await this.getTableMetadata(tableName);
    if (!metadata) return false;

    // System can read everything
    if (requesterType === 'system') return true;

    // Users can read everything except protected tables they don't own
    if (requesterType === 'user') {
      return metadata.accessLevel !== 'protected';
    }

    // Plugins can read their own protected tables and all locked/user tables
    if (requesterType === 'plugin') {
      if (metadata.accessLevel === 'protected') {
        return metadata.ownerId === requesterId;
      }
      return true;
    }

    return false;
  }

  async canWrite(tableName: string, requesterId: string, requesterType: 'user' | 'plugin' | 'system'): Promise<boolean> {
    const metadata = await this.getTableMetadata(tableName);
    if (!metadata) return false;

    // System can write everything
    if (requesterType === 'system') return true;

    // Locked tables cannot be written by anyone except system
    if (metadata.accessLevel === 'locked') {
      // Emit access denied event
      getEventBus().emit(createEvent(
        'database.access_denied',
        'system',
        'database-acl',
        { tableName, requesterId, requesterType, operation: 'write', reason: 'table is locked' }
      ));
      return false;
    }

    // Protected tables can only be written by their owner
    if (metadata.accessLevel === 'protected') {
      const allowed = metadata.ownerId === requesterId;
      if (!allowed) {
        getEventBus().emit(createEvent(
          'database.access_denied',
          'system',
          'database-acl',
          { tableName, requesterId, requesterType, operation: 'write', reason: 'not table owner' }
        ));
      }
      return allowed;
    }

    // User tables can be written by anyone
    return true;
  }

  async canDelete(tableName: string, requesterId: string, requesterType: 'user' | 'plugin' | 'system'): Promise<boolean> {
    // Same logic as canWrite
    return this.canWrite(tableName, requesterId, requesterType);
  }

  async validateQuery(query: string, requesterId: string, requesterType: 'user' | 'plugin' | 'system'): Promise<ValidationResult> {
    // Parse query to extract table names (simplified)
    const tables = this.extractTableNames(query);
    const operation = this.detectOperation(query);

    for (const tableName of tables) {
      let allowed = false;
      if (operation === 'SELECT') {
        allowed = await this.canRead(tableName, requesterId, requesterType);
      } else if (['INSERT', 'UPDATE', 'DELETE'].includes(operation)) {
        allowed = await this.canWrite(tableName, requesterId, requesterType);
      }

      if (!allowed) {
        return {
          allowed: false,
          reason: `${operation} operation not allowed on table ${tableName}`,
          violatedTable: tableName,
        };
      }
    }

    return { allowed: true };
  }

  private extractTableNames(query: string): string[] {
    // Simplified table name extraction (use a proper SQL parser in production)
    const tablePattern = /(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi;
    const matches = [...query.matchAll(tablePattern)];
    return matches.map(m => m[1].toLowerCase());
  }

  private detectOperation(query: string): string {
    const trimmed = query.trim().toUpperCase();
    if (trimmed.startsWith('SELECT')) return 'SELECT';
    if (trimmed.startsWith('INSERT')) return 'INSERT';
    if (trimmed.startsWith('UPDATE')) return 'UPDATE';
    if (trimmed.startsWith('DELETE')) return 'DELETE';
    return 'UNKNOWN';
  }

  private mapColumnType(type: string): string {
    const typeMap: Record<string, string> = {
      'text': 'TEXT',
      'number': 'NUMERIC',
      'boolean': 'BOOLEAN',
      'date': 'DATE',
      'datetime': 'TIMESTAMP',
      'json': 'JSONB',
    };
    return typeMap[type] || 'TEXT';
  }

  private formatDefaultValue(value: unknown): string {
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (value === null) return 'NULL';
    return String(value);
  }
}
```

### Usage Example

```typescript
// In your repository or service
import { getDatabaseACL } from './services/database-acl';

async function updateTask(taskId: string, updates: Partial<Task>) {
  const acl = getDatabaseACL();
  
  // Validate access before query
  const validation = await acl.validateQuery(
    `UPDATE tasks SET title = '${updates.title}' WHERE id = '${taskId}'`,
    'user-123',
    'user'
  );
  
  if (!validation.allowed) {
    throw new Error(`Access denied: ${validation.reason}`);
  }
  
  // Execute query
  await db.execute('UPDATE tasks SET title = $1 WHERE id = $2', [updates.title, taskId]);
}
```

---

## 2. Tool Registry Service

### Interface Definition

```typescript
// packages/core/src/services/tool-registry/types.ts

export type ToolSource = 'builtin' | 'custom' | 'plugin';

export interface ToolInfo {
  id: string;
  name: string;
  source: ToolSource;
  sourceId?: string; // plugin_id if source='plugin'
  category: string;
  definition: ToolDefinition;
  executor: ToolExecutor;
  isEnabled: boolean;
  isLocked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolFilters {
  source?: ToolSource;
  category?: string;
  enabled?: boolean;
  searchQuery?: string;
}

export interface IToolRegistry {
  // Registration
  registerBuiltinTool(definition: ToolDefinition, executor: ToolExecutor): Promise<void>;
  registerCustomTool(userId: string, tool: CustomToolDefinition): Promise<string>;
  registerPluginTool(pluginId: string, definition: ToolDefinition, executor: ToolExecutor): Promise<void>;
  
  // Discovery
  searchTools(query: string, filters?: ToolFilters): Promise<ToolDefinition[]>;
  getTool(name: string): Promise<ToolInfo | null>;
  listTools(filters?: ToolFilters): Promise<ToolInfo[]>;
  
  // Execution
  executeTool(name: string, args: unknown, context: ToolContext): Promise<ToolExecutionResult>;
  
  // Management
  enableTool(name: string): Promise<void>;
  disableTool(name: string): Promise<void>;
  unregisterTool(name: string): Promise<void>;
  unregisterPluginTools(pluginId: string): Promise<void>;
}
```

### Implementation

```typescript
// packages/core/src/services/tool-registry/service.ts

import { getEventBus, createEvent, EventTypes } from '@ownpilot/core/events';
import type { IToolRegistry, ToolInfo, ToolFilters, ToolSource } from './types.js';
import type { ToolDefinition, ToolExecutor, ToolContext, ToolExecutionResult } from '../../agent/types.js';

export class ToolRegistryService implements IToolRegistry {
  private toolCache = new Map<string, ToolInfo>();
  private executorCache = new Map<string, ToolExecutor>();

  constructor(private db: any) {}

  async initialize(): Promise<void> {
    // Create tool_registry table
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS tool_registry (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        source TEXT NOT NULL CHECK(source IN ('builtin', 'custom', 'plugin')),
        source_id TEXT,
        category TEXT NOT NULL,
        definition JSONB NOT NULL,
        is_enabled BOOLEAN DEFAULT TRUE,
        is_locked BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes
    await this.db.execute('CREATE INDEX IF NOT EXISTS idx_tool_registry_source ON tool_registry(source)');
    await this.db.execute('CREATE INDEX IF NOT EXISTS idx_tool_registry_category ON tool_registry(category)');
    
    // Load cache
    await this.refreshCache();
  }

  private async refreshCache(): Promise<void> {
    const tools = await this.db.query('SELECT * FROM tool_registry WHERE is_enabled = TRUE');
    this.toolCache.clear();
    for (const tool of tools) {
      this.toolCache.set(tool.name, {
        id: tool.id,
        name: tool.name,
        source: tool.source,
        sourceId: tool.source_id,
        category: tool.category,
        definition: tool.definition,
        executor: null as any, // Executor loaded separately
        isEnabled: tool.is_enabled,
        isLocked: tool.is_locked,
        createdAt: tool.created_at,
        updatedAt: tool.updated_at,
      });
    }
  }

  async registerBuiltinTool(definition: ToolDefinition, executor: ToolExecutor): Promise<void> {
    const id = `builtin-${definition.name}`;
    
    await this.db.execute(
      `INSERT INTO tool_registry (id, name, source, category, definition, is_enabled, is_locked)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (name) DO UPDATE SET
         definition = EXCLUDED.definition,
         updated_at = NOW()`,
      [id, definition.name, 'builtin', definition.category || 'utilities', JSON.stringify(definition), true, true]
    );

    // Cache executor in memory
    this.executorCache.set(definition.name, executor);
    await this.refreshCache();

    // Emit event
    getEventBus().emit(createEvent(
      EventTypes.TOOL_REGISTERED,
      'tool',
      'tool-registry',
      { name: definition.name, source: 'builtin' }
    ));
  }

  async registerCustomTool(userId: string, tool: CustomToolDefinition): Promise<string> {
    const id = `custom-${userId}-${tool.name}`;
    
    await this.db.execute(
      `INSERT INTO tool_registry (id, name, source, source_id, category, definition, is_enabled, is_locked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, tool.name, 'custom', userId, tool.category || 'custom', JSON.stringify(tool), true, false]
    );

    await this.refreshCache();

    getEventBus().emit(createEvent(
      EventTypes.TOOL_REGISTERED,
      'tool',
      'tool-registry',
      { name: tool.name, source: 'custom', userId }
    ));

    return id;
  }

  async registerPluginTool(pluginId: string, definition: ToolDefinition, executor: ToolExecutor): Promise<void> {
    const id = `plugin-${pluginId}-${definition.name}`;
    
    await this.db.execute(
      `INSERT INTO tool_registry (id, name, source, source_id, category, definition, is_enabled, is_locked)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (name) DO UPDATE SET
         definition = EXCLUDED.definition,
         updated_at = NOW()`,
      [id, definition.name, 'plugin', pluginId, definition.category || 'plugin', JSON.stringify(definition), true, false]
    );

    this.executorCache.set(definition.name, executor);
    await this.refreshCache();

    getEventBus().emit(createEvent(
      EventTypes.TOOL_REGISTERED,
      'tool',
      'tool-registry',
      { name: definition.name, source: 'plugin', pluginId }
    ));
  }

  async searchTools(query: string, filters?: ToolFilters): Promise<ToolDefinition[]> {
    let sql = 'SELECT definition FROM tool_registry WHERE is_enabled = TRUE';
    const params: any[] = [];
    let paramIndex = 1;

    if (filters?.source) {
      sql += ` AND source = $${paramIndex++}`;
      params.push(filters.source);
    }

    if (filters?.category) {
      sql += ` AND category = $${paramIndex++}`;
      params.push(filters.category);
    }

    if (query) {
      sql += ` AND (name ILIKE $${paramIndex} OR definition::text ILIKE $${paramIndex})`;
      params.push(`%${query}%`);
      paramIndex++;
    }

    const results = await this.db.query(sql, params);
    return results.map((r: any) => r.definition);
  }

  async getTool(name: string): Promise<ToolInfo | null> {
    return this.toolCache.get(name) || null;
  }

  async listTools(filters?: ToolFilters): Promise<ToolInfo[]> {
    await this.refreshCache();
    let tools = Array.from(this.toolCache.values());

    if (filters?.source) {
      tools = tools.filter(t => t.source === filters.source);
    }

    if (filters?.category) {
      tools = tools.filter(t => t.category === filters.category);
    }

    if (filters?.enabled !== undefined) {
      tools = tools.filter(t => t.isEnabled === filters.enabled);
    }

    return tools;
  }

  async executeTool(name: string, args: unknown, context: ToolContext): Promise<ToolExecutionResult> {
    const tool = await this.getTool(name);
    if (!tool) {
      throw new Error(`Tool not found: ${name}`);
    }

    if (!tool.isEnabled) {
      throw new Error(`Tool is disabled: ${name}`);
    }

    const executor = this.executorCache.get(name);
    if (!executor) {
      throw new Error(`Tool executor not found: ${name}`);
    }

    const startTime = Date.now();
    let result: ToolExecutionResult;
    let error: string | undefined;

    try {
      result = await executor(args, context);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      result = {
        success: false,
        error,
        output: null,
      };
    }

    const duration = Date.now() - startTime;

    // Emit event
    getEventBus().emit(createEvent(
      EventTypes.TOOL_EXECUTED,
      'tool',
      'tool-registry',
      {
        name,
        duration,
        success: result.success,
        error,
        conversationId: context.conversationId,
      }
    ));

    return result;
  }

  async enableTool(name: string): Promise<void> {
    await this.db.execute(
      'UPDATE tool_registry SET is_enabled = TRUE, updated_at = NOW() WHERE name = $1',
      [name]
    );
    await this.refreshCache();
  }

  async disableTool(name: string): Promise<void> {
    const tool = await this.getTool(name);
    if (tool?.isLocked) {
      throw new Error(`Cannot disable locked tool: ${name}`);
    }

    await this.db.execute(
      'UPDATE tool_registry SET is_enabled = FALSE, updated_at = NOW() WHERE name = $1',
      [name]
    );
    await this.refreshCache();
  }

  async unregisterTool(name: string): Promise<void> {
    const tool = await this.getTool(name);
    if (tool?.isLocked) {
      throw new Error(`Cannot unregister locked tool: ${name}`);
    }

    await this.db.execute('DELETE FROM tool_registry WHERE name = $1', [name]);
    this.executorCache.delete(name);
    await this.refreshCache();

    getEventBus().emit(createEvent(
      EventTypes.TOOL_UNREGISTERED,
      'tool',
      'tool-registry',
      { name }
    ));
  }

  async unregisterPluginTools(pluginId: string): Promise<void> {
    const tools = await this.db.query(
      'SELECT name FROM tool_registry WHERE source = $1 AND source_id = $2',
      ['plugin', pluginId]
    );

    for (const tool of tools) {
      this.executorCache.delete(tool.name);
    }

    await this.db.execute(
      'DELETE FROM tool_registry WHERE source = $1 AND source_id = $2',
      ['plugin', pluginId]
    );

    await this.refreshCache();
  }
}
```

### Usage Example

```typescript
// Register built-in tools at startup
import { getToolRegistry } from './services/tool-registry';
import { allBuiltinTools } from './agent/tools';

async function registerBuiltinTools() {
  const registry = await getToolRegistry();
  
  for (const { definition, executor } of allBuiltinTools) {
    await registry.registerBuiltinTool(definition, executor);
  }
  
  console.log('Registered 148+ built-in tools');
}

// Plugin registers its tools
async function pluginOnLoad(pluginId: string, context: PluginContext) {
  const registry = await getToolRegistry();
  
  await registry.registerPluginTool(pluginId, {
    name: 'weather_current',
    description: 'Get current weather',
    category: 'weather',
    parameters: { /* ... */ },
  }, async (args, ctx) => {
    // Tool implementation
    return { success: true, output: weatherData };
  });
}

// Execute a tool
async function executeToolByName(toolName: string, args: unknown) {
  const registry = await getToolRegistry();
  
  const result = await registry.executeTool(toolName, args, {
    conversationId: 'conv-123',
    userId: 'user-456',
  });
  
  return result;
}
```

---

## 3. Plugin Service with Integrations

### Enhanced Plugin Service

```typescript
// packages/core/src/services/plugin-service/service.ts

import { getEventBus, createEvent } from '@ownpilot/core/events';
import { getToolRegistry } from '../tool-registry';
import { getDatabaseACL } from '../../../gateway/src/services/database-acl';
import type { IPluginService, Plugin, PluginStatus } from './types.js';

export class PluginService implements IPluginService {
  constructor(private db: any) {}

  async install(manifest: PluginManifest): Promise<string> {
    const pluginId = manifest.id;

    // 1. Store plugin in database
    await this.db.execute(
      `INSERT INTO plugins (id, manifest, status, config, installed_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())`,
      [pluginId, JSON.stringify(manifest), 'installed', JSON.stringify(manifest.defaultConfig || {})]
    );

    // 2. Create plugin database tables (via Database ACL)
    if (manifest.databaseTables) {
      const acl = getDatabaseACL();
      for (const tableDef of manifest.databaseTables) {
        await acl.createPluginTable(pluginId, tableDef);
      }
    }

    // 3. Register plugin tools (via Tool Registry)
    // Tools are registered when plugin is enabled

    // 4. Subscribe to events (via Event Bus)
    // Event subscriptions are set up when plugin is enabled

    // 5. Emit event
    getEventBus().emit(createEvent(
      'plugin.installed',
      'plugin',
      'plugin-service',
      { pluginId, manifest }
    ));

    return pluginId;
  }

  async enable(pluginId: string): Promise<void> {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);

    // 1. Update status
    await this.db.execute(
      'UPDATE plugins SET status = $1, updated_at = NOW() WHERE id = $2',
      ['enabled', pluginId]
    );

    // 2. Register tools
    const toolRegistry = await getToolRegistry();
    for (const [name, { definition, executor }] of plugin.tools) {
      await toolRegistry.registerPluginTool(pluginId, definition, executor);
    }

    // 3. Subscribe to events
    for (const pattern of plugin.manifest.eventSubscriptions || []) {
      const subscriptionId = await getEventBus().subscribe(
        pluginId,
        pattern,
        (event) => plugin.eventHandler?.(event)
      );
      
      await this.db.execute(
        'INSERT INTO plugin_event_subscriptions (id, plugin_id, event_pattern) VALUES ($1, $2, $3)',
        [subscriptionId, pluginId, pattern]
      );
    }

    // 4. Call lifecycle hook
    if (plugin.lifecycle.onEnable) {
      await plugin.lifecycle.onEnable();
    }

    // 5. Emit event
    getEventBus().emit(createEvent(
      'plugin.enabled',
      'plugin',
      'plugin-service',
      { pluginId }
    ));
  }

  async disable(pluginId: string): Promise<void> {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);

    // 1. Call lifecycle hook
    if (plugin.lifecycle.onDisable) {
      await plugin.lifecycle.onDisable();
    }

    // 2. Unregister tools
    const toolRegistry = await getToolRegistry();
    await toolRegistry.unregisterPluginTools(pluginId);

    // 3. Unsubscribe from events
    const subscriptions = await this.db.query(
      'SELECT id FROM plugin_event_subscriptions WHERE plugin_id = $1',
      [pluginId]
    );
    for (const sub of subscriptions) {
      getEventBus().unsubscribe(sub.id);
    }
    await this.db.execute('DELETE FROM plugin_event_subscriptions WHERE plugin_id = $1', [pluginId]);

    // 4. Update status
    await this.db.execute(
      'UPDATE plugins SET status = $1, updated_at = NOW() WHERE id = $2',
      ['disabled', pluginId]
    );

    // 5. Emit event
    getEventBus().emit(createEvent(
      'plugin.disabled',
      'plugin',
      'plugin-service',
      { pluginId }
    ));
  }

  async uninstall(pluginId: string): Promise<void> {
    const plugin = await this.getPlugin(pluginId);
    if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);

    // 1. Disable if enabled
    if (plugin.status === 'enabled') {
      await this.disable(pluginId);
    }

    // 2. Drop plugin tables
    const acl = getDatabaseACL();
    const tables = await acl.listTables('protected');
    for (const table of tables) {
      if (table.ownerId === pluginId) {
        await acl.dropPluginTable(pluginId, table.tableName);
      }
    }

    // 3. Delete plugin storage
    await this.db.execute('DELETE FROM plugin_storage WHERE plugin_id = $1', [pluginId]);

    // 4. Delete plugin
    await this.db.execute('DELETE FROM plugins WHERE id = $1', [pluginId]);

    // 5. Emit event
    getEventBus().emit(createEvent(
      'plugin.uninstalled',
      'plugin',
      'plugin-service',
      { pluginId }
    ));
  }

  // ... other methods
}
```

---

## 4. Complete Plugin Example

### Weather Plugin with Full Integration

```typescript
// packages/core/src/plugins/examples/weather-plugin-v2.ts

import { createPlugin } from '../index.js';
import type { PluginContext } from '../index.js';

// Plugin manifest
const manifest = {
  id: 'weather-plugin',
  name: 'Weather Plugin',
  version: '2.0.0',
  description: 'Provides weather information',
  capabilities: ['tools', 'storage', 'scheduled'],
  permissions: ['network', 'storage'],
  category: 'lifestyle',
  
  // Plugin's own settings
  pluginConfigSchema: [
    {
      key: 'updateInterval',
      label: 'Update Interval (minutes)',
      type: 'number',
      defaultValue: 30,
      required: true,
    },
  ],
  
  // External services needed
  requiredServices: [
    {
      name: 'openweathermap',
      displayName: 'OpenWeatherMap',
      description: 'Weather data provider',
      category: 'weather',
      docsUrl: 'https://openweathermap.org/api',
      configSchema: [
        {
          key: 'apiKey',
          label: 'API Key',
          type: 'password',
          required: true,
        },
        {
          key: 'units',
          label: 'Units',
          type: 'select',
          options: [
            { value: 'metric', label: 'Metric (°C)' },
            { value: 'imperial', label: 'Imperial (°F)' },
          ],
          defaultValue: 'metric',
        },
      ],
    },
  ],
  
  // Database tables
  databaseTables: [
    {
      name: 'weather_cache',
      displayName: 'Weather Cache',
      description: 'Cached weather data',
      columns: [
        { name: 'id', type: 'text', required: true },
        { name: 'location', type: 'text', required: true },
        { name: 'data', type: 'json', required: true },
        { name: 'cached_at', type: 'datetime', required: true },
      ],
    },
  ],
};

// Plugin implementation
export const weatherPlugin = createPlugin()
  .meta(manifest)
  
  // Lifecycle hooks
  .onLoad(async (context: PluginContext) => {
    context.log.info('Weather plugin loading...');
    
    // Initialize cache
    const cacheExists = await context.storage.get('cache_initialized');
    if (!cacheExists) {
      await context.storage.set('cache_initialized', true);
      context.log.info('Cache initialized');
    }
  })
  
  .onEnable(async (context: PluginContext) => {
    context.log.info('Weather plugin enabled');
    
    // Subscribe to location change events
    context.events.on('user.location_changed', async (data: any) => {
      context.log.info('Location changed, updating weather', data);
      // Fetch new weather data
    });
  })
  
  .onDisable(async (context: PluginContext) => {
    context.log.info('Weather plugin disabled');
  })
  
  // Tools
  .tool(
    {
      name: 'get_current_weather',
      description: 'Get current weather for a location',
      category: 'weather',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'City name or coordinates',
          },
        },
        required: ['location'],
      },
    },
    async (args: any, context: any) => {
      // Check cache first
      const cached = await context.storage.get(`weather:${args.location}`);
      if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
        return { success: true, output: cached.data };
      }
      
      // Fetch from API
      const apiKey = await context.getServiceConfig('openweathermap', 'apiKey');
      const units = await context.getServiceConfig('openweathermap', 'units');
      
      const response = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${args.location}&appid=${apiKey}&units=${units}`
      );
      
      const data = await response.json();
      
      // Cache result
      await context.storage.set(`weather:${args.location}`, {
        data,
        timestamp: Date.now(),
      });
      
      return {
        success: true,
        output: {
          location: data.name,
          temperature: data.main.temp,
          description: data.weather[0].description,
          humidity: data.main.humidity,
          windSpeed: data.wind.speed,
        },
      };
    }
  )
  
  .build();
```

---

## Summary

This architecture provides:

✅ **Clean Separation**: Each service has a single responsibility  
✅ **Clear Interfaces**: Well-defined contracts between services  
✅ **Event-Driven**: Services communicate via Event Bus  
✅ **Access Control**: Database ACL protects all data  
✅ **Centralized Tools**: Tool Registry manages all tools  
✅ **Plugin Isolation**: Plugins are sandboxed and controlled  

The migration can be done **incrementally** without breaking existing functionality!
