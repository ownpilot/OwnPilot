/**
 * PinnedNavLink — A sidebar navigation link with active state, icon, and optional badge.
 *
 * Extracted from Sidebar.tsx to reduce its size. Handles the special Chat
 * route (/) by resetting the conversation when clicked while already on it.
 */

import { useLocation, useNavigate, useSearchParams, NavLink } from 'react-router-dom';
import { useChatStore } from '../../hooks/useChatStore';
import { chatApi } from '../../api/endpoints/chat';
import { ignoreError } from '../../utils/ignore-error';
import type { NavItem } from '../../constants/nav-items';

interface PinnedNavLinkProps {
  item: NavItem;
  badge?: number;
  onCloseCustomize?: () => void;
  isCustomizeOpen?: boolean;
}

export function PinnedNavLink({
  item,
  badge,
  onCloseCustomize,
  isCustomizeOpen,
}: PinnedNavLinkProps) {
  const Icon = item.icon;
  const location = useLocation();
  const { clearMessages, provider, model, sessionId, messages } = useChatStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleClick = (e: React.MouseEvent) => {
    onCloseCustomize?.();
    // Chat item: if already on "/" start a new chat instead of no-op navigation
    if (item.to === '/' && location.pathname === '/') {
      e.preventDefault();
      clearMessages();
      navigate('/', { replace: true });
      // Reset backend context (best-effort)
      ignoreError(chatApi.resetContext(provider, model), 'sidebar:resetContext');
    }
  };

  // Chat link: de-highlight when a conversation is active
  const hasActiveConversation =
    item.to === '/' && (sessionId || searchParams.get('conversationId') || messages.length > 0);

  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={handleClick}
      className={({ isActive }) =>
        `flex items-center gap-2 px-3 py-2.5 md:py-1.5 rounded-md transition-all text-base ${
          isActive && !isCustomizeOpen && !hasActiveConversation
            ? 'bg-primary/10 text-primary border-l-[3px] border-primary'
            : 'text-text-secondary dark:text-dark-text-secondary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary hover:translate-x-0.5'
        }`
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
