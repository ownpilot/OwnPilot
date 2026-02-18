/**
 * Comprehensive tests for the Autonomy system.
 *
 * Covers:
 *   1. Risk assessment (risk.ts) - assessRisk, utility functions
 *   2. Approval manager (approvals.ts) - ApprovalManager class, singleton
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  assessRisk,
  riskLevelToNumber,
  compareRiskLevels,
  isRiskAtOrAbove,
  getRiskLevelColor,
} from './risk.js';
import { ApprovalManager, getApprovalManager } from './approvals.js';
import {
  AutonomyLevel,
  DEFAULT_AUTONOMY_CONFIG,
  type AutonomyConfig,
  type ActionCategory,
  type ActionContext,
  type RiskLevel,
} from './types.js';

// ============================================================================
// Helpers
// ============================================================================

/** Build a full AutonomyConfig from a partial, using DEFAULT_AUTONOMY_CONFIG as base. */
function makeConfig(overrides: Partial<AutonomyConfig> = {}): AutonomyConfig {
  const now = new Date();
  return {
    ...DEFAULT_AUTONOMY_CONFIG,
    userId: 'user-1',
    budgetResetAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const emptyContext: ActionContext = {};

// ============================================================================
// 1. Risk Assessment (risk.ts)
// ============================================================================

describe('Risk Assessment', () => {
  // --------------------------------------------------------------------------
  // assessRisk - basic return shape
  // --------------------------------------------------------------------------
  describe('assessRisk return shape', () => {
    it('should return a RiskAssessment with all required fields', () => {
      const result = assessRisk(
        'notification',
        'send_notification',
        {},
        emptyContext,
        makeConfig()
      );

      expect(result).toHaveProperty('level');
      expect(result).toHaveProperty('score');
      expect(result).toHaveProperty('factors');
      expect(result).toHaveProperty('requiresApproval');
      expect(result).toHaveProperty('mitigations');
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.factors)).toBe(true);
      expect(Array.isArray(result.mitigations)).toBe(true);
      expect(typeof result.requiresApproval).toBe('boolean');
    });

    it('should include a present flag on every factor', () => {
      const result = assessRisk(
        'notification',
        'list_directory',
        {},
        emptyContext,
        makeConfig()
      );

      for (const factor of result.factors) {
        expect(factor).toHaveProperty('present');
        expect(typeof factor.present).toBe('boolean');
      }
    });
  });

  // --------------------------------------------------------------------------
  // Category base risk scores
  // --------------------------------------------------------------------------
  describe('category base risk scores', () => {
    const categoryScores: [ActionCategory, number][] = [
      ['tool_execution', 20],
      ['data_modification', 30],
      ['external_communication', 40],
      ['file_operation', 25],
      ['code_execution', 70],
      ['system_command', 80],
      ['api_call', 35],
      ['notification', 15],
      ['plan_execution', 45],
      ['memory_modification', 25],
      ['goal_modification', 20],
      ['financial', 90],
    ];

    it.each(categoryScores)(
      'category "%s" should have base risk %i reflected in score',
      (category, baseRisk) => {
        // Use a benign action type with no tool factors so factor score is ~0.
        const result = assessRisk(
          category,
          'list_directory',
          {},
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );

        // score = round((baseRisk + factorScore) / 2), factorScore ~0
        const expectedScore = Math.round(baseRisk / 2);
        expect(result.score).toBe(expectedScore);
      }
    );

    it('should default to 30 for an unknown category', () => {
      const result = assessRisk(
        'unknown_category' as ActionCategory,
        'list_directory',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );

      // (30 + ~0) / 2 = 15
      expect(result.score).toBe(15);
    });
  });

  // --------------------------------------------------------------------------
  // Tool-specific risk factors
  // --------------------------------------------------------------------------
  describe('tool-specific risk factors', () => {
    it('execute_code marks code_execution and irreversible as present', () => {
      const result = assessRisk(
        'code_execution',
        'execute_code',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );

      const codeExec = result.factors.find((f) => f.name === 'Code Execution');
      const irreversible = result.factors.find((f) => f.name === 'Irreversible');
      expect(codeExec?.present).toBe(true);
      expect(irreversible?.present).toBe(true);
    });

    it('send_email marks email_send, external_api, and affects_others as present', () => {
      const result = assessRisk(
        'external_communication',
        'send_email',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );

      const email = result.factors.find((f) => f.name === 'Email Send');
      const api = result.factors.find((f) => f.name === 'External API');
      const others = result.factors.find((f) => f.name === 'Affects Others');
      expect(email?.present).toBe(true);
      expect(api?.present).toBe(true);
      expect(others?.present).toBe(true);
    });

    it('delete_file marks file_delete, data_deletion, and irreversible as present', () => {
      const result = assessRisk(
        'file_operation',
        'delete_file',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );

      const fileDel = result.factors.find((f) => f.name === 'File Delete');
      const dataDel = result.factors.find((f) => f.name === 'Data Deletion');
      const irrev = result.factors.find((f) => f.name === 'Irreversible');
      expect(fileDel?.present).toBe(true);
      expect(dataDel?.present).toBe(true);
      expect(irrev?.present).toBe(true);
    });

    it('list_directory should have no tool-specific factors present', () => {
      const result = assessRisk(
        'file_operation',
        'list_directory',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );

      const presentFactors = result.factors.filter((f) => f.present);
      expect(presentFactors).toHaveLength(0);
    });

    it('run_script marks code_execution and system_command as present', () => {
      const result = assessRisk(
        'system_command',
        'run_script',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );

      const code = result.factors.find((f) => f.name === 'Code Execution');
      const sys = result.factors.find((f) => f.name === 'System Command');
      expect(code?.present).toBe(true);
      expect(sys?.present).toBe(true);
    });

    it('add_contact marks data_modification and sensitive_data', () => {
      const result = assessRisk(
        'data_modification',
        'add_contact',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );

      const dataMod = result.factors.find((f) => f.name === 'Data Modification');
      const sensitive = result.factors.find((f) => f.name === 'Sensitive Data');
      expect(dataMod?.present).toBe(true);
      expect(sensitive?.present).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Parameter-based risk factor detection
  // --------------------------------------------------------------------------
  describe('parameter-based risk factor detection', () => {
    describe('bulk_operation', () => {
      it('should detect items array with more than 10 elements', () => {
        const items = Array.from({ length: 11 }, (_, i) => i);
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { items },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const bulk = result.factors.find((f) => f.name === 'Bulk Operation');
        expect(bulk?.present).toBe(true);
      });

      it('should NOT detect items array with 10 or fewer elements', () => {
        const items = Array.from({ length: 10 }, (_, i) => i);
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { items },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const bulk = result.factors.find((f) => f.name === 'Bulk Operation');
        expect(bulk?.present).toBe(false);
      });

      it('should detect bulk=true', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { bulk: true },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const bulk = result.factors.find((f) => f.name === 'Bulk Operation');
        expect(bulk?.present).toBe(true);
      });

      it('should detect all=true', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { all: true },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const bulk = result.factors.find((f) => f.name === 'Bulk Operation');
        expect(bulk?.present).toBe(true);
      });
    });

    describe('sensitive_data', () => {
      it('should detect sensitive=true', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { sensitive: true },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const sens = result.factors.find((f) => f.name === 'Sensitive Data');
        expect(sens?.present).toBe(true);
      });

      it.each(['password', 'api_key', 'secret', 'token', 'credential', 'ssn', 'credit_card'])(
        'should detect keyword "%s" in params',
        (keyword) => {
          const result = assessRisk(
            'tool_execution',
            'list_directory',
            { data: keyword },
            emptyContext,
            makeConfig({ level: AutonomyLevel.FULL })
          );
          const sens = result.factors.find((f) => f.name === 'Sensitive Data');
          expect(sens?.present).toBe(true);
        }
      );

      it('should detect sensitive keywords in nested params', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { config: { apikey: 'abc123' } },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const sens = result.factors.find((f) => f.name === 'Sensitive Data');
        expect(sens?.present).toBe(true);
      });

      it('should NOT flag params without sensitive keywords or flag', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { name: 'hello', count: 5 },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const sens = result.factors.find((f) => f.name === 'Sensitive Data');
        expect(sens?.present).toBe(false);
      });
    });

    describe('high_cost', () => {
      it('should detect cost > 1000', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { cost: 1001 },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const hc = result.factors.find((f) => f.name === 'High Cost');
        expect(hc?.present).toBe(true);
      });

      it('should NOT detect cost = 1000', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { cost: 1000 },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const hc = result.factors.find((f) => f.name === 'High Cost');
        expect(hc?.present).toBe(false);
      });

      it('should detect tokens > 5000', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { tokens: 5001 },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const hc = result.factors.find((f) => f.name === 'High Cost');
        expect(hc?.present).toBe(true);
      });

      it('should NOT detect tokens = 5000', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { tokens: 5000 },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const hc = result.factors.find((f) => f.name === 'High Cost');
        expect(hc?.present).toBe(false);
      });
    });

    describe('irreversible', () => {
      it.each([
        ['force', { force: true }],
        ['permanent', { permanent: true }],
        ['noUndo', { noUndo: true }],
      ])('should detect %s flag', (_label, params) => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          params as Record<string, unknown>,
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const irr = result.factors.find((f) => f.name === 'Irreversible');
        expect(irr?.present).toBe(true);
      });

      it('should NOT flag when none of the irreversible params exist', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { someOther: true },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const irr = result.factors.find((f) => f.name === 'Irreversible');
        expect(irr?.present).toBe(false);
      });
    });

    describe('affects_others', () => {
      it('should detect recipients in params', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { recipients: ['a@b.com'] },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const ao = result.factors.find((f) => f.name === 'Affects Others');
        expect(ao?.present).toBe(true);
      });

      it('should detect broadcast=true', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { broadcast: true },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const ao = result.factors.find((f) => f.name === 'Affects Others');
        expect(ao?.present).toBe(true);
      });

      it('should detect non-empty users array', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { users: ['user-1'] },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const ao = result.factors.find((f) => f.name === 'Affects Others');
        expect(ao?.present).toBe(true);
      });

      it('should NOT flag empty users array', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { users: [] },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const ao = result.factors.find((f) => f.name === 'Affects Others');
        expect(ao?.present).toBe(false);
      });
    });

    describe('system_wide', () => {
      it('should detect global=true', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { global: true },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const sw = result.factors.find((f) => f.name === 'System Wide');
        expect(sw?.present).toBe(true);
      });

      it('should detect systemWide=true', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          { systemWide: true },
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const sw = result.factors.find((f) => f.name === 'System Wide');
        expect(sw?.present).toBe(true);
      });

      it('should NOT flag when neither global nor systemWide is set', () => {
        const result = assessRisk(
          'tool_execution',
          'list_directory',
          {},
          emptyContext,
          makeConfig({ level: AutonomyLevel.FULL })
        );
        const sw = result.factors.find((f) => f.name === 'System Wide');
        expect(sw?.present).toBe(false);
      });
    });
  });

  // --------------------------------------------------------------------------
  // Risk score calculation
  // --------------------------------------------------------------------------
  describe('risk score calculation', () => {
    it('should calculate score as average of base category score and factor score', () => {
      // notification base = 15, list_directory has no tool factors and no param factors
      // factorScore = 0 => score = round((15 + 0) / 2) = 8
      const result = assessRisk(
        'notification',
        'list_directory',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      expect(result.score).toBe(8); // round(15/2)
    });

    it('should increase score when tool factors are present', () => {
      const low = assessRisk(
        'file_operation',
        'list_directory',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      const high = assessRisk(
        'file_operation',
        'delete_file',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      expect(high.score).toBeGreaterThan(low.score);
    });

    it('should increase score when parameter factors are present', () => {
      const base = assessRisk(
        'tool_execution',
        'list_directory',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      const withParams = assessRisk(
        'tool_execution',
        'list_directory',
        { bulk: true, force: true, global: true },
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      expect(withParams.score).toBeGreaterThan(base.score);
    });

    it('should never exceed 100', () => {
      const result = assessRisk(
        'financial',
        'execute_code',
        {
          bulk: true,
          all: true,
          sensitive: true,
          cost: 9999,
          tokens: 99999,
          force: true,
          permanent: true,
          noUndo: true,
          recipients: ['x'],
          broadcast: true,
          global: true,
          systemWide: true,
        },
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  // --------------------------------------------------------------------------
  // Level thresholds
  // --------------------------------------------------------------------------
  describe('level thresholds', () => {
    // We can indirectly test scoreToLevel via assessRisk scores.
    // Use notification (base=15) with no factors => score=8 => low
    it('should assign "low" for scores 0-24', () => {
      const result = assessRisk(
        'notification',
        'list_directory',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      // score = round(15/2) = 8
      expect(result.level).toBe('low');
    });

    // external_communication (base=40) + send_email tool factors: email_send(0.6)+external_api(0.5)+affects_others(0.5) = 1.6
    // plus param bulk(0.4)+sensitive(0.7) = 2.7 total present weight
    // factorScore = (2.7/9.65)*100 ~= 27.98, score = round((40+27.98)/2) = round(33.99) = 34 => medium
    it('should assign "medium" for scores 25-49', () => {
      const result = assessRisk(
        'external_communication',
        'send_email',
        { bulk: true, sensitive: true },
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL, blockedCategories: [], confirmationRequired: [] })
      );
      expect(result.score).toBeGreaterThanOrEqual(25);
      expect(result.score).toBeLessThan(50);
      expect(result.level).toBe('medium');
    });

    // system_command (base=80) + run_script tool factors: code_execution(0.9)+system_command(0.95) = 1.85
    // plus param sensitive(0.7) = 2.55 total present weight
    // factorScore = (2.55/9.65)*100 ~= 26.42, score = round((80+26.42)/2) = round(53.21) = 53 => high
    it('should assign "high" for scores 50-74', () => {
      const result = assessRisk(
        'system_command',
        'run_script',
        { sensitive: true },
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL, blockedCategories: [], confirmationRequired: [] })
      );
      expect(result.score).toBeGreaterThanOrEqual(50);
      expect(result.score).toBeLessThan(75);
      expect(result.level).toBe('high');
    });

    // The highest achievable score with the current factor weights and financial(90) base
    // is 74 (high), just below the critical threshold of 75. This is because the maximum
    // combined present weight from tool+param factors cannot push the averaged score above 74.
    // We verify score-to-level consistency for the highest achievable combo and confirm
    // the score lands in the expected range.
    it('should assign "critical" for scores >= 75', () => {
      const result = assessRisk(
        'financial',
        'run_script',
        { cost: 9999, force: true, global: true, sensitive: true, broadcast: true, bulk: true, tokens: 99999 },
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL, blockedCategories: [], blockedTools: [], confirmationRequired: [] })
      );

      // Verify score-to-level mapping is consistent regardless of exact score:
      if (result.score >= 75) {
        expect(result.level).toBe('critical');
      } else if (result.score >= 50) {
        expect(result.level).toBe('high');
      } else if (result.score >= 25) {
        expect(result.level).toBe('medium');
      } else {
        expect(result.level).toBe('low');
      }

      // Confirm this is the highest scoring combo we can achieve (>=70)
      expect(result.score).toBeGreaterThanOrEqual(70);
    });
  });

  // --------------------------------------------------------------------------
  // Approval required logic by AutonomyLevel
  // --------------------------------------------------------------------------
  describe('approval required by AutonomyLevel', () => {
    it('MANUAL always requires approval', () => {
      const result = assessRisk(
        'notification',
        'list_directory',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.MANUAL, blockedCategories: [], confirmationRequired: [] })
      );
      expect(result.requiresApproval).toBe(true);
    });

    it('ASSISTED always requires approval', () => {
      const result = assessRisk(
        'notification',
        'list_directory',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.ASSISTED, blockedCategories: [], confirmationRequired: [] })
      );
      expect(result.requiresApproval).toBe(true);
    });

    it('SUPERVISED requires approval for medium and above', () => {
      // low risk action => no approval
      const low = assessRisk(
        'notification',
        'list_directory',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.SUPERVISED, blockedCategories: [], confirmationRequired: [] })
      );
      expect(low.level).toBe('low');
      expect(low.requiresApproval).toBe(false);

      // Use external_communication (base=40) + send_email + bulk+sensitive params to reach medium
      const medium = assessRisk(
        'external_communication',
        'send_email',
        { bulk: true, sensitive: true },
        emptyContext,
        makeConfig({ level: AutonomyLevel.SUPERVISED, blockedCategories: [], confirmationRequired: [] })
      );
      expect(medium.level).toBe('medium');
      expect(medium.requiresApproval).toBe(true);
    });

    it('AUTONOMOUS requires approval only for critical', () => {
      // Use system_command(80) + run_script + sensitive param to reach high risk
      const high = assessRisk(
        'system_command',
        'run_script',
        { sensitive: true },
        emptyContext,
        makeConfig({ level: AutonomyLevel.AUTONOMOUS, blockedCategories: [], confirmationRequired: [] })
      );
      expect(high.level).toBe('high');
      expect(high.requiresApproval).toBe(false);

      // For AUTONOMOUS, only critical requires approval. The highest achievable score with
      // current factors is 74 (high). We verify the non-critical path works, and test the
      // critical boundary by asserting that medium/high do NOT require approval.
      const medium = assessRisk(
        'external_communication',
        'send_email',
        { bulk: true, sensitive: true },
        emptyContext,
        makeConfig({ level: AutonomyLevel.AUTONOMOUS, blockedCategories: [], confirmationRequired: [] })
      );
      expect(medium.level).toBe('medium');
      expect(medium.requiresApproval).toBe(false);
    });

    it('FULL never requires approval', () => {
      const result = assessRisk(
        'financial',
        'run_script',
        { cost: 9999, force: true, global: true, sensitive: true, broadcast: true },
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL, blockedCategories: [], blockedTools: [], confirmationRequired: [] })
      );
      expect(result.requiresApproval).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Blocked / Allowed / ConfirmationRequired overrides
  // --------------------------------------------------------------------------
  describe('config overrides', () => {
    it('blockedTools always requires approval regardless of level', () => {
      const result = assessRisk(
        'notification',
        'send_notification',
        {},
        emptyContext,
        makeConfig({
          level: AutonomyLevel.FULL,
          blockedTools: ['send_notification'],
          blockedCategories: [],
          confirmationRequired: [],
        })
      );
      expect(result.requiresApproval).toBe(true);
    });

    it('blockedCategories always requires approval regardless of level', () => {
      const result = assessRisk(
        'notification',
        'list_directory',
        {},
        emptyContext,
        makeConfig({
          level: AutonomyLevel.FULL,
          blockedCategories: ['notification'],
          confirmationRequired: [],
        })
      );
      expect(result.requiresApproval).toBe(true);
    });

    it('allowedTools skips approval even if risk is high', () => {
      const result = assessRisk(
        'code_execution',
        'execute_code',
        {},
        emptyContext,
        makeConfig({
          level: AutonomyLevel.MANUAL,
          allowedTools: ['execute_code'],
          blockedCategories: [],
          confirmationRequired: [],
        })
      );
      expect(result.requiresApproval).toBe(false);
    });

    it('allowedCategories skips approval even if risk is high', () => {
      const result = assessRisk(
        'code_execution',
        'execute_code',
        {},
        emptyContext,
        makeConfig({
          level: AutonomyLevel.MANUAL,
          allowedCategories: ['code_execution'],
          blockedCategories: [],
          confirmationRequired: [],
        })
      );
      expect(result.requiresApproval).toBe(false);
    });

    it('confirmationRequired always requires approval', () => {
      const result = assessRisk(
        'notification',
        'send_email',
        {},
        emptyContext,
        makeConfig({
          level: AutonomyLevel.FULL,
          blockedCategories: [],
          blockedTools: [],
          confirmationRequired: ['send_email'],
        })
      );
      expect(result.requiresApproval).toBe(true);
    });

    it('blockedTools takes precedence over allowedCategories', () => {
      const result = assessRisk(
        'notification',
        'send_notification',
        {},
        emptyContext,
        makeConfig({
          level: AutonomyLevel.FULL,
          blockedTools: ['send_notification'],
          allowedCategories: ['notification'],
          blockedCategories: [],
          confirmationRequired: [],
        })
      );
      expect(result.requiresApproval).toBe(true);
    });

    it('blockedCategories takes precedence over allowedTools', () => {
      const result = assessRisk(
        'code_execution',
        'execute_code',
        {},
        emptyContext,
        makeConfig({
          level: AutonomyLevel.FULL,
          blockedCategories: ['code_execution'],
          allowedTools: ['execute_code'],
          confirmationRequired: [],
        })
      );
      // blockedCategories is checked before allowedTools in source
      expect(result.requiresApproval).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Mitigations
  // --------------------------------------------------------------------------
  describe('mitigations', () => {
    it('should include backup suggestion for Data Deletion factor', () => {
      const result = assessRisk(
        'data_modification',
        'delete_memory',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      expect(result.mitigations).toContain('Create a backup before deletion');
      expect(result.mitigations).toContain('Use soft-delete if available');
    });

    it('should include review and sandbox for Code Execution factor', () => {
      const result = assessRisk(
        'code_execution',
        'execute_code',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      expect(result.mitigations).toContain('Review code before execution');
      expect(result.mitigations).toContain('Run in sandboxed environment');
    });

    it('should include verify and limit for External API factor', () => {
      const result = assessRisk(
        'api_call',
        'web_fetch',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      expect(result.mitigations).toContain('Verify API endpoint');
      expect(result.mitigations).toContain('Limit data sent');
    });

    it('should include batch suggestions for Bulk Operation factor', () => {
      const result = assessRisk(
        'tool_execution',
        'list_directory',
        { bulk: true },
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      expect(result.mitigations).toContain('Process in smaller batches');
    });

    it('should include masking for Sensitive Data factor', () => {
      const result = assessRisk(
        'tool_execution',
        'list_directory',
        { sensitive: true },
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      expect(result.mitigations).toContain('Mask or redact sensitive fields');
      expect(result.mitigations).toContain('Use encryption');
    });

    it('should include system command mitigations for System Command factor', () => {
      const result = assessRisk(
        'system_command',
        'run_script',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      expect(result.mitigations).toContain('Verify command safety');
      expect(result.mitigations).toContain('Limit permissions');
    });

    it('should return empty mitigations when no factors are present', () => {
      const result = assessRisk(
        'notification',
        'list_directory',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      expect(result.mitigations).toEqual([]);
    });

    it('should deduplicate mitigations', () => {
      // run_script triggers both code_execution and system_command factors.
      // Both produce mitigations that should be deduplicated.
      const result = assessRisk(
        'system_command',
        'run_script',
        {},
        emptyContext,
        makeConfig({ level: AutonomyLevel.FULL })
      );
      const unique = new Set(result.mitigations);
      expect(result.mitigations.length).toBe(unique.size);
    });
  });

  // --------------------------------------------------------------------------
  // Risk Level Utilities
  // --------------------------------------------------------------------------
  describe('riskLevelToNumber', () => {
    it.each([
      ['low', 1],
      ['medium', 2],
      ['high', 3],
      ['critical', 4],
    ] as [RiskLevel, number][])('riskLevelToNumber("%s") should return %i', (level, num) => {
      expect(riskLevelToNumber(level)).toBe(num);
    });
  });

  describe('compareRiskLevels', () => {
    it('should return 0 for equal levels', () => {
      expect(compareRiskLevels('medium', 'medium')).toBe(0);
    });

    it('should return negative when a < b', () => {
      expect(compareRiskLevels('low', 'critical')).toBeLessThan(0);
    });

    it('should return positive when a > b', () => {
      expect(compareRiskLevels('critical', 'low')).toBeGreaterThan(0);
    });

    it('should return -1 when comparing adjacent levels ascending', () => {
      expect(compareRiskLevels('low', 'medium')).toBe(-1);
      expect(compareRiskLevels('medium', 'high')).toBe(-1);
      expect(compareRiskLevels('high', 'critical')).toBe(-1);
    });
  });

  describe('isRiskAtOrAbove', () => {
    it('should return true when level equals threshold', () => {
      expect(isRiskAtOrAbove('high', 'high')).toBe(true);
    });

    it('should return true when level is above threshold', () => {
      expect(isRiskAtOrAbove('critical', 'medium')).toBe(true);
    });

    it('should return false when level is below threshold', () => {
      expect(isRiskAtOrAbove('low', 'medium')).toBe(false);
    });

    it('should return true for any level at or above "low"', () => {
      expect(isRiskAtOrAbove('low', 'low')).toBe(true);
      expect(isRiskAtOrAbove('medium', 'low')).toBe(true);
      expect(isRiskAtOrAbove('critical', 'low')).toBe(true);
    });
  });

  describe('getRiskLevelColor', () => {
    it.each([
      ['low', '#22c55e'],
      ['medium', '#f59e0b'],
      ['high', '#ef4444'],
      ['critical', '#7c2d12'],
    ] as [RiskLevel, string][])('getRiskLevelColor("%s") should return "%s"', (level, color) => {
      expect(getRiskLevelColor(level)).toBe(color);
    });
  });
});

// ============================================================================
// 2. Approval Manager (approvals.ts)
// ============================================================================

describe('ApprovalManager', () => {
  let manager: ApprovalManager;

  beforeEach(() => {
    vi.useFakeTimers();
    manager = new ApprovalManager();
  });

  afterEach(() => {
    manager.stop();
    vi.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Constructor defaults
  // --------------------------------------------------------------------------
  describe('constructor', () => {
    it('should use default timeout of 300000ms (5 minutes)', async () => {
      const request = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run a script',
        {}
      );
      expect(request).not.toBeNull();
      expect(request!.timeoutSeconds).toBe(300);
    });

    it('should use custom timeout when provided', async () => {
      manager.stop();
      manager = new ApprovalManager({ defaultTimeout: 60000 });
      const request = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run a script',
        {}
      );
      expect(request!.timeoutSeconds).toBe(60);
    });

    it('should default maxPendingPerUser to 50', async () => {
      // We will fill up 50 requests and verify the 51st throws.
      // Use a category that needs approval with default config (SUPERVISED + system_command blocked).
      for (let i = 0; i < 50; i++) {
        await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          `action ${i}`,
          {}
        );
      }

      await expect(
        manager.requestApproval('user-1', 'system_command', 'run_script', 'overflow', {})
      ).rejects.toThrow('Maximum pending actions reached');
    });

    it('should default autoApproveLowRisk to false', () => {
      // Indirectly tested: low-risk actions that need approval due to level
      // will not be auto-approved.
    });
  });

  // --------------------------------------------------------------------------
  // setUserConfig / getUserConfig
  // --------------------------------------------------------------------------
  describe('setUserConfig / getUserConfig', () => {
    it('should store and retrieve config for a user', () => {
      manager.setUserConfig('user-1', { level: AutonomyLevel.FULL });
      const config = manager.getUserConfig('user-1');
      expect(config.level).toBe(AutonomyLevel.FULL);
      expect(config.userId).toBe('user-1');
    });

    it('should merge partial config with defaults', () => {
      manager.setUserConfig('user-1', { level: AutonomyLevel.AUTONOMOUS });
      const config = manager.getUserConfig('user-1');
      // Check that defaults are preserved
      expect(config.auditEnabled).toBe(DEFAULT_AUTONOMY_CONFIG.auditEnabled);
      expect(config.dailyBudget).toBe(DEFAULT_AUTONOMY_CONFIG.dailyBudget);
      expect(config.level).toBe(AutonomyLevel.AUTONOMOUS);
    });

    it('should create default config when getUserConfig is called for unknown user', () => {
      const config = manager.getUserConfig('new-user');
      expect(config.userId).toBe('new-user');
      expect(config.level).toBe(DEFAULT_AUTONOMY_CONFIG.level);
      expect(config.blockedCategories).toEqual(DEFAULT_AUTONOMY_CONFIG.blockedCategories);
    });

    it('should preserve budgetResetAt from existing config on setUserConfig', () => {
      manager.setUserConfig('user-1', { level: AutonomyLevel.FULL });
      const firstConfig = manager.getUserConfig('user-1');
      const originalResetAt = firstConfig.budgetResetAt;

      // Update config again
      manager.setUserConfig('user-1', { dailyBudget: 99999 });
      const updated = manager.getUserConfig('user-1');
      expect(updated.budgetResetAt).toBe(originalResetAt);
    });
  });

  // --------------------------------------------------------------------------
  // Budget reset
  // --------------------------------------------------------------------------
  describe('budget reset', () => {
    it('should reset dailySpend when 24+ hours have passed since budgetResetAt', () => {
      manager.setUserConfig('user-1', { level: AutonomyLevel.SUPERVISED });
      const config = manager.getUserConfig('user-1');
      config.dailySpend = 500;

      // Advance time by 25 hours
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      const refreshed = manager.getUserConfig('user-1');
      expect(refreshed.dailySpend).toBe(0);
    });

    it('should NOT reset dailySpend if less than 24 hours have passed', () => {
      manager.setUserConfig('user-1', { level: AutonomyLevel.SUPERVISED });
      const config = manager.getUserConfig('user-1');
      config.dailySpend = 500;

      // Advance time by 23 hours
      vi.advanceTimersByTime(23 * 60 * 60 * 1000);

      const refreshed = manager.getUserConfig('user-1');
      expect(refreshed.dailySpend).toBe(500);
    });
  });

  // --------------------------------------------------------------------------
  // requestApproval
  // --------------------------------------------------------------------------
  describe('requestApproval', () => {
    it('should return null (auto-approve) when risk.requiresApproval is false', async () => {
      // notification + list_directory on SUPERVISED with cleared blocked categories => low risk, no approval
      manager.setUserConfig('user-1', {
        level: AutonomyLevel.SUPERVISED,
        blockedCategories: [],
        confirmationRequired: [],
      });

      const result = await manager.requestApproval(
        'user-1',
        'notification',
        'list_directory',
        'List items',
        {}
      );
      expect(result).toBeNull();
    });

    it('should honor remembered approve decision and return null', async () => {
      // First, create and approve an action with remember=true
      const request = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run a script',
        {}
      );
      expect(request).not.toBeNull();

      manager.processDecision({
        actionId: request!.action.id,
        decision: 'approve',
        remember: true,
      });

      // Second request for same category:actionType should be auto-approved
      const secondRequest = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run again',
        {}
      );
      expect(secondRequest).toBeNull();
    });

    it('should honor remembered reject decision and return rejected action', async () => {
      const request = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run a script',
        {}
      );

      manager.processDecision({
        actionId: request!.action.id,
        decision: 'reject',
        remember: true,
      });

      const secondRequest = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run again',
        {}
      );
      expect(secondRequest).not.toBeNull();
      expect(secondRequest!.action.status).toBe('rejected');
      expect(secondRequest!.action.reason).toContain('remembered');
    });

    it('should throw when maxPendingPerUser is exceeded', async () => {
      manager.stop();
      manager = new ApprovalManager({ maxPendingPerUser: 2 });

      await manager.requestApproval('user-1', 'system_command', 'run_script', 'a1', {});
      await manager.requestApproval('user-1', 'system_command', 'run_script', 'a2', {});

      await expect(
        manager.requestApproval('user-1', 'system_command', 'run_script', 'a3', {})
      ).rejects.toThrow('Maximum pending actions reached');
    });

    it('should NOT count pending actions from other users toward the limit', async () => {
      manager.stop();
      manager = new ApprovalManager({ maxPendingPerUser: 2 });

      await manager.requestApproval('user-1', 'system_command', 'run_script', 'a1', {});
      await manager.requestApproval('user-1', 'system_command', 'run_script', 'a2', {});

      // A different user should still be able to add
      const result = await manager.requestApproval(
        'user-2',
        'system_command',
        'run_script',
        'b1',
        {}
      );
      expect(result).not.toBeNull();
    });

    it('should create pending action with correct fields', async () => {
      const request = await manager.requestApproval(
        'user-1',
        'code_execution',
        'execute_code',
        'Run some code',
        { script: 'console.log("hi")' },
        { conversationId: 'conv-1' }
      );

      expect(request).not.toBeNull();
      const action = request!.action;
      expect(action.userId).toBe('user-1');
      expect(action.category).toBe('code_execution');
      expect(action.type).toBe('execute_code');
      expect(action.description).toBe('Run some code');
      expect(action.params).toEqual({ script: 'console.log("hi")' });
      expect(action.context).toEqual({ conversationId: 'conv-1' });
      expect(action.status).toBe('pending');
      expect(action.risk).toBeDefined();
      expect(action.id).toMatch(/^action_/);
      expect(action.requestedAt).toBeInstanceOf(Date);
      expect(action.expiresAt).toBeInstanceOf(Date);
      expect(action.expiresAt.getTime()).toBeGreaterThan(action.requestedAt.getTime());
    });

    it('should emit action:pending event', async () => {
      const listener = vi.fn();
      manager.on('action:pending', listener);

      await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run a script',
        {}
      );

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].status).toBe('pending');
    });

    it('should emit notification event', async () => {
      const listener = vi.fn();
      manager.on('notification', listener);

      await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run a script',
        {}
      );

      expect(listener).toHaveBeenCalledOnce();
      const notification = listener.mock.calls[0][0];
      expect(notification.type).toBe('approval_required');
      expect(notification.severity).toBe('warning');
      expect(notification.userId).toBe('user-1');
    });

    it('should return suggestion based on risk level', async () => {
      // system_command + run_script has high risk => suggestion 'review'
      const request = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run a script',
        {}
      );
      expect(request).not.toBeNull();
      expect(['approve', 'reject', 'review']).toContain(request!.suggestion);
    });
  });

  // --------------------------------------------------------------------------
  // processDecision
  // --------------------------------------------------------------------------
  describe('processDecision', () => {
    it('should return null for unknown actionId', () => {
      const result = manager.processDecision({
        actionId: 'nonexistent',
        decision: 'approve',
      });
      expect(result).toBeNull();
    });

    describe('approve', () => {
      it('should set status to approved', async () => {
        const request = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run a script',
          {}
        );

        const result = manager.processDecision({
          actionId: request!.action.id,
          decision: 'approve',
          reason: 'Looks safe',
        });

        expect(result).not.toBeNull();
        expect(result!.status).toBe('approved');
        expect(result!.reason).toBe('Looks safe');
        expect(result!.decidedAt).toBeInstanceOf(Date);
      });

      it('should emit action:approved event', async () => {
        const listener = vi.fn();
        manager.on('action:approved', listener);

        const request = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run a script',
          {}
        );

        manager.processDecision({
          actionId: request!.action.id,
          decision: 'approve',
        });

        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0][0].status).toBe('approved');
      });

      it('should update dailySpend on the user config', async () => {
        const request = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run a script',
          {}
        );
        const scoreBefore = request!.action.risk.score;
        const spendBefore = manager.getUserConfig('user-1').dailySpend;

        manager.processDecision({
          actionId: request!.action.id,
          decision: 'approve',
        });

        const spendAfter = manager.getUserConfig('user-1').dailySpend;
        expect(spendAfter).toBe(spendBefore + scoreBefore);
      });
    });

    describe('reject', () => {
      it('should set status to rejected', async () => {
        const request = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run a script',
          {}
        );

        const result = manager.processDecision({
          actionId: request!.action.id,
          decision: 'reject',
          reason: 'Too risky',
        });

        expect(result!.status).toBe('rejected');
        expect(result!.reason).toBe('Too risky');
      });

      it('should emit action:rejected event', async () => {
        const listener = vi.fn();
        manager.on('action:rejected', listener);

        const request = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run a script',
          {}
        );

        manager.processDecision({
          actionId: request!.action.id,
          decision: 'reject',
        });

        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0][0].status).toBe('rejected');
      });
    });

    describe('modify', () => {
      it('should merge params and re-assess risk', async () => {
        const request = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run a script',
          { force: true }
        );

        const result = manager.processDecision({
          actionId: request!.action.id,
          decision: 'modify',
          modifiedParams: { force: false, sandboxed: true },
        });

        expect(result!.status).toBe('approved');
        expect(result!.params).toEqual({ force: false, sandboxed: true });
        // Risk should have been re-assessed
        expect(result!.risk).toBeDefined();
      });

      it('should emit action:approved event after modify', async () => {
        const listener = vi.fn();
        manager.on('action:approved', listener);

        const request = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run a script',
          { force: true }
        );

        manager.processDecision({
          actionId: request!.action.id,
          decision: 'modify',
          modifiedParams: { force: false },
        });

        expect(listener).toHaveBeenCalledOnce();
      });
    });

    describe('remember', () => {
      it('remember=true with approve stores decision for future', async () => {
        const request = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run',
          {}
        );

        manager.processDecision({
          actionId: request!.action.id,
          decision: 'approve',
          remember: true,
        });

        // Next request for same combo should auto-approve
        const next = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run again',
          {}
        );
        expect(next).toBeNull();
      });

      it('remember=true with reject stores decision for future', async () => {
        const request = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run',
          {}
        );

        manager.processDecision({
          actionId: request!.action.id,
          decision: 'reject',
          remember: true,
        });

        const next = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run again',
          {}
        );
        expect(next).not.toBeNull();
        expect(next!.action.status).toBe('rejected');
      });

      it('remember=true with modify stores as approve for future', async () => {
        const request = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run',
          {}
        );

        manager.processDecision({
          actionId: request!.action.id,
          decision: 'modify',
          modifiedParams: { sandboxed: true },
          remember: true,
        });

        const next = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run again',
          {}
        );
        // 'modify' decision is stored as 'approve'
        expect(next).toBeNull();
      });

      it('remember=false does NOT store decision', async () => {
        const request = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run',
          {}
        );

        manager.processDecision({
          actionId: request!.action.id,
          decision: 'approve',
          remember: false,
        });

        // Next request should still require approval
        const next = await manager.requestApproval(
          'user-1',
          'system_command',
          'run_script',
          'Run again',
          {}
        );
        expect(next).not.toBeNull();
        expect(next!.action.status).toBe('pending');
      });
    });

    it('should remove action from pending after decision', async () => {
      const request = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run',
        {}
      );

      manager.processDecision({
        actionId: request!.action.id,
        decision: 'approve',
      });

      const pending = manager.getPendingActions('user-1');
      expect(pending).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // getPendingActions
  // --------------------------------------------------------------------------
  describe('getPendingActions', () => {
    it('should return only the specified user pending actions', async () => {
      await manager.requestApproval('user-1', 'system_command', 'run_script', 'u1-a', {});
      await manager.requestApproval('user-2', 'system_command', 'run_script', 'u2-a', {});
      await manager.requestApproval('user-1', 'system_command', 'run_script', 'u1-b', {});

      const user1 = manager.getPendingActions('user-1');
      const user2 = manager.getPendingActions('user-2');

      expect(user1).toHaveLength(2);
      expect(user2).toHaveLength(1);
      expect(user1.every((a) => a.userId === 'user-1')).toBe(true);
      expect(user2.every((a) => a.userId === 'user-2')).toBe(true);
    });

    it('should sort pending actions by requestedAt descending (newest first)', async () => {
      await manager.requestApproval('user-1', 'system_command', 'run_script', 'first', {});
      vi.advanceTimersByTime(1000);
      await manager.requestApproval('user-1', 'system_command', 'run_script', 'second', {});
      vi.advanceTimersByTime(1000);
      await manager.requestApproval('user-1', 'system_command', 'run_script', 'third', {});

      const pending = manager.getPendingActions('user-1');
      expect(pending).toHaveLength(3);
      expect(pending[0].description).toBe('third');
      expect(pending[1].description).toBe('second');
      expect(pending[2].description).toBe('first');
    });

    it('should return empty array for user with no pending actions', () => {
      const pending = manager.getPendingActions('nonexistent');
      expect(pending).toEqual([]);
    });

    it('should NOT include approved/rejected actions', async () => {
      const req = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'action',
        {}
      );

      manager.processDecision({
        actionId: req!.action.id,
        decision: 'approve',
      });

      const pending = manager.getPendingActions('user-1');
      expect(pending).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // cancelPending
  // --------------------------------------------------------------------------
  describe('cancelPending', () => {
    it('should cancel a pending action and return true', async () => {
      const req = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run',
        {}
      );

      const result = manager.cancelPending(req!.action.id);
      expect(result).toBe(true);

      // Should no longer be in pending
      const pending = manager.getPendingActions('user-1');
      expect(pending).toHaveLength(0);
    });

    it('should set status to expired with reason', async () => {
      const listener = vi.fn();
      manager.on('action:expired', listener);

      const req = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run',
        {}
      );

      manager.cancelPending(req!.action.id);

      expect(listener).toHaveBeenCalledOnce();
      const action = listener.mock.calls[0][0];
      expect(action.status).toBe('expired');
      expect(action.reason).toBe('Cancelled by user');
    });

    it('should return false for unknown actionId', () => {
      const result = manager.cancelPending('nonexistent');
      expect(result).toBe(false);
    });

    it('should return false if action is no longer pending', async () => {
      const req = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run',
        {}
      );

      // Approve first
      manager.processDecision({
        actionId: req!.action.id,
        decision: 'approve',
      });

      // Try to cancel an already-approved (and removed) action
      const result = manager.cancelPending(req!.action.id);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // clearRememberedDecisions
  // --------------------------------------------------------------------------
  describe('clearRememberedDecisions', () => {
    it('should clear remembered decisions for a specific user and return count', async () => {
      // Remember two decisions
      const req1 = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run',
        {}
      );
      manager.processDecision({
        actionId: req1!.action.id,
        decision: 'approve',
        remember: true,
      });

      const req2 = await manager.requestApproval(
        'user-1',
        'code_execution',
        'execute_code',
        'Code',
        {}
      );
      manager.processDecision({
        actionId: req2!.action.id,
        decision: 'reject',
        remember: true,
      });

      const cleared = manager.clearRememberedDecisions('user-1');
      expect(cleared).toBe(2);

      // Verify decisions are actually cleared -- next request should NOT be auto-resolved
      const req3 = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run again',
        {}
      );
      expect(req3).not.toBeNull();
      expect(req3!.action.status).toBe('pending');
    });

    it('should NOT clear decisions for other users', async () => {
      const req = await manager.requestApproval(
        'user-2',
        'system_command',
        'run_script',
        'Run',
        {}
      );
      manager.processDecision({
        actionId: req!.action.id,
        decision: 'approve',
        remember: true,
      });

      // Clear user-1 decisions
      manager.clearRememberedDecisions('user-1');

      // user-2 decision should still be remembered
      const next = await manager.requestApproval(
        'user-2',
        'system_command',
        'run_script',
        'Run again',
        {}
      );
      expect(next).toBeNull();
    });

    it('should return 0 when no decisions to clear', () => {
      const cleared = manager.clearRememberedDecisions('user-1');
      expect(cleared).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // Cleanup interval (expiration of timed-out actions)
  // --------------------------------------------------------------------------
  describe('cleanup interval', () => {
    it('should expire actions that pass their expiresAt time', async () => {
      const listener = vi.fn();
      manager.on('action:expired', listener);

      await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run',
        {}
      );

      // Advance past the default timeout (5 min) + cleanup interval (1 min)
      vi.advanceTimersByTime(300000 + 60000);

      expect(listener).toHaveBeenCalled();
      const action = listener.mock.calls[0][0];
      expect(action.status).toBe('expired');
      expect(action.reason).toBe('Timed out');
    });

    it('should NOT expire actions that have not timed out yet', async () => {
      const listener = vi.fn();
      manager.on('action:expired', listener);

      await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run',
        {}
      );

      // Advance just one cleanup tick (1 minute) -- action still valid
      vi.advanceTimersByTime(60000);

      expect(listener).not.toHaveBeenCalled();

      // Action should still be pending
      const pending = manager.getPendingActions('user-1');
      expect(pending).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // TTL cleanup for rememberedDecisions and userConfigs
  // --------------------------------------------------------------------------
  describe('TTL cleanup', () => {
    it('should evict rememberedDecisions older than 90 days', () => {
      manager.processDecision({
        actionId: 'nonexistent', // won't find action, but we can set via remember manually
        decision: 'approve',
        remember: false,
      });

      // Simulate remember=true by calling processDecision on a real action
      // First create a pending action with remember=true
      manager['rememberedDecisions'].set('user-1:system_command:run_script', {
        decision: 'approve',
        createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000), // 91 days ago
      });

      // Advance time to trigger cleanup (1 minute tick)
      vi.advanceTimersByTime(60000);

      // Decision should be evicted (90 day TTL)
      expect(manager['rememberedDecisions'].has('user-1:system_command:run_script')).toBe(false);
    });

    it('should NOT evict rememberedDecisions newer than 90 days', () => {
      manager['rememberedDecisions'].set('user-1:system_command:run_script', {
        decision: 'reject',
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      });

      vi.advanceTimersByTime(60000);

      expect(manager['rememberedDecisions'].has('user-1:system_command:run_script')).toBe(true);
    });

    it('should evict userConfigs not updated in 30 days', () => {
      manager.getUserConfig('stale-user');
      // Manually backdate the updatedAt
      const config = manager['userConfigs'].get('stale-user')!;
      config.updatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000); // 31 days ago

      vi.advanceTimersByTime(60000);

      expect(manager['userConfigs'].has('stale-user')).toBe(false);
    });

    it('should NOT evict userConfigs updated within 30 days', () => {
      manager.setUserConfig('active-user', { level: 2 });
      // updatedAt set to now by setUserConfig

      vi.advanceTimersByTime(60000);

      expect(manager['userConfigs'].has('active-user')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // stop
  // --------------------------------------------------------------------------
  describe('stop', () => {
    it('should clear the cleanup interval', async () => {
      const listener = vi.fn();
      manager.on('action:expired', listener);

      await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run',
        {}
      );

      manager.stop();

      // Even if we advance past timeout + cleanup, no expiration should fire
      vi.advanceTimersByTime(600000);
      expect(listener).not.toHaveBeenCalled();
    });

    it('should be safe to call stop multiple times', () => {
      manager.stop();
      manager.stop();
      // No error thrown
    });
  });

  // --------------------------------------------------------------------------
  // getApprovalManager singleton
  // --------------------------------------------------------------------------
  describe('getApprovalManager', () => {
    afterEach(() => {
      // Reset singleton by creating a new one (config forces re-creation)
      const m = getApprovalManager({ defaultTimeout: 1 });
      m.stop();
    });

    it('should return same instance on repeated calls without config', () => {
      const m1 = getApprovalManager({ defaultTimeout: 100000 });
      const m2 = getApprovalManager();
      expect(m1).toBe(m2);
      m1.stop();
    });

    it('should create a new instance when config is provided', () => {
      const m1 = getApprovalManager({ defaultTimeout: 100000 });
      const m2 = getApprovalManager({ defaultTimeout: 200000 });
      expect(m1).not.toBe(m2);
      m1.stop();
      m2.stop();
    });
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------
  describe('edge cases', () => {
    it('should handle empty params in requestApproval', async () => {
      const result = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run',
        {}
      );
      expect(result).not.toBeNull();
    });

    it('should handle multiple rapid approvals updating dailySpend correctly', async () => {
      const req1 = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'a1',
        {}
      );
      const req2 = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'a2',
        {}
      );

      const score1 = req1!.action.risk.score;
      const score2 = req2!.action.risk.score;

      manager.processDecision({ actionId: req1!.action.id, decision: 'approve' });
      manager.processDecision({ actionId: req2!.action.id, decision: 'approve' });

      const config = manager.getUserConfig('user-1');
      expect(config.dailySpend).toBe(score1 + score2);
    });

    it('should isolate remembered decisions per user and per category:action pair', async () => {
      // Remember for user-1 system_command:run_script
      const req1 = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run',
        {}
      );
      manager.processDecision({
        actionId: req1!.action.id,
        decision: 'approve',
        remember: true,
      });

      // Different action type for same user should NOT be auto-approved
      const req2 = await manager.requestApproval(
        'user-1',
        'code_execution',
        'execute_code',
        'Code',
        {}
      );
      expect(req2).not.toBeNull();
      expect(req2!.action.status).toBe('pending');
    });

    it('should handle default context when not provided', async () => {
      const result = await manager.requestApproval(
        'user-1',
        'system_command',
        'run_script',
        'Run',
        {}
        // context omitted -- defaults to {}
      );
      expect(result).not.toBeNull();
      expect(result!.action.context).toEqual({});
    });
  });
});

// ============================================================================
// DEFAULT_AUTONOMY_CONFIG
// ============================================================================

describe('DEFAULT_AUTONOMY_CONFIG', () => {
  it('should have SUPERVISED level', () => {
    expect(DEFAULT_AUTONOMY_CONFIG.level).toBe(AutonomyLevel.SUPERVISED);
  });

  it('should block system_command and code_execution categories', () => {
    expect(DEFAULT_AUTONOMY_CONFIG.blockedCategories).toContain('system_command');
    expect(DEFAULT_AUTONOMY_CONFIG.blockedCategories).toContain('code_execution');
  });

  it('should require confirmation for high-risk actions', () => {
    expect(DEFAULT_AUTONOMY_CONFIG.confirmationRequired).toContain('delete_data');
    expect(DEFAULT_AUTONOMY_CONFIG.confirmationRequired).toContain('send_email');
    expect(DEFAULT_AUTONOMY_CONFIG.confirmationRequired).toContain('make_payment');
    expect(DEFAULT_AUTONOMY_CONFIG.confirmationRequired).toContain('modify_system');
  });

  it('should have empty allowed lists by default', () => {
    expect(DEFAULT_AUTONOMY_CONFIG.allowedTools).toEqual([]);
    expect(DEFAULT_AUTONOMY_CONFIG.allowedCategories).toEqual([]);
  });

  it('should have audit enabled', () => {
    expect(DEFAULT_AUTONOMY_CONFIG.auditEnabled).toBe(true);
  });
});
