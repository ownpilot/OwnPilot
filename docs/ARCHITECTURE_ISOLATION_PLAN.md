# OwnPilot Architecture Isolation Plan

## Executive Summary

This document outlines the architectural isolation strategy for OwnPilot's plugin system, tools, database, events, triggers, and plans. The goal is to create **clean service boundaries** that prevent architectural collapse during development.

---

## Current State Analysis

### Problems Identified

1. **Tool System Fragmentation**
   - Tools scattered across 3 locations (core/agent/tools, gateway/services/tool-providers, gateway/tools)
   - No central tool registry
   - Plugin tools mixed with built-in tools
   - Custom tools stored in DB but not properly isolated

2. **Database Isolation Issues**
   - No "locked" table concept for built-in tables
   - Plugin tables use custom_data_tables but lack protection
   - No clear separation between system, user, and plugin data

3. **Event System Coupling**
   - Global singleton EventBus tightly coupled to plugins
   - Plugin events mixed with system events
   - No clear event namespace isolation

4. **Trigger & Plan System**
   - Tightly coupled to Gateway
   - No clear service boundary
   - Event integration is ad-hoc

5. **Plugin System**
   - File-based storage instead of database
   - EventBus dependency creates coupling
   - Tool registration not centralized

---

## Target Architecture

### Service Isolation Principles

1. **Single Responsibility**: Each service owns one domain
2. **Clear Boundaries**: Well-defined interfaces between services
3. **Dependency Inversion**: Services depend on abstractions, not implementations
4. **Event-Driven Communication**: Services communicate via events, not direct calls
5. **Database Isolation**: Each service owns its tables with clear access control

---

## Isolated Service Design

### 1. Tool Registry Service

**Location**: `@ownpilot/core/services/tool-registry`

**Responsibilities**:

- Central registry for ALL tools (built-in, custom, plugin)
- Tool discovery and search
- Tool execution routing
- Tool permission management

**Database Tables**:

```sql
-- System table (locked)
CREATE TABLE tool_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL, -- 'builtin' | 'custom' | 'plugin'
  source_id TEXT, -- plugin_id if source='plugin'
  category TEXT NOT NULL,
  definition JSONB NOT NULL,
  is_enabled BOOLEAN DEFAULT TRUE,
  is_locked BOOLEAN DEFAULT FALSE, -- builtin tools are locked
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User-created custom tools
CREATE TABLE custom_tools (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  code TEXT NOT NULL,
  parameters JSONB,
  requires_approval BOOLEAN DEFAULT TRUE,
  is_enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, name)
);
```

**API**:

```typescript
interface IToolRegistry {
  // Registration
  registerBuiltinTool(definition: ToolDefinition, executor: ToolExecutor): Promise<void>;
  registerCustomTool(userId: string, tool: CustomToolDefinition): Promise<string>;
  registerPluginTool(
    pluginId: string,
    definition: ToolDefinition,
    executor: ToolExecutor
  ): Promise<void>;

  // Discovery
  searchTools(query: string, filters?: ToolFilters): Promise<ToolDefinition[]>;
  getTool(name: string): Promise<ToolInfo | null>;
  listTools(source?: ToolSource): Promise<ToolDefinition[]>;

  // Execution
  executeTool(name: string, args: unknown, context: ToolContext): Promise<ToolExecutionResult>;

  // Management
  enableTool(name: string): Promise<void>;
  disableTool(name: string): Promise<void>;
  unregisterTool(name: string): Promise<void>;
}
```

**Events Emitted**:

- `tool.registered` - When a tool is registered
- `tool.unregistered` - When a tool is removed
- `tool.executed` - After tool execution
- `tool.enabled` - When a tool is enabled
- `tool.disabled` - When a tool is disabled

---

### 2. Database Access Control Service

**Location**: `@ownpilot/gateway/services/database-acl`

**Responsibilities**:

- Table access control (locked, protected, user)
- Plugin database table management
- Query permission validation
- Schema migration for plugin tables

**Table Types**:

```typescript
enum TableAccessLevel {
  LOCKED = 'locked', // System tables, read-only via API
  PROTECTED = 'protected', // Plugin tables, only plugin can write
  USER = 'user', // User custom tables, full access
}

interface TableMetadata {
  name: string;
  accessLevel: TableAccessLevel;
  ownerId?: string; // plugin_id for protected tables
  schema: ColumnDefinition[];
  createdAt: string;
  isSystem: boolean;
}
```

