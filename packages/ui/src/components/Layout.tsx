import { useState, useEffect, useCallback } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useGateway, type ConnectionStatus } from '../hooks/useWebSocket';
import { useIsMobile } from '../hooks/useMediaQuery';
import { useAuth } from '../hooks/useAuth';
import {
  MessageSquare,
  Inbox,
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
  ChevronDown,
  ChevronRight,
  Activity,
  Code,
  Receipt,
  Key,
  Globe,
  Server,
  Container,
  Info,
  Sparkles,
  BookOpen,
  Menu,
  X,
  GitBranch,
  Link,
  LogOut,
  Terminal,
} from './icons';
import { StatsPanel } from './StatsPanel';
import { RealtimeBridge, type BadgeCounts } from './RealtimeBridge';
import { SecurityBanner } from './SecurityBanner';
import { usePulseSlots, PulseSlotGrid } from './PulseSlots';
import { STORAGE_KEYS } from '../constants/storage-keys';
import { DebugDrawer } from './DebugDrawer';
import { MiniChat } from './MiniChat';
import { MiniTerminal } from './MiniTerminal';

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
  /** If true, hidden in simple mode */
  advancedOnly?: boolean;
}

// Main navigation items (always visible)
const mainItems: NavItem[] = [
  { to: '/', icon: MessageSquare, label: 'Chat' },
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/inbox', icon: Inbox, label: 'Inbox' },
  { to: '/history', icon: History, label: 'History' },
];

// Grouped navigation
const navGroups: NavGroup[] = [
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
    ],
  },
  {
    id: 'ai',
    label: 'AI & Automation',
    icon: Brain,
    advancedOnly: true,
    items: [
      { to: '/memories', icon: Brain, label: 'Memories' },
      { to: '/goals', icon: Target, label: 'Goals' },
      { to: '/plans', icon: ListChecks, label: 'Plans' },
      { to: '/triggers', icon: Zap, label: 'Triggers' },
      { to: '/workflows', icon: GitBranch, label: 'Workflows' },
      { to: '/autonomy', icon: Shield, label: 'Autonomy' },
    ],
  },
  {
    id: 'tools',
    label: 'Tools & Extensions',
    icon: Wrench,
    advancedOnly: true,
    items: [
      { to: '/tools', icon: Wrench, label: 'Tools' },
      { to: '/custom-tools', icon: Code, label: 'Custom Tools' },
      { to: '/extensions', icon: Sparkles, label: 'User Extensions' },
      { to: '/skills', icon: BookOpen, label: 'Skills' },
      { to: '/plugins', icon: Puzzle, label: 'Plugins' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Cpu,
    advancedOnly: true,
    items: [
      { to: '/agents', icon: Bot, label: 'Agents' },
      { to: '/models', icon: Cpu, label: 'Models' },
      { to: '/coding-agents', icon: Terminal, label: 'Coding Agents' },
      { to: '/wizards', icon: Sparkles, label: 'Wizards' },
      { to: '/workspaces', icon: HardDrive, label: 'Workspaces' },
      { to: '/custom-data', icon: Database, label: 'Custom Data' },
      { to: '/data-browser', icon: Table, label: 'Data Browser' },
      { to: '/costs', icon: DollarSign, label: 'Costs' },
      { to: '/logs', icon: Activity, label: 'Logs' },
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

// Simple mode shows fewer settings
const simpleSettingsItems: NavItem[] = [
  { to: '/settings/api-keys', icon: Key, label: 'API Keys' },
  { to: '/settings/security', icon: Shield, label: 'Security' },
  { to: '/settings/ai-models', icon: Cpu, label: 'AI Models' },
];

// Bottom navigation items
const bottomItems: NavItem[] = [
  { to: '/about', icon: Info, label: 'About' },
  { to: '/profile', icon: UserCircle, label: 'Profile' },
];

function NavItemLink({
  item,
  compact = false,
  badge,
}: {
  item: NavItem;
  compact?: boolean;
  badge?: number;
}) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-sm ${
          isActive
            ? 'bg-primary text-white shadow-sm border-l-[3px] border-white/50'
            : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5'
        } ${compact ? 'pl-8' : ''}`
      }
    >
      <Icon className="w-4 h-4 shrink-0" />
      <span className="truncate flex-1">{item.label}</span>
      {badge != null && badge > 0 && (
        <span className="ml-auto min-w-[1.25rem] h-5 px-1 flex items-center justify-center rounded-full bg-error text-white text-[10px] font-bold leading-none">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </NavLink>
  );
}

function CollapsibleGroup({
  group,
  isOpen,
  onToggle,
}: {
  group: NavGroup;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const location = useLocation();
  const Icon = group.icon;
  const isActive = group.items.some(
    (item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/')
  );

  return (
    <div className="space-y-0.5">
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-colors text-sm ${
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

function ModeToggle({ isAdvanced, onToggle }: { isAdvanced: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-text-muted dark:text-dark-text-muted hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors"
      title={isAdvanced ? 'Switch to Simple Mode' : 'Switch to Advanced Mode'}
    >
      <Settings className="w-3.5 h-3.5 shrink-0" />
      <span className="flex-1 text-left">{isAdvanced ? 'Advanced Mode' : 'Simple Mode'}</span>
      <div
        className={`w-7 h-4 rounded-full transition-colors relative ${
          isAdvanced ? 'bg-primary' : 'bg-border dark:bg-dark-border'
        }`}
      >
        <div
          className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
            isAdvanced ? 'translate-x-3.5' : 'translate-x-0.5'
          }`}
        />
      </div>
    </button>
  );
}

const CONNECTION_STYLES: Record<
  ConnectionStatus,
  { color: string; pulse: boolean; label: string }
> = {
  connected: { color: 'bg-success', pulse: false, label: 'Connected' },
  connecting: { color: 'bg-warning', pulse: true, label: 'Connecting...' },
  disconnected: { color: 'bg-error', pulse: false, label: 'Disconnected' },
  error: { color: 'bg-error', pulse: false, label: 'Connection Error' },
};

function ConnectionIndicator({ status }: { status: ConnectionStatus }) {
  const style = CONNECTION_STYLES[status];
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-xs text-text-muted dark:text-dark-text-muted">
      <span
        className={`w-1.5 h-1.5 rounded-full ${style.color} ${style.pulse ? 'animate-pulse' : ''}`}
        aria-hidden="true"
      />
      <span>{style.label}</span>
    </div>
  );
}

