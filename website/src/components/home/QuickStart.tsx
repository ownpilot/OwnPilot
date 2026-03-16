import { useRef, useState } from 'react';
import { motion, useInView } from 'framer-motion';
import { CheckCircle } from 'lucide-react';
import { CodeBlock } from '@/components/ui/CodeBlock';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils';

const tabs = [
  {
    id: 'docker',
    label: 'Docker',
    icon: '🐳',
    steps: [
      {
        title: 'Clone repository',
        code: `git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot`,
        language: 'bash',
      },
      {
        title: 'Start OwnPilot + PostgreSQL',
        code: `docker compose --profile postgres up -d`,
        language: 'bash',
      },
      {
        title: 'Open in browser',
        code: `# UI + API: http://localhost:8080
# Configure AI keys in Settings → Config Center`,
        language: 'bash',
      },
    ],
  },
  {
    id: 'source',
    label: 'From Source',
    icon: '📦',
    steps: [
      {
        title: 'Clone and install',
        code: `git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot
pnpm install`,
        language: 'bash',
      },
      {
        title: 'Configure environment',
        code: `cp .env.example .env
# Edit .env (defaults work with Docker Compose)`,
        language: 'bash',
      },
      {
        title: 'Start database',
        code: `docker compose --profile postgres up -d`,
        language: 'bash',
      },
      {
        title: 'Start dev server',
        code: `pnpm dev
# Gateway: http://localhost:8080
# UI:      http://localhost:5173`,
        language: 'bash',
      },
    ],
  },
  {
    id: 'wizard',
    label: 'Setup Wizard',
    icon: '🧙',
    steps: [
      {
        title: 'Clone and run setup wizard',
        code: `git clone https://github.com/ownpilot/ownpilot.git
cd ownpilot

# Linux/macOS
./setup.sh

# Windows PowerShell
.\\setup.ps1`,
        language: 'bash',
      },
      {
        title: 'Wizard guides you through',
        code: `# Prerequisites check (Node.js 22+, pnpm 10+, Docker)
# Server configuration (ports, host)
# Authentication setup (none / API key / JWT)
# Database configuration
# Docker PostgreSQL startup
# Dependency installation and build`,
        language: 'bash',
      },
    ],
  },
];

const envVars = `# Server
PORT=8080
UI_PORT=5173
HOST=127.0.0.1
NODE_ENV=development

# Database (Docker Compose defaults)
POSTGRES_HOST=localhost
POSTGRES_PORT=25432
POSTGRES_USER=ownpilot
POSTGRES_PASSWORD=ownpilot_secret
POSTGRES_DB=ownpilot

# Authentication
AUTH_TYPE=none   # none | api-key | jwt

# AI Keys (or configure via UI Config Center)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...`;

export function QuickStart() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const [activeTab, setActiveTab] = useState('docker');

  const activeTabData = tabs.find((t) => t.id === activeTab) ?? tabs[0]!;

  return (
    <section id="quick-start" className="py-24 bg-[var(--color-bg-subtle)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div ref={ref} className="text-center max-w-2xl mx-auto mb-12">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
          >
            <Badge variant="green" className="mb-4">
              Quick Start
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--color-text)] mb-4">
              Up and running in minutes
            </h2>
            <p className="text-[var(--color-text-muted)]">
              Three ways to get started. Docker is the quickest — no Node.js required.
            </p>
          </motion.div>
        </div>

        <div className="grid lg:grid-cols-2 gap-8 max-w-6xl mx-auto">
          {/* Left: Setup steps */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ delay: 0.15 }}
          >
            {/* Tab bar */}
            <div className="flex gap-1 mb-6 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-1 w-fit">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer',
                    activeTab === tab.id
                      ? 'bg-[var(--color-bg)] text-[var(--color-text)] shadow-sm border border-[var(--color-border)]'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  )}
                >
                  <span>{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Steps */}
            <div className="space-y-4">
              {activeTabData.steps.map((step, i) => (
                <div key={i} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="w-7 h-7 rounded-full bg-[hsl(var(--primary))] text-white text-xs font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </div>
                    {i < activeTabData.steps.length - 1 && (
                      <div className="w-px flex-1 bg-[var(--color-border)] mt-2" />
                    )}
                  </div>
                  <div className="flex-1 pb-4">
                    <p className="text-sm font-medium text-[var(--color-text)] mb-2">
                      {step.title}
                    </p>
                    <CodeBlock code={step.code} language={step.language} />
                  </div>
                </div>
              ))}
            </div>

            {/* Services info */}
            <div className="mt-6 p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]">
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-subtle)] mb-3">
                Available after start
              </p>
              <div className="space-y-2">
                {[
                  {
                    label: 'Gateway API',
                    url: 'http://localhost:8080',
                    desc: 'REST API + WebSocket',
                  },
                  { label: 'Web UI (dev)', url: 'http://localhost:5173', desc: 'Vite dev server' },
                  { label: 'PostgreSQL', url: 'localhost:25432', desc: 'Database with pgvector' },
                ].map((svc) => (
                  <div key={svc.label} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-[var(--color-text-muted)]">{svc.label}</span>
                    </div>
                    <code className="text-xs font-mono text-[hsl(var(--primary))] bg-[var(--color-accent-light)] px-2 py-0.5 rounded">
                      {svc.url}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Right: .env config */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ delay: 0.25 }}
          >
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-[var(--color-text)] mb-1">
                Environment Configuration
              </h3>
              <p className="text-sm text-[var(--color-text-muted)]">
                The defaults in{' '}
                <code className="text-xs bg-[var(--color-code-bg)] px-1.5 py-0.5 rounded font-mono">
                  .env.example
                </code>{' '}
                work out of the box with Docker Compose PostgreSQL.
              </p>
            </div>
            <CodeBlock code={envVars} language="bash" filename=".env" />

            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]">
                <div className="text-2xl mb-1">🔑</div>
                <div className="text-sm font-medium text-[var(--color-text)] mb-1">
                  Config Center
                </div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  Set AI API keys via the web UI. No .env editing required.
                </div>
              </div>
              <div className="p-4 rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)]">
                <div className="text-2xl mb-1">💻</div>
                <div className="text-sm font-medium text-[var(--color-text)] mb-1">CLI Config</div>
                <div className="text-xs text-[var(--color-text-muted)]">
                  <code className="font-mono">ownpilot config set openai-api-key sk-...</code>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
