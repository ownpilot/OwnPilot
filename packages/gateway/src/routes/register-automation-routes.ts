/**
 * Automation Domain Route Registration
 *
 * Mounts all automation-related routes: triggers, plans,
 * workflows, autonomy, and execution permissions.
 */

import type { Hono } from 'hono';
import {
  triggersRoutes,
  plansRoutes,
  workflowRoutes,
  autonomyRoutes,
  executionPermissionsRoutes,
  knowledgeGraphRoutes,
  hitlRoutes,
  workflowGeneratorRoutes,
  workflowHooksRoutes,
} from './index.js';

export function registerAutomationRoutes(app: Hono): void {
  // Triggers routes (proactive automation)
  app.route('/api/v1/triggers', triggersRoutes);

  // Plans routes (autonomous plan execution)
  app.route('/api/v1/plans', plansRoutes);

  // Workflows (visual DAG tool pipelines)
  app.route('/api/v1/workflows', workflowRoutes);

  // Autonomy routes (risk assessment, approvals)
  app.route('/api/v1/autonomy', autonomyRoutes);

  // Execution Permissions (granular code execution security)
  app.route('/api/v1/execution-permissions', executionPermissionsRoutes);

  // Knowledge Graph (entity/relation management, hybrid search, LightRAG)
  app.route('/api/v1/knowledge-graph', knowledgeGraphRoutes);

  // HITL (human-in-the-loop approval/rejection for workflows)
  app.route('/api/v1/hitl', hitlRoutes);

  // Workflow Generator (LLM-powered workflow generation)
  app.route('/api/v1/workflow-generator', workflowGeneratorRoutes);

  // Workflow Hooks (pre/post execution hooks for workflows)
  app.route('/api/v1/workflow-hooks', workflowHooksRoutes);
}