export function Layout() {
  const { status: wsStatus } = useGateway();
  const { passwordConfigured, logout } = useAuth();
  const isMobile = useIsMobile();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isStatsPanelCollapsed, setIsStatsPanelCollapsed] = useState(true);
  const [isAdvancedMode, setIsAdvancedMode] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.ADVANCED_MODE) === 'true';
  });
  const { slots: pulseSlots } = usePulseSlots();
  const [badgeCounts, setBadgeCounts] = useState<BadgeCounts>({ inbox: 0, tasks: 0 });
  const handleBadgeUpdate = useCallback(
    (updater: (prev: BadgeCounts) => BadgeCounts) => setBadgeCounts(updater),
    []
  );
  const location = useLocation();

  // Close mobile sidebar on navigation
  useEffect(() => {
    if (isMobile) setIsMobileSidebarOpen(false);
  }, [location.pathname, isMobile]);

  // Reset badges when navigating to their respective pages
  useEffect(() => {
    if (location.pathname === '/inbox' || location.pathname.startsWith('/inbox/')) {
      setBadgeCounts((prev) => (prev.inbox === 0 ? prev : { ...prev, inbox: 0 }));
    }
    if (location.pathname === '/tasks' || location.pathname.startsWith('/tasks/')) {
      setBadgeCounts((prev) => (prev.tasks === 0 ? prev : { ...prev, tasks: 0 }));
    }
  }, [location.pathname]);

  // Persist mode preference
  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.ADVANCED_MODE, String(isAdvancedMode));
  }, [isAdvancedMode]);

  // Filter nav groups based on mode
  const visibleGroups = isAdvancedMode
    ? navGroups
    : navGroups
        .filter((g) => !g.advancedOnly)
        .map((g) => {
          // In simple mode, show fewer settings items
          if (g.id === 'settings') {
            return { ...g, items: simpleSettingsItems };
          }
          return g;
        });

  // Initialize open groups based on current path
  const getInitialOpenGroups = () => {
    const openGroups: Record<string, boolean> = {};
    navGroups.forEach((group) => {
      const isActive = group.items.some(
        (item) => location.pathname === item.to || location.pathname.startsWith(item.to + '/')
      );
      openGroups[group.id] = isActive || group.defaultOpen || false;
    });
    return openGroups;
  };

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    // Restore from localStorage, fallback to initial
    try {
      const saved = localStorage.getItem('ownpilot_nav_groups');
      if (saved) return { ...getInitialOpenGroups(), ...JSON.parse(saved) };
    } catch {
      /* ignore */
    }
    return getInitialOpenGroups();
  });

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [groupId]: !prev[groupId] };
      try {
        localStorage.setItem('ownpilot_nav_groups', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const connectionStyle = CONNECTION_STYLES[wsStatus];

  return (
    <div className="flex flex-col h-screen bg-bg-primary dark:bg-dark-bg-primary">
      {/* Global Header Bar */}
      <header className="h-12 flex items-center px-4 gap-3 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary shrink-0 z-50">
        {isMobile && (
          <button
            onClick={() => setIsMobileSidebarOpen(true)}
            className="p-1 -ml-1 rounded-md text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <h1 className="font-semibold text-text-primary dark:text-dark-text-primary whitespace-nowrap text-sm">
          OwnPilot
        </h1>
        <div className="flex-1 flex justify-center">
          <PulseSlotGrid slots={pulseSlots} compact={isMobile} />
        </div>
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${connectionStyle.color} ${connectionStyle.pulse ? 'animate-pulse' : ''}`}
          title={connectionStyle.label}
        />
      </header>

      {/* Body: sidebar + content + stats */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Backdrop (mobile only, when sidebar open) */}
        {isMobile && isMobileSidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-30"
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Left Sidebar - Navigation */}
        <aside
          className={
            isMobile
              ? `fixed inset-y-0 left-0 z-40 w-64 bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col transform transition-transform duration-200 ease-out ${
                  isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
                }`
              : 'w-56 border-r border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary flex flex-col'
          }
        >
          {/* Mobile close button */}
          {isMobile && (
            <div className="p-3 border-b border-border dark:border-dark-border flex items-center justify-end">
              <button
                onClick={() => setIsMobileSidebarOpen(false)}
                className="p-1 rounded-md text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}

          {/* Navigation */}
          <nav className="flex-1 p-2 overflow-y-auto">
            {/* Main Items */}
            <div className="space-y-0.5 mb-3">
              {mainItems.map((item) => (
                <NavItemLink
                  key={item.to}
                  item={item}
                  badge={
                    item.to === '/inbox'
                      ? badgeCounts.inbox
                      : item.to === '/tasks'
                        ? badgeCounts.tasks
                        : undefined
                  }
                />
              ))}
            </div>

            {/* Divider */}
            <div className="border-t border-border dark:border-dark-border my-2" />

            {/* Grouped Items */}
            <div className="space-y-1">
              {visibleGroups.map((group) => (
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

          {/* Mode Toggle + Status */}
          <div className="p-2 border-t border-border dark:border-dark-border space-y-1">
            <ModeToggle
              isAdvanced={isAdvancedMode}
              onToggle={() => setIsAdvancedMode(!isAdvancedMode)}
            />
            {passwordConfigured && (
              <button
                onClick={() => logout()}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-text-muted dark:text-dark-text-muted hover:bg-error/10 hover:text-error transition-colors"
                title="Log out"
              >
                <LogOut className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1 text-left">Log Out</span>
              </button>
            )}
            <ConnectionIndicator status={wsStatus} />
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 flex flex-col overflow-y-auto">
          <SecurityBanner />
          <Outlet />
        </main>

        {/* Right Sidebar - Stats Panel (desktop only) */}
        {!isMobile && (
          <StatsPanel
            isCollapsed={isStatsPanelCollapsed}
            onToggle={() => setIsStatsPanelCollapsed(!isStatsPanelCollapsed)}
          />
        )}
      </div>

      {/* Realtime WS→UI wiring (invisible) */}
      <RealtimeBridge onBadgeUpdate={handleBadgeUpdate} />

      {/* Floating mini chat widget (desktop only, hidden on ChatPage) */}
      {!isMobile && <MiniChat />}

      {/* Floating mini terminal widget (desktop only, hidden on CodingAgentsPage) */}
      {!isMobile && <MiniTerminal />}

      {/* Debug Drawer (advanced mode only) */}
      {isAdvancedMode && <DebugDrawer />}
    </div>
  );
}
