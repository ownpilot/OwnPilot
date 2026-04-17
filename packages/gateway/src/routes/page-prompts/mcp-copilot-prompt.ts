/**
 * MCP Server Copilot Prompt
 *
 * Domain-specific system prompt section for the MCP Server page.
 * Injected into ## Page Context when the user is viewing/configuring an MCP server.
 */

export function buildMcpCopilotSection(contextData?: Record<string, unknown>): string {
  const parts: string[] = [];

  parts.push(`\n### MCP Server Assistant

You are helping the user connect and configure an MCP (Model Context Protocol) server.

**Connection Diagnostics**
- Verify the server URL/command is reachable: \`curl -s http://localhost:PORT/ping\`
- Check the server process is running: \`ps aux | grep mcp\`
- Review server logs for startup errors
- Ensure the transport type matches the server implementation (stdio vs HTTP/SSE)

**Tool Discovery**
- Once connected, list available tools: the server exposes them via the MCP handshake
- Tool names follow the pattern: \`server_name.tool_name\` (e.g., \`github.list_repos\`)
- Use discovered tools in workflows with the exact dotted name

**Common Issues & Fixes**
| Issue | Fix |
|-------|-----|
| Connection refused | Server not running — start it or check port |
| Auth error | Verify API key / token in server config |
| Tool call timeout | Increase timeout or check server logs |
| "Unknown tool" | Reconnect to refresh tool list |
| stdio not responding | Check that the command path is correct and executable |`);

  // Reference specific server config if provided
  if (contextData && typeof contextData === 'object') {
    const { name, transport, url, command } = contextData as {
      name?: string;
      transport?: string;
      url?: string;
      command?: string;
    };

    const refs: string[] = [];
    if (name) refs.push(`- Server: **${name}**`);
    if (transport) refs.push(`- Transport: ${transport}`);
    if (url) refs.push(`- URL: \`${url}\``);
    if (command) refs.push(`- Command: \`${command}\``);

    if (refs.length > 0) {
      parts.push(`\n**Current Server**\n${refs.join('\n')}`);
    }
  }

  return parts.join('\n');
}
