/**
 * Page Copilot Prompt Router
 *
 * Maps pageType to domain-specific system prompt sections.
 * These are appended to the ## Page Context section when the sidebar
 * chat is used on a specific page type.
 */

import { buildAgentCopilotSection } from './agent-copilot-prompt.js';
import { buildMcpCopilotSection } from './mcp-copilot-prompt.js';
import { buildToolCopilotSection } from './tool-copilot-prompt.js';
import { buildSkillCopilotSection } from './skill-copilot-prompt.js';
import { buildClawCopilotSection } from './claw-copilot-prompt.js';
import { buildWorkspaceCopilotSection } from './workspace-copilot-prompt.js';
import { buildCodingAgentCopilotSection } from './coding-agent-copilot-prompt.js';
import { buildAutonomousCopilotSection } from './autonomous-copilot-prompt.js';
import { buildCliToolsCopilotSection } from './cli-tools-copilot-prompt.js';
import { buildToolGroupsCopilotSection } from './tool-groups-copilot-prompt.js';
import { buildWorkflowToolsCopilotSection } from './workflow-tools-copilot-prompt.js';
import { STATIC_PROMPT as WORKFLOW_FULL_PROMPT } from '../workflow-copilot-prompt.js';

export function getPageCopilotPrompt(pageType: string, contextData?: Record<string, unknown>, hasEntity = false): string {
  switch (pageType) {
    case 'workflow':
      return hasEntity ? buildWorkflowCopilotFull() : buildWorkflowCopilotSection();
    case 'agent':
      return buildAgentCopilotSection(contextData);
    case 'tool':
    case 'custom-tool':
      return buildToolCopilotSection(contextData);
    case 'mcp-server':
      return buildMcpCopilotSection(contextData);
    case 'skill':
      return buildSkillCopilotSection(contextData);
    case 'claw':
      return buildClawCopilotSection(contextData);
    case 'workspace':
      return buildWorkspaceCopilotSection(contextData);
    case 'coding-agent':
      return buildCodingAgentCopilotSection(contextData);
    case 'autonomous':
      return buildAutonomousCopilotSection(contextData);
    case 'cli-tool':
      return buildCliToolsCopilotSection(contextData);
    case 'tool-group':
      return buildToolGroupsCopilotSection(contextData);
    case 'workflow-tool':
      return buildWorkflowToolsCopilotSection(contextData);
    default:
      return '';
  }
}

/**
 * Enriched workflow copilot section for sidebar chat page context injection.
 * Contains node types, template syntax, edge rules, data flow, and common mistakes
 * from the full workflow-copilot-prompt.ts — condensed for sidebar use.
 */
