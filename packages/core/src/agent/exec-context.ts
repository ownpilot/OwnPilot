/**
 * Tool Execution AsyncLocalStorage
 *
 * Per-call ambient context that flows through `ToolRegistry.executeToolCall`
 * without needing every callsite to thread the same field as an argument.
 *
 * Today the only ambient field is `workspaceDir`. The motivating case: a
 * shared chat agent (singleton in the gateway's `getOrCreateChatAgent` cache)
 * runs heartbeats for multiple souls. We cannot `setWorkspaceDir` on the
 * registry — that would race across concurrent heartbeats — but each
 * heartbeat invocation can wrap its `agent.chat(...)` call in
 * `runInExecContext({ workspaceDir })` and the file-system tools will see
 * the right root for the duration of the call only.
 *
 * Precedence in `ToolRegistry.executeToolCall`:
 *   explicit context.workspaceDir → registry.setWorkspaceDir → ExecContext → cwd
 *
 * Keep this surface tiny — promote new fields only when they're (1) needed
 * by tools, (2) too fine-grained to live on the registry, and (3) reset
 * between unrelated calls.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface ExecContext {
  /** Absolute path used by file-system tools when neither call-site nor
   *  registry-default workspace is set. */
  readonly workspaceDir?: string;
}

const storage = new AsyncLocalStorage<ExecContext>();

/**
 * Run `fn` inside an exec context. Nested calls fully shadow the outer ctx —
 * we intentionally do NOT merge, so a caller can opt out of an inherited
 * workspace by passing `{}`.
 */
export function runInExecContext<T>(ctx: ExecContext, fn: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(storage.run(ctx, fn));
}

/** Return the active ExecContext, or undefined when not inside one. */
export function getExecContext(): ExecContext | undefined {
  return storage.getStore();
}
