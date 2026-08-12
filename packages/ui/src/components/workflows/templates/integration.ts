/**
 * Integration workflow templates.
 *
 * Split by category out of workflow-templates.ts (1268 LOC). Data only —
 * the catalog is re-exported unchanged from that file.
 */

import type { WorkflowTemplate } from '../workflow-templates';

export const INTEGRATION_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'webhook-processor',
    name: 'Webhook Processor',
    description: 'Receive webhook, validate payload, classify with AI, and route to handlers',
    category: 'Integration',
    nodeCount: 7,
    definition: {
      name: 'Webhook Processor',
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          triggerType: 'webhook',
          label: 'Incoming Webhook',
          webhookPath: '/events',
          position: { x: 100, y: 150 },
        },
        {
          id: 'node_2',
          type: 'code',
          label: 'Validate Payload',
          language: 'javascript',
          code: 'const body = typeof data === "string" ? JSON.parse(data) : (data.body || data);\nif (!body || !body.type) throw new Error("Invalid payload: missing type field");\nreturn { type: body.type, payload: body, receivedAt: new Date().toISOString() };',
          position: { x: 350, y: 150 },
        },
        {
          id: 'node_3',
          type: 'switch',
          label: 'Route by Type',
          expression: 'data.type',
          cases: [
            { label: 'user_signup', value: 'user_signup' },
            { label: 'payment', value: 'payment' },
            { label: 'error', value: 'error' },
          ],
          position: { x: 600, y: 150 },
        },
        {
          id: 'node_4',
          tool: 'core.create_memory',
          label: 'Save New User',
          args: { content: 'New user signed up: {{node_2.output.payload}}', importance: 7 },
          position: { x: 900, y: 30 },
        },
        {
          id: 'node_5',
          tool: 'core.add_custom_record',
          label: 'Log Payment',
          args: { table: 'payments', data: '{{node_2.output.payload}}' },
          position: { x: 900, y: 150 },
        },
        {
          id: 'node_6',
          type: 'notification',
          label: 'Error Alert',
          message: 'Webhook error event received:\n{{node_2.output.payload}}',
          severity: 'error',
          position: { x: 900, y: 270 },
        },
        {
          id: 'node_7',
          type: 'notification',
          label: 'Unknown Type',
          message: 'Unhandled webhook type: {{node_2.output.type}}',
          severity: 'warning',
          position: { x: 900, y: 390 },
        },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4', sourceHandle: 'user_signup' },
        { source: 'node_3', target: 'node_5', sourceHandle: 'payment' },
        { source: 'node_3', target: 'node_6', sourceHandle: 'error' },
        { source: 'node_3', target: 'node_7', sourceHandle: 'default' },
      ],
    },
  },
  {
    id: 'github-issue-triage',
    name: 'GitHub Issue Triage',
    description:
      'Fetch issues via HTTP, classify priority and labels with AI, route critical issues to alerts',
    category: 'Integration',
    nodeCount: 6,
    definition: {
      name: 'GitHub Issue Triage',
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          triggerType: 'schedule',
          label: 'Every 30 Minutes',
          cron: '*/30 * * * *',
          position: { x: 100, y: 150 },
        },
        {
          id: 'node_2',
          type: 'httpRequest',
          label: 'Fetch Open Issues',
          method: 'GET',
          url: 'https://api.github.com/repos/{{variables.owner}}/{{variables.repo}}/issues?state=open&per_page=10&sort=created&direction=desc',
          headers: {
            Accept: 'application/vnd.github+json',
            Authorization: 'Bearer {{variables.githubToken}}',
          },
          position: { x: 350, y: 150 },
        },
        {
          id: 'node_3',
          type: 'llm',
          label: 'Classify Priority',
          provider: 'default',
          model: 'default',
          systemPrompt:
            'You are an issue triage assistant. For each GitHub issue, classify its priority as "critical", "high", "medium", or "low" and suggest labels. Return a JSON array of objects: [{"number": <issue_number>, "title": "...", "priority": "critical|high|medium|low", "labels": ["bug","feature",...], "reason": "..."}].',
          userMessage:
            'Classify these GitHub issues by priority and suggest labels:\n\n{{node_2.output.body}}',
          temperature: 0.2,
          maxTokens: 2048,
          responseFormat: 'json',
          position: { x: 600, y: 150 },
        },
        {
          id: 'node_4',
          type: 'condition',
          label: 'Any Critical?',
          expression:
            'Array.isArray(data) ? data.some(i => i.priority === "critical") : (typeof data === "string" && data.includes("critical"))',
          position: { x: 850, y: 150 },
        },
        {
          id: 'node_5',
          type: 'notification',
          label: 'Critical Alert',
          message:
            'CRITICAL issues found in {{variables.owner}}/{{variables.repo}}:\n\n{{node_3.output}}',
          severity: 'error',
          position: { x: 1100, y: 50 },
        },
        {
          id: 'node_6',
          type: 'notification',
          label: 'Triage Summary',
          message:
            'Issue triage complete for {{variables.owner}}/{{variables.repo}}:\n\n{{node_3.output}}',
          severity: 'info',
          position: { x: 1100, y: 250 },
        },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
        { source: 'node_4', target: 'node_5', sourceHandle: 'true' },
        { source: 'node_4', target: 'node_6', sourceHandle: 'false' },
      ],
      variables: {
        owner: 'my-org',
        repo: 'my-repo',
        githubToken: '',
      },
    },
  },
];
