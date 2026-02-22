# OwnPilot Architecture Isolation - Implementation Roadmap

## Overview

This document provides a **step-by-step implementation guide** for the architecture isolation plan. Each phase is designed to be implemented incrementally without breaking existing functionality.

---

## Phase 1: Database Access Control Layer (Week 1-2)

### Goals

- Establish table access control
- Protect system tables from modification
- Enable plugin table management

### Tasks

#### 1.1 Create Database ACL Service Structure

```bash
mkdir -p packages/gateway/src/services/database-acl
touch packages/gateway/src/services/database-acl/index.ts
touch packages/gateway/src/services/database-acl/types.ts
touch packages/gateway/src/services/database-acl/service.ts
touch packages/gateway/src/services/database-acl/middleware.ts
```

#### 1.2 Add Table Metadata Schema

```sql
-- Add to schema.ts
CREATE TABLE IF NOT EXISTS table_metadata (
  table_name TEXT PRIMARY KEY,
  access_level TEXT NOT NULL CHECK(access_level IN ('locked', 'protected', 'user')),
  owner_id TEXT,
  schema_definition JSONB NOT NULL,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 1.3 Implement DatabaseACL Service

- Create `IDatabaseACL` interface
- Implement `DatabaseACLService` class
- Add table metadata repository
- Implement access control methods

#### 1.4 Create Migration Script

- Script to populate `table_metadata` with all existing tables
- Mark all system tables as `locked`
- Run migration on existing databases

#### 1.5 Add Middleware

- Create middleware to intercept all DB queries
- Validate access before execution
- Log access violations

#### 1.6 Testing

- Unit tests for access control logic
- Integration tests with existing repositories
- Test locked table protection

**Deliverables**:

- ✅ `DatabaseACLService` implemented
- ✅ All system tables marked as locked
- ✅ Middleware protecting DB access
- ✅ Tests passing

---

## Phase 2: Tool Registry Service (Week 3-4)

### Goals

- Centralize all tool management
- Unify built-in, custom, and plugin tools
- Enable tool discovery and execution routing

### Tasks

#### 2.1 Create Tool Registry Service Structure

```bash
mkdir -p packages/core/src/services/tool-registry
touch packages/core/src/services/tool-registry/index.ts
touch packages/core/src/services/tool-registry/types.ts
touch packages/core/src/services/tool-registry/service.ts
touch packages/core/src/services/tool-registry/repository.ts
```

#### 2.2 Add Tool Registry Schema

```sql
-- Add to schema.ts
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
);

