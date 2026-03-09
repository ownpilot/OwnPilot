/**
 * Tool Context Injection for CLI Chat
 *
 * When CLI providers have MCP tools available, this injects concise instructions
 * into the user message explaining how to use the 4 meta-tools.
 *
 * This goes into the USER message (not system prompt) because coding CLIs
 * have their own system prompts we can't modify.
 */

/**
 * Build a minimal tool context hint for CLI providers.
 * Kept extremely short — CLIs discover tools via MCP's tools/list.
 */
export function buildToolContextBlock(): string {
  return `<ownpilot>
You have OwnPilot tools available via MCP. Call them directly when needed.
Common: add_task, list_tasks, search_memory, add_memory, search_web, web_fetch, send_email, manage_goal.
</ownpilot>`;
}

/**
 * Inject tool context into the first user message of a conversation.
 * Returns a new message array with context prepended to the first user message.
 */
export function injectToolContext(
  messages: readonly { role: string; content: string | unknown }[]
): typeof messages {
  const toolBlock = buildToolContextBlock();
  const result = [...messages];
  let injected = false;

  for (let i = 0; i < result.length; i++) {
    const msg = result[i]!;
    if (msg.role === 'user' && typeof msg.content === 'string' && !injected) {
      result[i] = {
        ...msg,
        content: `${toolBlock}\n\n${msg.content}`,
      };
      injected = true;
      break;
    }
  }

  return result;
}
