import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Callout } from '@/components/ui/Callout';
import { Badge } from '@/components/ui/Badge';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const MCP_CLIENT_CONFIG = `# Configure MCP servers via Settings → MCP, or via the CLI:
ownpilot config set mcp-servers '[
  {
    "name": "filesystem",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user/documents"]
  },
  {
    "name": "github",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."
    }
  }
]'`;

const MCP_CLIENT_HTTP = `# Or configure via the REST API:
POST /api/v1/mcp/servers
Content-Type: application/json

{
  "name": "brave-search",
  "type": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-brave-search"],
  "env": {
    "BRAVE_API_KEY": "BSA..."
  },
  "autoStart": true
}`;

const MCP_LIST_SERVERS = `# List connected MCP servers
GET /api/v1/mcp/servers

# Response:
{
  "data": [
    {
      "id": "mcp_filesystem",
      "name": "filesystem",
      "status": "connected",
      "tools": ["read_file", "write_file", "list_directory", "search_files"],
      "toolCount": 4,
      "connectedAt": "2026-03-16T08:00:00Z"
    }
  ]
}`;

const MCP_TOOLS_USAGE = `# MCP tools are automatically available to the agent.
# The agent can search for them:
# "search_tools filesystem" → returns filesystem MCP tools
#
# And call them like any built-in tool:
# use_tool("filesystem.read_file", { "path": "/docs/README.md" })
#
# MCP tools appear in the agent's tool search under their server name`;

const MCP_SERVER_CONFIG_CLAUDE = `// claude_desktop_config.json
{
  "mcpServers": {
    "ownpilot": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}`;

const MCP_SERVER_TOOLS = `# OwnPilot exposes all 190+ tools via Streamable HTTP at /mcp
# Example tools available to Claude Desktop:

core__create_note        → Create a note
core__list_tasks         → List your tasks
core__remember           → Store a memory
core__search_web         → Search the web
core__execute_code       → Run sandboxed code
core__create_event       → Create calendar event
core__send_telegram_msg  → Send Telegram message
# ... and 180+ more

# Dots in tool names are converted to double-underscores for MCP compatibility
# e.g. core.create_note → core__create_note`;

const MCP_PRESETS = `# Popular MCP server presets (available in Settings → MCP → Add Preset):
#
# Filesystem     — Read/write local files
# GitHub         — Issues, PRs, repos, gists
# Brave Search   — Web search via Brave
# PostgreSQL     — Query any PostgreSQL database
# Puppeteer      — Browser automation
# Slack          — Read/write Slack messages
# Google Drive   — Access Drive files
# Memory         — External persistent memory store
# Sequential Thinking — Chain-of-thought reasoning
# Fetch          — HTTP requests with SSRF protection`;

const MCP_AUTH = `# If AUTH_TYPE=api-key, include the key in MCP requests:
# Streamable HTTP transport (recommended for Claude Desktop):
{
  "type": "http",
  "url": "http://your-server:8080/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_API_KEY"
  }
}

# Note: Claude Code uses "type": "http" (not "streamable-http")
# for Streamable HTTP transport`;

