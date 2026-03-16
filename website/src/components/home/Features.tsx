import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import {
  Brain,
  Wrench,
  Shield,
  Zap,
  Globe,
  Database,
  Bot,
  MessageSquare,
  GitBranch,
  Cpu,
  Wifi,
  Mic,
  Chrome,
  Code,
  Users,
  Activity,
  BarChart3,
  Lock,
  Network,
  Layers,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

const features = [
  {
    icon: Brain,
    title: '96 AI Providers',
    badge: 'Multi-Provider',
    badgeVariant: 'purple' as const,
    description:
      'OpenAI, Anthropic, Google, xAI, DeepSeek, Mistral, and 90+ more — including Ollama and LM Studio for fully local inference. Smart routing: cheapest, fastest, smartest.',
    color: 'from-purple-500/20 to-violet-500/20',
    iconColor: 'text-purple-500',
  },
  {
    icon: Wrench,
    title: '190+ Built-in Tools',
    badge: '32 Categories',
    badgeVariant: 'blue' as const,
    description:
      'Tasks, notes, calendar, contacts, bookmarks, expenses, habits, Pomodoro, files, code execution, web search, email, git, browser automation, IoT control, and more.',
    color: 'from-blue-500/20 to-cyan-500/20',
    iconColor: 'text-blue-500',
  },
  {
    icon: Bot,
    title: 'Soul Agents',
    badge: 'Autonomous',
    badgeVariant: 'purple' as const,
    description:
      'Agents with rich identity: personality, role, mission, heartbeat lifecycle, crew system, inter-agent messaging, and evolution tracking. 16+ ready-made templates.',
    color: 'from-violet-500/20 to-purple-500/20',
    iconColor: 'text-violet-500',
  },
  {
    icon: Activity,
    title: 'Background Agents',
    badge: '3 Modes',
    badgeVariant: 'orange' as const,
    description:
      'Persistent autonomous agents with interval, continuous, or event-driven scheduling. Full tool access, workspace isolation, budget tracking, and rate limiting.',
    color: 'from-orange-500/20 to-amber-500/20',
    iconColor: 'text-orange-500',
  },
  {
    icon: GitBranch,
    title: 'Workflows',
    badge: '23 Node Types',
    badgeVariant: 'green' as const,
    description:
      'Visual drag-and-drop workflow builder with LLM, condition, forEach, parallel, merge, dataStore, schemaValidator, approval, and webhook nodes. Copilot-assisted.',
    color: 'from-emerald-500/20 to-green-500/20',
    iconColor: 'text-emerald-500',
  },
  {
    icon: Network,
    title: 'MCP Integration',
    badge: 'Client + Server',
    badgeVariant: 'blue' as const,
    description:
      'Both sides of MCP: connect to external MCP servers (Filesystem, GitHub, Brave Search) and expose OwnPilot as an MCP server for Claude Desktop.',
    color: 'from-cyan-500/20 to-blue-500/20',
    iconColor: 'text-cyan-500',
  },
  {
    icon: Zap,
    title: 'Meta-tool Proxy',
    badge: 'Only 4 Tools',
    badgeVariant: 'orange' as const,
    description:
      'Only 4 meta-tools are sent to the LLM context. All 190+ tools are discoverable on-demand, keeping prompts lean while maintaining full tool availability.',
    color: 'from-yellow-500/20 to-orange-500/20',
    iconColor: 'text-yellow-500',
  },
  {
    icon: Shield,
    title: '4-Layer Security',
    badge: 'AES-256-GCM',
    badgeVariant: 'red' as const,
    description:
      'Critical pattern blocking → permission matrix → approval callback → sandbox isolation. PII detection (15+ categories), zero-dep crypto, tamper-evident audit logs.',
    color: 'from-red-500/20 to-rose-500/20',
    iconColor: 'text-red-500',
  },
  {
    icon: MessageSquare,
    title: 'Channels',
    badge: 'Telegram + WhatsApp',
    badgeVariant: 'green' as const,
    description:
      'Telegram bot with formatting and filters. WhatsApp via Baileys (no Meta Business needed), QR auth, group messages, anti-ban hardening, session persistence.',
    color: 'from-green-500/20 to-teal-500/20',
    iconColor: 'text-green-500',
  },
  {
    icon: Code,
    title: 'Coding Agents',
    badge: 'Claude Code, Codex',
    badgeVariant: 'purple' as const,
    description:
      'Orchestrate Claude Code, Codex, and Gemini CLI from the web UI. Real-time terminal output streaming, PTY interactive mode, and custom provider registration.',
    color: 'from-indigo-500/20 to-blue-500/20',
    iconColor: 'text-indigo-500',
  },
  {
    icon: Wifi,
    title: 'Edge / IoT',
    badge: 'MQTT',
    badgeVariant: 'blue' as const,
    description:
      'Mosquitto MQTT broker integration. Device registry for Raspberry Pi, ESP32, Arduino. Telemetry ingestion, command queuing with ACK, and 6 LLM-callable tools.',
    color: 'from-teal-500/20 to-emerald-500/20',
    iconColor: 'text-teal-500',
  },
  {
    icon: Mic,
    title: 'Voice Pipeline',
    badge: 'STT + TTS',
    badgeVariant: 'orange' as const,
    description:
      'Whisper API for speech-to-text, OpenAI TTS with 6 voices (alloy, echo, fable, onyx, nova, shimmer). Voice recording in chat and audio playback for responses.',
    color: 'from-pink-500/20 to-rose-500/20',
    iconColor: 'text-pink-500',
  },
  {
    icon: Chrome,
    title: 'Browser Agent',
    badge: 'Playwright',
    badgeVariant: 'blue' as const,
    description:
      'Playwright-powered headless Chromium for AI-driven automation. Navigate, click, type, screenshot, eval JS, extract content, fill forms — all via LLM tools.',
    color: 'from-sky-500/20 to-blue-500/20',
    iconColor: 'text-sky-500',
  },
  {
    icon: Users,
    title: 'Fleet Command',
    badge: 'Multi-Worker',
    badgeVariant: 'purple' as const,
    description:
      'FleetManager with 4 worker types: ai-chat, coding-cli, api-call, mcp-bridge. Task dependencies, shared context feedback, cron scheduling, crash recovery.',
    color: 'from-violet-500/20 to-indigo-500/20',
    iconColor: 'text-violet-500',
  },
  {
    icon: Globe,
    title: 'Connected Apps',
    badge: '1000+ Integrations',
    badgeVariant: 'green' as const,
    description:
      '1000+ OAuth app integrations via Composio. Google Drive, GitHub, Slack, Notion, Stripe, and hundreds more accessible through AI tool calling.',
    color: 'from-lime-500/20 to-green-500/20',
    iconColor: 'text-lime-500',
  },
  {
    icon: Database,
    title: 'Personal Data',
    badge: 'Fully Owned',
    badgeVariant: 'blue' as const,
    description:
      'Notes, tasks, bookmarks, contacts, calendar, expenses, habits, Pomodoro timer, goals, custom data tables, and encrypted long-term memory with vector search.',
    color: 'from-blue-500/20 to-indigo-500/20',
    iconColor: 'text-blue-500',
  },
  {
    icon: Cpu,
    title: 'Subagents',
    badge: 'Parallel',
    badgeVariant: 'orange' as const,
    description:
      'Fire-and-forget parallel task delegation. Spawn lightweight child agents, poll for results, configurable concurrency limits, and nesting depth cap.',
    color: 'from-amber-500/20 to-orange-500/20',
    iconColor: 'text-amber-500',
  },
  {
    icon: BarChart3,
    title: 'Agent Orchestra',
    badge: 'Fan-out / Race',
    badgeVariant: 'purple' as const,
    description:
      'Multi-agent orchestration with fan-out, race, pipeline, and voting strategies. Real-time WebSocket progress events and 6 LLM-callable orchestra tools.',
    color: 'from-purple-500/20 to-pink-500/20',
    iconColor: 'text-purple-500',
  },
  {
    icon: Lock,
    title: 'Skills Platform',
    badge: 'SKILL.md Standard',
    badgeVariant: 'green' as const,
    description:
      'Open standard SKILL.md format (AgentSkills.io). Sandboxed execution with granular permissions, npm dependencies, CLI management with install/update/remove.',
    color: 'from-emerald-500/20 to-teal-500/20',
    iconColor: 'text-emerald-500',
  },
  {
    icon: Layers,
    title: 'Plugin System',
    badge: 'Extensible',
    badgeVariant: 'blue' as const,
    description:
      'PluginRegistry with isolation, marketplace, signing, and runtime. Channel plugins use builder pattern with standardized lifecycle hooks and UCP protocol.',
    color: 'from-blue-500/20 to-violet-500/20',
    iconColor: 'text-blue-500',
  },
];

interface FeatureCardProps {
  feature: (typeof features)[number];
  index: number;
}

function FeatureCard({ feature, index }: FeatureCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: '-50px' });
  const Icon = feature.icon;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 20 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.4, delay: (index % 4) * 0.08 }}
    >
      <Card hover className="h-full group">
        <div
          className={`w-10 h-10 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-4 transition-transform duration-200 group-hover:scale-110`}
        >
          <Icon className={`w-5 h-5 ${feature.iconColor}`} />
        </div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <h3 className="font-semibold text-[var(--color-text)] text-sm leading-tight">
            {feature.title}
          </h3>
          <Badge variant={feature.badgeVariant} className="shrink-0 text-xs">
            {feature.badge}
          </Badge>
        </div>
        <p className="text-sm text-[var(--color-text-muted)] leading-relaxed">
          {feature.description}
        </p>
      </Card>
    </motion.div>
  );
}

export function Features() {
  const headerRef = useRef<HTMLDivElement>(null);
  const isHeaderInView = useInView(headerRef, { once: true });

  return (
    <section id="features" className="py-24 bg-[var(--color-bg)]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div ref={headerRef} className="text-center max-w-3xl mx-auto mb-16">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={isHeaderInView ? { opacity: 1, y: 0 } : {}}
          >
            <Badge variant="purple" className="mb-4">
              Everything you need
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-[var(--color-text)] mb-4">
              A complete AI platform, <span className="text-gradient">not a SaaS</span>
            </h2>
            <p className="text-lg text-[var(--color-text-muted)] leading-relaxed">
              OwnPilot runs entirely on your infrastructure. No data sent to third parties, no
              subscription fees, no vendor lock-in. Just a powerful, extensible AI assistant that
              respects your privacy.
            </p>
          </motion.div>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {features.map((feature, index) => (
            <FeatureCard key={feature.title} feature={feature} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
