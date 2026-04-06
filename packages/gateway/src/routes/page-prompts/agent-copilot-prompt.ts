/**
 * Agent Page Copilot Prompt
 *
 * Domain-specific system prompt section for the Agent configuration page.
 * Injected into ## Page Context when the user is on an agent detail/edit view.
 */

export function buildAgentCopilotSection(contextData?: Record<string, unknown>): string {
  const parts: string[] = [];

  parts.push(`\n### Agent Configuration Assistant

You are helping the user configure an OwnPilot agent. Focus on practical guidance for:

**System Prompt Best Practices**
- Be specific about the agent's role and scope — vague prompts produce inconsistent behavior
- Include output format instructions (markdown, JSON, plain text) when relevant
- Add constraints ("do not", "always", "never") to prevent unwanted behavior
- Keep the system prompt under 2000 tokens for cost efficiency

**Tool Selection**
- Only enable tools the agent actually needs — fewer tools = faster, cheaper responses
- Group related tools (e.g., all file tools, all search tools) to help the model understand its capabilities
- If the agent needs web access, enable \`search\` and/or \`fetch\` tools
- For coding tasks, enable \`code_interpreter\` or relevant shell tools

**Provider & Model Configuration**
- \`default\` provider/model uses your configured default — good for general tasks
- Use a more capable model (e.g., claude-opus-4) for complex reasoning, cheaper model for simple tasks
- Set temperature: 0 for deterministic tasks (data extraction), 0.7+ for creative tasks
- Max tokens: set a limit to control costs; leave unset for tasks with variable-length output`);

  // Reference specific agent config if provided
  if (contextData && typeof contextData === 'object') {
    const { name, systemPrompt, tools, provider, model } = contextData as {
      name?: string;
      systemPrompt?: string;
      tools?: string[];
      provider?: string;
      model?: string;
    };

    const refs: string[] = [];
    if (name) refs.push(`- Agent name: **${name}**`);
    if (provider || model) refs.push(`- Current model: ${provider ?? 'default'} / ${model ?? 'default'}`);
    if (tools && Array.isArray(tools) && tools.length > 0) {
      refs.push(`- Enabled tools (${tools.length}): ${tools.slice(0, 8).join(', ')}${tools.length > 8 ? '…' : ''}`);
    }
    if (systemPrompt && typeof systemPrompt === 'string') {
      const wordCount = systemPrompt.split(/\s+/).length;
      refs.push(`- Current system prompt: ~${wordCount} words`);
    }

    if (refs.length > 0) {
      parts.push(`\n**Current Agent**\n${refs.join('\n')}`);
    }
  }

  return parts.join('\n');
}
