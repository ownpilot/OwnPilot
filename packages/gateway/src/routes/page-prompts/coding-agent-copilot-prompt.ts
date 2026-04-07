/**
 * Coding Agent Copilot Prompt
 *
 * Domain-specific system prompt section for the Coding Agents page.
 * Injected into ## Page Context when the user is viewing a coding agent session.
 * Note: coding-agents use preferBridge=true for file-system access.
 */

export function buildCodingAgentCopilotSection(contextData?: Record<string, unknown>): string {
  const parts: string[] = [];

  parts.push(`\n### Coding Agent Assistant

You are helping the user manage coding agent sessions — CLI-based AI tools that write and edit code.

**Supported Coding Agents**
- **Claude Code** (claude) — Anthropic's CLI for code editing, testing, git
- **Codex** (codex) — OpenAI's code generation CLI
- **Gemini** (gemini) — Google's AI CLI
- **OpenCode** (opencode) — Multi-provider CLI (DashScope, OpenRouter)

**Session Management**
- Each session has: provider, model, working directory (cwd), status
- Sessions can be active (running) or idle (waiting for input)
- The bridge spawns the actual CLI process in the host filesystem
- Multiple sessions can run concurrently on different projects

**Bridge Integration**
- Coding agents are spawned via the bridge's runtime registry
- The \`X-Runtime\` header selects which CLI tool to use
- Bridge forwards the conversation and returns streamed responses
- File changes happen directly on the host filesystem

**Common Tasks**
- "What is this agent working on?" → Check recent git commits in the cwd
- "Show the latest error" → Read terminal output or test results
- "Help debug" → Analyze error messages and suggest fixes
- "Switch model" → Change the provider/model for the next interaction`);

  if (contextData && typeof contextData === 'object') {
    const { displayName, provider, cwd } = contextData as {
      displayName?: string;
      provider?: string;
      cwd?: string;
    };

    const refs: string[] = [];
    if (displayName) refs.push(`- Session: **${displayName}**`);
    if (provider) refs.push(`- Provider: ${provider}`);
    if (cwd) refs.push(`- Working directory: \`${cwd}\``);

    if (refs.length > 0) {
      parts.push(`\n**Current Session**\n${refs.join('\n')}`);
    }
  }

  return parts.join('\n');
}
