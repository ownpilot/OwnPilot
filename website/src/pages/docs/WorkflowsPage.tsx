import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const WORKFLOW_EXAMPLE = `{
  "name": "GitHub Issue Triage",
  "trigger": {
    "type": "webhook",
    "path": "/github-issues",
    "method": "POST"
  },
  "nodes": [
    {
      "id": "parse",
      "type": "transformer",
      "config": {
        "expression": "{ issue: input.issue, labels: input.labels }"
      }
    },
    {
      "id": "classify",
      "type": "llm",
      "config": {
        "prompt": "Classify this GitHub issue: {{parse.issue.body}}",
        "responseFormat": "json"
      }
    },
    {
      "id": "check-priority",
      "type": "condition",
      "config": {
        "expression": "classify.priority === 'high'"
      }
    },
    {
      "id": "notify",
      "type": "notification",
      "config": {
        "message": "High priority issue: {{parse.issue.title}}"
      }
    }
  ]
}`;

export function WorkflowsPage() {
  return (
    <DocsLayout>
      <Badge variant="green" className="mb-3">
        Automation
      </Badge>
      <h1>Workflows</h1>
      <p>
        OwnPilot's workflow system provides a visual drag-and-drop builder with 23 node types, a
        Workflow Copilot for AI-assisted creation, and webhook triggers with HMAC signature
        validation.
      </p>

      <h2>23 Node Types</h2>
      <table>
        <thead>
          <tr>
            <th>Node Type</th>
            <th>Short Name</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Tool Node</td>
            <td>
              <code>tool</code>
            </td>
            <td>Execute any built-in or custom tool</td>
          </tr>
          <tr>
            <td>Trigger Node</td>
            <td>
              <code>trigger</code>
            </td>
            <td>Entry point (webhook, schedule, event)</td>
          </tr>
          <tr>
            <td>LLM Node</td>
            <td>
              <code>llm</code>
            </td>
            <td>AI inference with optional JSON output</td>
          </tr>
          <tr>
            <td>Condition Node</td>
            <td>
              <code>condition</code>
            </td>
            <td>If/else branching</td>
          </tr>
          <tr>
            <td>Code Node</td>
            <td>
              <code>code</code>
            </td>
            <td>Run sandboxed JavaScript/Python</td>
          </tr>
          <tr>
            <td>Transformer Node</td>
            <td>
              <code>transformer</code>
            </td>
            <td>Transform data with expressions</td>
          </tr>
          <tr>
            <td>ForEach Node</td>
            <td>
              <code>forEach</code>
            </td>
            <td>Iterate over array items</td>
          </tr>
          <tr>
            <td>HTTP Request Node</td>
            <td>
              <code>httpRequest</code>
            </td>
            <td>Call external APIs</td>
          </tr>
          <tr>
            <td>Delay Node</td>
            <td>
              <code>delay</code>
            </td>
            <td>Wait (up to 1 hour safety cap)</td>
          </tr>
          <tr>
            <td>Switch Node</td>
            <td>
              <code>switch</code>
            </td>
            <td>Multi-branch routing</td>
          </tr>
          <tr>
            <td>Error Handler Node</td>
            <td>
              <code>errorHandler</code>
            </td>
            <td>Catch and handle errors</td>
          </tr>
          <tr>
            <td>Sub-Workflow Node</td>
            <td>
              <code>subWorkflow</code>
            </td>
            <td>Nest another workflow</td>
          </tr>
          <tr>
            <td>Approval Node</td>
            <td>
              <code>approval</code>
            </td>
            <td>Pause for human approval</td>
          </tr>
          <tr>
            <td>Sticky Note</td>
            <td>
              <code>stickyNote</code>
            </td>
            <td>Documentation node</td>
          </tr>
          <tr>
            <td>Notification Node</td>
            <td>
              <code>notification</code>
            </td>
            <td>Send via channels</td>
          </tr>
          <tr>
            <td>Parallel Node</td>
            <td>
              <code>parallel</code>
            </td>
            <td>Fan-out concurrent execution</td>
          </tr>
          <tr>
            <td>Merge Node</td>
            <td>
              <code>merge</code>
            </td>
            <td>Wait for branches (all or first)</td>
          </tr>
          <tr>
            <td>DataStore Node</td>
            <td>
              <code>dataStore</code>
            </td>
            <td>Key-value persistence across runs</td>
          </tr>
          <tr>
            <td>Schema Validator</td>
            <td>
              <code>schemaValidator</code>
            </td>
            <td>JSON schema validation</td>
          </tr>
          <tr>
            <td>Filter Node</td>
            <td>
              <code>filter</code>
            </td>
            <td>Filter arrays by predicate</td>
          </tr>
          <tr>
            <td>Map Node</td>
            <td>
              <code>map</code>
            </td>
            <td>Transform array items</td>
          </tr>
          <tr>
            <td>Aggregate Node</td>
            <td>
              <code>aggregate</code>
            </td>
            <td>sum/count/avg/min/max/groupBy</td>
          </tr>
          <tr>
            <td>Webhook Response</td>
            <td>
              <code>webhookResponse</code>
            </td>
            <td>Send HTTP response for webhook triggers</td>
          </tr>
        </tbody>
      </table>

      <h2>Workflow example</h2>
      <CodeBlock code={WORKFLOW_EXAMPLE} language="json" filename="github-triage.json" />

      <h2>Webhook triggers</h2>
      <p>
        Workflows can be triggered via HTTP webhook at <code>POST /webhooks/workflow/:path</code>.
        Requests are validated with HMAC-SHA256 signature verification.
      </p>

      <h2>Workflow Copilot</h2>
      <p>
        The Workflow Copilot is an AI assistant that helps you build workflows via natural language.
        Describe what you want to automate, and the copilot generates the workflow definition. It
        uses short type names (e.g., <code>"llm"</code>, <code>"condition"</code>) which the UI
        automatically converts to the full ReactFlow node format.
      </p>

      <h2>5 Workflow Templates</h2>
      <ul>
        <li>
          <strong>GitHub Issue Triage</strong> — Classify and route incoming issues
        </li>
        <li>
          <strong>Data Pipeline</strong> — Fetch, transform, and store data
        </li>
        <li>
          <strong>Scheduled Report</strong> — Generate and send periodic reports
        </li>
        <li>
          <strong>Multi-Source Merge</strong> — Aggregate data from multiple sources
        </li>
        <li>
          <strong>Approval Workflow</strong> — Human-in-the-loop approval process
        </li>
      </ul>

      <h2>Safety limits</h2>
      <ul>
        <li>Max 500 nodes per workflow (DoS prevention)</li>
        <li>Delay node: 1-hour maximum cap</li>
        <li>Sub-workflow: ownership check prevents cross-user access</li>
        <li>DataStore: 10K entry limit with LRU eviction</li>
      </ul>

      <h2>Approval recovery</h2>
      <p>
        When a workflow pauses at an Approval node, <code>resumeFromApproval()</code> automatically
        resumes it when the approval decision is recorded. No manual intervention required.
      </p>

      <Callout type="info" title="LLM Node: JSON mode">
        Set <code>responseFormat: "json"</code> on an LLM node to automatically parse the model's
        output as JSON. This is useful for classification, extraction, and data transformation
        tasks.
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
          to="/docs/security"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Security
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
