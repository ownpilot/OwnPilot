import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useGateway, type ConnectionStatus } from '../hooks/useWebSocket';
import { useIsMobile } from '../hooks/useMediaQuery';
import {
  Menu,
  Settings,
} from './icons';
import { StatsPanel } from './StatsPanel';
import { RealtimeBridge, type BadgeCounts } from './RealtimeBridge';
import { SecurityBanner } from './SecurityBanner';
import { DebugDrawer } from './DebugDrawer';
import { MiniChat } from './MiniChat';
import { MiniTerminal } from './MiniTerminal';
import { Sidebar } from './Sidebar';
import { GlobalSearchOverlay } from './GlobalSearchOverlay';
import { PinnedItemsProvider } from '../hooks/usePinnedItems';
import { HeaderItemsProvider } from '../hooks/useHeaderItems';
import { navGroups } from '../constants/nav-items';
import { LayoutConfigProvider } from '../hooks/useLayoutConfig';
import { HeaderItemsBar } from './HeaderItemsBar';

const CustomizePage = lazy(() =>
  import('../pages/CustomizePage').then((m) => ({ default: m.CustomizePage }))
);

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
  // PulseSlotGrid removed from header — available as widget in zone config
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isCustomizePanelOpen, setIsCustomizePanelOpen] = useState(false);
  const [isSettingsDropdownOpen, setIsSettingsDropdownOpen] = useState(false);
  const settingsDropdownRef = useRef<HTMLDivElement>(null);
  const [badgeCounts, setBadgeCounts] = useState<BadgeCounts>({ inbox: 0, tasks: 0 });
  const handleBadgeUpdate = useCallback(
    (updater: (prev: BadgeCounts) => BadgeCounts) => setBadgeCounts(updater),
    []
  );
  const location = useLocation();
  const navigate = useNavigate();

  const handleCustomizeToggle = useCallback(() => {
    const willOpen = !isCustomizePanelOpen;
    setIsCustomizePanelOpen(willOpen);
    if (willOpen) {
      navigate('/');
    }
  }, [isCustomizePanelOpen, navigate]);

  const handleCloseCustomize = useCallback(() => {
    setIsCustomizePanelOpen(false);
  }, []);

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

  // Global Ctrl+K / Cmd+K to open search overlay
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close settings dropdown on click-outside or Escape
  useEffect(() => {
    if (!isSettingsDropdownOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (settingsDropdownRef.current && !settingsDropdownRef.current.contains(e.target as Node)) {
        setIsSettingsDropdownOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsSettingsDropdownOpen(false); };
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => { document.removeEventListener('mousedown', handleClick); window.removeEventListener('keydown', handleKey); };
  }, [isSettingsDropdownOpen]);

  const settingsGroup = navGroups.find((g) => g.id === 'settings');

  const connectionStyle = CONNECTION_STYLES[wsStatus];

  return (
    <PinnedItemsProvider>
      <HeaderItemsProvider>
        <LayoutConfigProvider>
        <div className="flex flex-col h-screen bg-bg-primary dark:bg-dark-bg-primary">
      {/* Global Header Bar — 5 zones: Brand | Left | Center | Right | Settings */}
      <header className="relative h-12 flex items-center px-4 border-b border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary shrink-0 z-50">
        {/* Zone 1: Brand (fixed) */}
        <div className="flex items-center gap-2 shrink-0">
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
        </div>

        {/* Zones 2-4: Configurable header zones (desktop only) */}
        {!isMobile && (
          <>
            <div className="w-px h-5 bg-border dark:bg-dark-border mx-3 shrink-0" />
            <HeaderItemsBar />
          </>
        )}

        {/* Spacer — pushes settings to far right */}
        <div className="flex-1" />

        {/* Zone 5: Settings dropdown + status (fixed) */}
        <div className="flex items-center gap-2 shrink-0 ml-3">
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${connectionStyle.color} ${connectionStyle.pulse ? 'animate-pulse' : ''}`}
            title={connectionStyle.label}
          />
          <div ref={settingsDropdownRef} className="relative">
            <button
              onClick={() => setIsSettingsDropdownOpen((prev) => !prev)}
              className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
                isSettingsDropdownOpen
                  ? 'bg-primary/15 text-primary'
                  : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
              }`}
              title="Settings"
              aria-label="Settings menu"
            >
              <Settings className="w-4 h-4" />
            </button>
            {isSettingsDropdownOpen && settingsGroup && (
              <div className="absolute top-full right-0 mt-1 min-w-[200px] max-h-[320px] overflow-y-auto py-1 rounded-lg border border-border dark:border-dark-border bg-bg-secondary dark:bg-dark-bg-secondary shadow-lg z-50">
                {settingsGroup.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname === item.to;
                  return (
                    <button
                      key={item.to}
                      onClick={() => { navigate(item.to); setIsSettingsDropdownOpen(false); }}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
                        isActive
                          ? 'bg-primary/10 text-primary'
                          : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Body: sidebar + content + stats */}
      <div className="relative z-0 flex flex-1 overflow-hidden min-h-0">
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
          onCustomizeToggle={handleCustomizeToggle}
          isCustomizeOpen={isCustomizePanelOpen}
          onCloseCustomize={handleCloseCustomize}
          wsStatus={wsStatus}
          badgeCounts={badgeCounts}
        />

        {/* Customize Panel (persistent — survives route changes) */}
        {isCustomizePanelOpen && (
          <Suspense fallback={null}>
            <CustomizePage />
          </Suspense>
        )}

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <SecurityBanner />
          <main className="flex-1 flex flex-col overflow-y-auto min-h-0">
            <Outlet />
          </main>
        </div>

        {/* Right Sidebar - Stats or Detail Panel (desktop only) */}
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

      {/* Global Search Overlay */}
      {isSearchOpen && <GlobalSearchOverlay onClose={() => setIsSearchOpen(false)} />}
        </div>
        </LayoutConfigProvider>
      </HeaderItemsProvider>
    </PinnedItemsProvider>
  );
}
