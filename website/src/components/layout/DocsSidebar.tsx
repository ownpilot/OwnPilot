import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface NavItem {
  title: string;
  href?: string;
  items?: NavItem[];
  badge?: string;
}

export const docsNav: NavItem[] = [
  {
    title: 'Getting Started',
    items: [
      { title: 'Introduction', href: '/docs/introduction' },
      { title: 'Quick Start', href: '/docs/quick-start' },
      { title: 'Installation', href: '/docs/installation' },
      { title: 'Configuration', href: '/docs/configuration' },
    ],
  },
  {
    title: 'Architecture',
    items: [
      { title: 'Overview', href: '/docs/architecture' },
      { title: 'Monorepo Structure', href: '/docs/architecture/monorepo' },
      { title: 'Message Pipeline', href: '/docs/architecture/pipeline' },
      { title: 'Event System', href: '/docs/architecture/events' },
    ],
  },
  {
    title: 'AI Providers',
    items: [
      { title: 'Provider Overview', href: '/docs/providers' },
      { title: 'OpenAI', href: '/docs/providers/openai' },
      { title: 'Anthropic', href: '/docs/providers/anthropic' },
      { title: 'Local AI (Ollama)', href: '/docs/providers/local' },
      { title: 'Smart Routing', href: '/docs/providers/routing' },
    ],
  },
  {
    title: 'Agent System',
    items: [
      { title: 'Agent Overview', href: '/docs/agents' },
      { title: 'Soul Agents', href: '/docs/agents/soul' },
      { title: 'Background Agents', href: '/docs/agents/background' },
      { title: 'Subagents', href: '/docs/agents/subagents' },
      { title: 'Agent Orchestra', href: '/docs/agents/orchestra' },
      { title: 'Crew System', href: '/docs/agents/crew' },
      { title: 'Coding Agents', href: '/docs/coding-agents' },
    ],
  },
  {
    title: 'Tool System',
    items: [
      { title: 'Tool Overview', href: '/docs/tools' },
      { title: 'Built-in Tools (190+)', href: '/docs/tools/builtin' },
      { title: 'Meta-tool Proxy', href: '/docs/tools/meta-proxy' },
      { title: 'MCP Integration', href: '/docs/mcp' },
      { title: 'Extensions', href: '/docs/tools/extensions' },
      { title: 'Skills Platform', href: '/docs/tools/skills' },
      { title: 'Custom Tools', href: '/docs/tools/custom' },
    ],
  },
  {
    title: 'Personal Data',
    items: [
      { title: 'Overview', href: '/docs/personal-data' },
      { title: 'Notes & Tasks', href: '/docs/personal-data/notes-tasks' },
      { title: 'Calendar & Contacts', href: '/docs/personal-data/calendar' },
      { title: 'Memory System', href: '/docs/personal-data/memory' },
      { title: 'Goals', href: '/docs/personal-data/goals' },
    ],
  },
  {
    title: 'Channels',
    items: [
      { title: 'Channels Overview', href: '/docs/channels' },
      { title: 'Telegram Setup', href: '/docs/channels/telegram' },
      { title: 'WhatsApp Setup', href: '/docs/channels/whatsapp' },
      { title: 'User Approval', href: '/docs/channels/approval' },
    ],
  },
  {
    title: 'Automation',
    items: [
      { title: 'Workflows', href: '/docs/automation/workflows' },
      { title: 'Triggers', href: '/docs/automation/triggers' },
      { title: 'Pulse System', href: '/docs/automation/pulse' },
      { title: 'Fleet Command', href: '/docs/automation/fleet' },
    ],
  },
  {
    title: 'Edge Devices',
    items: [
      { title: 'Edge & IoT Overview', href: '/docs/edge-devices' },
      { title: 'MQTT Setup', href: '/docs/edge-devices/mqtt' },
      { title: 'Device Registry', href: '/docs/edge-devices/registry' },
      { title: 'Telemetry & Commands', href: '/docs/edge-devices/telemetry' },
    ],
  },
  {
    title: 'Security',
    items: [
      { title: 'Security Overview', href: '/docs/security' },
      { title: 'Code Execution', href: '/docs/security/sandbox' },
      { title: 'Encryption', href: '/docs/security/encryption' },
      { title: 'Privacy & PII', href: '/docs/security/privacy' },
    ],
  },
  {
    title: 'API Reference',
    items: [
      { title: 'REST API', href: '/docs/api-reference' },
      { title: 'WebSocket Events', href: '/docs/api-reference/websocket' },
      { title: 'Authentication', href: '/docs/api-reference/auth' },
    ],
  },
  {
    title: 'Deployment',
    items: [
      { title: 'Docker', href: '/docs/deployment' },
      { title: 'Environment Variables', href: '/docs/deployment/env' },
      { title: 'Production Setup', href: '/docs/deployment/production' },
    ],
  },
];

interface SidebarItemProps {
  item: NavItem;
  depth?: number;
}

function SidebarItem({ item, depth = 0 }: SidebarItemProps) {
  const location = useLocation();
  const isActive = item.href ? location.pathname === item.href : false;
  const hasChildren = item.items && item.items.length > 0;
  const isChildActive = item.items?.some((child) => child.href && location.pathname === child.href);
  const [open, setOpen] = useState(isChildActive || isActive);

  if (hasChildren) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={cn(
            'flex items-center justify-between w-full px-3 py-1.5 rounded-md text-sm transition-colors cursor-pointer',
            'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)]',
            depth === 0 &&
              'font-semibold text-xs uppercase tracking-wider text-[var(--color-text-subtle)] hover:text-[var(--color-text-muted)] hover:bg-transparent'
          )}
        >
          <span>{item.title}</span>
          {depth > 0 &&
            (open ? (
              <ChevronDown className="w-3.5 h-3.5 shrink-0" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
            ))}
        </button>
        {open && item.items && (
          <div
            className={cn(
              'mt-0.5',
              depth === 0 ? 'mb-4' : 'ml-3 border-l border-[var(--color-border-subtle)] pl-3 mt-1'
            )}
          >
            {item.items.map((child) => (
              <SidebarItem key={child.title} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      to={item.href ?? '#'}
      className={cn(
        'flex items-center justify-between px-3 py-1.5 rounded-md text-sm transition-colors',
        isActive
          ? 'sidebar-link-active'
          : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-bg-subtle)]'
      )}
    >
      <span>{item.title}</span>
      {item.badge && (
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

interface DocsSidebarProps {
  className?: string;
}

export function DocsSidebar({ className }: DocsSidebarProps) {
  return (
    <nav className={cn('space-y-1', className)} aria-label="Documentation navigation">
      {docsNav.map((item) => (
        <SidebarItem key={item.title} item={item} depth={0} />
      ))}
    </nav>
  );
}
