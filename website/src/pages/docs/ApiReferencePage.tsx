import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export function ApiReferencePage() {
  return (
    <DocsLayout>
      <Badge variant="blue" className="mb-3">
        API Reference
      </Badge>
      <h1>REST API Reference</h1>
      <p>
        OwnPilot exposes a comprehensive REST API at <code>http://localhost:8080/api/v1/</code>. All
        responses use standardized <code>apiResponse</code> / <code>apiError</code> helpers.
      </p>

      <h2>Response format</h2>
      <CodeBlock
        code={`// Success
{ "data": { ... }, "status": "ok" }

// Error
{ "error": "NOT_FOUND", "message": "Resource not found", "status": "error" }

// Paginated
{
  "data": [...],
  "total": 42,
  "page": 1,
  "limit": 20,
  "status": "ok"
}`}
        language="json"
      />

      <h2>Authentication</h2>
      <CodeBlock
        code={`# API Key mode
curl -H "Authorization: Bearer YOUR_API_KEY" http://localhost:8080/api/v1/health

# JWT mode
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" http://localhost:8080/api/v1/health`}
        language="bash"
      />

      <h2>Route modules</h2>
      <table>
        <thead>
          <tr>
            <th>Route</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>GET /api/v1/health</code>
            </td>
            <td>Health check + version</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/v1/chat</code>
            </td>
            <td>Send chat message (SSE streaming)</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/conversations</code>
            </td>
            <td>List conversations</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/agents</code>
            </td>
            <td>List soul agents</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/v1/agents</code>
            </td>
            <td>Create soul agent</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/agents/:id/heartbeat</code>
            </td>
            <td>Get heartbeat logs</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/v1/agents/:id/start</code>
            </td>
            <td>Start agent heartbeat</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/background-agents</code>
            </td>
            <td>List background agents</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/v1/background-agents</code>
            </td>
            <td>Create background agent</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/workflows</code>
            </td>
            <td>List workflows</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/v1/workflows</code>
            </td>
            <td>Create workflow</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/v1/workflows/:id/run</code>
            </td>
            <td>Execute workflow</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/tools</code>
            </td>
            <td>List available tools</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/v1/tools/execute</code>
            </td>
            <td>Execute a tool directly</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/extensions</code>
            </td>
            <td>List extensions</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/v1/extensions/:id/enable</code>
            </td>
            <td>Enable extension</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/notes</code>
            </td>
            <td>List notes</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/tasks</code>
            </td>
            <td>List tasks</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/memories</code>
            </td>
            <td>List memories</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/goals</code>
            </td>
            <td>List goals</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/calendar</code>
            </td>
            <td>List calendar events</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/contacts</code>
            </td>
            <td>List contacts</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/edge/devices</code>
            </td>
            <td>List IoT devices</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/v1/edge/devices/:id/command</code>
            </td>
            <td>Send device command</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/providers</code>
            </td>
            <td>List AI providers</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/config</code>
            </td>
            <td>Get configuration</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/v1/pulse/run</code>
            </td>
            <td>Trigger pulse cycle</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/v1/fleet</code>
            </td>
            <td>List fleet sessions</td>
          </tr>
          <tr>
            <td>
              <code>POST /webhooks/workflow/:path</code>
            </td>
            <td>Webhook trigger (HMAC-SHA256)</td>
          </tr>
        </tbody>
      </table>

      <h2>Chat (streaming)</h2>
      <CodeBlock
        code={`POST /api/v1/chat
Content-Type: application/json
Accept: text/event-stream

{
  "message": "Summarize my tasks for today",
  "conversationId": "conv_abc123",
  "agentId": "default"
}

// SSE response events:
// data: {"type":"content","delta":"Here are "}
// data: {"type":"tool_start","tool":"core.list_tasks"}
// data: {"type":"tool_end","tool":"core.list_tasks","result":{...}}
// data: {"type":"content","delta":"your tasks:"}
// data: {"type":"done"}`}
        language="http"
      />

      <h2>WebSocket Events</h2>
      <p>
        Connect to <code>ws://localhost:8080/ws</code> for real-time updates.
      </p>
      <CodeBlock
        code={`// Subscribe to events
ws.send(JSON.stringify({
  type: "subscribe",
  events: ["agent:status:changed", "task:created", "heartbeat:completed"]
}))

// Incoming event format
{
  "type": "agent:status:changed",
  "payload": { "agentId": "soul_123", "status": "running" },
  "timestamp": "2026-03-16T10:00:00Z"
}`}
        language="json"
      />

      <h2>Pagination</h2>
      <p>All list endpoints support pagination via query parameters:</p>
      <CodeBlock
        code={`GET /api/v1/notes?page=1&limit=20
GET /api/v1/tasks?page=2&limit=50&status=pending`}
        language="bash"
      />

      <Callout type="info" title="API versioning">
        All API routes are prefixed with <code>/api/v1/</code>. Future breaking changes will use{' '}
        <code>/api/v2/</code>.
      </Callout>

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/security"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Security
        </Link>
        <Link
          to="/docs/deployment"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Deployment
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
