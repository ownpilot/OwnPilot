import { useState } from 'react';
import { X, Layout, Zap, Brain, Database, Clock, Settings } from '../icons';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  nodeCount: number;
  definition: {
    name: string;
    nodes: unknown[];
    edges: unknown[];
    variables?: Record<string, unknown>;
  };
}

interface TemplateGalleryProps {
  onUseTemplate: (template: WorkflowTemplate) => void;
  onClose: () => void;
}

// Templates use copilot definition format — converted via convertDefinitionToReactFlow.
// LLM nodes use provider/model 'default' — resolved at runtime to the user's configured defaults.
// Tool nodes use full dotted names (core.search_memories, core.list_goals, etc.).
const TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'daily-memory-briefing',
    name: 'Daily Memory Briefing',
    description: 'Search recent memories, summarize with AI, and deliver a morning briefing',
    category: 'Scheduling',
    nodeCount: 4,
    definition: {
      name: 'Daily Memory Briefing',
      nodes: [
        { id: 'node_1', type: 'trigger', triggerType: 'schedule', label: 'Daily 9AM', cron: '0 9 * * *', position: { x: 100, y: 150 } },
        { id: 'node_2', tool: 'core.search_memories', label: 'Search Recent Memories', args: { query: 'important events tasks updates', limit: 20 }, position: { x: 350, y: 150 } },
        { id: 'node_3', type: 'llm', label: 'Summarize Briefing', provider: 'default', model: 'default', systemPrompt: 'You are a concise personal assistant. Create a clear morning briefing from the user\'s recent memories. Group by topic, highlight action items, and keep it scannable.', userMessage: 'Create my daily briefing from these recent memories:\n\n{{node_2.output}}', temperature: 0.5, maxTokens: 2048, position: { x: 600, y: 150 } },
        { id: 'node_4', type: 'notification', label: 'Deliver Briefing', message: '{{node_3.output}}', severity: 'info', position: { x: 850, y: 150 } },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
      ],
    },
  },
  {
    id: 'goal-progress-tracker',
    name: 'Goal Progress Tracker',
    description: 'Review active goals, analyze progress with AI, flag blocked items',
    category: 'Automation',
    nodeCount: 6,
    definition: {
      name: 'Goal Progress Tracker',
      nodes: [
        { id: 'node_1', type: 'trigger', triggerType: 'schedule', label: 'Weekly Monday 8AM', cron: '0 8 * * 1', position: { x: 100, y: 150 } },
        { id: 'node_2', tool: 'core.list_goals', label: 'Get Active Goals', args: { status: 'active', limit: 50 }, position: { x: 300, y: 150 } },
        { id: 'node_3', type: 'llm', label: 'Analyze Progress', provider: 'default', model: 'default', systemPrompt: 'You are a productivity coach. Analyze the user\'s goals and their steps. Identify: (1) goals making good progress, (2) goals that are stalled or blocked, (3) suggested next actions. Be specific and actionable.', userMessage: 'Analyze my goal progress:\n\n{{node_2.output}}', temperature: 0.4, maxTokens: 3000, position: { x: 550, y: 150 } },
        { id: 'node_4', type: 'condition', label: 'Any Blocked?', expression: 'typeof data === "string" && (data.toLowerCase().includes("blocked") || data.toLowerCase().includes("stalled"))', position: { x: 800, y: 150 } },
        { id: 'node_5', type: 'notification', label: 'Alert: Blocked Goals', message: '{{node_3.output}}', severity: 'warning', position: { x: 1050, y: 50 } },
        { id: 'node_6', type: 'notification', label: 'Weekly Update', message: '{{node_3.output}}', severity: 'info', position: { x: 1050, y: 250 } },
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
    id: 'smart-content-pipeline',
    name: 'Smart Content Pipeline',
    description: 'Generate content with AI, auto-review for quality, revise if needed',
    category: 'AI',
    nodeCount: 6,
    definition: {
      name: 'Smart Content Pipeline',
      nodes: [
        { id: 'node_1', type: 'trigger', triggerType: 'manual', label: 'Start', position: { x: 100, y: 150 } },
        { id: 'node_2', type: 'llm', label: 'Generate Draft', provider: 'default', model: 'default', systemPrompt: 'You are an expert content writer. Write high-quality, engaging content based on the user\'s request.', userMessage: 'Write a {{variables.contentType}} about: {{variables.topic}}\n\nTone: {{variables.tone}}\nTarget audience: {{variables.audience}}', temperature: 0.8, maxTokens: 4096, position: { x: 350, y: 150 } },
        { id: 'node_3', type: 'llm', label: 'Quality Review', provider: 'default', model: 'default', systemPrompt: 'You are a strict content reviewer. Rate the content on a scale of 1-10 for quality, clarity, and engagement. If the score is 7 or above, respond with "PASS: [score]". If below 7, respond with "REVISE: [specific improvements needed]".', userMessage: 'Review this {{variables.contentType}}:\n\n{{node_2.output}}', temperature: 0.3, maxTokens: 1024, position: { x: 600, y: 150 } },
        { id: 'node_4', type: 'condition', label: 'Quality Check', expression: 'typeof data === "string" && data.startsWith("PASS")', position: { x: 850, y: 150 } },
        { id: 'node_5', type: 'notification', label: 'Content Ready', message: 'Your {{variables.contentType}} is ready:\n\n{{node_2.output}}', severity: 'success', position: { x: 1100, y: 50 } },
        { id: 'node_6', type: 'llm', label: 'Revise Content', provider: 'default', model: 'default', systemPrompt: 'You are an expert editor. Revise the content based on the reviewer\'s feedback while preserving the original intent and voice.', userMessage: 'Original content:\n{{node_2.output}}\n\nReviewer feedback:\n{{node_3.output}}\n\nPlease revise accordingly.', temperature: 0.6, maxTokens: 4096, position: { x: 1100, y: 250 } },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
        { source: 'node_4', target: 'node_5', sourceHandle: 'true' },
        { source: 'node_4', target: 'node_6', sourceHandle: 'false' },
      ],
      variables: { contentType: 'blog post', topic: 'AI automation in daily life', tone: 'professional but approachable', audience: 'tech-savvy professionals' },
    },
  },
  {
    id: 'webhook-processor',
    name: 'Webhook Processor',
    description: 'Receive webhook, validate payload, classify with AI, and route to handlers',
    category: 'Integration',
    nodeCount: 7,
    definition: {
      name: 'Webhook Processor',
      nodes: [
        { id: 'node_1', type: 'trigger', triggerType: 'webhook', label: 'Incoming Webhook', webhookPath: '/events', position: { x: 100, y: 150 } },
        { id: 'node_2', type: 'code', label: 'Validate Payload', language: 'javascript', code: 'const body = typeof data === "string" ? JSON.parse(data) : (data.body || data);\nif (!body || !body.type) throw new Error("Invalid payload: missing type field");\nreturn { type: body.type, payload: body, receivedAt: new Date().toISOString() };', position: { x: 350, y: 150 } },
        { id: 'node_3', type: 'switch', label: 'Route by Type', expression: 'data.type', cases: [{ label: 'user_signup', value: 'user_signup' }, { label: 'payment', value: 'payment' }, { label: 'error', value: 'error' }], position: { x: 600, y: 150 } },
        { id: 'node_4', tool: 'core.create_memory', label: 'Save New User', args: { content: 'New user signed up: {{node_2.output.payload}}', importance: 7 }, position: { x: 900, y: 30 } },
        { id: 'node_5', tool: 'core.add_custom_record', label: 'Log Payment', args: { table: 'payments', data: '{{node_2.output.payload}}' }, position: { x: 900, y: 150 } },
        { id: 'node_6', type: 'notification', label: 'Error Alert', message: 'Webhook error event received:\n{{node_2.output.payload}}', severity: 'error', position: { x: 900, y: 270 } },
        { id: 'node_7', type: 'notification', label: 'Unknown Type', message: 'Unhandled webhook type: {{node_2.output.type}}', severity: 'warning', position: { x: 900, y: 390 } },
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
    id: 'task-digest',
    name: 'Weekly Task Digest',
    description: 'Gather tasks, goals, and memories into a comprehensive weekly digest',
    category: 'Scheduling',
    nodeCount: 7,
    definition: {
      name: 'Weekly Task Digest',
      nodes: [
        { id: 'node_1', type: 'trigger', triggerType: 'schedule', label: 'Friday 5PM', cron: '0 17 * * 5', position: { x: 100, y: 150 } },
        { id: 'node_2', type: 'parallel', label: 'Gather Data', branchCount: 3, branchLabels: ['Tasks', 'Goals', 'Memories'], position: { x: 300, y: 150 } },
        { id: 'node_3', tool: 'core.list_tasks', label: 'Get Tasks', args: { limit: 30 }, position: { x: 550, y: 30 } },
        { id: 'node_4', tool: 'core.list_goals', label: 'Get Goals', args: { status: 'active', limit: 20 }, position: { x: 550, y: 150 } },
        { id: 'node_5', tool: 'core.search_memories', label: 'Get Key Memories', args: { query: 'achievements progress milestones completed', limit: 15 }, position: { x: 550, y: 270 } },
        { id: 'node_6', type: 'merge', label: 'Combine All', mode: 'waitAll', position: { x: 800, y: 150 } },
        { id: 'node_7', type: 'llm', label: 'Format Digest', provider: 'default', model: 'default', systemPrompt: 'You are a personal productivity assistant. Create a well-structured weekly digest with sections for: completed tasks, pending tasks, goal progress, and key highlights. Use bullet points and be concise.', userMessage: 'Format my weekly digest from this data:\n\nTasks: {{node_3.output}}\n\nGoals: {{node_4.output}}\n\nKey Memories: {{node_5.output}}', temperature: 0.5, maxTokens: 3000, position: { x: 1050, y: 150 } },
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
    id: 'approval-flow',
    name: 'Approval Flow',
    description: 'AI risk analysis, human approval gate, then execute with audit trail',
    category: 'Automation',
    nodeCount: 7,
    definition: {
      name: 'Approval Flow',
      nodes: [
        { id: 'node_1', type: 'trigger', triggerType: 'manual', label: 'Submit Request', position: { x: 100, y: 150 } },
        { id: 'node_2', type: 'llm', label: 'Risk Analysis', provider: 'default', model: 'default', systemPrompt: 'You are a risk analyst. Evaluate the request and classify risk as LOW, MEDIUM, or HIGH. Provide a brief justification. Format: "RISK: [level]\\n\\nAnalysis: [details]"', userMessage: 'Evaluate this request:\n\n{{node_1.output}}', temperature: 0.3, maxTokens: 1024, position: { x: 350, y: 150 } },
        { id: 'node_3', type: 'approval', label: 'Manager Approval', approvalMessage: 'Request: {{node_1.output}}\n\nAI Risk Assessment:\n{{node_2.output}}\n\nPlease approve or reject.', timeoutMinutes: 1440, position: { x: 600, y: 150 } },
        { id: 'node_4', tool: 'core.create_memory', label: 'Log Approval', args: { content: 'Request approved: {{node_1.output}}. Risk assessment: {{node_2.output}}', importance: 8 }, position: { x: 850, y: 50 } },
        { id: 'node_5', type: 'notification', label: 'Approved', message: 'Your request has been approved and logged.', severity: 'success', position: { x: 1100, y: 50 } },
        { id: 'node_6', tool: 'core.create_memory', label: 'Log Rejection', args: { content: 'Request rejected: {{node_1.output}}', importance: 5 }, position: { x: 850, y: 250 } },
        { id: 'node_7', type: 'notification', label: 'Rejected', message: 'Your request was not approved.', severity: 'warning', position: { x: 1100, y: 250 } },
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
    id: 'multi-intent-router',
    name: 'Multi-Intent Router',
    description: 'Classify user input into categories and route to specialized AI handlers',
    category: 'AI',
    nodeCount: 7,
    definition: {
      name: 'Multi-Intent Router',
      nodes: [
        { id: 'node_1', type: 'trigger', triggerType: 'manual', label: 'User Input', position: { x: 100, y: 200 } },
        { id: 'node_2', type: 'llm', label: 'Classify Intent', provider: 'default', model: 'default', systemPrompt: 'Classify the user input into exactly one category. Reply with ONLY the category name, nothing else.\n\nCategories:\n- question (factual questions, how-to)\n- task (action items, things to do)\n- creative (writing, brainstorming, ideas)\n- analysis (data interpretation, research)', userMessage: '{{node_1.output}}', temperature: 0.1, maxTokens: 50, position: { x: 350, y: 200 } },
        { id: 'node_3', type: 'switch', label: 'Route Intent', expression: 'typeof data === "string" ? data.trim().toLowerCase() : "question"', cases: [{ label: 'question', value: 'question' }, { label: 'task', value: 'task' }, { label: 'creative', value: 'creative' }, { label: 'analysis', value: 'analysis' }], position: { x: 600, y: 200 } },
        { id: 'node_4', type: 'llm', label: 'Answer Question', provider: 'default', model: 'default', systemPrompt: 'You are a knowledgeable assistant. Provide clear, accurate answers with sources when possible.', userMessage: '{{node_1.output}}', temperature: 0.4, maxTokens: 2048, position: { x: 900, y: 30 } },
        { id: 'node_5', type: 'llm', label: 'Plan Task', provider: 'default', model: 'default', systemPrompt: 'You are a task planner. Break down the request into clear, actionable steps with priorities and estimated effort.', userMessage: 'Create an action plan for: {{node_1.output}}', temperature: 0.5, maxTokens: 2048, position: { x: 900, y: 150 } },
        { id: 'node_6', type: 'llm', label: 'Creative Work', provider: 'default', model: 'default', systemPrompt: 'You are a creative writing assistant. Be imaginative, original, and engaging.', userMessage: '{{node_1.output}}', temperature: 0.9, maxTokens: 4096, position: { x: 900, y: 270 } },
        { id: 'node_7', type: 'llm', label: 'Deep Analysis', provider: 'default', model: 'default', systemPrompt: 'You are a research analyst. Provide thorough, structured analysis with pros/cons, key findings, and recommendations.', userMessage: 'Analyze: {{node_1.output}}', temperature: 0.4, maxTokens: 4096, position: { x: 900, y: 390 } },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4', sourceHandle: 'question' },
        { source: 'node_3', target: 'node_5', sourceHandle: 'task' },
        { source: 'node_3', target: 'node_6', sourceHandle: 'creative' },
        { source: 'node_3', target: 'node_7', sourceHandle: 'analysis' },
      ],
    },
  },
  {
    id: 'data-import-pipeline',
    name: 'Data Import Pipeline',
    description: 'Fetch API data, validate each record, and store in custom data tables',
    category: 'Data',
    nodeCount: 7,
    definition: {
      name: 'Data Import Pipeline',
      nodes: [
        { id: 'node_1', type: 'trigger', triggerType: 'manual', label: 'Start Import', position: { x: 100, y: 150 } },
        { id: 'node_2', type: 'httpRequest', label: 'Fetch API Data', method: 'GET', url: '{{variables.apiUrl}}', headers: { 'Authorization': 'Bearer {{variables.apiToken}}' }, position: { x: 300, y: 150 } },
        { id: 'node_3', type: 'code', label: 'Parse & Validate', language: 'javascript', code: 'const response = data.body || data;\nconst items = Array.isArray(response) ? response : (response.data || response.results || []);\nconst valid = items.filter(item => {\n  if (!item || typeof item !== "object") return false;\n  if (!item.id && !item.name) return false;\n  return true;\n});\nreturn { total: items.length, valid: valid.length, skipped: items.length - valid.length, records: valid };', position: { x: 550, y: 150 } },
        { id: 'node_4', type: 'condition', label: 'Has Records?', expression: 'data && data.valid > 0', position: { x: 800, y: 150 } },
        { id: 'node_5', type: 'forEach', label: 'Store Each Record', arrayExpression: '{{node_3.output.records}}', itemVariable: 'record', maxIterations: 500, onError: 'continue', position: { x: 1050, y: 50 } },
        { id: 'node_6', tool: 'core.add_custom_record', label: 'Save to Table', args: { table: '{{variables.tableName}}', data: '{{record}}' }, position: { x: 1050, y: 200 } },
        { id: 'node_7', type: 'notification', label: 'No Data', message: 'API returned no valid records from {{variables.apiUrl}}', severity: 'warning', position: { x: 1050, y: 300 } },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
        { source: 'node_4', target: 'node_5', sourceHandle: 'true' },
        { source: 'node_4', target: 'node_7', sourceHandle: 'false' },
        { source: 'node_5', target: 'node_6', sourceHandle: 'each' },
      ],
      variables: { apiUrl: 'https://api.example.com/data', apiToken: '', tableName: 'imported_records' },
    },
  },
  {
    id: 'knowledge-capture',
    name: 'Knowledge Capture',
    description: 'Process input with AI, extract key facts, and save as structured memories',
    category: 'AI',
    nodeCount: 5,
    definition: {
      name: 'Knowledge Capture',
      nodes: [
        { id: 'node_1', type: 'trigger', triggerType: 'manual', label: 'Input Knowledge', position: { x: 100, y: 150 } },
        { id: 'node_2', type: 'llm', label: 'Extract Key Facts', provider: 'default', model: 'default', systemPrompt: 'Extract key facts, insights, and actionable items from the input. Return a JSON array of objects, each with: {"fact": "...", "importance": 1-10, "category": "insight|action|reference"}. Return ONLY valid JSON, no explanation.', userMessage: '{{node_1.output}}', temperature: 0.3, maxTokens: 2048, position: { x: 350, y: 150 } },
        { id: 'node_3', type: 'code', label: 'Parse Facts', language: 'javascript', code: 'const text = typeof data === "string" ? data : JSON.stringify(data);\nconst jsonMatch = text.match(/\\[\\s*\\{[\\s\\S]*\\}\\s*\\]/);\nif (!jsonMatch) return [];\ntry { return JSON.parse(jsonMatch[0]); } catch { return []; }', position: { x: 600, y: 150 } },
        { id: 'node_4', type: 'forEach', label: 'Save Each Fact', arrayExpression: '{{node_3.output}}', itemVariable: 'fact', onError: 'continue', position: { x: 850, y: 150 } },
        { id: 'node_5', tool: 'core.create_memory', label: 'Store Memory', args: { content: '{{fact.fact}}', importance: '{{fact.importance}}' }, position: { x: 850, y: 300 } },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
        { source: 'node_4', target: 'node_5', sourceHandle: 'each' },
      ],
    },
  },
  {
    id: 'parallel-research',
    name: 'Parallel Research',
    description: 'Run 3 specialized AI analyses in parallel, merge results, synthesize a report',
    category: 'AI',
    nodeCount: 8,
    definition: {
      name: 'Parallel Research',
      nodes: [
        { id: 'node_1', type: 'trigger', triggerType: 'manual', label: 'Research Topic', position: { x: 100, y: 200 } },
        { id: 'node_2', type: 'parallel', label: 'Research Branches', branchCount: 3, branchLabels: ['Technical', 'Market', 'Risks'], position: { x: 300, y: 200 } },
        { id: 'node_3', type: 'llm', label: 'Technical Analysis', provider: 'default', model: 'default', systemPrompt: 'You are a technical analyst. Provide deep technical analysis including architecture, implementation challenges, and technology stack recommendations.', userMessage: 'Technical analysis of: {{variables.topic}}', temperature: 0.5, maxTokens: 3000, position: { x: 550, y: 50 } },
        { id: 'node_4', type: 'llm', label: 'Market Analysis', provider: 'default', model: 'default', systemPrompt: 'You are a market analyst. Analyze market size, competition, trends, target audience, and go-to-market strategy.', userMessage: 'Market analysis of: {{variables.topic}}', temperature: 0.5, maxTokens: 3000, position: { x: 550, y: 200 } },
        { id: 'node_5', type: 'llm', label: 'Risk Assessment', provider: 'default', model: 'default', systemPrompt: 'You are a risk analyst. Identify potential risks, regulatory concerns, scalability issues, and mitigation strategies.', userMessage: 'Risk assessment for: {{variables.topic}}', temperature: 0.4, maxTokens: 2000, position: { x: 550, y: 350 } },
        { id: 'node_6', type: 'merge', label: 'Combine Results', mode: 'waitAll', position: { x: 800, y: 200 } },
        { id: 'node_7', type: 'llm', label: 'Synthesize Report', provider: 'default', model: 'default', systemPrompt: 'You are an executive analyst. Synthesize the three research reports into a cohesive executive summary with key findings, recommendations, and next steps. Use clear headings and bullet points.', userMessage: 'Synthesize these three research reports into one executive summary:\n\nTechnical Analysis:\n{{node_3.output}}\n\nMarket Analysis:\n{{node_4.output}}\n\nRisk Assessment:\n{{node_5.output}}', temperature: 0.5, maxTokens: 4096, position: { x: 1050, y: 200 } },
        { id: 'node_8', type: 'notification', label: 'Report Ready', message: 'Research report for "{{variables.topic}}" is complete.', severity: 'success', position: { x: 1300, y: 200 } },
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
        { source: 'node_7', target: 'node_8' },
      ],
      variables: { topic: 'AI-powered personal assistant platforms' },
    },
  },
];

const CATEGORIES = ['All', 'AI', 'Scheduling', 'Integration', 'Data', 'Automation'];

const categoryIcons: Record<string, React.ReactElement> = {
  AI: <Brain className="w-3 h-3" />,
  Scheduling: <Clock className="w-3 h-3" />,
  Integration: <Zap className="w-3 h-3" />,
  Data: <Database className="w-3 h-3" />,
  Automation: <Settings className="w-3 h-3" />,
};

export function TemplateGallery({ onUseTemplate, onClose }: TemplateGalleryProps) {
  const [selectedCategory, setSelectedCategory] = useState('All');

  const filteredTemplates =
    selectedCategory === 'All'
      ? TEMPLATES
      : TEMPLATES.filter((t) => t.category === selectedCategory);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-bg-secondary dark:bg-dark-bg-secondary rounded-xl shadow-2xl border border-border dark:border-dark-border max-w-3xl w-full max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
          <div className="flex items-center gap-2">
            <Layout className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Workflow Templates
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-primary dark:hover:bg-dark-bg-primary rounded transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-text-muted dark:text-dark-text-muted" />
          </button>
        </div>

        {/* Category Tabs */}
        <div className="flex gap-2 px-6 py-3 border-b border-border dark:border-dark-border overflow-x-auto">
          {CATEGORIES.map((category) => (
            <button
              key={category}
              onClick={() => setSelectedCategory(category)}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                selectedCategory === category
                  ? 'bg-primary text-white'
                  : 'bg-bg-primary dark:bg-dark-bg-primary text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Template Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTemplates.map((template) => (
              <div
                key={template.id}
                className="border border-border dark:border-dark-border rounded-lg p-4 hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => onUseTemplate(template)}
              >
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-text-primary dark:text-dark-text-primary">
                    {template.name}
                  </h3>
                  <div className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-primary/10 text-primary">
                    {categoryIcons[template.category]}
                    <span>{template.category}</span>
                  </div>
                </div>
                <p className="text-sm text-text-muted dark:text-dark-text-muted mb-3">
                  {template.description}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted dark:text-dark-text-muted">
                    {template.nodeCount} nodes
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onUseTemplate(template);
                    }}
                    className="px-3 py-1 text-xs font-medium bg-primary text-white rounded hover:bg-primary/90 transition-colors"
                  >
                    Use Template
                  </button>
                </div>
              </div>
            ))}
          </div>

          {filteredTemplates.length === 0 && (
            <div className="text-center py-12 text-text-muted dark:text-dark-text-muted">
              No templates found in this category
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
