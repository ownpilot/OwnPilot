import { DocsLayout } from '@/components/layout/DocsLayout';
import { Callout } from '@/components/ui/Callout';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Link } from 'react-router';
import { ArrowRight, Shield, Cpu, Wrench, Bot } from 'lucide-react';
import { CodeBlock } from '@/components/ui/CodeBlock';

export function IntroductionPage() {
  return (
    <DocsLayout>
      <div className="mb-2">
        <Badge variant="blue" className="mb-3">
          Documentation
        </Badge>
      </div>
      <h1>Introduction</h1>
      <p className="text-xl text-[var(--color-text-muted)] leading-relaxed mb-6 mt-2 font-medium">
        OwnPilot is a privacy-first personal AI assistant platform that runs entirely on your own
        infrastructure. Self-hosted. Your data stays yours.
      </p>

      <Callout type="tip" title="Quick Start">
        Want to get running immediately? Jump to the{' '}
        <Link to="/docs/quick-start">Quick Start guide</Link> — Docker gets you live in under 2
        minutes.
      </Callout>

      <h2>What is OwnPilot?</h2>
      <p>
        OwnPilot is a full-featured AI assistant platform that you deploy on your own hardware or
        cloud VM. It brings together multi-provider AI (96 providers including local inference),
        190+ built-in tools, autonomous soul agents, visual workflow automation, MCP integration,
        voice, browser automation, IoT control, and Telegram + WhatsApp connectivity — all in a
        single, self-hosted package.
      </p>
      <p>
        Unlike cloud-based AI assistants, OwnPilot never sends your personal data to third parties.
        Your conversations, memories, notes, tasks, contacts, and all other personal data stay on
        your server.
      </p>

      <h2>Core principles</h2>

      <div className="grid sm:grid-cols-2 gap-4 my-6">
        {[
          {
            icon: Shield,
            title: 'Privacy by design',
            desc: 'AES-256-GCM encryption for sensitive data, PII detection and redaction, tamper-evident audit logs, and sandboxed code execution. Your data never leaves your infrastructure.',
          },
          {
            icon: Cpu,
            title: 'Local-first AI',
            desc: 'Works with Ollama, LM Studio, LocalAI, and vLLM for fully local inference. No internet required for AI processing when using local providers.',
          },
          {
            icon: Wrench,
            title: 'Extensible',
            desc: '190+ built-in tools, custom tools via LLM, Extensions SDK, Skills (SKILL.md), MCP client/server, plugins, and 1000+ Composio integrations.',
          },
          {
            icon: Bot,
            title: 'Autonomous',
            desc: 'Soul agents with heartbeat lifecycles, background agents with 3 scheduling modes, visual workflows with 23 node types, and proactive Pulse system.',
          },
        ].map(({ icon: Icon, title, desc }) => (
          <Card key={title} className="flex gap-4">
            <div className="w-9 h-9 rounded-lg bg-[var(--color-accent-light)] flex items-center justify-center shrink-0">
              <Icon className="w-4.5 h-4.5 text-[hsl(var(--primary))]" />
            </div>
            <div>
              <h3 className="font-semibold text-[var(--color-text)] text-sm mb-1">{title}</h3>
              <p className="text-sm text-[var(--color-text-muted)] leading-relaxed m-0">{desc}</p>
            </div>
          </Card>
        ))}
      </div>

      <h2>Key numbers</h2>
      <table>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>AI Providers</td>
            <td>96 (including 8 aggregators + local)</td>
          </tr>
          <tr>
            <td>Built-in Tools</td>
            <td>190+ across 32 categories</td>
          </tr>
          <tr>
            <td>Workflow Node Types</td>
            <td>23</td>
          </tr>
          <tr>
            <td>Test Suite</td>
            <td>26,500+ tests, 545+ files</td>
          </tr>
          <tr>
            <td>Codebase</td>
            <td>~180K LOC (TypeScript)</td>
          </tr>
          <tr>
            <td>License</td>
            <td>MIT</td>
          </tr>
          <tr>
            <td>Runtime</td>
            <td>Node.js 22+</td>
          </tr>
          <tr>
            <td>Database</td>
            <td>PostgreSQL 16+ with pgvector</td>
          </tr>
        </tbody>
      </table>

      <h2>Architecture overview</h2>
      <p>
        OwnPilot is a TypeScript monorepo managed with Turborepo and pnpm. It consists of 4
        packages:
      </p>
      <ul>
        <li>
          <code>@ownpilot/core</code> — AI engine, 190+ tools, plugins, sandbox, crypto, privacy
          (~62K LOC)
        </li>
        <li>
          <code>@ownpilot/gateway</code> — Hono HTTP API server, 120+ route modules, 45+ DB
          repositories (~76K LOC)
        </li>
        <li>
          <code>@ownpilot/ui</code> — React 19 + Vite 7 + Tailwind CSS 4 frontend, 57+ pages (~40K
          LOC)
        </li>
        <li>
          <code>@ownpilot/cli</code> — Commander.js CLI for server and configuration management
        </li>
      </ul>
      <p>
        In production, a single port (8080) serves everything: the bundled React UI, REST API,
        WebSocket (<code>/ws</code>), and Server-Sent Events. In development mode, Vite runs on port
        5173 and proxies API/WebSocket requests to the gateway on 8080.
      </p>

      <h2>What you can do with OwnPilot</h2>
      <ul>
        <li>
          Chat with 96 AI providers (OpenAI, Anthropic, Google, Ollama, and more) through a single
          interface
        </li>
        <li>
          Manage notes, tasks, calendar, contacts, memories, bookmarks, expenses, and habits — all
          locally stored
        </li>
        <li>
          Build visual workflows with 23 node types and a Workflow Copilot for AI-assisted creation
        </li>
        <li>
          Create autonomous Soul Agents with personalities, heartbeat schedules, and crew
          orchestration
        </li>
        <li>Connect Telegram and WhatsApp as channel interfaces with full tool access</li>
        <li>
          Integrate external tools via MCP client, and expose all tools to Claude Desktop via MCP
          server
        </li>
        <li>Orchestrate Claude Code, Codex CLI, and Gemini CLI as coding agents</li>
        <li>Control IoT devices (ESP32, RPi, Arduino) via MQTT integration</li>
        <li>
          Run 1000+ OAuth app integrations via Composio (GitHub, Slack, Google Drive, Notion, etc.)
        </li>
      </ul>

      <h2>Quickstart</h2>
      <CodeBlock
        code={`git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
docker compose --profile postgres up -d
# Open http://localhost:8080 — configure your first AI provider in Settings → Config Center`}
        language="bash"
      />

      <h2>Next steps</h2>
      <div className="grid sm:grid-cols-2 gap-3">
        {[
          { href: '/docs/quick-start', title: 'Quick Start', desc: 'Docker or source in minutes' },
          { href: '/docs/installation', title: 'Installation', desc: 'Detailed setup guide' },
          { href: '/docs/architecture', title: 'Architecture', desc: 'Deep dive into the system' },
          {
            href: '/docs/agents',
            title: 'Agent System',
            desc: 'Soul agents, background agents, crews',
          },
        ].map((link) => (
          <Link
            key={link.href}
            to={link.href}
            className="group flex items-center justify-between p-4 rounded-xl border border-[var(--color-border)] hover:border-[hsl(var(--primary)/0.4)] hover:bg-[var(--color-accent-light)] transition-all no-underline"
          >
            <div>
              <div className="font-medium text-sm text-[var(--color-text)]">{link.title}</div>
              <div className="text-xs text-[var(--color-text-muted)]">{link.desc}</div>
            </div>
            <ArrowRight className="w-4 h-4 text-[var(--color-text-subtle)] group-hover:text-[hsl(var(--primary))] transition-colors" />
          </Link>
        ))}
      </div>

      {/* Next navigation */}
      <div className="flex items-center justify-end mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/quick-start"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Quick Start
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
