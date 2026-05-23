/**
 * Workflow template catalog — 125 practical workflow examples organised
 * by category. Used by the Workflow Copilot as reference for suggesting
 * real, implementable workflows over OwnPilot's tool ecosystem.
 *
 * Node types: trigger, llm, condition, code, transformer, forEach,
 * httpRequest, delay, switch, notification, parallel, merge, dataStore,
 * filter, map, aggregate, approval, subWorkflow, errorHandler,
 * webhookResponse, stickyNote, clawNode.
 *
 * Tool sources: core.*, mcp.*, custom.*, ext.*, skill.*
 */

import { API_TEMPLATES } from './api.js';
import { BUSINESS_TEMPLATES } from './business.js';
import { CONTENT_TEMPLATES } from './content.js';
import { DATA_TEMPLATES } from './data.js';
import { DEVOPS_TEMPLATES } from './devops.js';
import { MONITORING_TEMPLATES } from './monitoring.js';
import { PERSONAL_TEMPLATES } from './personal.js';
import { RESEARCH_TEMPLATES } from './research.js';
import { SECURITY_TEMPLATES } from './security.js';
import type { WorkflowTemplateIdea } from './types.js';

export type { WorkflowTemplateIdea } from './types.js';
export {
  API_TEMPLATES,
  BUSINESS_TEMPLATES,
  CONTENT_TEMPLATES,
  DATA_TEMPLATES,
  DEVOPS_TEMPLATES,
  MONITORING_TEMPLATES,
  PERSONAL_TEMPLATES,
  RESEARCH_TEMPLATES,
  SECURITY_TEMPLATES,
};

export const WORKFLOW_TEMPLATE_IDEAS: WorkflowTemplateIdea[] = [
  ...CONTENT_TEMPLATES,
  ...DATA_TEMPLATES,
  ...MONITORING_TEMPLATES,
  ...DEVOPS_TEMPLATES,
  ...BUSINESS_TEMPLATES,
  ...API_TEMPLATES,
  ...PERSONAL_TEMPLATES,
  ...SECURITY_TEMPLATES,
  ...RESEARCH_TEMPLATES,
];
