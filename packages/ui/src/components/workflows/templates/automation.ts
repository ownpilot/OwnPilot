/**
 * Automation workflow templates.
 *
 * Split by category out of workflow-templates.ts (1268 LOC). Data only —
 * the catalog is re-exported unchanged from that file.
 */

import type { WorkflowTemplate } from '../workflow-templates';

export const AUTOMATION_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'goal-progress-tracker',
    name: 'Goal Progress Tracker',
    description: 'Review active goals, analyze progress with AI, flag blocked items',
    category: 'Automation',
    nodeCount: 6,
    definition: {
      name: 'Goal Progress Tracker',
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          triggerType: 'schedule',
          label: 'Weekly Monday 8AM',
          cron: '0 8 * * 1',
          position: { x: 100, y: 150 },
        },
        {
          id: 'node_2',
          tool: 'core.list_goals',
          label: 'Get Active Goals',
          args: { status: 'active', limit: 50 },
          position: { x: 300, y: 150 },
        },
        {
          id: 'node_3',
          type: 'llm',
          label: 'Analyze Progress',
          provider: 'default',
          model: 'default',
          systemPrompt:
            "You are a productivity coach. Analyze the user's goals and their steps. Identify: (1) goals making good progress, (2) goals that are stalled or blocked, (3) suggested next actions. Be specific and actionable.",
          userMessage: 'Analyze my goal progress:\n\n{{node_2.output}}',
          temperature: 0.4,
          maxTokens: 3000,
          position: { x: 550, y: 150 },
        },
        {
          id: 'node_4',
          type: 'condition',
          label: 'Any Blocked?',
          expression:
            'typeof data === "string" && (data.toLowerCase().includes("blocked") || data.toLowerCase().includes("stalled"))',
          position: { x: 800, y: 150 },
        },
        {
          id: 'node_5',
          type: 'notification',
          label: 'Alert: Blocked Goals',
          message: '{{node_3.output}}',
          severity: 'warning',
          position: { x: 1050, y: 50 },
        },
        {
          id: 'node_6',
          type: 'notification',
          label: 'Weekly Update',
          message: '{{node_3.output}}',
          severity: 'info',
          position: { x: 1050, y: 250 },
        },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
        { source: 'node_4', target: 'node_5', sourceHandle: 'true' },
        { source: 'node_4', target: 'node_6', sourceHandle: 'false' },
      ],
    },
  },
  {
    id: 'approval-flow',
    name: 'Approval Flow',
    description: 'AI risk analysis, human approval gate, then execute with audit trail',
    category: 'Automation',
    nodeCount: 7,
    definition: {
      name: 'Approval Flow',
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          triggerType: 'manual',
          label: 'Submit Request',
          position: { x: 100, y: 150 },
        },
        {
          id: 'node_2',
          type: 'llm',
          label: 'Risk Analysis',
          provider: 'default',
          model: 'default',
          systemPrompt:
            'You are a risk analyst. Evaluate the request and classify risk as LOW, MEDIUM, or HIGH. Provide a brief justification. Format: "RISK: [level]\\n\\nAnalysis: [details]"',
          userMessage: 'Evaluate this request:\n\n{{node_1.output}}',
          temperature: 0.3,
          maxTokens: 1024,
          position: { x: 350, y: 150 },
        },
        {
          id: 'node_3',
          type: 'approval',
          label: 'Manager Approval',
          approvalMessage:
            'Request: {{node_1.output}}\n\nAI Risk Assessment:\n{{node_2.output}}\n\nPlease approve or reject.',
          timeoutMinutes: 1440,
          position: { x: 600, y: 150 },
        },
        {
          id: 'node_4',
          tool: 'core.create_memory',
          label: 'Log Approval',
          args: {
            content: 'Request approved: {{node_1.output}}. Risk assessment: {{node_2.output}}',
            importance: 8,
          },
          position: { x: 850, y: 50 },
        },
        {
          id: 'node_5',
          type: 'notification',
          label: 'Approved',
          message: 'Your request has been approved and logged.',
          severity: 'success',
          position: { x: 1100, y: 50 },
        },
        {
          id: 'node_6',
          tool: 'core.create_memory',
          label: 'Log Rejection',
          args: { content: 'Request rejected: {{node_1.output}}', importance: 5 },
          position: { x: 850, y: 250 },
        },
        {
          id: 'node_7',
          type: 'notification',
          label: 'Rejected',
          message: 'Your request was not approved.',
          severity: 'warning',
          position: { x: 1100, y: 250 },
        },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4', sourceHandle: 'approved' },
        { source: 'node_3', target: 'node_6', sourceHandle: 'rejected' },
        { source: 'node_4', target: 'node_5' },
        { source: 'node_6', target: 'node_7' },
      ],
    },
  },
  {
    id: 'approval-workflow',
    name: 'Approval Workflow',
    description:
      'AI drafts a proposal, submits for human approval, then notifies based on the decision',
    category: 'Automation',
    nodeCount: 7,
    definition: {
      name: 'Approval Workflow',
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          triggerType: 'manual',
          label: 'Submit Request',
          position: { x: 100, y: 150 },
        },
        {
          id: 'node_2',
          type: 'llm',
          label: 'Draft Proposal',
          provider: 'default',
          model: 'default',
          systemPrompt:
            'You are a professional proposal writer. Draft a clear, concise proposal based on the request. Include: objective, approach, timeline, and expected outcomes. Format it professionally.',
          userMessage: 'Draft a proposal for this request:\n\n{{node_1.output}}',
          temperature: 0.6,
          maxTokens: 3000,
          position: { x: 350, y: 150 },
        },
        {
          id: 'node_3',
          type: 'approval',
          label: 'Review & Approve',
          approvalMessage:
            'Please review this AI-drafted proposal:\n\n{{node_2.output}}\n\nOriginal request: {{node_1.output}}',
          timeoutMinutes: 2880,
          position: { x: 600, y: 150 },
        },
        {
          id: 'node_4',
          type: 'condition',
          label: 'Approved?',
          expression: 'data === true || data === "approved"',
          position: { x: 850, y: 150 },
        },
        {
          id: 'node_5',
          type: 'notification',
          label: 'Approved',
          message: 'Your proposal has been approved!\n\nProposal:\n{{node_2.output}}',
          severity: 'success',
          position: { x: 1100, y: 50 },
        },
        {
          id: 'node_6',
          type: 'notification',
          label: 'Rejected',
          message:
            'Your proposal was not approved. Please revise and resubmit.\n\nOriginal request: {{node_1.output}}',
          severity: 'warning',
          position: { x: 1100, y: 250 },
        },
        {
          id: 'node_7',
          tool: 'core.create_memory',
          label: 'Log Decision',
          args: {
            content: 'Proposal decision: {{node_4.output}}. Request: {{node_1.output}}',
            importance: 6,
          },
          position: { x: 1350, y: 150 },
        },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
        { source: 'node_4', target: 'node_5', sourceHandle: 'true' },
        { source: 'node_4', target: 'node_6', sourceHandle: 'false' },
        { source: 'node_5', target: 'node_7' },
        { source: 'node_6', target: 'node_7' },
      ],
    },
  },
];
