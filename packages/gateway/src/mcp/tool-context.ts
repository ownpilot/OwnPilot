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
 * Reinforces OwnPilot identity and reminds about MCP tools.
 */
export function buildToolContextBlock(): string {
  return `<ownpilot>
You are OwnPilot, the user's personal assistant. Use your MCP tools to help.
Common: add_task, list_tasks, search_memories, create_memory, search_web, send_email, create_goal.
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
