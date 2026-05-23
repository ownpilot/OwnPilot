/**
 * Heartbeat Execution Context
 *
 * AsyncLocalStorage-based ambient context that carries the current soul agent's
 * identity through heartbeat tool executions. This allows communication tools
 * (read_agent_inbox, send_agent_message, crew tools) to know which soul agent
 * is executing without requiring interface changes.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface HeartbeatExecutionContext {
  agentId: string;
  crewId?: string;
}

const storage = new AsyncLocalStorage<HeartbeatExecutionContext>();

/**
 * Run `fn` inside a heartbeat execution context.
 * Any call to `getHeartbeatContext()` within `fn` (or its callees) will
 * return the provided context object.
 */
export function runInHeartbeatContext<T>(
  ctx: HeartbeatExecutionContext,
  fn: () => Promise<T>
): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Returns the current heartbeat execution context, or undefined if called
 * outside a heartbeat execution.
 */
export function getHeartbeatContext(): HeartbeatExecutionContext | undefined {
  return storage.getStore();
}
