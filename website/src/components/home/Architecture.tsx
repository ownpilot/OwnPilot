import { useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { Badge } from '@/components/ui/Badge';

const packages = [
  {
    name: '@ownpilot/core',
    size: '~62K LOC',
    files: '160+ files',
    color: 'border-purple-500/30 bg-purple-500/5',
    badge: 'bg-purple-500/10 text-purple-500',
    description:
      'AI engine, tool framework, plugin architecture, security primitives, sandboxed code execution, AES-256-GCM encryption, tamper-evident audit, PII detection. Minimal dependencies.',
    modules: [
      'agent/ — Multi-provider AI engine',
      'agent/orchestra/ — Fan-out, race, pipeline',
      'agent/tools/ — 190+ tool definitions',
      'plugins/ — Isolation + marketplace',
      'sandbox/ — VM, Docker, Worker threads',
      'crypto/ — Zero-dep AES-256-GCM',
      'privacy/ — PII detection (15+ types)',
    ],
  },
  {
    name: '@ownpilot/gateway',
    size: '~76K LOC',
    files: '389 test files',
    color: 'border-blue-500/30 bg-blue-500/5',
    badge: 'bg-blue-500/10 text-blue-500',
    description:
      'Hono HTTP API server. Routes, services, DB repositories, agent runners, WebSocket, channels (Telegram + WhatsApp), MCP client/server, plugin init, triggers.',
    modules: [
      'routes/ — 55+ route modules',
      'services/ — 60+ business services',
      'db/repositories/ — 45+ repos',
      'channels/ — Telegram + WhatsApp',
      'services/workflow/ — 23 node executors',
      'services/soul-heartbeat-service.ts',
      'tools/ — CLI, edge, browser, coding',
    ],
  },
  {
    name: '@ownpilot/ui',
    size: '~40K LOC',
    files: '57+ pages',
    color: 'border-emerald-500/30 bg-emerald-500/5',
    badge: 'bg-emerald-500/10 text-emerald-500',
    description:
      'React 19 + Vite 7 + Tailwind CSS 4 frontend. Code-split with lazy loading, dark mode, 120+ components, real-time WebSocket updates.',
    modules: [
      'pages/ — 57+ page components',
      'components/ — 120+ reusable UI',
      'hooks/ — WebSocket, chat store, theme',
      'api/ — Typed fetch wrapper + endpoints',
      'App.tsx — Route definitions',
    ],
  },
  {
    name: '@ownpilot/cli',
    size: 'CLI tools',
    files: '293 tests',
    color: 'border-orange-500/30 bg-orange-500/5',
    badge: 'bg-orange-500/10 text-orange-500',
    description:
      'Commander.js CLI for server management, bot control, workspace operations, configuration, and channel management.',
    modules: [
      'commands/start — Start server',
      'commands/config — Manage settings',
      'commands/bot — Telegram bot control',
      'commands/workspace — Isolation',
      'commands/skill — Install/remove skills',
    ],
  },
];

export function Architecture() {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section className="py-24 bg-[var(--color-bg)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div ref={ref} className="text-center max-w-2xl mx-auto mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : {}}
          >
            <Badge variant="blue" className="mb-4">
              Architecture
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--color-text)] mb-4">
              TypeScript monorepo, <span className="text-gradient">built to scale</span>
            </h2>
            <p className="text-[var(--color-text-muted)]">
              4 packages, single port in production. Gateway serves the bundled UI, REST API,
              WebSocket, and SSE — all on port 8080.
            </p>
          </motion.div>
        </div>

        {/* Architecture diagram — visual banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.15 }}
          className="mb-16"
        >
          <div className="max-w-5xl mx-auto rounded-2xl overflow-hidden border border-[var(--color-border)] shadow-lg">
            <img
              src="/architecture.png"
              alt="OwnPilot Architecture — Privacy-first AI platform with 100+ tools, 11+ providers, self-hosted"
              className="w-full h-auto"
              loading="lazy"
            />
          </div>
        </motion.div>

        {/* Package cards */}
        <div className="grid md:grid-cols-2 gap-6">
          {packages.map((pkg, i) => (
            <motion.div
              key={pkg.name}
              initial={{ opacity: 0, y: 20 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.2 + i * 0.1 }}
              className={`rounded-xl border p-6 ${pkg.color}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <code className={`text-sm font-mono font-bold px-2 py-0.5 rounded ${pkg.badge}`}>
                    {pkg.name}
                  </code>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-xs text-[var(--color-text-subtle)]">{pkg.size}</span>
                    <span className="text-xs text-[var(--color-text-subtle)]">·</span>
                    <span className="text-xs text-[var(--color-text-subtle)]">{pkg.files}</span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-[var(--color-text-muted)] mb-4 leading-relaxed">
                {pkg.description}
              </p>
              <ul className="space-y-1">
                {pkg.modules.map((mod) => (
                  <li
                    key={mod}
                    className="flex items-start gap-2 text-xs text-[var(--color-text-muted)]"
                  >
                    <span className="text-[var(--color-text-subtle)] mt-0.5 shrink-0">—</span>
                    <code className="font-mono">{mod}</code>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* Pipeline */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.5 }}
          className="mt-12 p-6 rounded-xl bg-[var(--color-bg-subtle)] border border-[var(--color-border)]"
        >
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--color-text-subtle)] mb-4">
            Message Pipeline
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            {[
              'Request',
              'Audit',
              'Persistence',
              'Post-Processing',
              'Context-Injection',
              'Agent-Execution',
              'Response',
            ].map((stage, i, arr) => (
              <div key={stage} className="flex items-center gap-2">
                <div className="px-3 py-1.5 rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] text-sm text-[var(--color-text-muted)] font-medium">
                  {stage}
                </div>
                {i < arr.length - 1 && (
                  <span className="text-[var(--color-text-subtle)] text-lg">→</span>
                )}
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-[var(--color-text-subtle)]">
            All messages (web UI, Telegram, WhatsApp, triggers) flow through the same MessageBus
            pipeline.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
