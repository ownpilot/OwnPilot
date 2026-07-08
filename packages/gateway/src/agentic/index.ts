/**
 * Agentic Gateway Integration — Barrel Export
 *
 * Wires the core Agentic Capability Layer to gateway services.
 *
 * Usage:
 *   import { getAgenticExecutor, createGatewayOrchestrator } from './agentic/index.js';
 *
 *   // Create orchestrator with real gateway dispatch
 *   const orchestrator = createGatewayOrchestrator();
 *   const report = await orchestrator.execute({
 *     name: 'Research task',
 *     description: 'Research topic X...',
 *   });
 */

export {
  AgenticGatewayExecutor,
  getAgenticExecutor,
  resetAgenticExecutor,
} from './agentic-executor.js';
export type { DispatchResult } from './agentic-executor.js';

import { AgenticOrchestrator } from '@ownpilot/core/agentic';
import { getAgenticExecutor } from './agentic-executor.js';
import type { StepDispatchFn } from '@ownpilot/core/agentic';
import type { ExecutionStep } from '@ownpilot/core/agentic';

/**
 * Create an AgenticOrchestrator pre-wired with the gateway's real executor.
 * This is the main entry point for running agentic tasks from the gateway.
 */
export function createGatewayOrchestrator(): AgenticOrchestrator {
  const handler: StepDispatchFn = async (step: ExecutionStep, signal?: AbortSignal) => {
    const result = await getAgenticExecutor().dispatch(step, signal);
    return {
      success: result.success,
      output: result.output,
      error: result.error,
      costUsd: result.costUsd,
    };
  };

  return new AgenticOrchestrator(undefined, handler);
}
