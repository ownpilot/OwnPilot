/**
 * Claw Execution Context
 *
 * AsyncLocalStorage-based ambient context that carries the current claw's
 * identity through tool executions. This allows claw tools (spawn_subclaw,
 * run_script, etc.) to know which claw is executing without interface changes.
 *
 * Modeled after heartbeat-context.ts.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClawSandboxMode } from '@ownpilot/core';

export interface ClawExecutionContext {
  clawId: string;
  userId: string;
  workspaceId?: string;
  depth: number;
  /**
   * Sandbox preference inherited from the claw config. Tools like
   * `claw_run_script` honor this when deciding between Docker and local
   * execution. Defaults to `'auto'` if the runner did not supply one.
   */
  sandbox?: ClawSandboxMode;
}

const storage = new AsyncLocalStorage<ClawExecutionContext>();

/**
 * Run `fn` inside a claw execution context.
 * Any call to `getClawContext()` within `fn` (or its callees) will
 * return the provided context object.
 */
export function runInClawContext<T>(ctx: ClawExecutionContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/**
 * Returns the current claw execution context, or undefined if called
 * outside a claw execution.
 */
export function getClawContext(): ClawExecutionContext | undefined {
  return storage.getStore();
}