export function McpPage() {
  return (
    <DocsLayout>
      <Badge variant="purple" className="mb-3">
        MCP Integration
      </Badge>
      <h1>MCP Integration</h1>
      <p className="text-lg text-[var(--color-text-muted)] mb-8">
        OwnPilot is both an MCP client and an MCP server. As a client, it connects to external MCP
        servers and uses their tools natively. As a server, it exposes all 190+ built-in tools to
        Claude Desktop, Claude Code, and any other MCP client.
      </p>

      <h2>OwnPilot as MCP client</h2>
      <p>
        Connect any MCP-compatible tool server to OwnPilot. The tools become immediately available
        to the agent in all conversations, workflows, and autonomous agents — no restart required.
      </p>

      <h3>Configuring MCP servers</h3>
      <CodeBlock code={MCP_CLIENT_CONFIG} language="bash" filename="configure-mcp.sh" />
      <p>Or via the REST API:</p>
      <CodeBlock code={MCP_CLIENT_HTTP} language="http" filename="add-mcp-server.http" />

      <h3>Listing and inspecting connected servers</h3>
      <CodeBlock code={MCP_LIST_SERVERS} language="http" filename="list-mcp-servers.http" />

      <h3>MCP server management API</h3>
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Endpoint</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>GET</code>
            </td>
            <td>
              <code>/api/v1/mcp/servers</code>
            </td>
            <td>List all MCP servers</td>
          </tr>
          <tr>
            <td>
              <code>POST</code>
            </td>
            <td>
              <code>/api/v1/mcp/servers</code>
            </td>
            <td>Add MCP server</td>
          </tr>
          <tr>
            <td>
              <code>GET</code>
            </td>
            <td>
              <code>/api/v1/mcp/servers/:id</code>
            </td>
            <td>Get server details + tools</td>
          </tr>
          <tr>
            <td>
              <code>DELETE</code>
            </td>
            <td>
              <code>/api/v1/mcp/servers/:id</code>
            </td>
            <td>Remove server</td>
          </tr>
          <tr>
            <td>
              <code>POST</code>
            </td>
            <td>
              <code>/api/v1/mcp/servers/:id/connect</code>
            </td>
            <td>Connect/reconnect</td>
          </tr>
          <tr>
            <td>
              <code>POST</code>
            </td>
            <td>
              <code>/api/v1/mcp/servers/:id/disconnect</code>
            </td>
            <td>Disconnect</td>
          </tr>
        </tbody>
      </table>

      <h3>Transport types</h3>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Description</th>
            <th>When to use</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>stdio</code>
            </td>
            <td>Launch a local process, communicate over stdin/stdout</td>
            <td>Local tools (filesystem, git, etc.)</td>
          </tr>
          <tr>
            <td>
              <code>http</code>
            </td>
            <td>Streamable HTTP transport</td>
            <td>Remote MCP servers, services</td>
          </tr>
          <tr>
            <td>
              <code>sse</code>
            </td>
            <td>Server-Sent Events transport (legacy)</td>
            <td>Older MCP servers</td>
          </tr>
        </tbody>
      </table>

      <h3>Using MCP tools in conversations</h3>
      <CodeBlock code={MCP_TOOLS_USAGE} language="bash" />

      <Callout type="tip" title="Tool discovery">
        MCP tools are discovered automatically when a server connects. They appear in the agent's
        tool search under their server name. The agent doesn't need any special instructions — it
        can find and use MCP tools the same way as built-in tools.
      </Callout>

      <h3>Popular server presets</h3>
      <CodeBlock code={MCP_PRESETS} language="bash" />

      <h2>OwnPilot as MCP server</h2>
      <p>
        OwnPilot exposes all 190+ built-in tools as a Streamable HTTP MCP endpoint at
        <code>/mcp</code>. This lets Claude Desktop, Claude Code, Cursor, and other MCP clients use
        your personal data and tools directly.
      </p>

      <h3>Connecting Claude Desktop</h3>
      <CodeBlock
        code={MCP_SERVER_CONFIG_CLAUDE}
        language="json"
        filename="claude_desktop_config.json"
      />

      <p>
        On macOS, this file is at{' '}
        <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>. On Windows:{' '}
        <code>%APPDATA%\Claude\claude_desktop_config.json</code>.
      </p>

      <h3>Available tools in Claude Desktop</h3>
      <CodeBlock code={MCP_SERVER_TOOLS} language="bash" />

      <Callout type="info" title="Tool name encoding">
        MCP requires tool names to contain only alphanumeric characters and underscores. OwnPilot's
        dot-prefixed namespaces (<code>core.create_note</code>) are automatically converted to
        double-underscore format (<code>core__create_note</code>) for MCP compatibility. The reverse
        mapping is applied when the tool is executed.
      </Callout>

      <h3>Authentication for the MCP server</h3>
      <CodeBlock code={MCP_AUTH} language="json" />

      <h3>Connecting Claude Code (CLI)</h3>
      <CodeBlock
        code={`# Add to your .mcp.json or use --mcp-config flag:
{
  "mcpServers": {
    "ownpilot": {
      "type": "http",
      "url": "http://localhost:8080/mcp"
    }
  }
}

# Run Claude Code with MCP config:
claude -p "List my tasks for today" \\
  --mcp-config .mcp.json \\
  --allowedTools "mcp__ownpilot__*"`}
        language="bash"
        filename="claude-code-mcp.sh"
      />

      <Callout type="note" title="Claude Code transport">
        Claude Code uses <code>"type": "http"</code> (not <code>"streamable-http"</code>) for
        Streamable HTTP transport. Use <code>--mcp-config</code> explicitly — Claude Code does not
        auto-read <code>.mcp.json</code> in <code>-p</code> (print) mode.
      </Callout>

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/channels"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Channels
        </Link>
        <Link
          to="/docs/coding-agents"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Coding Agents
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
