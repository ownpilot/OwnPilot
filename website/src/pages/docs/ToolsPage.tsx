import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const TOOL_CATEGORIES = `Personal Data:    notes, tasks, bookmarks, contacts, calendar, expenses
Productivity:     pomodoro, habits, quick-capture, goals
Memory:           remember, recall, search-memories
Files:            read-file, write-file, list-files, search-files
Code:             execute-code, run-script, sandbox
Web:              search-web, fetch-url, browser
Email:            send-email, read-email, search-email
Git:              git-log, git-diff, git-commit
Translation:      translate-text
Weather:          get-weather
Finance:          get-stock-price, convert-currency
IoT/Edge:         list-devices, read-sensor, send-command
Voice:            transcribe-audio, text-to-speech
Browser:          navigate, click, screenshot, fill-form
Artifacts:        create-artifact, update-artifact
CLI:              run-cli-tool, list-cli-tools
Orchestra:        create-orchestra, run-orchestra
Subagents:        spawn-subagent, check-subagent
MCP:              (dynamic, from connected MCP servers)
Custom:           (user-defined via Extension SDK)
Skills:           (from installed SKILL.md packages)`;

export function ToolsPage() {
  return (
    <DocsLayout>
      <Badge variant="blue" className="mb-3">
        Tool System
      </Badge>
      <h1>Tool System Overview</h1>
      <p>
        OwnPilot provides 190+ built-in tools across 32 categories, plus extensible hooks for custom
        tools, MCP tools, skills, and extensions. The meta-tool proxy keeps LLM context lean.
      </p>

      <h2>Meta-tool Proxy</h2>
      <p>
        Instead of sending all 190+ tool definitions to the LLM (which would consume thousands of
        tokens), OwnPilot uses a meta-tool proxy pattern. Only 4 tools are ever sent to the LLM:
      </p>
      <ul>
        <li>
          <code>search_tools</code> — Find tools by keyword or category
        </li>
        <li>
          <code>get_tool_help</code> — Get full schema for a specific tool
        </li>
        <li>
          <code>use_tool</code> — Execute any tool by name and arguments
        </li>
        <li>
          <code>batch_use_tool</code> — Execute multiple tools in parallel
        </li>
      </ul>

      <Callout type="tip" title="Why meta-tools?">
        Sending 190+ tool definitions to the LLM would use 15,000+ tokens per request. With
        meta-tools, the LLM uses ~200 tokens to get the schema for exactly the tool it needs. This
        reduces cost by ~98% and improves response quality.
      </Callout>

      <h2>Tool namespaces</h2>
      <p>All tools use dot-prefixed namespaces for clear origin tracking:</p>
      <table>
        <thead>
          <tr>
            <th>Namespace</th>
            <th>Origin</th>
            <th>Example</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>core.*</code>
            </td>
            <td>Built-in tools</td>
            <td>
              <code>core.create_note</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>custom.*</code>
            </td>
            <td>User-created tools</td>
            <td>
              <code>custom.my_tool</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>{'plugin.{id}.*'}</code>
            </td>
            <td>Plugin tools</td>
            <td>
              <code>plugin.github.create_issue</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>{'skill.{id}.*'}</code>
            </td>
            <td>Skill tools</td>
            <td>
              <code>skill.coding_assistant.review</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>mcp.*</code>
            </td>
            <td>MCP server tools</td>
            <td>
              <code>mcp.filesystem.read_file</code>
            </td>
          </tr>
          <tr>
            <td>
              <code>ext.*</code>
            </td>
            <td>Extension tools</td>
            <td>
              <code>ext.daily_briefing.run</code>
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Built-in tools (190+)</h2>
      <p>Organized across 32 categories:</p>
      <CodeBlock code={TOOL_CATEGORIES} language="text" filename="tool-categories" />

      <h2>MCP Integration</h2>
      <p>OwnPilot is both an MCP client and server:</p>

      <h3>MCP Client</h3>
      <p>
        Connect to external MCP servers and use their tools natively in conversations. Popular
        servers include Filesystem, GitHub, Brave Search, and more.
      </p>
      <CodeBlock
        code={`# Configure MCP servers via Settings → MCP
# or via the CLI:
ownpilot config set mcp-servers '[
  {
    "name": "filesystem",
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
  }
]'`}
        language="bash"
      />

      <h3>MCP Server</h3>
      <p>
        OwnPilot exposes all 190+ tools as an MCP endpoint, making them available to Claude Desktop
        and any other MCP client. Uses Streamable HTTP transport on <code>/mcp</code>.
      </p>

      <h2>Extensions</h2>
      <p>
        Extensions are installable tool bundles with custom tools, triggers, services, and
        configurations. The Extension SDK provides access to all built-in tools via{' '}
        <code>utils.callTool()</code>.
      </p>

      <h3>6 Default Extensions</h3>
      <ul>
        <li>
          <strong>Daily Briefing</strong> — Summarizes your day's tasks, events, and news
        </li>
        <li>
          <strong>Knowledge Base</strong> — Structured knowledge management with vector search
        </li>
        <li>
          <strong>Project Tracker</strong> — Multi-project tracking with milestones
        </li>
        <li>
          <strong>Smart Search</strong> — Enhanced web search with result synthesis
        </li>
        <li>
          <strong>Automation Builder</strong> — Build and manage triggers via natural language
        </li>
        <li>
          <strong>Contact Enricher</strong> — Enrich contact records with public data
        </li>
      </ul>

      <h2>Skills Platform</h2>
      <p>
        Skills use the open standard SKILL.md format from AgentSkills.io. They are instruction-based
        AI knowledge packages that extend the assistant's capabilities.
      </p>
      <CodeBlock
        code={`# Install a skill
ownpilot skill install ./my-skill.skill

# List installed skills
ownpilot skill list

# Update all skills
ownpilot skill update`}
        language="bash"
      />

      <h2>Custom Tools</h2>
      <p>
        Create new tools at runtime via LLM. Tools are sandboxed JavaScript that can call any of the
        190+ built-in tools. Stored in the database and available immediately.
      </p>

      <h2>Connected Apps (Composio)</h2>
      <p>
        1000+ OAuth app integrations via Composio. Google Drive, GitHub, Slack, Notion, Stripe,
        Linear, Jira, and hundreds more — all accessible through AI tool calling after OAuth
        authentication.
      </p>

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/agents"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Agent System
        </Link>
        <Link
          to="/docs/personal-data"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Personal Data
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
