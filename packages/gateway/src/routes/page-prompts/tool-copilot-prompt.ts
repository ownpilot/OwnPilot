/**
 * Tool / Custom Extension Copilot Prompt
 *
 * Domain-specific system prompt section for the Tool and Custom Tool pages.
 * Injected into ## Page Context when the user is viewing/editing a tool or extension.
 */

export function buildToolCopilotSection(contextData?: Record<string, unknown>): string {
  const parts: string[] = [];

  parts.push(`\n### Tool Development Assistant

You are helping the user create or edit an OwnPilot custom tool (JavaScript/TypeScript extension).

**Tool Schema**
Every tool must define:
\`\`\`json
{
  "name": "my_tool",
  "description": "Clear, action-oriented description (verb + noun)",
  "parameters": {
    "type": "object",
    "properties": {
      "param_name": { "type": "string", "description": "What this parameter does" }
    },
    "required": ["param_name"]
  }
}
\`\`\`

**Code Patterns**
- Export a default async function: \`export default async function(params, context) { ... }\`
- Return a plain value, string, or object — it will be serialized for the LLM
- Use \`context.log()\` for debug output (visible in tool execution logs)
- Throw descriptive errors: \`throw new Error('Missing required param: id')\`
- Keep tools focused — one tool per operation, not a Swiss Army knife

**Testing Tools**
- Use the "Test" panel to run the tool with sample inputs before saving
- Check the execution log for errors and timing
- Verify the return value is what the agent would receive`);

  // Reference specific tool/extension config if provided
  if (contextData && typeof contextData === 'object') {
    const { name, description, code } = contextData as {
      name?: string;
      description?: string;
      code?: string;
    };

    const refs: string[] = [];
    if (name) refs.push(`- Tool name: **${name}**`);
    if (description) refs.push(`- Description: ${description}`);
    if (code && typeof code === 'string') {
      const lineCount = code.split('\n').length;
      refs.push(`- Current code: ${lineCount} lines`);
    }

    if (refs.length > 0) {
      parts.push(`\n**Current Tool**\n${refs.join('\n')}`);
    }
  }

  return parts.join('\n');
}
