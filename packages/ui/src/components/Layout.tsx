import { useState } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  MessageSquare,
  Inbox,
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
  ChevronDown,
  ChevronRight,
  Activity,
  Code,
  Receipt,
  Key,
  Globe,
  Server,
  Image,
  Link,
  Container,
} from './icons';
import { StatsPanel } from './StatsPanel';

interface NavItem {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}

interface NavGroup {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  items: NavItem[];
  defaultOpen?: boolean;
}

// Main navigation items (always visible)
const mainItems: NavItem[] = [
  { to: '/', icon: MessageSquare, label: 'Chat' },
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inbox', icon: Inbox, label: 'Inbox' },
];

// Grouped navigation
const navGroups: NavGroup[] = [
  {
    id: 'data',
    label: 'Data',
    icon: Database,
    items: [
      { to: '/tasks', icon: CheckCircle2, label: 'Tasks' },
      { to: '/notes', icon: FileText, label: 'Notes' },
      { to: '/calendar', icon: Calendar, label: 'Calendar' },
      { to: '/contacts', icon: Users, label: 'Contacts' },
      { to: '/bookmarks', icon: Bookmark, label: 'Bookmarks' },
      { to: '/expenses', icon: Receipt, label: 'Expenses' },
      { to: '/custom-data', icon: Database, label: 'Custom Data' },
      { to: '/data-browser', icon: Table, label: 'Data Browser' },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    icon: Brain,
    items: [
      { to: '/memories', icon: Brain, label: 'Memories' },
      { to: '/goals', icon: Target, label: 'Goals' },
      { to: '/triggers', icon: Zap, label: 'Triggers' },
      { to: '/plans', icon: ListChecks, label: 'Plans' },
      { to: '/autonomy', icon: Shield, label: 'Autonomy' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Cpu,
    items: [
      { to: '/agents', icon: Bot, label: 'Agents' },
      { to: '/tools', icon: Wrench, label: 'Tools' },
      { to: '/custom-tools', icon: Code, label: 'Custom Tools' },
      { to: '/plugins', icon: Puzzle, label: 'Plugins' },
      { to: '/workspaces', icon: HardDrive, label: 'Workspaces' },
      { to: '/models', icon: Cpu, label: 'Models' },
      { to: '/costs', icon: DollarSign, label: 'Costs' },
      { to: '/logs', icon: Activity, label: 'Logs' },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: Settings,
    items: [
      { to: '/settings/config-center', icon: Globe, label: 'Config Center' },
      { to: '/settings/api-keys', icon: Key, label: 'API Keys' },
      { to: '/settings/providers', icon: Server, label: 'Providers' },
      { to: '/settings/ai-models', icon: Cpu, label: 'AI Models' },
      { to: '/settings/integrations', icon: Link, label: 'Integrations' },
      { to: '/settings/media', icon: Image, label: 'Media' },
      { to: '/settings/system', icon: Container, label: 'System' },
    ],
  },
];

// Bottom navigation items
const bottomItems: NavItem[] = [
  { to: '/profile', icon: UserCircle, label: 'Profile' },
];

function NavItemLink({ item, compact = false }: { item: NavItem; compact?: boolean }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-sm ${
          isActive
            ? 'bg-primary text-white'
            : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
        } ${compact ? 'pl-8' : ''}`
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

function CollapsibleGroup({ group, isOpen, onToggle }: { group: NavGroup; isOpen: boolean; onToggle: () => void }) {
  const location = useLocation();
  const Icon = group.icon;
  const isActive = group.items.some(item => location.pathname === item.to || location.pathname.startsWith(item.to + '/'));

  return (
    <div className="space-y-0.5">
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors text-sm ${
          isActive && !isOpen
            ? 'bg-primary/10 text-primary'
            : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
        }`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left font-medium">{group.label}</span>
        {isOpen ? (
          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="space-y-0.5">
          {group.items.map((item) => (
            <NavItemLink key={item.to} item={item} compact />
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const [isStatsPanelCollapsed, setIsStatsPanelCollapsed] = useState(false);
  const location = useLocation();

  // Initialize open groups based on current path
  const getInitialOpenGroups = () => {
    const openGroups: Record<string, boolean> = {};
    navGroups.forEach(group => {
      const isActive = group.items.some(item => location.pathname === item.to || location.pathname.startsWith(item.to + '/'));
      openGroups[group.id] = isActive || group.defaultOpen || false;
    });
    return openGroups;
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(getInitialOpenGroups);

  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <div className="flex h-screen bg-bg-primary dark:bg-dark-bg-primary">
      {/* Left Sidebar - Navigation */}
      <aside className="w-56 border-r border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col">
        {/* Logo */}
        <div className="p-3 border-b border-border dark:border-dark-border">
          <h1 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            OwnPilot
          </h1>
          <p className="text-xs text-text-muted dark:text-dark-text-muted">
            Privacy-first AI Assistant
          </p>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-2 overflow-y-auto">
          {/* Main Items */}
          <div className="space-y-0.5 mb-3">
            {mainItems.map((item) => (
              <NavItemLink key={item.to} item={item} />
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-border dark:border-dark-border my-2" />

          {/* Grouped Items */}
          <div className="space-y-1">
            {navGroups.map((group) => (
              <CollapsibleGroup
                key={group.id}
                group={group}
                isOpen={openGroups[group.id] || false}
                onToggle={() => toggleGroup(group.id)}
              />
            ))}
          </div>

          {/* Divider */}
          <div className="border-t border-border dark:border-dark-border my-2" />

          {/* Bottom Items */}
          <div className="space-y-0.5">
            {bottomItems.map((item) => (
              <NavItemLink key={item.to} item={item} />
            ))}
          </div>
        </nav>

        {/* Status */}
        <div className="p-3 border-t border-border dark:border-dark-border">
          <div className="flex items-center gap-2 text-xs text-text-muted dark:text-dark-text-muted">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            <span>Connected</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>

      {/* Right Sidebar - Stats Panel */}
      <StatsPanel
        isCollapsed={isStatsPanelCollapsed}
        onToggle={() => setIsStatsPanelCollapsed(!isStatsPanelCollapsed)}
      />
    </div>
  );
}
