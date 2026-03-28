/**
 * SidebarFooter — connection status indicator + logout button.
 * Extracted from Layout.tsx — identical visual output.
 */
import { useAuth } from '../../hooks/useAuth';
import { LogOut } from '../icons';
import type { ConnectionStatus } from '../../hooks/useWebSocket';

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

interface SidebarFooterProps {
  wsStatus: ConnectionStatus;
}

export function SidebarFooter({ wsStatus }: SidebarFooterProps) {
  const { passwordConfigured, logout } = useAuth();
  return (
    <div className="p-2 border-t border-border dark:border-dark-border space-y-1" data-testid="sidebar-footer">
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
  );
}