**Database Tables**:

```sql
-- System table (locked)
CREATE TABLE table_metadata (
  table_name TEXT PRIMARY KEY,
  access_level TEXT NOT NULL CHECK(access_level IN ('locked', 'protected', 'user')),
  owner_id TEXT, -- plugin_id for protected tables
  schema_definition JSONB NOT NULL,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Pre-populate with all system tables
INSERT INTO table_metadata (table_name, access_level, is_system) VALUES
  ('conversations', 'locked', TRUE),
  ('messages', 'locked', TRUE),
  ('agents', 'locked', TRUE),
  ('tasks', 'locked', TRUE),
  ('notes', 'locked', TRUE),
  ('bookmarks', 'locked', TRUE),
  ('contacts', 'locked', TRUE),
  ('calendar_events', 'locked', TRUE),
  ('memories', 'locked', TRUE),
  ('goals', 'locked', TRUE),
  ('triggers', 'locked', TRUE),
  ('plans', 'locked', TRUE),
  ('plugins', 'locked', TRUE),
  ('custom_tools', 'locked', TRUE),
  ('channels', 'locked', TRUE),
  ('costs', 'locked', TRUE),
  ('settings', 'locked', TRUE);
```

**API**:

```typescript
interface IDatabaseACL {
  // Table management
  createPluginTable(pluginId: string, tableDef: PluginDatabaseTable): Promise<void>;
  dropPluginTable(pluginId: string, tableName: string): Promise<void>;
  getTableMetadata(tableName: string): Promise<TableMetadata | null>;

  // Access control
  canRead(tableName: string, requesterId: string): Promise<boolean>;
  canWrite(tableName: string, requesterId: string): Promise<boolean>;
  canDelete(tableName: string, requesterId: string): Promise<boolean>;

  // Query validation
  validateQuery(query: string, requesterId: string): Promise<ValidationResult>;
}
```

**Events Emitted**:

- `database.table_created` - When a plugin table is created
- `database.table_dropped` - When a plugin table is dropped
- `database.access_denied` - When access is denied

---

### 3. Event Bus Service (Enhanced)

**Location**: `@ownpilot/core/services/event-bus`

**Enhancements**:

- Event namespace isolation
- Plugin event sandboxing
- Event rate limiting
- Event audit logging

**Event Namespaces**:

```typescript
enum EventNamespace {
  SYSTEM = 'system', // system.* - Core system events
  TOOL = 'tool', // tool.* - Tool lifecycle events
  RESOURCE = 'resource', // resource.* - CRUD events
  PLUGIN = 'plugin', // plugin.* - Plugin lifecycle events
  AGENT = 'agent', // agent.* - Agent execution events
  TRIGGER = 'trigger', // trigger.* - Trigger events
  PLAN = 'plan', // plan.* - Plan execution events
}

interface EventSubscription {
  id: string;
  subscriberId: string; // plugin_id or service_name
  pattern: string;
  handler: EventHandler;
  rateLimit?: number; // events per second
  createdAt: string;
}
```

**API**:

```typescript
interface IEventBus {
  // Publishing
  emit<T>(event: TypedEvent<T>): void;
  emitAsync<T>(event: TypedEvent<T>): Promise<void>;

  // Subscribing
  subscribe<T>(subscriberId: string, pattern: string, handler: EventHandler<T>): string;
  unsubscribe(subscriptionId: string): void;

  // Management
  listSubscriptions(subscriberId?: string): EventSubscription[];
  clearSubscriptions(subscriberId: string): void;

  // Audit
  getEventHistory(filters: EventFilters): Promise<TypedEvent[]>;
}
```

**Database Tables**:

```sql
-- Event audit log (locked)
CREATE TABLE event_log (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  data JSONB,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_event_log_type ON event_log(event_type);
CREATE INDEX idx_event_log_category ON event_log(category);
CREATE INDEX idx_event_log_timestamp ON event_log(timestamp);
```

---

### 4. Plugin Service (Enhanced)

**Location**: `@ownpilot/core/services/plugin-service`

**Enhancements**:

- Database-backed storage (not file-based)
- Centralized tool registration via Tool Registry
- Event subscription via Event Bus
- Database table creation via Database ACL

**Database Tables**:

