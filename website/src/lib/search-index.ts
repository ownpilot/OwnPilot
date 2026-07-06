/**
 * Documentation search index — pre-built list of all searchable pages.
 * Each entry maps to a route + content summary for client-side fuzzy search.
 */
export interface SearchEntry {
  path: string;
  title: string;
  description: string;
  section: string;
  keywords: string[];
}

export const SEARCH_INDEX: SearchEntry[] = [
  {
    path: '/docs/introduction',
    title: 'Introduction',
    description: 'Overview of OwnPilot: a privacy-first AI assistant platform with soul agents, autonomous workflows, and 250+ tools.',
    section: 'Getting Started',
    keywords: ['overview', 'about', 'privacy', 'self-hosted', 'ai assistant'],
  },
  {
    path: '/docs/quick-start',
    title: 'Quick Start',
    description: 'The fastest way to start OwnPilot with Docker Compose or from source.',
    section: 'Getting Started',
    keywords: ['docker', 'compose', 'setup', 'installation', 'start'],
  },
  {
    path: '/docs/installation',
    title: 'Installation',
    description: 'Detailed installation guide covering Docker, manual setup, configuration, and environment variables.',
    section: 'Getting Started',
    keywords: ['docker', 'manual', 'install', 'configure', 'environment', '.env'],
  },
  {
    path: '/docs/configuration',
    title: 'Configuration',
    description: 'Configuration options for OwnPilot: providers, workspaces, authentication, logging, and advanced settings.',
    section: 'Getting Started',
    keywords: ['config', 'settings', 'providers', 'auth', 'logging'],
  },
  {
    path: '/docs/architecture',
    title: 'Architecture',
    description: 'System architecture of OwnPilot: core packages, gateway, UI, CLI, and how they interact.',
    section: 'Getting Started',
    keywords: ['architecture', 'packages', 'monorepo', 'core', 'gateway', 'system design'],
  },
  {
    path: '/docs/providers',
    title: 'AI Providers',
    description: 'Configure 104 AI providers including OpenAI, Anthropic, Google, Ollama, and local models.',
    section: 'Core Concepts',
    keywords: ['provider', 'model', 'api', 'openai', 'anthropic', 'ollama', 'lm studio', 'local'],
  },
  {
    path: '/docs/agents',
    title: 'Agents',
    description: 'Create and manage AI agents with rich identity, personality, role systems, and crew coordination.',
    section: 'Core Concepts',
    keywords: ['agent', 'soul', 'personality', 'crew', 'identity', 'autonomous'],
  },
  {
    path: '/docs/tools',
    title: 'Tools',
    description: '250+ built-in tools covering personal data, code execution, web search, browser automation, and IoT.',
    section: 'Core Concepts',
    keywords: ['tool', 'code', 'search', 'browser', 'iot', 'automation', 'execution'],
  },
  {
    path: '/docs/personal-data',
    title: 'Personal Data',
    description: 'Manage tasks, notes, bookmarks, contacts, calendar, expenses, habits, and custom data tables.',
    section: 'Core Concepts',
    keywords: ['tasks', 'notes', 'bookmarks', 'contacts', 'calendar', 'expenses', 'habits', 'data'],
  },
  {
    path: '/docs/channels',
    title: 'Channels',
    description: 'Connect OwnPilot to Telegram and WhatsApp for AI-powered messaging across platforms.',
    section: 'Core Concepts',
    keywords: ['telegram', 'whatsapp', 'messaging', 'channel', 'bot'],
  },
  {
    path: '/docs/mcp',
    title: 'MCP Integration',
    description: 'Model Context Protocol: connect external MCP servers and expose OwnPilot to Claude Desktop.',
    section: 'Core Concepts',
    keywords: ['mcp', 'model context protocol', 'claude', 'external', 'integration'],
  },
  {
    path: '/docs/coding-agents',
    title: 'Coding Agents',
    description: 'Orchestrate Claude Code, Codex, and Gemini CLI from the web UI with real-time output streaming.',
    section: 'Core Concepts',
    keywords: ['coding', 'claude code', 'codex', 'gemini', 'cli', 'terminal'],
  },
  {
    path: '/docs/edge-devices',
    title: 'Edge Devices',
    description: 'IoT device management with MQTT broker integration, telemetry, and command queuing.',
    section: 'Core Concepts',
    keywords: ['iot', 'edge', 'device', 'mqtt', 'raspberry pi', 'esp32', 'telemetry'],
  },
  {
    path: '/docs/automation/workflows',
    title: 'Workflows',
    description: 'Visual drag-and-drop workflow builder with 23+ node types, LLM integration, and copilot assistance.',
    section: 'Automation',
    keywords: ['workflow', 'automation', 'drag-drop', 'pipeline', 'llm', 'node'],
  },
  {
    path: '/docs/security',
    title: 'Security',
    description: 'Security architecture: sandboxed execution, PII detection, encryption, audit logging, and access control.',
    section: 'Operations',
    keywords: ['security', 'sandbox', 'pii', 'encryption', 'audit', 'permissions'],
  },
  {
    path: '/docs/api-reference',
    title: 'API Reference',
    description: 'Complete API reference for the OwnPilot Gateway REST API with authentication and endpoint documentation.',
    section: 'Operations',
    keywords: ['api', 'rest', 'endpoint', 'reference', 'gateway'],
  },
  {
    path: '/docs/deployment',
    title: 'Deployment',
    description: 'Production deployment guide: Docker options, environment variables, reverse proxy, and database setup.',
    section: 'Operations',
    keywords: ['deploy', 'production', 'docker', 'proxy', 'nginx', 'postgres'],
  },
];
