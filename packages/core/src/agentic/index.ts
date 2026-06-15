/**
 * Agentic Capability Layer — Barrel Export
 *
 * A unified orchestration layer that sits on top of claws, souls, crews,
 * coding agents, workflows, triggers, and channels — exposing all OwnPilot
 * agent capabilities through a single substrate for maximum autonomous agency.
 *
 * Architecture:
 *
 *   CapabilityRegistry ← agents register what they can do
 *         ↓
 *   AgenticRouter ← analyzes tasks, routes to optimal executor
 *         ↓
 *   OrchestrationComposer ← composes multi-agent pipelines
 *         ↓
 *   AgenticOrchestrator ← executes plans, produces reports
 *         ↓
 *   AgenticReport ← full observability of execution
 *
 * Usage:
 *   import { getCapabilityRegistry, AgenticRouter, AgenticOrchestrator } from '@ownpilot/core/agentic';
 *
 *   const registry = getCapabilityRegistry();
 *   const router = new AgenticRouter();
 *   const orchestrator = new AgenticOrchestrator();
 *
 *   const report = await orchestrator.execute({
 *     name: 'Research quantum computing',
 *     description: 'Research the latest advances in quantum computing...',
 *   });
 */

// ── Core Types ──
export type {
  // Executor system
  ExecutorKind,
  CapabilityEntry,
  CapabilityQuery,
  CapabilityLookupResult,

  // Task & Plan
  AgenticTask,
  TaskPriority,
  TaskTriggerStrategy,
  TaskOutputRouting,
  ExecutionPlan,
  ExecutionStep,

  // Results
  StepStatus,
  StepResult,
  ExecutionStatus,
  AgenticReport,

  // Interfaces
  ICapabilityRegistry,
  IAgenticRouter,
  IAgenticOrchestrator,

  // Router internals
  TaskAnalysis,
} from './types.js';

// ── Capability Registry ──
export {
  CapabilityRegistry,
  getCapabilityRegistry,
  setCapabilityRegistry,
  resetCapabilityRegistry,
  getBuiltInCapabilities,
} from './capability-registry.js';

// ── Task Router ──
export {
  AgenticRouter,
} from './router.js';

// ── Orchestration Composer ──
export {
  AgenticOrchestrator,
  optimizePlan,
  createResearchPipeline,
  createMonitoringPipeline,
  createCodePipeline,
} from './composer.js';

export type { OptimizationSuggestion, StepDispatchFn } from './composer.js';