```sql
-- Plugin registry (locked)
CREATE TABLE plugins (
  id TEXT PRIMARY KEY,
  manifest JSONB NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('installed', 'enabled', 'disabled', 'error')),
  config JSONB NOT NULL DEFAULT '{}',
  installed_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

-- Plugin storage (protected per plugin)
CREATE TABLE plugin_storage (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (plugin_id, key)
);

-- Plugin event subscriptions (locked)
CREATE TABLE plugin_event_subscriptions (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  event_pattern TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**API**:

```typescript
interface IPluginService {
  // Lifecycle
  install(manifest: PluginManifest): Promise<string>;
  uninstall(pluginId: string): Promise<void>;
  enable(pluginId: string): Promise<void>;
  disable(pluginId: string): Promise<void>;

  // Management
  getPlugin(pluginId: string): Promise<Plugin | null>;
  listPlugins(status?: PluginStatus): Promise<Plugin[]>;
  updateConfig(pluginId: string, config: Record<string, unknown>): Promise<void>;

  // Storage (scoped to plugin)
  getStorage(pluginId: string): IPluginStorage;

  // Tools (delegates to Tool Registry)
  registerTool(pluginId: string, definition: ToolDefinition, executor: ToolExecutor): Promise<void>;
  unregisterTools(pluginId: string): Promise<void>;

  // Events (delegates to Event Bus)
  subscribeToEvent(pluginId: string, pattern: string, handler: EventHandler): Promise<string>;
  unsubscribeFromEvents(pluginId: string): Promise<void>;

  // Database (delegates to Database ACL)
  createTable(pluginId: string, tableDef: PluginDatabaseTable): Promise<void>;
  dropTables(pluginId: string): Promise<void>;
}
```

---

### 5. Trigger Service (Isolated)

**Location**: `@ownpilot/gateway/services/trigger-service`

**Responsibilities**:

- Trigger lifecycle management
- Schedule-based execution (cron)
- Event-based execution (listens to Event Bus)
- Condition evaluation
- Webhook handling

**Database Tables** (already exist, mark as locked):

```sql
-- triggers (locked)
-- trigger_history (locked)
```

**API**:

```typescript
interface ITriggerService {
  // CRUD
  createTrigger(trigger: TriggerDefinition): Promise<string>;
  updateTrigger(id: string, updates: Partial<TriggerDefinition>): Promise<void>;
  deleteTrigger(id: string): Promise<void>;
  getTrigger(id: string): Promise<Trigger | null>;
  listTriggers(filters?: TriggerFilters): Promise<Trigger[]>;

  // Execution
  executeTrigger(id: string, context?: unknown): Promise<void>;
  enableTrigger(id: string): Promise<void>;
  disableTrigger(id: string): Promise<void>;

  // History
  getTriggerHistory(id: string, limit?: number): Promise<TriggerExecution[]>;
}
```

**Event Integration**:

- Subscribes to `resource.*` events for event-based triggers
- Emits `trigger.executed`, `trigger.failed` events

---

### 6. Plan Service (Isolated)

**Location**: `@ownpilot/gateway/services/plan-service`

**Responsibilities**:

- Plan lifecycle management
- Multi-step execution
- Checkpoint management
- Rollback on failure

**Database Tables** (already exist, mark as locked):

```sql
-- plans (locked)
-- plan_steps (locked)
-- plan_history (locked)
```

**API**:

```typescript
interface IPlanService {
  // CRUD
  createPlan(plan: PlanDefinition): Promise<string>;
  updatePlan(id: string, updates: Partial<PlanDefinition>): Promise<void>;
  deletePlan(id: string): Promise<void>;
  getPlan(id: string): Promise<Plan | null>;
  listPlans(filters?: PlanFilters): Promise<Plan[]>;

  // Execution
  executePlan(id: string, context?: unknown): Promise<void>;
  pausePlan(id: string): Promise<void>;
  resumePlan(id: string): Promise<void>;
  cancelPlan(id: string): Promise<void>;

  // Checkpoints
  createCheckpoint(planId: string): Promise<string>;
  rollbackToCheckpoint(planId: string, checkpointId: string): Promise<void>;

