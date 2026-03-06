/**
 * Autonomy Guard Tests
 *
 * Tests for AGENT-HIGH-002: Autonomy Level Enforcement
 */

import { describe, it, expect } from 'vitest';
import {
  checkAutonomy,
  isActionBlocked,
  getAutonomyLevelDescription,
  formatAutonomySettings,
  type AutonomyGuardContext,
} from './autonomy-guard.js';
import { AutonomyLevel, type ActionCategory } from './types.js';
import type { SoulAutonomy } from '@ownpilot/core';

function createMockAutonomy(overrides: Partial<SoulAutonomy> = {}): SoulAutonomy {
  return {
    level: AutonomyLevel.SUPERVISED,
    allowedActions: ['search_memory', 'read_file'],
    blockedActions: ['delete_data', 'send_email'],
    requiresApproval: ['modify_system', 'execute_code'],
    maxCostPerCycle: 1.0,
    maxCostPerDay: 5.0,
    maxCostPerMonth: 50.0,
    pauseOnConsecutiveErrors: 5,
    pauseOnBudgetExceeded: true,
    notifyUserOnPause: true,
    ...overrides,
  };
}

function createMockContext(overrides: Partial<AutonomyGuardContext> = {}): AutonomyGuardContext {
  return {
    autonomy: createMockAutonomy(),
    agentId: 'agent-test-123',
    agentName: 'Test Agent',
    ...overrides,
  };
}

describe('checkAutonomy', () => {
  describe('Level 0: MANUAL', () => {
    it('requires approval for all actions', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.MANUAL }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'search_memory',
        'Search memory'
      );

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('MANUAL');
    });

    it('even allows blocked actions to be approved (approval will reject)', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.MANUAL }),
      });

      // In MANUAL mode, everything requires approval, including blocked actions
      // (the approval system will handle the block)
      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'delete_data',
        'Delete data'
      );

      expect(result.requiresApproval).toBe(true);
    });
  });

  describe('Level 1: ASSISTED', () => {
    it('allows actions in allowedActions without approval', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.ASSISTED }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'search_memory',
        'Search memory'
      );

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it('blocks actions in blockedActions', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.ASSISTED }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'delete_data',
        'Delete data'
      );

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(false);
      expect(result.notify).toBe(true);
    });

    it('requires approval for actions not in allowedActions', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.ASSISTED }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'unknown_action',
        'Unknown action'
      );

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('ASSISTED');
    });
  });

  describe('Level 2: SUPERVISED', () => {
    it('allows actions in allowedActions without approval', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.SUPERVISED }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'search_memory',
        'Search memory'
      );

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });

    it('blocks actions in blockedActions', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.SUPERVISED }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'delete_data',
        'Delete data'
      );

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(false);
    });

    it('requires approval for actions in requiresApproval list', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.SUPERVISED }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'modify_system',
        'Modify system'
      );

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.reason).toContain('explicit approval');
    });

    it('allows other actions for risk assessment', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.SUPERVISED }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'some_other_action',
        'Some action'
      );

      // Returns neutral - caller should use risk assessment
      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
    });
  });

  describe('Level 3: AUTONOMOUS', () => {
    it('allows actions not in blockedActions', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.AUTONOMOUS }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'search_memory',
        'Search memory'
      );

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
      expect(result.notify).toBe(true);
    });

    it('blocks actions in blockedActions', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.AUTONOMOUS }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'delete_data',
        'Delete data'
      );

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(false);
      expect(result.notify).toBe(true);
      expect(result.severity).toBe('error');
    });

    it('notifies on execution', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.AUTONOMOUS }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'any_action',
        'Any action'
      );

      expect(result.notify).toBe(true);
      expect(result.severity).toBe('info');
    });
  });

  describe('Level 4: FULL', () => {
    it('allows actions not in blockedActions without notification', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.FULL }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'search_memory',
        'Search memory'
      );

      expect(result.allowed).toBe(true);
      expect(result.requiresApproval).toBe(false);
      expect(result.notify).toBe(false);
    });

    it('blocks actions in blockedActions even at FULL level', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.FULL }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'delete_data',
        'Delete data'
      );

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(false);
      expect(result.reason).toContain('even FULL autonomy');
    });

    it('has minimal notifications', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: AutonomyLevel.FULL }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'any_action',
        'Any action'
      );

      expect(result.notify).toBe(false);
    });
  });

  describe('Unknown level fallback', () => {
    it('requires approval for unknown levels', () => {
      const ctx = createMockContext({
        autonomy: createMockAutonomy({ level: 99 as AutonomyLevel }),
      });

      const result = checkAutonomy(
        ctx,
        'tool_execution' as ActionCategory,
        'any_action',
        'Any action'
      );

      expect(result.allowed).toBe(false);
      expect(result.requiresApproval).toBe(true);
      expect(result.notify).toBe(true);
    });
  });
});

describe('isActionBlocked', () => {
  it('blocks actions in blockedActions', () => {
    const autonomy = createMockAutonomy();

    const result = isActionBlocked(autonomy, 'delete_data');

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('blockedActions');
  });

  it('allows actions not in blockedActions', () => {
    const autonomy = createMockAutonomy();

    const result = isActionBlocked(autonomy, 'search_memory');

    expect(result.blocked).toBe(false);
  });

  it('blocks everything at MANUAL level', () => {
    const autonomy = createMockAutonomy({ level: AutonomyLevel.MANUAL });

    const result = isActionBlocked(autonomy, 'search_memory');

    expect(result.blocked).toBe(true);
    expect(result.reason).toContain('MANUAL');
  });

  it('allows actions at other levels if not in blockedActions', () => {
    const autonomy = createMockAutonomy({ level: AutonomyLevel.FULL });

    const result = isActionBlocked(autonomy, 'search_memory');

    expect(result.blocked).toBe(false);
  });
});

describe('getAutonomyLevelDescription', () => {
  it('returns correct descriptions for all levels', () => {
    expect(getAutonomyLevelDescription(AutonomyLevel.MANUAL)).toContain('explicit approval');
    expect(getAutonomyLevelDescription(AutonomyLevel.ASSISTED)).toContain('allowedActions');
    expect(getAutonomyLevelDescription(AutonomyLevel.SUPERVISED)).toContain('Risk-based');
    expect(getAutonomyLevelDescription(AutonomyLevel.AUTONOMOUS)).toContain('Execute freely');
    expect(getAutonomyLevelDescription(AutonomyLevel.FULL)).toContain('minimal notifications');
  });

  it('returns unknown for invalid levels', () => {
    expect(getAutonomyLevelDescription(99 as AutonomyLevel)).toContain('Unknown');
  });
});

describe('formatAutonomySettings', () => {
  it('formats autonomy settings for display', () => {
    const autonomy = createMockAutonomy({
      level: AutonomyLevel.AUTONOMOUS,
      allowedActions: ['action1', 'action2'],
      blockedActions: ['bad_action'],
      requiresApproval: ['critical_action'],
      maxCostPerDay: 10.5,
    });

    const formatted = formatAutonomySettings(autonomy);

    expect(formatted).toContain('Level: 3');
    expect(formatted).toContain('AUTONOMOUS');
    expect(formatted).toContain('Allowed Actions: 2');
    expect(formatted).toContain('Blocked Actions: 1');
    expect(formatted).toContain('Requires Approval: 1');
    expect(formatted).toContain('Daily Budget: $10.5');
  });
});