function buildWorkflowCopilotSection(): string {
  return `\n### Workflow Assistant

You are helping the user build or edit an OwnPilot visual workflow.
When suggesting changes, output the COMPLETE workflow JSON inside a \`\`\`json code block.

**Node Types (24)**
- **trigger** — entry point: \`triggerType\`: manual | schedule | event | condition | webhook. Schedule: add \`cron\`. Webhook: add \`webhookPath\`. Max ONE per workflow.
- **llm** — AI model call: \`provider\`: "default", \`model\`: "default", \`systemPrompt\`, \`userMessage\` (required). Use \`responseFormat: "json"\` for structured output.
- **tool** — registered tool: \`tool\`: "exact.name" (no \`type\` field!), \`args\`: {params}
- **condition** — if/else: \`expression\` (JS against \`data\`). Edges MUST use \`sourceHandle: "true"\` / \`"false"\`
- **switch** — multi-branch: \`expression\`, \`cases\`: [{label, value}]. Edges use \`sourceHandle\` = case label or "default"
- **forEach** — loop: \`arrayExpression\`, \`itemVariable\`, \`maxIterations\`. Edges: "each" / "done"
- **parallel** — concurrent: \`branchCount\` (2-10). Edges: "branch-0", "branch-1", ...
- **merge** — collect parallel results: \`mode\`: "waitAll" | "firstCompleted"
- **httpRequest** — API call: \`method\` + \`url\` (required). Optional: \`headers\`, \`body\`, \`auth\`
- **code** — run code: \`language\`: js/python/shell, \`code\` (use \`data\` var, \`return\` for output)
- **transformer** — reshape: \`expression\` (JS against \`data\`)
- **filter** — filter array: \`arrayExpression\`, \`condition\` (access \`item\`, \`index\`)
- **map** — transform array: \`arrayExpression\`, \`expression\` (access \`item\`, \`index\`)
- **aggregate** — reduce: \`arrayExpression\`, \`operation\`: sum/count/avg/min/max/groupBy/flatten/unique
- **delay** — pause: \`duration\` + \`unit\` (seconds/minutes/hours). Max 1 hour.
- **dataStore** — persist: \`operation\`: get/set/delete/list/has, \`key\`, \`value\`, \`namespace\`
- **notification** — alert: \`message\` (required), \`severity\`: info/warning/error/success
- **subWorkflow** — nested: \`subWorkflowId\` (required), \`inputMapping\`, \`maxDepth\`
- **approval** — human gate: \`approvalMessage\`, \`timeoutMinutes\`
- **webhookResponse** — HTTP response: \`statusCode\`, \`body\`, \`contentType\`
- **errorHandler** — catch: max ONE per workflow. Place off main flow. \`continueOnSuccess\`
- **claw** — autonomous agent: \`name\`, \`mission\`, \`mode\`: single-shot/continuous/interval/event
- **stickyNote** — annotation only: \`text\`, \`color\`. No connections, not executed.

**Template Syntax** (used in tool args, LLM messages, HTTP urls/body, notifications)
- \`{{nodeId.output}}\` — full output of upstream node
- \`{{nodeId.output.field}}\` — nested field access
- \`{{variables.key}}\` — workflow-level variable
- \`{{inputs.paramName}}\` — workflow input parameter
- \`{{alias}}\` — node output alias (set via \`outputAlias\` field)
- Type preservation: \`"{{node_2.output}}"\` keeps original type; \`"Result: {{node_2.output}}"\` becomes string

**Expression Nodes** (condition, switch, transformer, code) use \`data\` variable — NOT templates:
- CORRECT: \`"expression": "data.items.length > 0"\`
- WRONG: \`"expression": "{{node_2.output}}.items.length > 0"\`

**Edge Rules**
- Basic: \`{ "source": "node_1", "target": "node_2" }\`
- Condition: MUST use \`sourceHandle\`: "true" or "false"
- ForEach: MUST use \`sourceHandle\`: "each" or "done"
- Switch: MUST use \`sourceHandle\`: case label or "default"
- Parallel: MUST use \`sourceHandle\`: "branch-0", "branch-1", ...

**Data Flow Patterns**
- Tool → LLM: \`"userMessage": "Summarize: {{node_2.output}}"\`
- LLM → Tool: \`"args": { "content": "{{node_3.output}}" }\`
- HTTP → Transformer: \`"expression": "data.body.results"\` (HTTP output: {status, body, headers})
- ForEach body: \`"args": { "id": "{{item.id}}" }\` (when itemVariable="item")

**Layout**
- Trigger at y=50, each level +150px. Center at x=300. Branches offset x±200.

**Common Mistakes to Avoid**
1. NEVER add multiple trigger nodes — max ONE (node_1)
2. LLM nodes MUST include \`userMessage\`
3. Use \`"provider": "default"\` and \`"model": "default"\` unless user specifies
4. Condition/ForEach/Switch edges MUST have \`sourceHandle\`
5. HTTP nodes MUST include \`method\` and \`url\`
6. Always include \`"edges": []\` even if empty

**Database Access** — for advanced inspection:
\`\`\`
psql -h localhost -p 25432 -U ownpilot -d ownpilot
SELECT nodes, edges, variables FROM workflows WHERE id = '<workflow_id>';
SELECT * FROM workflow_logs WHERE workflow_id = '<workflow_id>' ORDER BY started_at DESC LIMIT 5;
\`\`\``;
}

/**
 * Full workflow copilot prompt (~6,700 tokens) — used when viewing a SPECIFIC workflow.
 * Reuses the same 600-line STATIC_PROMPT from workflow-copilot-prompt.ts
 * that the dedicated Copilot panel uses. Ensures sidebar chat has identical
 * workflow editing capabilities when user is on /workflows/:id.
 */
function buildWorkflowCopilotFull(): string {
  return '\n### Workflow Editor (Full)\n\n' + WORKFLOW_FULL_PROMPT;
}
