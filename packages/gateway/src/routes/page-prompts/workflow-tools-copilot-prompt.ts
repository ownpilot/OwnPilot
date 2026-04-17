/**
 * Workflow Tools Settings Copilot Prompt
 *
 * Domain-specific system prompt section for the Workflow Tools settings page.
 * Injected into ## Page Context when the user is managing which tools are available
 * inside the workflow engine (workflowUsable toggle).
 */

export function buildWorkflowToolsCopilotSection(_contextData?: Record<string, unknown>): string {
  const parts: string[] = [];

  parts.push(`\n### Workflow Tools Manager Assistant

You are helping the user control which custom tools and MCP server tools can be used inside workflows.

**How It Works**
- Workflows can only use tools marked as "workflow usable"
- This is a safety gate — prevents untested tools from running in automated workflows
- Two tool sources: **Custom Tools** (JavaScript) and **MCP Server Tools** (external)

**Custom Tools Tab**
- Shows all active custom tools from the database
- Each tool has a \`workflowUsable\` toggle
- Toggling OFF a tool used in active workflows shows a warning
- Tools must be saved and active before they can be workflow-enabled

**MCP Tools Tab**
- Shows tools exposed by connected MCP servers
- Each MCP tool can be individually toggled for workflow use
- MCP tools are discovered via the server's tool listing handshake
- Tool settings are stored in the server's \`metadata.toolSettings\`

**Safety Considerations**
- Always test a tool manually before enabling it for workflows
- Disabling a tool used in active workflows may cause those workflows to fail
- Review the "Active Workflows" column to see dependencies before toggling
- Use this page to audit which tools have workflow access

**API Reference**
\`\`\`
GET   /api/v1/custom-tools                        — List custom tools
PATCH /api/v1/custom-tools/:id/workflow-usable    — Toggle workflowUsable
GET   /api/v1/mcp                                  — List MCP servers
GET   /api/v1/mcp/:id/tools                        — List MCP server tools
PATCH /api/v1/mcp/:id/tool-settings                — Toggle MCP tool settings
GET   /api/v1/workflows/active-tool-names           — Tools used in active workflows
\`\`\``);

  return parts.join('\n');
}
