import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const ARCH = `                     ┌──────────────┐
                     │   Web UI     │  React 19 + Vite 7
                     │  (bundled)   │  Tailwind CSS 4
                     └──────┬───────┘
                            │ HTTP + SSE + WebSocket (/ws)
              ┌─────────────┼─────────────────┐
              │             │                 │
     ┌────────┴──────┐      │      ┌──────────┴────────┐
     │  Telegram Bot │      │      │  External MCP      │
     │  WhatsApp     │      │      │  Clients/Servers   │
     └────────┬──────┘      │      └──────────┬─────────┘
              └─────────────┤──────────────────┘
                            │
                   ┌────────▼────────┐
                   │    Gateway      │  Hono 4.x
                   │  (Port 8080)    │  120+ Route Modules
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐
                   │     Core        │  @ownpilot/core
                   │  190+ Tools     │  AI Engine
                   └────────┬────────┘
                            │
                   ┌────────▼────────┐  ┌──────────────┐
                   │   PostgreSQL    │  │  Mosquitto   │
                   │  88+ Repos      │  │  MQTT Broker │
                   └─────────────────┘  └──────────────┘`;

const PIPELINE = `Request
  → Audit Middleware (tamper-evident logging)
  → Persistence Middleware (conversation storage)
  → Post-Processing (message normalization)
  → Context-Injection (memories, goals, soul context)
  → Agent-Execution (tool orchestration, LLM calls)
  → Response`;

export function ArchitecturePage() {
  return (
    <DocsLayout>
      <Badge variant="blue" className="mb-3">
        Architecture
      </Badge>
      <h1>Architecture Overview</h1>
      <p>
        OwnPilot is a TypeScript monorepo built with Turborepo. Four packages work together to
        deliver a complete self-hosted AI assistant platform.
      </p>

      <h2>System diagram</h2>
      <CodeBlock code={ARCH} language="text" filename="system-architecture" />

      <h2>Packages</h2>

      <h3>@ownpilot/core</h3>
      <p>
        The foundational runtime library. Contains the AI engine, 190+ tool definitions, plugin
        architecture, security primitives, sandboxed code execution, and cryptography. Minimal
        external dependencies (only <code>googleapis</code> for Google OAuth).
      </p>
      <ul>
        <li>
          <code>agent/</code> — Agent engine with multi-provider support, orchestrator, tool-calling
          loop
        </li>
        <li>
          <code>agent/orchestra/</code> — Multi-agent orchestration (fan-out, race, pipeline,
          voting)
        </li>
        <li>
          <code>agent/providers/</code> — Provider implementations (OpenAI, Anthropic, Google,
          Zhipu, 8 aggregators)
        </li>
        <li>
          <code>agent/tools/</code> — 190+ built-in tool definitions across 32 tool files
        </li>
        <li>
          <code>plugins/</code> — Plugin system with isolation, marketplace, signing, runtime
        </li>
        <li>
          <code>events/</code> — EventBus, HookBus, ScopedBus
        </li>
        <li>
          <code>sandbox/</code> — 5 implementations: VM, Docker, Worker threads, Local, Scoped APIs
        </li>
        <li>
          <code>crypto/</code> — PBKDF2, AES-256-GCM, RSA, SHA256 — zero dependency
        </li>
        <li>
          <code>privacy/</code> — PII detection (15+ categories) and redaction
        </li>
        <li>
          <code>security/</code> — Critical pattern blocking (100+ patterns), permission matrix
        </li>
      </ul>

      <h3>@ownpilot/gateway</h3>
      <p>
        The API server built on{' '}
        <a href="https://hono.dev/" target="_blank" rel="noopener noreferrer">
          Hono 4.x
        </a>
        . Handles HTTP/WebSocket communication, database operations, agent execution, MCP
        integration, plugin management, and channel connectivity. ~76K LOC with 389 test files and
        16,400+ tests.
      </p>
      <ul>
        <li>
          <code>routes/</code> — 55+ route modules (chat, agents, workflows, tools, extensions,
          etc.)
        </li>
        <li>
          <code>services/</code> — 60+ business logic services
        </li>
        <li>
          <code>db/repositories/</code> — 45+ data access repositories
        </li>
        <li>
          <code>channels/</code> — Telegram + WhatsApp channel plugins
        </li>
        <li>
          <code>services/workflow/</code> — 23 node type executors
        </li>
        <li>
          <code>tools/</code> — CLI tools, edge devices, browser, coding agents
        </li>
        <li>
          <code>ws/</code> — WebSocket server and real-time broadcasts
        </li>
      </ul>

      <h3>@ownpilot/ui</h3>
      <p>
        React 19 + Vite 7 + Tailwind CSS 4 frontend. Code-split with lazy loading, dark mode, 120+
        components, real-time WebSocket updates. ~40K LOC with 57+ pages.
      </p>

      <h3>@ownpilot/cli</h3>
      <p>
        Commander.js CLI for server management, bot control, workspace operations, configuration,
        and channel management.
      </p>
      <ul>
        <li>
          <code>ownpilot start</code> — Start the server
        </li>
        <li>
          <code>ownpilot config set &lt;key&gt; &lt;value&gt;</code> — Configure settings
        </li>
        <li>
          <code>ownpilot bot start</code> — Start Telegram bot
        </li>
        <li>
          <code>ownpilot skill install &lt;file&gt;</code> — Install a skill
        </li>
      </ul>

      <h2>Message pipeline</h2>
      <p>
        All messages — whether from the web UI, Telegram, WhatsApp, or triggers — flow through the
        same MessageBus middleware pipeline:
      </p>
      <CodeBlock code={PIPELINE} language="text" />

      <Callout type="info" title="Single-port production">
        In production, port 8080 serves everything: the bundled React UI (static assets), the REST
        API (<code>/api/v1/*</code>), WebSocket (<code>/ws</code>), and Server-Sent Events. No
        separate nginx or reverse proxy required for basic deployments.
      </Callout>

      <h2>Event system</h2>
      <p>
        OwnPilot uses a 3-in-1 event system in <code>@ownpilot/core</code>:
      </p>
      <ul>
        <li>
          <strong>EventBus</strong> — Fire-and-forget event broadcasting with type-safe events
        </li>
        <li>
          <strong>HookBus</strong> — Interceptable hooks that can modify data in transit
        </li>
        <li>
          <strong>ScopedBus</strong> — Namespaced buses for plugin isolation
        </li>
      </ul>
      <p>
        The <strong>EventBusBridge</strong> in the gateway translates dot-notation events (e.g.,{' '}
        <code>agent.status.changed</code>) to WebSocket colon-notation (e.g.,{' '}
        <code>agent:status:changed</code>) for real-time UI updates.
      </p>

      <h2>Database</h2>
      <p>
        PostgreSQL 16+ with the pgvector extension for vector similarity search. All schema
        migrations are idempotent (<code>IF NOT EXISTS</code> / <code>IF EXISTS</code>).
      </p>
      <ul>
        <li>45+ repositories using a typed adapter abstraction</li>
        <li>pgvector for memory similarity search</li>
        <li>AES-256-GCM encrypted columns for sensitive data</li>
        <li>Tamper-evident hash chain for audit logs</li>
      </ul>

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/installation"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Installation
        </Link>
        <Link
          to="/docs/providers"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          AI Providers
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
