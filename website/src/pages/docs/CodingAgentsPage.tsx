import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Callout } from '@/components/ui/Callout';
import { Badge } from '@/components/ui/Badge';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const CREATE_CODING_AGENT = `POST /api/v1/coding-agents
Content-Type: application/json

{
  "name": "Frontend Helper",
  "provider": "claude-code",
  "workDir": "/workspace/my-project",
  "maxTurns": 30,
  "model": "claude-opus-4-5",
  "systemPrompt": "You are an expert frontend developer. Focus on React and TypeScript."
}`;

const START_SESSION = `# Start a coding agent session
POST /api/v1/coding-agents/:id/sessions
Content-Type: application/json

{
  "prompt": "Refactor the AuthContext to use React 19 context patterns",
  "mode": "auto"
}

# Response includes a session ID for polling:
{
  "sessionId": "sess_abc123",
  "status": "running",
  "streamUrl": "/api/v1/coding-agents/:id/sessions/sess_abc123/stream"
}`;

const STREAM_OUTPUT = `# Stream session output (SSE)
GET /api/v1/coding-agents/:id/sessions/:sessionId/stream
Accept: text/event-stream

# Events:
data: {"type":"output","content":"Reading AuthContext.tsx...\n"}
data: {"type":"tool_use","tool":"Read","input":{"file_path":"/workspace/AuthContext.tsx"}}
data: {"type":"output","content":"Refactoring to use createContext...\n"}
data: {"type":"done","exitCode":0,"tokensUsed":4821,"cost":0.0144}`;

const PTY_MODE = `# PTY (pseudoterminal) mode for interactive tools
POST /api/v1/coding-agents/:id/sessions
{
  "prompt": "Run the tests and fix any failures",
  "mode": "auto",
  "ptyMode": true,
  "env": {
    "NODE_ENV": "test"
  }
}`;

const PROVIDERS_CONFIG = `# Supported coding agent providers:

# Claude Code (Anthropic) — recommended
{
  "provider": "claude-code",
  "model": "claude-opus-4-5"
}

# Codex CLI (OpenAI)
{
  "provider": "codex",
  "model": "o3"
}

# Gemini CLI (Google)
{
  "provider": "gemini-cli",
  "model": "gemini-2.5-pro"
}`;

const CUSTOM_PROVIDER = `# Register a custom coding agent provider
POST /api/v1/coding-agents/providers
Content-Type: application/json

{
  "id": "my-custom-agent",
  "name": "My Custom Agent",
  "command": "/usr/local/bin/my-agent",
  "args": ["--print", "--model", "{model}"],
  "env": {
    "CUSTOM_API_KEY": "sk-..."
  },
  "inputMode": "stdin",
  "outputMode": "stdout"
}`;

const SESSION_MANAGEMENT = `# List sessions for a coding agent
GET /api/v1/coding-agents/:id/sessions

# Get session details
GET /api/v1/coding-agents/:id/sessions/:sessionId

# Cancel a running session
POST /api/v1/coding-agents/:id/sessions/:sessionId/cancel

# Get session transcript
GET /api/v1/coding-agents/:id/sessions/:sessionId/transcript`;

const FLEET_CODING = `# Use coding agents in Fleet Command for parallel code tasks
POST /api/v1/fleet
Content-Type: application/json

{
  "name": "Refactor Sprint",
  "tasks": [
    {
      "id": "task1",
      "type": "coding-cli",
      "prompt": "Add JSDoc comments to all exported functions in utils/",
      "config": { "provider": "claude-code", "workDir": "/workspace" }
    },
    {
      "id": "task2",
      "type": "coding-cli",
      "prompt": "Write unit tests for the authentication module",
      "config": { "provider": "claude-code", "workDir": "/workspace" },
      "dependsOn": ["task1"]
    }
  ]
}`;

const ENV_SANITIZATION = `# Coding agent processes run with a sanitized environment.
# The following variables are automatically removed to prevent
# child process conflicts:
#
# CLAUDECODE=1  — Claude Code sets this; child processes would refuse to start
# (other agent-specific env vars also cleaned)
#
# Custom env vars can be passed via the 'env' field in session config.`;

