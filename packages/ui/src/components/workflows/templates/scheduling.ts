/**
 * Scheduling workflow templates.
 *
 * Split by category out of workflow-templates.ts (1268 LOC). Data only —
 * the catalog is re-exported unchanged from that file.
 */

import type { WorkflowTemplate } from '../workflow-templates';

export const SCHEDULING_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'daily-memory-briefing',
    name: 'Daily Memory Briefing',
    description: 'Search recent memories, summarize with AI, and deliver a morning briefing',
    category: 'Scheduling',
    nodeCount: 4,
    definition: {
      name: 'Daily Memory Briefing',
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          triggerType: 'schedule',
          label: 'Daily 9AM',
          cron: '0 9 * * *',
          position: { x: 100, y: 150 },
        },
        {
          id: 'node_2',
          tool: 'core.search_memories',
          label: 'Search Recent Memories',
          args: { query: 'important events tasks updates', limit: 20 },
          position: { x: 350, y: 150 },
        },
        {
          id: 'node_3',
          type: 'llm',
          label: 'Summarize Briefing',
          provider: 'default',
          model: 'default',
          systemPrompt:
            "You are a concise personal assistant. Create a clear morning briefing from the user's recent memories. Group by topic, highlight action items, and keep it scannable.",
          userMessage: 'Create my daily briefing from these recent memories:\n\n{{node_2.output}}',
          temperature: 0.5,
          maxTokens: 2048,
          position: { x: 600, y: 150 },
        },
        {
          id: 'node_4',
          type: 'notification',
          label: 'Deliver Briefing',
          message: '{{node_3.output}}',
          severity: 'info',
          position: { x: 850, y: 150 },
        },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
      ],
    },
  },
  {
    id: 'task-digest',
    name: 'Weekly Task Digest',
    description: 'Gather tasks, goals, and memories into a comprehensive weekly digest',
    category: 'Scheduling',
    nodeCount: 7,
    definition: {
      name: 'Weekly Task Digest',
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          triggerType: 'schedule',
          label: 'Friday 5PM',
          cron: '0 17 * * 5',
          position: { x: 100, y: 150 },
        },
        {
          id: 'node_2',
          type: 'parallel',
          label: 'Gather Data',
          branchCount: 3,
          branchLabels: ['Tasks', 'Goals', 'Memories'],
          position: { x: 300, y: 150 },
        },
        {
          id: 'node_3',
          tool: 'core.list_tasks',
          label: 'Get Tasks',
          args: { limit: 30 },
          position: { x: 550, y: 30 },
        },
        {
          id: 'node_4',
          tool: 'core.list_goals',
          label: 'Get Goals',
          args: { status: 'active', limit: 20 },
          position: { x: 550, y: 150 },
        },
        {
          id: 'node_5',
          tool: 'core.search_memories',
          label: 'Get Key Memories',
          args: { query: 'achievements progress milestones completed', limit: 15 },
          position: { x: 550, y: 270 },
        },
        {
          id: 'node_6',
          type: 'merge',
          label: 'Combine All',
          mode: 'waitAll',
          position: { x: 800, y: 150 },
        },
        {
          id: 'node_7',
          type: 'llm',
          label: 'Format Digest',
          provider: 'default',
          model: 'default',
          systemPrompt:
            'You are a personal productivity assistant. Create a well-structured weekly digest with sections for: completed tasks, pending tasks, goal progress, and key highlights. Use bullet points and be concise.',
          userMessage:
            'Format my weekly digest from this data:\n\nTasks: {{node_3.output}}\n\nGoals: {{node_4.output}}\n\nKey Memories: {{node_5.output}}',
          temperature: 0.5,
          maxTokens: 3000,
          position: { x: 1050, y: 150 },
        },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3', sourceHandle: 'branch-0' },
        { source: 'node_2', target: 'node_4', sourceHandle: 'branch-1' },
        { source: 'node_2', target: 'node_5', sourceHandle: 'branch-2' },
        { source: 'node_3', target: 'node_6' },
        { source: 'node_4', target: 'node_6' },
        { source: 'node_5', target: 'node_6' },
        { source: 'node_6', target: 'node_7' },
      ],
    },
  },
  {
    id: 'scheduled-report',
    name: 'Scheduled Report',
    description: 'Gather data on a schedule, analyze with AI, and post results to a webhook',
    category: 'Scheduling',
    nodeCount: 5,
    definition: {
      name: 'Scheduled Report',
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          triggerType: 'schedule',
          label: 'Daily 7AM',
          cron: '0 7 * * *',
          position: { x: 100, y: 150 },
        },
        {
          id: 'node_2',
          tool: 'core.search_memories',
          label: 'Gather Data',
          args: { query: 'metrics performance status updates', limit: 30 },
          position: { x: 350, y: 150 },
        },
        {
          id: 'node_3',
          type: 'llm',
          label: 'Analyze & Format',
          provider: 'default',
          model: 'default',
          systemPrompt:
            'You are a reporting assistant. Analyze the data and produce a structured daily report in JSON format with sections: "summary", "highlights" (array of strings), "metrics" (key-value pairs), and "actionItems" (array of strings).',
          userMessage: 'Generate a daily report from this data:\n\n{{node_2.output}}',
          temperature: 0.4,
          maxTokens: 3000,
          responseFormat: 'json',
          position: { x: 600, y: 150 },
        },
        {
          id: 'node_4',
          type: 'httpRequest',
          label: 'Post to Webhook',
          method: 'POST',
          url: '{{variables.webhookUrl}}',
          headers: { 'Content-Type': 'application/json' },
          body: '{"report": {{node_3.output}}, "generatedAt": "{{variables.timestamp}}"}',
          bodyType: 'json',
          position: { x: 850, y: 150 },
        },
        {
          id: 'node_5',
          type: 'notification',
          label: 'Report Sent',
          message: 'Daily report posted to webhook successfully.',
          severity: 'success',
          position: { x: 1100, y: 150 },
        },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
        { source: 'node_4', target: 'node_5' },
      ],
      variables: {
        webhookUrl: 'https://hooks.example.com/reports',
        timestamp: '',
      },
    },
  },
];
