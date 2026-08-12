/**
 * Data workflow templates.
 *
 * Split by category out of workflow-templates.ts (1268 LOC). Data only —
 * the catalog is re-exported unchanged from that file.
 */

import type { WorkflowTemplate } from '../workflow-templates';

export const DATA_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'data-import-pipeline',
    name: 'Data Import Pipeline',
    description: 'Fetch API data, validate each record, and store in custom data tables',
    category: 'Data',
    nodeCount: 7,
    definition: {
      name: 'Data Import Pipeline',
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          triggerType: 'manual',
          label: 'Start Import',
          position: { x: 100, y: 150 },
        },
        {
          id: 'node_2',
          type: 'httpRequest',
          label: 'Fetch API Data',
          method: 'GET',
          url: '{{variables.apiUrl}}',
          headers: { Authorization: 'Bearer {{variables.apiToken}}' },
          position: { x: 300, y: 150 },
        },
        {
          id: 'node_3',
          type: 'code',
          label: 'Parse & Validate',
          language: 'javascript',
          code: 'const response = data.body || data;\nconst items = Array.isArray(response) ? response : (response.data || response.results || []);\nconst valid = items.filter(item => {\n  if (!item || typeof item !== "object") return false;\n  if (!item.id && !item.name) return false;\n  return true;\n});\nreturn { total: items.length, valid: valid.length, skipped: items.length - valid.length, records: valid };',
          position: { x: 550, y: 150 },
        },
        {
          id: 'node_4',
          type: 'condition',
          label: 'Has Records?',
          expression: 'data && data.valid > 0',
          position: { x: 800, y: 150 },
        },
        {
          id: 'node_5',
          type: 'forEach',
          label: 'Store Each Record',
          arrayExpression: '{{node_3.output.records}}',
          itemVariable: 'record',
          maxIterations: 500,
          onError: 'continue',
          position: { x: 1050, y: 50 },
        },
        {
          id: 'node_6',
          tool: 'core.add_custom_record',
          label: 'Save to Table',
          args: { table: '{{variables.tableName}}', data: '{{record}}' },
          position: { x: 1050, y: 200 },
        },
        {
          id: 'node_7',
          type: 'notification',
          label: 'No Data',
          message: 'API returned no valid records from {{variables.apiUrl}}',
          severity: 'warning',
          position: { x: 1050, y: 300 },
        },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
        { source: 'node_4', target: 'node_5', sourceHandle: 'true' },
        { source: 'node_4', target: 'node_7', sourceHandle: 'false' },
        { source: 'node_5', target: 'node_6', sourceHandle: 'each' },
      ],
      variables: {
        apiUrl: 'https://api.example.com/data',
        apiToken: '',
        tableName: 'imported_records',
      },
    },
  },
  {
    id: 'data-pipeline',
    name: 'Data Pipeline',
    description:
      'Fetch data via HTTP, filter and transform records, aggregate results, summarize with AI',
    category: 'Data',
    nodeCount: 7,
    definition: {
      name: 'Data Pipeline',
      nodes: [
        {
          id: 'node_1',
          type: 'trigger',
          triggerType: 'manual',
          label: 'Start Pipeline',
          position: { x: 100, y: 150 },
        },
        {
          id: 'node_2',
          type: 'httpRequest',
          label: 'Fetch Source Data',
          method: 'GET',
          url: '{{variables.dataSourceUrl}}',
          headers: { Authorization: 'Bearer {{variables.apiToken}}' },
          position: { x: 300, y: 150 },
        },
        {
          id: 'node_3',
          type: 'code',
          label: 'Filter Records',
          language: 'javascript',
          code: 'const response = data.body || data;\nconst items = Array.isArray(response) ? response : (response.data || response.results || []);\nreturn items.filter(item => item && typeof item === "object" && item.status !== "archived");',
          position: { x: 500, y: 150 },
        },
        {
          id: 'node_4',
          type: 'transformer',
          label: 'Map Fields',
          expression:
            'Array.isArray(data) ? data.map(item => ({ id: item.id, name: item.name || item.title, value: item.amount || item.value || 0, date: item.created_at || item.date })) : []',
          position: { x: 700, y: 150 },
        },
        {
          id: 'node_5',
          type: 'code',
          label: 'Aggregate',
          language: 'javascript',
          code: 'const items = Array.isArray(data) ? data : [];\nconst total = items.reduce((sum, i) => sum + (Number(i.value) || 0), 0);\nconst count = items.length;\nconst avg = count > 0 ? total / count : 0;\nreturn { count, total: Math.round(total * 100) / 100, average: Math.round(avg * 100) / 100, items };',
          position: { x: 900, y: 150 },
        },
        {
          id: 'node_6',
          type: 'llm',
          label: 'Summarize Results',
          provider: 'default',
          model: 'default',
          systemPrompt:
            'You are a data analyst. Summarize the aggregated data into a clear, actionable report. Highlight trends, outliers, and key metrics.',
          userMessage:
            'Summarize this aggregated data:\n\nTotal records: {{node_5.output.count}}\nTotal value: {{node_5.output.total}}\nAverage value: {{node_5.output.average}}\n\nSample records:\n{{node_5.output.items}}',
          temperature: 0.4,
          maxTokens: 2048,
          position: { x: 1100, y: 150 },
        },
        {
          id: 'node_7',
          type: 'notification',
          label: 'Deliver Report',
          message: '{{node_6.output}}',
          severity: 'info',
          position: { x: 1300, y: 150 },
        },
      ],
      edges: [
        { source: 'node_1', target: 'node_2' },
        { source: 'node_2', target: 'node_3' },
        { source: 'node_3', target: 'node_4' },
        { source: 'node_4', target: 'node_5' },
        { source: 'node_5', target: 'node_6' },
        { source: 'node_6', target: 'node_7' },
      ],
      variables: {
        dataSourceUrl: 'https://api.example.com/records',
        apiToken: '',
      },
    },
  },
];