export function CodingAgentsPage() {
  return (
    <DocsLayout>
      <Badge variant="purple" className="mb-3">
        Coding Agents
      </Badge>
      <h1>Coding Agents</h1>
      <p className="text-lg text-[var(--color-text-muted)] mb-8">
        OwnPilot orchestrates Claude Code, Codex CLI, and Gemini CLI as coding agents — autonomous
        code editors that can read files, run tests, make commits, and complete multi-step
        programming tasks. Sessions stream output in real-time and support PTY mode for interactive
        tools.
      </p>

      <h2>Supported providers</h2>
      <table>
        <thead>
          <tr>
            <th>Provider</th>
            <th>ID</th>
            <th>Default model</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Claude Code</td>
            <td>
              <code>claude-code</code>
            </td>
            <td>
              <code>claude-opus-4-5</code>
            </td>
            <td>Recommended — best code quality</td>
          </tr>
          <tr>
            <td>Codex CLI</td>
            <td>
              <code>codex</code>
            </td>
            <td>
              <code>o3</code>
            </td>
            <td>OpenAI's coding CLI</td>
          </tr>
          <tr>
            <td>Gemini CLI</td>
            <td>
              <code>gemini-cli</code>
            </td>
            <td>
              <code>gemini-2.5-pro</code>
            </td>
            <td>Google's coding agent</td>
          </tr>
          <tr>
            <td>Custom</td>
            <td>user-defined</td>
            <td>—</td>
            <td>Any CLI tool with stdin/stdout protocol</td>
          </tr>
        </tbody>
      </table>

      <h2>Creating a coding agent</h2>
      <CodeBlock code={CREATE_CODING_AGENT} language="http" filename="create-coding-agent.http" />

      <h3>Configuration options</h3>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>provider</code>
            </td>
            <td>string</td>
            <td>claude-code | codex | gemini-cli | custom ID</td>
          </tr>
          <tr>
            <td>
              <code>workDir</code>
            </td>
            <td>string</td>
            <td>Working directory for the agent</td>
          </tr>
          <tr>
            <td>
              <code>model</code>
            </td>
            <td>string</td>
            <td>Model to use for inference</td>
          </tr>
          <tr>
            <td>
              <code>maxTurns</code>
            </td>
            <td>number</td>
            <td>Max tool-use iterations per session (default: 20)</td>
          </tr>
          <tr>
            <td>
              <code>systemPrompt</code>
            </td>
            <td>string</td>
            <td>Additional instructions prepended to system</td>
          </tr>
          <tr>
            <td>
              <code>allowedTools</code>
            </td>
            <td>string[]</td>
            <td>Restrict which tools the agent can use</td>
          </tr>
          <tr>
            <td>
              <code>maxCost</code>
            </td>
            <td>number</td>
            <td>Maximum USD cost per session</td>
          </tr>
        </tbody>
      </table>

      <h2>Starting a session</h2>
      <CodeBlock code={START_SESSION} language="http" filename="start-session.http" />

      <h3>Execution modes</h3>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>auto</code>
            </td>
            <td>Agent runs autonomously, making all decisions</td>
          </tr>
          <tr>
            <td>
              <code>interactive</code>
            </td>
            <td>Agent pauses and asks for confirmation on significant actions</td>
          </tr>
        </tbody>
      </table>

      <h2>Streaming output</h2>
      <CodeBlock code={STREAM_OUTPUT} language="http" filename="stream-output.http" />

      <h2>PTY mode</h2>
      <p>
        PTY (pseudoterminal) mode allocates a real terminal for the coding agent process. This is
        required for tools that detect whether they're running in a terminal (like interactive test
        runners, color output, progress bars).
      </p>
      <CodeBlock code={PTY_MODE} language="json" filename="pty-session.json" />

      <Callout type="info" title="When to use PTY mode">
        Use PTY mode when running commands that require terminal detection: test runners with watch
        mode, tools using ANSI colors, interactive CLIs. For simple file operations and
        non-interactive tasks, PTY mode is not needed.
      </Callout>

      <h2>Provider configuration</h2>
      <CodeBlock code={PROVIDERS_CONFIG} language="json" filename="provider-config.json" />

      <h2>Custom provider registration</h2>
      <p>
        Any CLI tool that accepts a prompt on stdin or as a flag and produces output on stdout can
        be registered as a custom coding agent provider.
      </p>
      <CodeBlock code={CUSTOM_PROVIDER} language="http" filename="register-provider.http" />

      <h2>Session management</h2>
      <CodeBlock code={SESSION_MANAGEMENT} language="http" filename="session-management.http" />

      <h2>Environment sanitization</h2>
      <p>
        Coding agent child processes run with a sanitized copy of the parent environment. This
        prevents conflicts when OwnPilot itself runs inside an agent environment.
      </p>
      <CodeBlock code={ENV_SANITIZATION} language="bash" />

      <Callout type="warning" title="CLAUDECODE env var">
        Claude Code sets <code>CLAUDECODE=1</code> in its environment. If OwnPilot is itself running
        inside Claude Code, child coding agent processes will see this variable and refuse to start.
        OwnPilot automatically removes it (and similar variables) from the sanitized environment
        passed to child coding agents.
      </Callout>

      <h2>Fleet integration</h2>
      <p>
        Coding agents integrate with Fleet Command for parallel code tasks with dependency tracking.
        Multiple coding sessions can run concurrently, with dependencies cascading on failure.
      </p>
      <CodeBlock code={FLEET_CODING} language="json" filename="fleet-coding.json" />

      <h2>Cost tracking</h2>
      <p>
        Each coding session tracks token usage and cost via <code>calculateExecutionCost()</code>.
        Cost data is available in the session details and WebSocket events:
      </p>
      <CodeBlock
        code={`GET /api/v1/coding-agents/:id/sessions/:sessionId

{
  "sessionId": "sess_abc123",
  "status": "completed",
  "tokensUsed": { "input": 12500, "output": 3200 },
  "cost": 0.0892,
  "duration": 145000,
  "turnsUsed": 18
}`}
        language="json"
      />

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/mcp"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          MCP Integration
        </Link>
        <Link
          to="/docs/edge-devices"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Edge Devices
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
