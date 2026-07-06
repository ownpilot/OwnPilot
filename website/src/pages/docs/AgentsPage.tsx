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
            <td>Claw Agent</td>
            <td>Unified autonomous runtime with .claw/ directives</td>
            <td>Continuous / interval / event / single-shot</td>
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

      <h2>Claw Agents</h2>
      <p>
        Claw is the unified autonomous agent runtime that composes LLM, workspace, soul, and coding
        agents with 250+ tools. Claws use a <code>.claw/</code> directive system (INSTRUCTIONS.md,
        TASKS.md, MEMORY.md, LOG.md) that is auto-scaffolded and injected into the prompt.
      </p>

      <h3>Scheduling modes</h3>
      <ul>
        <li>
          <strong>Continuous</strong> — Adaptive delays based on activity level
        </li>
        <li>
          <strong>Interval</strong> — Fixed timer (e.g., every 30 minutes)
        </li>
        <li>
          <strong>Event-driven</strong> — Reactive to specific EventBus events
        </li>
        <li>
          <strong>Single-shot</strong> — Run once and complete
        </li>
      </ul>

      <h3>Features</h3>
      <ul>
        <li>Full tool access: same 250+ tools as chat agents</li>
        <li>Workspace isolation: each agent gets a private file workspace</li>
        <li>
          Working memory: persistent cross-cycle state via <code>claw_set_context</code> /{' '}
          <code>claw_get_context</code>
        </li>
        <li>Subclaws: nested autonomous agents (max depth 3)</li>
        <li>Escalation: approval-gated actions with deny support</li>
        <li>
          Stop conditions: <code>max_cycles</code>, <code>on_report</code>, <code>on_error</code>,{' '}
          <code>idle:N</code>
        </li>
        <li>Auto-fail after 5 consecutive errors</li>
        <li>Audit trail: full history with 90-day retention</li>
        <li>Budget tracking: auto-stop when budget exceeded</li>
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
