import { useState, useEffect, useCallback } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useGateway, type ConnectionStatus } from '../hooks/useWebSocket';
import { useIsMobile } from '../hooks/useMediaQuery';
import {
  Menu,
} from './icons';
import { StatsPanel } from './StatsPanel';
import { RealtimeBridge, type BadgeCounts } from './RealtimeBridge';
import { SecurityBanner } from './SecurityBanner';
import { usePulseSlots, PulseSlotGrid } from './PulseSlots';
import { DebugDrawer } from './DebugDrawer';
import { MiniChat } from './MiniChat';
import { MiniTerminal } from './MiniTerminal';
import { MiniPomodoro } from './MiniPomodoro';
import { Sidebar } from './Sidebar';
import { PinnedItemsProvider } from '../hooks/usePinnedItems';

const CONNECTION_STYLES: Record<
  ConnectionStatus,
  { color: string; pulse: boolean; label: string }
> = {
  connected: { color: 'bg-success', pulse: false, label: 'Connected' },
  connecting: { color: 'bg-warning', pulse: true, label: 'Connecting...' },
  disconnected: { color: 'bg-error', pulse: false, label: 'Disconnected' },
  error: { color: 'bg-error', pulse: false, label: 'Connection Error' },
};

export function Layout() {
  const { status: wsStatus } = useGateway();
  const isMobile = useIsMobile();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isStatsPanelCollapsed, setIsStatsPanelCollapsed] = useState(true);
  const { slots: pulseSlots } = usePulseSlots();
  const [_isSearchOpen, setIsSearchOpen] = useState(false);
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

  const connectionStyle = CONNECTION_STYLES[wsStatus];

  return (
    <PinnedItemsProvider>
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
        <MiniPomodoro />
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

        <Sidebar
          isMobile={isMobile}
          isOpen={isMobileSidebarOpen}
          onClose={() => setIsMobileSidebarOpen(false)}
          onSearchOpen={() => setIsSearchOpen(true)}
          wsStatus={wsStatus}
          badgeCounts={badgeCounts}
        />

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <SecurityBanner />
          <main className="flex-1 flex flex-col overflow-y-auto min-h-0">
            <Outlet />
          </main>
        </div>

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

      {/* Debug Drawer */}
      <DebugDrawer />
    </div>
    </PinnedItemsProvider>
  );
}