  // History
  getPlanHistory(id: string, limit?: number): Promise<PlanExecution[]>;
}
```

**Event Integration**:

- Emits `plan.started`, `plan.step_completed`, `plan.completed`, `plan.failed` events
- Can be triggered by Trigger Service

---

## Service Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                        Event Bus                            │
│                   (Central Communication)                    │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ (all services emit/subscribe)
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│   Plugin     │      │     Tool     │      │   Database   │
│   Service    │─────▶│   Registry   │      │     ACL      │
└──────────────┘      └──────────────┘      └──────────────┘
        │                     ▲                     ▲
        │                     │                     │
        └─────────────────────┴─────────────────────┘
                              │
                    (plugins register tools
                     and create tables)
                              │
        ┌─────────────────────┴─────────────────────┐
        │                                           │
        ▼                                           ▼
┌──────────────┐                            ┌──────────────┐
│   Trigger    │                            │     Plan     │
│   Service    │───────────────────────────▶│   Service    │
└──────────────┘     (triggers can          └──────────────┘
                      execute plans)
```

**Key Points**:

- All services communicate via Event Bus (no direct dependencies)
- Plugin Service delegates to Tool Registry and Database ACL
- Trigger Service can execute Plans
- Database ACL protects all table access

---

## Migration Strategy

### Phase 1: Database ACL Service

1. Create `table_metadata` table
2. Implement `DatabaseACL` service
3. Mark all existing tables as `locked`
4. Add middleware to validate all DB queries

### Phase 2: Tool Registry Service

1. Create `tool_registry` table
2. Migrate built-in tools to registry
3. Migrate custom tools to registry
4. Update plugin system to use registry

### Phase 3: Event Bus Enhancement

1. Add event namespaces
2. Add rate limiting
3. Add event audit logging
4. Migrate all event emitters to use namespaces

### Phase 4: Plugin Service Enhancement

1. Migrate plugin storage from files to DB
2. Update plugin registration to use Tool Registry
3. Update plugin database creation to use Database ACL
4. Update plugin events to use Event Bus namespaces

### Phase 5: Service Isolation

1. Isolate Trigger Service
2. Isolate Plan Service
3. Remove direct dependencies between services
4. All communication via Event Bus

---

## Testing Strategy

### Unit Tests

- Each service has comprehensive unit tests
- Mock all dependencies
- Test access control rules

### Integration Tests

- Test service-to-service communication via Event Bus
- Test plugin lifecycle with all services
- Test database access control

### End-to-End Tests

- Test complete workflows (plugin install → tool registration → execution)
- Test trigger → plan execution
- Test event propagation across services

---

## Monitoring & Observability

### Metrics

- Tool execution count/duration per source
- Event emission/subscription counts
- Database query counts per service
- Plugin lifecycle events

### Logging

- Structured logging with service name
- Event audit trail
- Access control violations
- Performance bottlenecks

### Alerts

- Plugin crashes
- Database access violations
- Event bus overload
- Tool execution failures

---

## Security Considerations

### Access Control

- All database access goes through Database ACL
- Plugin tools are sandboxed
- Event subscriptions are rate-limited
- Tool execution requires permissions

### Isolation

- Plugins cannot access other plugins' storage
- Plugins cannot modify system tables
- Plugins cannot unregister other plugins' tools
- Event handlers are isolated per plugin

### Audit

- All tool executions are logged
- All database writes are logged
- All plugin lifecycle events are logged
- All access violations are logged

---

## Performance Considerations

### Caching

- Tool definitions cached in memory
- Table metadata cached in memory
- Plugin manifests cached in memory
- Event subscriptions indexed

### Optimization

- Batch tool registration
- Lazy plugin loading
- Event bus uses async handlers
- Database queries use prepared statements

---

## Future Enhancements

1. **Plugin Marketplace Integration**
   - Remote plugin installation
   - Plugin verification and signing
   - Plugin dependency resolution

2. **Multi-Tenancy**
   - Per-user plugin installations
   - Per-user tool registrations
   - Per-user database isolation

3. **Distributed Event Bus**
   - Redis-backed event bus for horizontal scaling
   - Event replay for debugging
   - Event sourcing for audit

4. **Advanced Access Control**
   - Role-based access control (RBAC)
   - Attribute-based access control (ABAC)
   - Fine-grained permissions per table/column

---

## Conclusion

This architecture provides **clean service boundaries** with:

- ✅ Single responsibility per service
- ✅ Clear interfaces and contracts
- ✅ Event-driven communication
- ✅ Database access control
- ✅ Plugin isolation
- ✅ Comprehensive testing
- ✅ Security and audit

The migration can be done **incrementally** without breaking existing functionality.

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-XX  
**Author**: OwnPilot Architecture Team
