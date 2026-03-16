import { DocsLayout } from '@/components/layout/DocsLayout';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Callout } from '@/components/ui/Callout';
import { Badge } from '@/components/ui/Badge';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export function QuickStartPage() {
  return (
    <DocsLayout>
      <Badge variant="green" className="mb-3">
        Getting Started
      </Badge>
      <h1>Quick Start</h1>
      <p>
        The fastest way to start OwnPilot is with Docker — it pulls the image, starts PostgreSQL
        with pgvector, and serves everything on a single port.
      </p>

      <Callout type="info" title="Prerequisites">
        Docker Desktop (or Docker Engine) must be installed and running. No Node.js required for the
        Docker path.
      </Callout>

      <h2>Option 1: Docker Compose (Recommended)</h2>

      <CodeBlock
        code={`git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot

# Start OwnPilot + PostgreSQL
docker compose --profile postgres up -d`}
        language="bash"
      />

      <p>
        Open <code>http://localhost:8080</code> in your browser. Configure your first AI provider
        key in <strong>Settings → Config Center</strong>.
      </p>

      <Callout type="tip" title="Custom configuration">
        To customize settings before starting (auth, Telegram token, etc.), copy and edit{' '}
        <code>.env</code> first:
      </Callout>

      <CodeBlock
        code={`cp .env.example .env
# Edit .env — all docker-compose.yml defaults match .env.example
docker compose --profile postgres up -d`}
        language="bash"
      />

      <h2>Option 2: Docker with pre-built image</h2>
      <CodeBlock
        code={`# Pull and run (requires external PostgreSQL with pgvector)
docker run -d \\
  --name ownpilot \\
  -p 8080:8080 \\
  -e POSTGRES_HOST=host.docker.internal \\
  -e POSTGRES_PORT=25432 \\
  -e POSTGRES_USER=ownpilot \\
  -e POSTGRES_PASSWORD=ownpilot_secret \\
  -e POSTGRES_DB=ownpilot \\
  ghcr.io/ownpilot/ownpilot:latest`}
        language="bash"
      />

      <h2>Option 3: From source</h2>

      <Callout type="info" title="Prerequisites">
        Node.js 22+, pnpm 10+, and Docker (for PostgreSQL) are required.
      </Callout>

      <CodeBlock
        code={`# Clone and install
git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
pnpm install

# Configure
cp .env.example .env
# (Optional) edit .env — defaults work with Docker Compose

# Start PostgreSQL
docker compose --profile postgres up -d

# Start development servers
pnpm dev`}
        language="bash"
      />

      <p>In dev mode, two URLs are available:</p>
      <ul>
        <li>
          <code>http://localhost:5173</code> — Vite UI dev server (hot reload, proxies API to
          gateway)
        </li>
        <li>
          <code>http://localhost:8080</code> — Gateway REST API + WebSocket
        </li>
      </ul>

      <h2>Option 4: Interactive setup wizard</h2>
      <CodeBlock
        code={`# Linux/macOS
./setup.sh

# Windows PowerShell
.\\setup.ps1`}
        language="bash"
      />

      <p>The wizard guides you through:</p>
      <ul>
        <li>Prerequisites check (Node.js 22+, pnpm 10+, Docker)</li>
        <li>Server configuration (ports, host)</li>
        <li>Authentication setup (none / API key / JWT)</li>
        <li>Database configuration</li>
        <li>Docker PostgreSQL startup</li>
        <li>Dependency installation and build</li>
      </ul>

      <h2>Configure AI providers</h2>
      <p>After starting, configure your AI provider API keys. There are two ways:</p>

      <h3>Web UI (recommended)</h3>
      <p>
        Navigate to <strong>Settings → Config Center</strong> and add your provider API keys. Keys
        are stored encrypted in PostgreSQL — not in plain text in <code>.env</code>.
      </p>

      <h3>CLI</h3>
      <CodeBlock
        code={`# Set OpenAI key
ownpilot config set openai-api-key sk-...

# Set Anthropic key
ownpilot config set anthropic-api-key sk-ant-...

# Set Ollama endpoint (local AI)
ownpilot config set ollama-base-url http://localhost:11434`}
        language="bash"
      />

      <h2>What's available after setup</h2>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>URL</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Gateway API</td>
            <td>
              <code>http://localhost:8080</code>
            </td>
            <td>REST API + WebSocket + bundled UI</td>
          </tr>
          <tr>
            <td>UI (dev mode)</td>
            <td>
              <code>http://localhost:5173</code>
            </td>
            <td>Vite dev server with hot reload</td>
          </tr>
          <tr>
            <td>PostgreSQL</td>
            <td>
              <code>localhost:25432</code>
            </td>
            <td>Database with pgvector extension</td>
          </tr>
          <tr>
            <td>WebSocket</td>
            <td>
              <code>ws://localhost:8080/ws</code>
            </td>
            <td>Real-time event broadcasts</td>
          </tr>
        </tbody>
      </table>

      <Callout type="success" title="You're ready!">
        Once OwnPilot is running and you've set an API key, navigate to the Chat page to start your
        first conversation. The assistant has access to all 190+ built-in tools by default.
      </Callout>

      {/* Prev/Next navigation */}
      <div className="flex items-center justify-between mt-12 pt-6 border-t border-[var(--color-border)]">
        <Link
          to="/docs/introduction"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          <ArrowLeft className="w-4 h-4" />
          Introduction
        </Link>
        <Link
          to="/docs/installation"
          className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors no-underline"
        >
          Installation
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    </DocsLayout>
  );
}
