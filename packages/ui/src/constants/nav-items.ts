/**
 * Shared navigation item constants.
 * Imported by Sidebar (Phase 2) and CustomizePage (Phase 3).
 * Source of truth for all nav items — do NOT duplicate in Layout.tsx.
 */
import React from 'react';
import {
  MessageSquare,
  History,
  Bot,
  Wrench,
  Cpu,
  DollarSign,
  Settings,
  UserCircle,
  LayoutDashboard,
  CheckCircle2,
  FileText,
  Calendar,
  Users,
  Bookmark,
  Database,
  Table,
  Brain,
  Target,
  Zap,
  ListChecks,
  Shield,
  Puzzle,
  HardDrive,
  Activity,
  Code,
  Receipt,
  Repeat,
  Clock,
  Key,
  Globe,
  Server,
  Container,
  Info,
  Sparkles,
  BookOpen,
  GitBranch,
  Link,
  Terminal,
  ShieldCheck,
  Send,
  MonitorCheck,
  Layers,
  LayoutTemplate,
  Wifi,
} from '../components/icons';

export interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

export interface NavGroup {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
  defaultOpen?: boolean;
  /** Optional badge text (e.g. "Beta") shown next to group label */
  badge?: string;
}

// Main navigation items (always visible)
export const mainItems: NavItem[] = [
  { to: '/', icon: MessageSquare, label: 'Chat' },
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/analytics', icon: Activity, label: 'Analytics' },
  { to: '/channels', icon: Send, label: 'Channels' },
  { to: '/history', icon: History, label: 'Conversations' },
];

// Grouped navigation
export const navGroups: NavGroup[] = [
  {
    id: 'data',
    label: 'Personal Data',
    icon: Database,
    items: [
      { to: '/tasks', icon: CheckCircle2, label: 'Tasks' },
      { to: '/notes', icon: FileText, label: 'Notes' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/contacts', icon: Users, label: 'Contacts' },
      { to: '/bookmarks', icon: Bookmark, label: 'Bookmarks' },
      { to: '/expenses', icon: Receipt, label: 'Expenses' },
      { to: '/habits', icon: Repeat, label: 'Habits' },
      { to: '/pomodoro', icon: Clock, label: 'Pomodoro' },
    ],
  },
  {
    id: 'ai',
    label: 'AI & Automation',
    icon: Brain,
    items: [
      { to: '/memories', icon: Brain, label: 'Memories' },
      { to: '/goals', icon: Target, label: 'Goals' },
      { to: '/plans', icon: ListChecks, label: 'Plans' },
      { to: '/triggers', icon: Zap, label: 'Triggers' },
      { to: '/workflows', icon: GitBranch, label: 'Workflows' },
      { to: '/autonomous', icon: Bot, label: 'Autonomous Agents' },
      { to: '/artifacts', icon: LayoutTemplate, label: 'Artifacts' },
      { to: '/approvals', icon: ShieldCheck, label: 'Approvals' },
      { to: '/autonomy', icon: Shield, label: 'Autonomy' },
    ],
  },
  {
    id: 'tools',
    label: 'Tools & Extensions',
    icon: Wrench,
    items: [
      { to: '/tools', icon: Wrench, label: 'Tools' },
      { to: '/custom-tools', icon: Code, label: 'Custom Tools' },
      { to: '/skills', icon: BookOpen, label: 'Skills Hub' },
      { to: '/plugins', icon: Puzzle, label: 'Plugins' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Cpu,
    items: [
      { to: '/agents', icon: Bot, label: 'Agents' },
      { to: '/models', icon: Cpu, label: 'Models' },
      { to: '/wizards', icon: Sparkles, label: 'Wizards' },
      { to: '/workspaces', icon: HardDrive, label: 'Workspaces' },
      { to: '/custom-data', icon: Database, label: 'Custom Data' },
      { to: '/data-browser', icon: Table, label: 'Data Browser' },
      { to: '/costs', icon: DollarSign, label: 'Costs' },
      { to: '/logs', icon: Activity, label: 'Logs' },
      { to: '/event-monitor', icon: MonitorCheck, label: 'Event Monitor' },
    ],
  },
  {
    id: 'experimental',
    label: 'Experimental',
    icon: Sparkles,
    badge: 'Beta',
    items: [
      { to: '/claws', icon: Zap, label: 'Claws' },
      { to: '/fleet', icon: Layers, label: 'Fleet Command' },
      { to: '/edge-devices', icon: Wifi, label: 'Edge Devices' },
      { to: '/coding-agents', icon: Terminal, label: 'Coding Agents' },
      { to: '/orchestration', icon: Zap, label: 'Orchestration' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    items: [
      // Setup essentials
      { to: '/settings/api-keys', icon: Key, label: 'API Keys' },
      { to: '/settings/providers', icon: Server, label: 'Providers' },
      { to: '/settings/ai-models', icon: Cpu, label: 'AI Models' },
      { to: '/settings/model-routing', icon: Sparkles, label: 'Model Routing' },
      // Security & access
      { to: '/settings/security', icon: Shield, label: 'Security' },
      { to: '/settings/security-scanner', icon: Activity, label: 'Security Scanner' },
      { to: '/settings/tool-groups', icon: Wrench, label: 'Tool Groups' },
      // Tools & integrations
      { to: '/settings/cli-tools', icon: Code, label: 'CLI Tools' },
      { to: '/settings/coding-agents', icon: Terminal, label: 'Coding Agents' },
      { to: '/settings/mcp-servers', icon: Zap, label: 'MCP Servers' },
      { to: '/settings/connected-apps', icon: Link, label: 'Connected Apps' },
      { to: '/settings/workflow-tools', icon: GitBranch, label: 'Workflow Tools' },
      // System
      { to: '/settings/config-center', icon: Globe, label: 'Config Center' },
      { to: '/settings/system', icon: Container, label: 'System' },
    ],
  },
];

// Bottom navigation items
export const bottomItems: NavItem[] = [
  { to: '/about', icon: Info, label: 'About' },
  { to: '/profile', icon: UserCircle, label: 'Profile' },
];

/** Flat array of every nav item for use in CustomizePage grid. */
export const ALL_NAV_ITEMS: NavItem[] = [
  ...mainItems,
  ...navGroups.flatMap((g) => g.items),
  ...bottomItems,
];
