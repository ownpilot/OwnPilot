# OwnPilot Architecture Isolation - Quick Reference

## 📋 Service Overview

| Service | Location | Responsibility | Database Tables | Events Emitted | Events Consumed |
|---------|----------|----------------|-----------------|----------------|-----------------|
| **Database ACL** | `gateway/services/database-acl` | Table access control, plugin table management | `table_metadata` | `database.table_created`<br>`database.table_dropped`<br>`database.access_denied` | None |
| **Tool Registry** | `core/services/tool-registry` | Central tool management, discovery, execution | `tool_registry` | `tool.registered`<br>`tool.unregistered`<br>`tool.executed` | None |
| **Event Bus** | `core/services/event-bus` | Event distribution, subscriptions, audit | `event_log` | All events | All events |
| **Plugin Service** | `core/services/plugin-service` | Plugin lifecycle, integration orchestration | `plugins`<br>`plugin_storage`<br>`plugin_event_subscriptions` | `plugin.installed`<br>`plugin.enabled`<br>`plugin.disabled`<br>`plugin.uninstalled` | None |
| **Trigger Service** | `gateway/services/trigger-service` | Automation triggers, scheduling | `triggers`<br>`trigger_history` | `trigger.executed`<br>`trigger.failed` | `resource.*` (for event triggers) |
| **Plan Service** | `gateway/services/plan-service` | Multi-step execution, checkpoints | `plans`<br>`plan_steps`<br>`plan_history` | `plan.started`<br>`plan.step_completed`<br>`plan.completed`<br>`plan.failed` | `trigger.*` (can be triggered) |

---

## 🗄️ Database Table Classification

### Locked Tables (System - Read-only via API)
```
conversations, messages, agents, settings, request_logs, channels, 
channel_messages, costs, tasks, notes, bookmarks, calendar_events, 
contacts, expenses, memories, goals, goal_steps, triggers, 
trigger_history, plans, plan_steps, plan_history, plugins, 
custom_tools, pomodoro_sessions, pomodoro_settings, habits, 
habit_logs, captures, projects, reminders, oauth_integrations, 
media_provider_settings, user_model_configs, local_providers, 
local_models, config_services, config_service_entries, 
custom_data_tables, custom_data_records, workspaces, file_workspaces,
table_metadata, tool_registry, event_log, plugin_storage, 
plugin_event_subscriptions
```
**Total: 47 tables**

### Protected Tables (Plugin-owned)
- Created dynamically by plugins via `PluginManifest.databaseTables`
- Only owning plugin can write
- Marked in `table_metadata` with `access_level='protected'` and `owner_id=plugin_id`

### User Tables (Custom Data)
- Created by users via Custom Data feature
- Full CRUD access for all users
- Marked in `table_metadata` with `access_level='user'`

---

## 🔧 Tool Classification

| Source | Count | Locked | Registration | Unregistration |
|--------|-------|--------|--------------|----------------|
| **Built-in** | 148+ | ✅ Yes | At startup | Never |
| **Custom** | User-defined | ❌ No | Via API/UI | Via API/UI |
| **Plugin** | Plugin-defined | ❌ No | On plugin enable | On plugin disable |

### Tool Registry Schema
```sql
CREATE TABLE tool_registry (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK(source IN ('builtin', 'custom', 'plugin')),
  source_id TEXT,              -- plugin_id if source='plugin'
  category TEXT NOT NULL,
  definition JSONB NOT NULL,
  is_enabled BOOLEAN DEFAULT TRUE,
  is_locked BOOLEAN DEFAULT FALSE,  -- TRUE for built-in tools
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## 📡 Event Namespaces

| Namespace | Pattern | Description | Examples |
|-----------|---------|-------------|----------|
| **System** | `system.*` | Core system events | `system.startup`, `system.shutdown` |
| **Tool** | `tool.*` | Tool lifecycle events | `tool.registered`, `tool.executed` |
| **Resource** | `resource.*` | CRUD events | `resource.created`, `resource.updated` |
| **Plugin** | `plugin.*` | Plugin lifecycle events | `plugin.enabled`, `plugin.disabled` |
| **Agent** | `agent.*` | Agent execution events | `agent.complete`, `agent.tool_call` |
| **Trigger** | `trigger.*` | Trigger events | `trigger.executed`, `trigger.failed` |
| **Plan** | `plan.*` | Plan execution events | `plan.started`, `plan.completed` |
| **Database** | `database.*` | Database events | `database.table_created`, `database.access_denied` |

---

## 🔐 Access Control Matrix

### Database Access

| Requester Type | Locked Tables | Protected Tables | User Tables |
|----------------|---------------|------------------|-------------|
| **System** | ✅ Read/Write | ✅ Read/Write | ✅ Read/Write |
| **User** | ✅ Read only | ❌ No access | ✅ Read/Write |
| **Plugin** | ✅ Read only | ✅ Read/Write (if owner) | ✅ Read/Write |

### Tool Access

| Requester Type | Built-in Tools | Custom Tools | Plugin Tools |
|----------------|----------------|--------------|--------------|
| **System** | ✅ Execute | ✅ Execute | ✅ Execute |
| **User** | ✅ Execute | ✅ Execute (if enabled) | ✅ Execute (if plugin enabled) |
| **Plugin** | ✅ Execute | ✅ Execute (if enabled) | ✅ Execute (if plugin enabled) |

---

## 🔄 Service Communication Flow

### Plugin Installation Flow
```
User/API
  ↓
