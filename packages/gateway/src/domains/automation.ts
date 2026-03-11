/**
 * Automation Domain
 *
 * Bounded context for proactive automation:
 * triggers, plans, workflows, autonomy assessment,
 * and execution permissions.
 *
 * Tables: triggers, trigger_history, plans, plan_steps,
 *         plan_history, workflows
 *
 * Routes: /triggers, /plans, /workflows, /autonomy,
 *         /execution-permissions
 */

export const automationDomain = {
  name: 'automation' as const,

  routes: [
    '/api/v1/triggers',
    '/api/v1/plans',
    '/api/v1/workflows',
    '/api/v1/autonomy',
    '/api/v1/execution-permissions',
  ],

  tables: [
    'triggers',
    'trigger_history',
    'plans',
    'plan_steps',
    'plan_history',
    'workflows',
  ],

  publicServices: [
    'trigger-service',
    'plan-service',
    'workflow-service',
  ],
} as const;
