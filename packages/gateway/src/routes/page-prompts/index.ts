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

export function getPageCopilotPrompt(pageType: string, contextData?: Record<string, unknown>): string {
  switch (pageType) {
    case 'workflow':
      return buildWorkflowCopilotSection();
    case 'agent':
      return buildAgentCopilotSection(contextData);
    case 'tool':
    case 'custom-tool':
      return buildToolCopilotSection(contextData);
    case 'mcp-server':
      return buildMcpCopilotSection(contextData);
    default:
      return '';
  }
}

/**
 * Condensed workflow copilot section for page context injection.
 * References node types only — not the full 657-line prompt (which is used
 * by the dedicated workflow copilot chat endpoint).
 */
function buildWorkflowCopilotSection(): string {
  return `\n### Workflow Assistant

You are helping the user build or edit an OwnPilot visual workflow.

**Available Node Types (24 total)**
- **trigger** — workflow entry point (manual / schedule / event / condition / webhook)
- **llm** — call an AI model with a prompt
- **tool** — execute a registered tool (identified by \`tool\` field, no \`type\` field)
- **condition** — if/else branching (edges use \`sourceHandle: "true"\` / \`"false"\`)
- **switch** — multi-branch routing by expression value
- **forEach** — iterate over an array (edges: \`"each"\` / \`"done"\`)
- **parallel** — run branches concurrently (edges: \`"branch-0"\`, \`"branch-1"\`, …)
- **merge** — collect results from parallel branches
- **httpRequest** — make an HTTP call (requires \`method\` + \`url\`)
- **notification** — send a message or alert
- **delay** — pause execution (requires \`duration\` + \`unit\`)
- **transformer** — reshape data with a JS expression
- **code** — run arbitrary JavaScript
- **filter** — remove items from an array
- **map** — transform each item in an array
- **aggregate** — reduce/collect array items
- **dataStore** — read/write persistent key-value data
- **subWorkflow** — call another workflow by ID
- **approval** — pause and wait for human approval
- **webhookResponse** — respond to an incoming webhook
- **errorHandler** — catch errors from upstream nodes
- **claw** — run an autonomous Claw agent
- **setVariable** — store a value for later nodes
- **note** — visual annotation only (no execution)

**Key Rules**
- Exactly ONE trigger node per workflow (always node_1)
- Node IDs must be sequential: node_1, node_2, …
- Tool nodes use \`"tool": "exact.tool.name"\` — no \`type\` field
- Always return the COMPLETE workflow JSON, never a partial patch`;
}