CREATE INDEX idx_tool_registry_source ON tool_registry(source);
CREATE INDEX idx_tool_registry_category ON tool_registry(category);
CREATE INDEX idx_tool_registry_name ON tool_registry(name);
```

#### 2.3 Implement Tool Registry Service

- Create `IToolRegistry` interface
- Implement `ToolRegistryService` class
- Add tool repository
- Implement registration methods
- Implement discovery methods
- Implement execution routing

#### 2.4 Migrate Built-in Tools

- Create migration script to register all 148+ built-in tools
- Mark built-in tools as `locked`
- Update tool executors to use registry

#### 2.5 Migrate Custom Tools

- Update custom tools table structure
- Migrate existing custom tools to registry
- Update custom tool creation flow

#### 2.6 Update Tool Execution Flow

- Update `ToolExecutor` service to use registry
- Update agent orchestrator to use registry
- Update tool search to use registry

#### 2.7 Testing

- Unit tests for tool registration
- Integration tests with agent execution
- Test tool discovery and search
- Test custom tool creation

**Deliverables**:

- ✅ `ToolRegistryService` implemented
- ✅ All built-in tools registered
- ✅ Custom tools migrated
- ✅ Tool execution using registry
- ✅ Tests passing

---

## Phase 3: Event Bus Enhancement (Week 5-6)

### Goals

- Add event namespaces
- Implement rate limiting
- Add event audit logging
- Improve plugin event isolation

### Tasks

#### 3.1 Enhance Event Bus Types

- Add `EventNamespace` enum
- Add `EventSubscription` interface
- Add rate limiting configuration
- Update `TypedEvent` interface

#### 3.2 Add Event Audit Schema

```sql
-- Add to schema.ts
CREATE TABLE IF NOT EXISTS event_log (
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

#### 3.3 Implement Event Namespaces

- Update `EventBus` class to enforce namespaces
- Add namespace validation
- Update all event emitters to use namespaces

#### 3.4 Implement Rate Limiting

- Add rate limiter per subscriber
- Configure limits per event type
- Add rate limit exceeded events

#### 3.5 Implement Event Audit Logging

- Create event logger service
- Log all events to database (configurable)
- Add event history API

#### 3.6 Update Plugin Event Integration

- Update plugin event emission to use namespaces
- Add plugin event sandboxing
- Update plugin event subscriptions

#### 3.7 Testing

- Unit tests for namespaces
- Unit tests for rate limiting
- Integration tests with plugins
- Test event audit logging

**Deliverables**:

- ✅ Event namespaces implemented
- ✅ Rate limiting active
- ✅ Event audit logging working
- ✅ Plugin events isolated
- ✅ Tests passing

---

## Phase 4: Plugin Service Enhancement (Week 7-8)

### Goals

- Migrate plugin storage to database
- Integrate with Tool Registry
- Integrate with Database ACL
- Improve plugin lifecycle management

### Tasks

#### 4.1 Add Plugin Storage Schema

```sql
-- Add to schema.ts
CREATE TABLE IF NOT EXISTS plugin_storage (
  plugin_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (plugin_id, key)
);

CREATE TABLE IF NOT EXISTS plugin_event_subscriptions (
  id TEXT PRIMARY KEY,
  plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
  event_pattern TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### 4.2 Migrate Plugin Storage

- Implement database-backed `PluginStorage`
- Create migration script for existing file-based storage
- Update `PluginRegistry` to use DB storage

#### 4.3 Integrate with Tool Registry

- Update plugin tool registration to use `ToolRegistryService`
- Update plugin tool unregistration
- Test plugin tool lifecycle

#### 4.4 Integrate with Database ACL

- Update plugin table creation to use `DatabaseACLService`
- Mark plugin tables as `protected`
- Test plugin table access control

#### 4.5 Integrate with Event Bus

- Update plugin event subscriptions to use enhanced Event Bus
- Store subscriptions in database
- Clean up subscriptions on plugin uninstall

#### 4.6 Update Plugin Lifecycle

- Improve plugin enable/disable flow
- Add plugin health checks
- Add plugin crash recovery

#### 4.7 Testing

- Unit tests for plugin storage
- Integration tests with Tool Registry
- Integration tests with Database ACL
- Test plugin lifecycle end-to-end

**Deliverables**:

- ✅ Plugin storage in database
- ✅ Plugin tools use Tool Registry
- ✅ Plugin tables use Database ACL
- ✅ Plugin events use enhanced Event Bus
- ✅ Tests passing

---

## Phase 5: Service Isolation (Week 9-10)

### Goals

- Isolate Trigger Service
- Isolate Plan Service
- Remove direct service dependencies
- All communication via Event Bus

### Tasks

#### 5.1 Isolate Trigger Service

- Create `ITriggerService` interface
- Refactor trigger engine to be standalone
- Remove direct dependencies on other services
- Use Event Bus for communication

#### 5.2 Isolate Plan Service

- Create `IPlanService` interface
- Refactor plan executor to be standalone
- Remove direct dependencies on other services
- Use Event Bus for communication

#### 5.3 Update Service Communication

- Map all service-to-service calls
- Replace with Event Bus events
- Document event contracts

#### 5.4 Create Service Registry

- Implement service discovery mechanism
- Register all services at startup
- Enable service health checks

#### 5.5 Update Dependency Injection

- Create DI container for services
- Inject interfaces, not implementations
- Enable service mocking for tests

#### 5.6 Testing

- Unit tests for each isolated service
- Integration tests via Event Bus
- End-to-end workflow tests
- Performance tests

**Deliverables**:

- ✅ Trigger Service isolated
- ✅ Plan Service isolated
- ✅ All services communicate via Event Bus
- ✅ Service registry implemented
- ✅ Tests passing

---

## Phase 6: Documentation & Migration (Week 11-12)

### Goals

- Complete API documentation
- Create migration guides
- Update developer documentation
- Train team on new architecture

### Tasks

#### 6.1 API Documentation

- Document all service interfaces
- Document event contracts
- Document database schemas
- Create API reference

#### 6.2 Migration Guides

- Guide for migrating existing plugins
- Guide for creating new plugins
- Guide for custom tool migration
- Guide for database access

#### 6.3 Developer Documentation

- Architecture overview
- Service interaction diagrams
- Best practices guide
- Troubleshooting guide

#### 6.4 Code Examples

- Example plugin using new architecture
- Example custom tool creation
- Example event subscription
- Example database access

#### 6.5 Testing Documentation

- Testing strategy overview
- Unit test examples
- Integration test examples
- E2E test examples

#### 6.6 Team Training

- Architecture walkthrough
- Hands-on workshop
- Q&A sessions
- Code review guidelines

**Deliverables**:

- ✅ Complete API documentation
- ✅ Migration guides published
- ✅ Developer docs updated
- ✅ Team trained

---

## Success Criteria

### Technical Metrics

- ✅ All 148+ tools registered in Tool Registry
- ✅ All 47+ system tables marked as locked
- ✅ Zero direct service-to-service dependencies
- ✅ 100% test coverage for new services
- ✅ All plugins migrated to new architecture

### Performance Metrics

- ✅ Tool execution latency < 10ms overhead
- ✅ Event bus throughput > 10,000 events/sec
- ✅ Database ACL validation < 1ms
- ✅ Plugin load time < 500ms

### Quality Metrics

- ✅ Zero breaking changes to existing APIs
- ✅ All tests passing
- ✅ No regressions in functionality
- ✅ Code review approval for all changes

---

## Risk Mitigation

### Risk 1: Breaking Changes

**Mitigation**:

- Maintain backward compatibility layers
- Deprecate old APIs gradually
- Provide migration tools

### Risk 2: Performance Degradation

**Mitigation**:

- Benchmark before and after
- Optimize hot paths
- Add caching where needed

### Risk 3: Data Migration Issues

**Mitigation**:

- Test migrations on copy of production DB
- Create rollback scripts
- Validate data integrity

### Risk 4: Plugin Compatibility

**Mitigation**:

- Test with all existing plugins
- Provide plugin migration guide
- Offer migration assistance

---

## Rollback Plan

### Per-Phase Rollback

Each phase has a rollback script:

1. Restore previous database schema
2. Revert code changes
3. Restore configuration
4. Validate system health

### Emergency Rollback

If critical issues arise:

1. Stop all services
2. Restore from last known good backup
3. Revert to previous release
4. Investigate and fix issues
5. Re-deploy with fixes

---

## Post-Implementation

### Monitoring

- Set up service health dashboards
- Monitor event bus metrics
- Track tool execution metrics
- Alert on access violations

### Optimization

- Profile service performance
- Optimize database queries
- Tune event bus throughput
- Cache frequently accessed data

### Continuous Improvement

- Gather developer feedback
- Identify pain points
- Iterate on architecture
- Plan future enhancements

---

## Timeline Summary

| Phase     | Duration     | Key Deliverables                    |
| --------- | ------------ | ----------------------------------- |
| Phase 1   | 2 weeks      | Database ACL Service                |
| Phase 2   | 2 weeks      | Tool Registry Service               |
| Phase 3   | 2 weeks      | Event Bus Enhancement               |
| Phase 4   | 2 weeks      | Plugin Service Enhancement          |
| Phase 5   | 2 weeks      | Service Isolation                   |
| Phase 6   | 2 weeks      | Documentation & Migration           |
| **Total** | **12 weeks** | **Complete Architecture Isolation** |

---

## Next Steps

1. **Review this roadmap** with the team
2. **Get approval** from stakeholders
3. **Assign owners** for each phase
4. **Set up project tracking** (Jira, GitHub Projects, etc.)
5. **Start Phase 1** implementation

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-XX  
**Author**: OwnPilot Architecture Team
