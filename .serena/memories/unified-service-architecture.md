# Unified Service Architecture

## ServiceRegistry
All services are accessed via a typed ServiceRegistry (`packages/core/src/services/registry.ts`).

```typescript
import { getServiceRegistry, Services } from '@ownpilot/core';
const registry = getServiceRegistry();
const log = registry.get(Services.Log);        // ILogService
const events = registry.get(Services.Event);    // IEventSystem
const session = registry.get(Services.Session); // ISessionService
const message = registry.get(Services.Message); // IMessageBus
const tool = registry.get(Services.Tool);       // IToolService
const channel = registry.get(Services.Channel); // IChannelService
const provider = registry.get(Services.Provider); // IProviderService
const audit = registry.get(Services.Audit);     // IAuditService
const config = registry.get(Services.Config);   // ConfigCenter
```

## Service Token Locations (interfaces)
- `core/src/services/registry.ts` — ServiceToken, ServiceRegistry, singleton functions
- `core/src/services/tokens.ts` — All Services tokens
- `core/src/services/log-service.ts` — ILogService
- `core/src/services/session-service.ts` — ISessionService, Session, SessionSource
- `core/src/services/message-bus.ts` — IMessageBus, MessageMiddleware, PipelineContext
- `core/src/services/message-types.ts` — NormalizedMessage, MessageMetadata
- `core/src/services/tool-service.ts` — IToolService
- `core/src/services/provider-service.ts` — IProviderService
- `core/src/services/audit-service.ts` — IAuditService

## Gateway Implementations
- `gateway/src/services/log-service-impl.ts` — LogService (createLogService)
- `gateway/src/services/session-service-impl.ts` — SessionService (createSessionService)
- `gateway/src/services/message-bus-impl.ts` — MessageBus (createMessageBus)
- `gateway/src/services/tool-service-impl.ts` — ToolService (createToolService)
- `gateway/src/services/provider-service-impl.ts` — ProviderService (createProviderService)

## Server.ts Registration Order
1. LogService (Services.Log)
2. EventSystem (Services.Event) — wraps existing singleton
3. SessionService (Services.Session)
4. MessageBus (Services.Message)
5. ConfigCenter (Services.Config) — wraps existing gatewayConfigCenter
6. ChannelService (Services.Channel) — wraps existing channelService
7. ToolService (Services.Tool) — wraps existing ToolRegistry
8. ProviderService (Services.Provider) — wraps existing settings functions

## Tests
- `core/src/services/registry.test.ts` — 22 tests for ServiceRegistry
- `gateway/src/services/session-service-impl.test.ts` — 22 tests for SessionService
- `gateway/src/services/message-bus-impl.test.ts` — 12 tests for MessageBus

## Audit Integration
- `packages/gateway/src/middleware/audit.ts` — Hono middleware logging every API request via AuditService
- `executeTool()` in `tool-executor.ts` — logs tool calls (name, success, duration) via AuditService
- Both use fire-and-forget pattern; skip if ServiceRegistry not initialized

## Backward Compatibility
Existing singletons (getEventSystem, getChannelService, getSharedToolRegistry) still work.
The registry holds the same instances. Both access paths lead to the same objects.