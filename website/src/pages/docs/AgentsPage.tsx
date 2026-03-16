import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const SOUL_CONFIG = `{
  "name": "Morning Briefer",
  "role": "Daily intelligence officer",
  "personality": "Professional, concise, proactive",
  "mission": "Deliver a focused morning briefing every weekday at 7am",
  "voice": "Formal but friendly",
  "heartbeat": {
    "schedule": "0 7 * * 1-5",
    "maxDurationMs": 120000,
    "maxCostPerCycle": 0.05
  },
  "autonomyLevel": "supervised",
  "allowedTools": ["search_web", "read_notes", "create_task"]
}`;

export function AgentsPage() {
  return (
    <DocsLayout>
      <Badge variant="purple" className="mb-3">
        Agent System
      </Badge>
      <h1>Agent System Overview</h1>
      <p>
        OwnPilot's agent system has multiple layers — from simple chat agents to fully autonomous
        soul agents with rich identity and heartbeat lifecycles.
      </p>

      <h2>Agent types</h2>
      <table>
        <thead>
          <tr>
            <th>Type</th>
            <th>Description</th>
            <th>Scheduling</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Chat Agent</td>
            <td>Conversational agent for web UI, Telegram, WhatsApp</td>
            <td>On-demand</td>
          </tr>
          <tr>
            <td>Soul Agent</td>
            <td>Autonomous agent with identity, heartbeat lifecycle</td>
            <td>Cron schedule</td>
          </tr>
          <tr>
            <td>Background Agent</td>
            <td>Persistent agent with configurable mission</td>
            <td>Interval / event-driven</td>
          </tr>
          <tr>
            <td>Subagent</td>
            <td>Lightweight fire-and-forget child agent</td>
            <td>Spawned by parent</td>
          </tr>
          <tr>
            <td>Fleet Worker</td>
            <td>Task-specific worker in a fleet</td>
            <td>Task queue / cron</td>
          </tr>
        </tbody>
      </table>

      <h2>Soul Agents</h2>
      <p>
        Soul agents are autonomous agents with a rich identity framework. They have personality,
        role, mission, voice, boundaries, and an emoji. They run on a configurable heartbeat
        schedule and can evolve over time.
      </p>

      <h3>Soul agent configuration</h3>
      <CodeBlock code={SOUL_CONFIG} language="json" filename="soul-agent.json" />

      <h3>Heartbeat lifecycle</h3>
      <p>On each heartbeat cycle, a soul agent:</p>
      <ol>
        <li>Gathers current context (memories, inbox messages, recent events)</li>
        <li>Executes its checklist items in order</li>
        <li>
          Runs <code>onHeartbeat</code> action sequence
        </li>
        <li>Records results to evolution log</li>
        <li>Enforces max duration and cost limits</li>
      </ol>

      <h3>Crew system</h3>
      <p>Multiple soul agents can form a crew. Crews enable:</p>
      <ul>
        <li>
          Role-based task delegation (<code>delegate_task</code> LLM tool)
        </li>
        <li>
          Inter-agent messaging (<code>broadcast_to_crew</code>)
        </li>
        <li>Shared crew context with 30-second TTL caching</li>
        <li>16+ ready-made crew templates</li>
      </ul>

      <h2>Background Agents</h2>
      <p>
        Background agents are persistent autonomous agents that run independently with configurable
        missions, schedules, and full tool access.
      </p>

      <h3>Scheduling modes</h3>
      <ul>
        <li>
          <strong>Interval</strong> — Fixed timer (e.g., every 30 minutes)
        </li>
        <li>
          <strong>Continuous</strong> — Adaptive delays based on activity level
        </li>
        <li>
          <strong>Event-driven</strong> — Reactive to specific EventBus events
        </li>
      </ul>

      <h3>Features</h3>
      <ul>
        <li>Full tool access: same 190+ tools as chat agents</li>
        <li>Workspace isolation: each agent gets a private file workspace</li>
        <li>Rate limiting: cycles-per-hour enforcement</li>
        <li>Budget tracking: auto-stop when budget exceeded</li>
        <li>Auto-pause on consecutive errors</li>
        <li>Session persistence: state saved to DB every 30 seconds</li>
        <li>Inbox messaging: send messages to running agents</li>
      </ul>

      <h2>Subagents</h2>
      <p>
        Chat and background agents can spawn subagents for parallel task execution. The
        fire-and-forget model lets the parent agent continue working while subagents run
        concurrently.
      </p>

      <h3>LLM-callable tools</h3>
      <ul>
        <li>
          <code>spawn_subagent</code> — Create and start a subagent
        </li>
        <li>
          <code>check_subagent</code> — Poll completion status
        </li>
        <li>
          <code>get_subagent_result</code> — Retrieve final output
        </li>
        <li>
          <code>cancel_subagent</code> — Abort a running subagent
        </li>
        <li>
          <code>list_subagents</code> — Show active subagents
        </li>
      </ul>

      <h3>Limits</h3>
      <ul>
        <li>Concurrent subagents: max 5 (configurable)</li>
        <li>Total spawn limit: max 20 per session</li>
        <li>Nesting depth: max 2 levels (subagent cannot spawn subagents)</li>
      </ul>

      <h2>Agent Orchestra</h2>
      <p>
        The orchestra system allows running multiple agents in parallel with different coordination
        strategies:
      </p>
      <ul>
        <li>
          <strong>Fan-out</strong> — All agents work on the same task; results are merged
        </li>
        <li>
          <strong>Race</strong> — First agent to complete wins; others are cancelled
        </li>
        <li>
          <strong>Pipeline</strong> — Agents run sequentially, passing output forward
        </li>
        <li>
          <strong>Voting</strong> — Multiple agents vote on the best answer
        </li>
      </ul>

      <h2>Autonomy Levels</h2>
      <table>
        <thead>
          <tr>
            <th>Level</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Manual</td>
            <td>All tool executions require explicit approval</td>
          </tr>
          <tr>
            <td>Assisted</td>
            <td>Low-risk tools auto-execute; high-risk require approval</td>
          </tr>
          <tr>
            <td>Supervised</td>
            <td>Most tools auto-execute; critical patterns blocked</td>
          </tr>
          <tr>
            <td>Autonomous</td>
            <td>Full tool access with audit logging</td>
          </tr>
          <tr>
            <td>Full (Claw)</td>
            <td>Maximum autonomy for crew orchestration</td>
          </tr>
        </tbody>
      </table>

      <Callout type="warning" title="Budget enforcement">
        All agent types support budget limits. At 80% of the budget, a warning is logged. At 100%,
        the agent auto-pauses. Configure per-cycle, per-day, and per-month limits.
      </Callout>

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/providers"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          AI Providers
        </Link>
        <Link
          to="/docs/tools"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Tool System
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
