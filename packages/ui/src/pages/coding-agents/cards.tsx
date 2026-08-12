/**
 * Presentational cards for the CodingAgents page.
 *
 * SessionCard / StateBadge / ProviderStatusCard / ResultCard were defined
 * inline in CodingAgentsPage.tsx. They hold no state and read no context —
 * pure props in, markup out.
 */

import type {
  CodingAgentSession,
  CodingAgentSessionState,
  CodingAgentStatus,
  CodingAgentResultRecord,
} from '../../api/endpoints/coding-agents';
import { CheckCircle2, XCircle, Clock, Key, Trash2 } from '../../components/icons';
import {
  STATE_COLORS,
  STATE_LABELS,
  PROVIDER_META,
  PROVIDER_COLORS,
} from '../CodingAgentsPage.constants';
import { formatDuration, formatRelativeTime } from './helpers';

export function SessionCard({
  session,
  active,
  onClick,
  onTerminate,
}: {
  session: CodingAgentSession;
  active: boolean;
  onClick: () => void;
  onTerminate: () => void;
}) {
  const color = PROVIDER_COLORS[session.provider] ?? 'bg-gray-500/20 text-gray-500';
  const icon = PROVIDER_META[session.provider]?.icon ?? '?';
  const isActive =
    session.state === 'running' || session.state === 'starting' || session.state === 'waiting';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
      className={`w-full text-left p-2.5 rounded-lg transition-colors group cursor-pointer ${
        active
          ? 'bg-primary/10 border border-primary/30'
          : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <div
          className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${color}`}
        >
          {icon}
        </div>
        <StateBadge state={session.state} />
        {session.acp?.enabled && (
          <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-violet-500/15 text-violet-400">
            ACP
          </span>
        )}
        {isActive && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTerminate();
            }}
            className="ml-auto p-0.5 rounded opacity-0 group-hover:opacity-100 text-text-muted hover:text-error transition-all"
            title="Terminate"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        )}
      </div>
      <p className="text-xs text-text-primary dark:text-dark-text-primary truncate">
        {session.prompt.length > 60 ? session.prompt.slice(0, 60) + '...' : session.prompt}
      </p>
      <div className="flex items-center gap-1 mt-1 text-[10px] text-text-muted dark:text-dark-text-muted">
        <Clock className="w-2.5 h-2.5" />
        <span>{formatRelativeTime(session.startedAt)}</span>
      </div>
    </div>
  );
}

export function StateBadge({ state }: { state: CodingAgentSessionState }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] text-text-muted dark:text-dark-text-muted">
      <span
        className={`w-1.5 h-1.5 rounded-full ${STATE_COLORS[state]} ${state === 'running' ? 'animate-pulse' : ''}`}
      />
      {STATE_LABELS[state]}
    </span>
  );
}

export function ProviderStatusCard({ status }: { status: CodingAgentStatus }) {
  const meta = PROVIDER_META[status.provider];
  const color = PROVIDER_COLORS[status.provider] ?? 'bg-gray-500/20';

  return (
    <div className="flex items-center gap-2 p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
      <div
        className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${color}`}
      >
        {meta?.icon ?? '?'}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-text-primary dark:text-dark-text-primary truncate">
          {status.displayName}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {status.installed ? (
            <CheckCircle2 className="w-2.5 h-2.5 text-success" />
          ) : (
            <XCircle className="w-2.5 h-2.5 text-error" />
          )}
          <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
            {status.installed ? (status.version ?? 'Installed') : 'Not installed'}
          </span>
          {status.configured && <Key className="w-2.5 h-2.5 text-success ml-1" />}
        </div>
      </div>
    </div>
  );
}

export function ResultCard({ result }: { result: CodingAgentResultRecord }) {
  const providerLabel = result.provider.startsWith('custom:')
    ? result.provider.slice(7)
    : result.provider;

  return (
    <div className="p-2 rounded-lg bg-bg-tertiary dark:bg-dark-bg-tertiary">
      <div className="flex items-center gap-1.5 mb-0.5">
        {result.success ? (
          <CheckCircle2 className="w-2.5 h-2.5 text-success shrink-0" />
        ) : (
          <XCircle className="w-2.5 h-2.5 text-error shrink-0" />
        )}
        <span className="text-[10px] font-medium text-text-primary dark:text-dark-text-primary truncate">
          {providerLabel}
        </span>
        <span className="text-[10px] text-text-muted dark:text-dark-text-muted ml-auto shrink-0">
          {formatDuration(result.durationMs)}
        </span>
      </div>
      <p className="text-[10px] text-text-muted dark:text-dark-text-muted truncate">
        {result.prompt.length > 50 ? result.prompt.slice(0, 50) + '...' : result.prompt}
      </p>
      <div className="text-[9px] text-text-muted dark:text-dark-text-muted mt-0.5">
        {formatRelativeTime(result.createdAt)}
      </div>
    </div>
  );
}
