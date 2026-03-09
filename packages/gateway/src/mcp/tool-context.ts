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
 * Build a concise tool usage guide to prepend to the first user message.
 * Kept short to avoid wasting context window on coding CLIs.
 */
export function buildToolContextBlock(): string {
  return `<ownpilot_tools>
You have access to OwnPilot's tool system via 4 MCP tools.
Use them to help the user with tasks beyond coding.

WORKFLOW:
1. search_tools(query: "keyword") — find tools by keyword (or "all" to list everything)
2. get_tool_help(tool_name: "core.xxx") — get parameter docs for a specific tool
3. use_tool(tool_name: "core.xxx", arguments: {...}) — execute a tool
4. batch_use_tool(calls: [{tool_name, arguments}, ...]) — execute multiple tools in parallel

Tool names use namespaces: core.*, custom.*, plugin.*, skill.*
Common tools: core.add_task, core.search_web, core.add_memory, core.list_tasks,
core.send_email, core.manage_goal, core.web_fetch, core.search_memory

When the user asks to do something that requires a tool (tasks, memory, email, web search, etc.),
search for the right tool first, then use it. Don't guess tool names — always search first.
</ownpilot_tools>`;
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
