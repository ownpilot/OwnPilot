/**
 * Tests for AgenticRouter — plan-step executorKind/capabilityId consistency.
 *
 * Regression coverage for the branch-B defect where step 1 was labeled with
 * the hardcoded claw capability (`claw:single-shot` / `ownpilot:claw`) while
 * its executorKind reflected the real primary kind — dispatching e.g. a
 * direct-LLM step (30s / 0.02 USD constraints) to the full claw runtime.
 */
import { describe, it, expect } from 'vitest';
import { AgenticRouter } from './router.js';
import type { ExecutorKind } from './types.js';

// The router's own kind->capability mapping (branch A execution steps and the
// single-step branch). Kinds without a dedicated capability fall back to claw.
const EXPECTED: Record<ExecutorKind, { capabilityId: string; providerId: string }> = {
  claw: { capabilityId: 'claw:single-shot', providerId: 'ownpilot:claw' },
  direct_llm: { capabilityId: 'direct-llm:chat', providerId: 'ownpilot:llm' },
  soul_heartbeat: { capabilityId: 'soul:heartbeat', providerId: 'ownpilot:claw' },
  coding_agent: { capabilityId: 'coding-agent:claude-code', providerId: 'ownpilot:coding-agent' },
  workflow: { capabilityId: 'workflow:dag', providerId: 'ownpilot:claw' },
  crew: { capabilityId: 'claw:single-shot', providerId: 'ownpilot:claw' },
  sandbox_code: { capabilityId: 'claw:single-shot', providerId: 'ownpilot:claw' },
  tool_catalog: { capabilityId: 'claw:single-shot', providerId: 'ownpilot:claw' },
};

describe('AgenticRouter.plan step capability labeling', () => {
  const router = new AgenticRouter();

  it('labels branch-B step 1 with the capability matching its executorKind', async () => {
    // 'translate' -> direct_llm (0.9); 'post to' -> channel (0.9);
    // no trigger keywords, no code-execution => multi-kind branch (branch B)
    // with direct_llm as the primary kind.
    const { plan } = await router.route({
      name: 'Translate and post',
      description: 'translate this document and post to slack',
    });

    expect(plan.steps.length).toBe(1);
    const step1 = plan.steps[0]!;
    expect(step1.executorKind).toBe('direct_llm');
    expect(step1.capabilityId).toBe(EXPECTED.direct_llm.capabilityId);
    expect(step1.providerId).toBe(EXPECTED.direct_llm.providerId);
  });

  it('labels single-step plans with the capability matching their executorKind', async () => {
    // 'explain' -> direct_llm only; no other kind scores, no trigger => single-step.
    const { plan } = await router.route({
      name: 'Quick explanation',
      description: 'explain how event loops work',
    });

    expect(plan.steps.length).toBe(1);
    const step1 = plan.steps[0]!;
    expect(step1.executorKind).toBe('direct_llm');
    expect(step1.capabilityId).toBe(EXPECTED.direct_llm.capabilityId);
    expect(step1.providerId).toBe(EXPECTED.direct_llm.providerId);
  });

  it('labels trigger-plan execution steps with the capability matching their executorKind', async () => {
    // 'when' => event trigger strategy (branch A); 'translate' => direct_llm,
    // and no soul_heartbeat/trigger-pattern keyword keeps direct_llm primary.
    // The trigger-setup step is intentionally special (capabilityId encodes
    // the trigger type); the EXECUTION step must carry the primary kind's
    // capability.
    const { plan } = await router.route({
      name: 'Conditional translation',
      description: 'translate this document when it changes',
    });

    expect(plan.steps.length).toBe(2);
    const [setup, execution] = plan.steps;
    expect(setup!.executorKind).toBe('trigger');
    expect(execution!.dependsOn).toContain(1);
    expect(execution!.executorKind).toBe('direct_llm');
    expect(execution!.capabilityId).toBe(EXPECTED.direct_llm.capabilityId);
    expect(execution!.providerId).toBe(EXPECTED.direct_llm.providerId);
  });

  it('labels scheduled-trigger execution steps with the capability matching their executorKind', async () => {
    // 'every day' => scheduled trigger (branch A); it also hits the
    // soul_heartbeat pattern (0.85) and the +0.3 hasTrigger boost => 1.15,
    // beating direct_llm (0.9). Regression: the execution step used to be
    // labeled 'direct-llm:chat'/'ownpilot:llm' via the claw-vs-everything
    // ternary, contradicting its soul_heartbeat executorKind.
    const { plan } = await router.route({
      name: 'Daily translation',
      description: 'translate this document every day',
    });

    expect(plan.steps.length).toBe(2);
    const [setup, execution] = plan.steps;
    expect(setup!.executorKind).toBe('trigger');
    expect(execution!.dependsOn).toContain(1);
    expect(execution!.executorKind).toBe('soul_heartbeat');
    expect(execution!.capabilityId).toBe(EXPECTED.soul_heartbeat.capabilityId);
    expect(execution!.providerId).toBe(EXPECTED.soul_heartbeat.providerId);
  });
});