Plugin Service
  ├─→ Database ACL (create plugin tables)
  ├─→ Tool Registry (register tools on enable)
  ├─→ Event Bus (subscribe to events on enable)
  └─→ Database (store plugin metadata)
```

### Tool Execution Flow
```
Agent/User
  ↓
Tool Registry
  ├─→ Validate tool exists & enabled
  ├─→ Get executor from cache
  ├─→ Execute tool
  └─→ Event Bus (emit tool.executed)
```

### Trigger Execution Flow
```
Scheduler/Event
  ↓
Trigger Service
  ├─→ Evaluate trigger conditions
  ├─→ Execute action (tool call or plan)
  ├─→ Event Bus (emit trigger.executed)
  └─→ Database (log trigger history)
```

### Database Query Flow
```
Repository/Service
  ↓
Database ACL
  ├─→ Parse query for table names
  ├─→ Check access permissions
  ├─→ Validate or reject
  └─→ Event Bus (emit access_denied if rejected)
```

---

## 🚀 Migration Checklist

### Phase 1: Database ACL (Week 1-2)
- [ ] Create `table_metadata` table
- [ ] Implement `DatabaseACLService`
- [ ] Add middleware to validate queries
- [ ] Mark all 47 system tables as locked
- [ ] Test access control

### Phase 2: Tool Registry (Week 3-4)
- [ ] Create `tool_registry` table
- [ ] Implement `ToolRegistryService`
- [ ] Migrate 148+ built-in tools
- [ ] Update tool execution flow
- [ ] Test tool discovery & execution

### Phase 3: Event Bus Enhancement (Week 5-6)
- [ ] Add event namespaces
- [ ] Implement rate limiting
- [ ] Add `event_log` table
- [ ] Update all event emitters
- [ ] Test event isolation

### Phase 4: Plugin Service Enhancement (Week 7-8)
- [ ] Create `plugin_storage` table
- [ ] Migrate file-based storage to DB
- [ ] Integrate with Tool Registry
- [ ] Integrate with Database ACL
- [ ] Test plugin lifecycle

### Phase 5: Service Isolation (Week 9-10)
- [ ] Isolate Trigger Service
- [ ] Isolate Plan Service
- [ ] Remove direct dependencies
- [ ] All communication via Event Bus
- [ ] Test end-to-end workflows

### Phase 6: Documentation (Week 11-12)
- [ ] Complete API documentation
- [ ] Create migration guides
- [ ] Update developer docs
- [ ] Train team
- [ ] Deploy to production

---

## 📊 Success Metrics

### Technical
- ✅ 148+ tools in Tool Registry
- ✅ 47+ tables marked as locked
- ✅ Zero direct service dependencies
- ✅ 100% test coverage for new services
- ✅ All plugins migrated

### Performance
- ✅ Tool execution overhead < 10ms
- ✅ Event bus throughput > 10,000/sec
- ✅ Database ACL validation < 1ms
- ✅ Plugin load time < 500ms

### Quality
- ✅ Zero breaking changes
- ✅ All tests passing
- ✅ No functionality regressions
- ✅ Code review approved

---

## 🛠️ Quick Commands

### Check Database ACL Status
```typescript
const acl = getDatabaseACL();
const metadata = await acl.getTableMetadata('tasks');
console.log(metadata.accessLevel); // 'locked'
```

### Register a Tool
```typescript
const registry = await getToolRegistry();
await registry.registerBuiltinTool(definition, executor);
```

### Subscribe to Events
```typescript
const eventBus = getEventBus();
eventBus.on('tool.executed', (event) => {
  console.log('Tool executed:', event.data);
});
```

### Create Plugin Table
```typescript
const acl = getDatabaseACL();
await acl.createPluginTable('my-plugin', {
  name: 'my_plugin_data',
  displayName: 'My Plugin Data',
  columns: [
    { name: 'id', type: 'text', required: true },
    { name: 'value', type: 'json', required: true },
  ],
});
```

---

## 📚 Related Documents

- **[ARCHITECTURE_ISOLATION_PLAN.md](./ARCHITECTURE_ISOLATION_PLAN.md)** - Detailed architecture design
- **[IMPLEMENTATION_ROADMAP.md](./IMPLEMENTATION_ROADMAP.md)** - Step-by-step implementation guide
- **[EXAMPLE_IMPLEMENTATIONS.md](./EXAMPLE_IMPLEMENTATIONS.md)** - Code examples

---

## 🎯 Key Principles

1. **Single Responsibility** - Each service owns one domain
2. **Clear Boundaries** - Well-defined interfaces
3. **Dependency Inversion** - Depend on abstractions
4. **Event-Driven** - Communicate via events
5. **Database Isolation** - Access control for all tables
6. **Plugin Sandboxing** - Isolated execution
7. **Backward Compatibility** - No breaking changes

---

**Last Updated**: 2025-01-XX  
**Version**: 1.0  
**Status**: Design Complete, Ready for Implementation
