/**
 * Channels Management Page
 *
 * Displays all channel plugins, their live connection status,
 * message stats, users, and provides connect/disconnect/reconnect actions.
 */

import { useState, useEffect, useCallback } from 'react';
import { channelsApi } from '../api/endpoints/misc';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from '../components/ToastProvider';
import { ChannelSetupModal } from '../components/ChannelSetupModal';
import {
  Plus,
  RefreshCw,
  Power,
  AlertTriangle,
  Users,
  MessageSquare,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Send,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Unlock,
  Trash2,
} from '../components/icons';
import type { Channel, ChannelUser, ChannelStats } from '../api/types';

// ============================================================================
// Helper: format relative time
// ============================================================================

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ============================================================================
// Status helpers
// ============================================================================

function getStatusColor(status: Channel['status']) {
  switch (status) {
    case 'connected':
      return 'text-success';
    case 'connecting':
      return 'text-warning';
    case 'error':
      return 'text-error';
    default:
      return 'text-text-muted dark:text-dark-text-muted';
  }
}

function getStatusBg(status: Channel['status']) {
  switch (status) {
    case 'connected':
      return 'bg-success/20';
    case 'connecting':
      return 'bg-warning/20';
    case 'error':
      return 'bg-error/20';
    default:
      return 'bg-text-muted/20';
  }
}

function StatusIcon({ status }: { status: Channel['status'] }) {
  switch (status) {
    case 'connected':
      return <CheckCircle2 className="w-4 h-4 text-success" />;
    case 'connecting':
      return <Clock className="w-4 h-4 text-warning animate-pulse" />;
    case 'error':
      return <XCircle className="w-4 h-4 text-error" />;
    default:
      return <Power className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />;
  }
}

function PlatformIcon({ type }: { type: string }) {
  // Telegram SVG icon
  if (type === 'telegram') {
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    );
  }
  // WhatsApp SVG icon
  if (type === 'whatsapp') {
    return (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    );
  }
  // Generic icon for others
  return <Send className="w-5 h-5" />;
}

// ============================================================================
// Main Component
// ============================================================================

export function ChannelsPage() {
  const toast = useToast();
  const { subscribe } = useGateway();

  const [channels, setChannels] = useState<Channel[]>([]);
  const [summary, setSummary] = useState<{ total: number; connected: number; disconnected: number }>({
    total: 0,
    connected: 0,
    disconnected: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  // Detail panel state
  const [users, setUsers] = useState<ChannelUser[]>([]);
  const [stats, setStats] = useState<ChannelStats | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const selectedChannel = channels.find((ch) => ch.id === selectedId) ?? null;

  // ---- Load channels ----
  const loadChannels = useCallback(async () => {
    try {
      const resp = await channelsApi.list();
      setChannels(resp.channels);
      setSummary(resp.summary);

      // Auto-select first if nothing selected
      if (!selectedId && resp.channels.length > 0) {
        setSelectedId(resp.channels[0]!.id);
      }
    } catch {
      toast.error('Failed to load channels');
    } finally {
      setIsLoading(false);
    }
  }, [selectedId, toast]);

  useEffect(() => {
    loadChannels();
  }, [loadChannels]);

  // ---- Load detail when selection changes ----
  const loadDetail = useCallback(
    async (channelId: string) => {
      setDetailLoading(true);
      try {
        const [usersResp, statsResp] = await Promise.all([
          channelsApi.getUsers(channelId),
          channelsApi.getStats(channelId),
        ]);
        setUsers(usersResp.users);
        setStats(statsResp);
      } catch {
        toast.error('Failed to load channel details');
      } finally {
        setDetailLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    if (selectedId) {
      loadDetail(selectedId);
    }
  }, [selectedId, loadDetail]);

  // ---- Real-time updates ----
  useEffect(() => {
    const unsub1 = subscribe<{ entity: string; action: string; id?: string }>(
      'data:changed',
      (data) => {
        if (data.entity === 'channel') {
          loadChannels();
          if (selectedId) loadDetail(selectedId);
        }
      }
    );
    const unsub2 = subscribe<{ channelId: string }>('channel:message', () => {
      // Refresh stats on new message
      if (selectedId) loadDetail(selectedId);
    });
    const unsub3 = subscribe<{ channelId: string; status: string }>('channel:status', (data) => {
      setChannels((prev) =>
        prev.map((ch) =>
          ch.id === data.channelId ? { ...ch, status: data.status as Channel['status'] } : ch
        )
      );
    });
    const unsub4 = subscribe<{ displayName?: string }>('channel:user:pending', (data) => {
      toast.info(`New user pending approval: ${data.displayName ?? 'Unknown'}`);
      if (selectedId) loadDetail(selectedId);
    });

    return () => {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
    };
  }, [subscribe, selectedId, loadChannels, loadDetail, toast]);

  // ---- Actions ----
  const handleConnect = useCallback(
    async (channelId: string) => {
      setActionLoading('connect');
      try {
        await channelsApi.connect(channelId);
        toast.success('Channel connected');
        await loadChannels();
      } catch {
        toast.error('Failed to connect channel');
      } finally {
        setActionLoading(null);
      }
    },
    [toast, loadChannels]
  );

  const handleDisconnect = useCallback(
    async (channelId: string) => {
      setActionLoading('disconnect');
      try {
        await channelsApi.disconnect(channelId);
        toast.success('Channel disconnected');
        await loadChannels();
      } catch {
        toast.error('Failed to disconnect channel');
      } finally {
        setActionLoading(null);
      }
    },
    [toast, loadChannels]
  );

  const handleReconnect = useCallback(
    async (channelId: string) => {
      setActionLoading('reconnect');
      try {
        await channelsApi.reconnect(channelId);
        toast.success('Channel reconnected');
        await loadChannels();
      } catch {
        toast.error('Failed to reconnect channel');
      } finally {
        setActionLoading(null);
      }
    },
    [toast, loadChannels]
  );

  const handleClearMessages = useCallback(
    async (channelId: string) => {
      if (!confirm('Clear all messages for this channel? This cannot be undone.')) return;
      setActionLoading('clear');
      try {
        const resp = await channelsApi.clearMessages(channelId);
        toast.success(`Cleared ${resp.deleted} messages`);
        if (selectedId === channelId) loadDetail(channelId);
      } catch {
        toast.error('Failed to clear messages');
      } finally {
        setActionLoading(null);
      }
    },
    [toast, selectedId, loadDetail]
  );

  // ---- User actions ----
  const handleApproveUser = useCallback(
    async (userId: string) => {
      try {
        await channelsApi.approveUser(userId);
        toast.success('User approved');
        if (selectedId) loadDetail(selectedId);
      } catch {
        toast.error('Failed to approve user');
      }
    },
    [toast, selectedId, loadDetail]
  );

  const handleBlockUser = useCallback(
    async (userId: string) => {
      if (!confirm('Block this user? They will no longer be able to message the bot.')) return;
      try {
        await channelsApi.blockUser(userId);
        toast.success('User blocked');
        if (selectedId) loadDetail(selectedId);
      } catch {
        toast.error('Failed to block user');
      }
    },
    [toast, selectedId, loadDetail]
  );

  const handleUnblockUser = useCallback(
    async (userId: string) => {
      try {
        await channelsApi.unblockUser(userId);
        toast.success('User unblocked');
        if (selectedId) loadDetail(selectedId);
      } catch {
        toast.error('Failed to unblock user');
      }
    },
    [toast, selectedId, loadDetail]
  );

  const handleDeleteUser = useCallback(
    async (userId: string) => {
      if (!confirm('Delete this user? This cannot be undone.')) return;
      try {
        await channelsApi.deleteUser(userId);
        toast.success('User deleted');
        if (selectedId) loadDetail(selectedId);
      } catch {
        toast.error('Failed to delete user');
      }
    },
    [toast, selectedId, loadDetail]
  );

  // ---- Loading skeleton ----
  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded animate-pulse" />
        <div className="flex gap-4">
          <div className="w-72 space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg animate-pulse"
              />
            ))}
          </div>
          <div className="flex-1 h-96 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border dark:border-dark-border">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Channels
            </h1>
            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-0.5">
              Manage messaging channels and monitor their status
            </p>
          </div>
          <button
            onClick={() => setShowSetup(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Channel
          </button>
        </div>

        {/* Status summary bar */}
        <div className="flex items-center gap-4 mt-3">
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-2 h-2 rounded-full bg-success" />
            <span className="text-text-secondary dark:text-dark-text-secondary">
              {summary.connected} Connected
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <div className="w-2 h-2 rounded-full bg-text-muted" />
            <span className="text-text-secondary dark:text-dark-text-secondary">
              {summary.disconnected} Disconnected
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-text-muted dark:text-dark-text-muted">
            <Activity className="w-3 h-3" />
            {summary.total} Total
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar — channel list */}
        <div className="w-72 border-r border-border dark:border-dark-border overflow-y-auto">
          {channels.length === 0 ? (
            <div className="p-6 text-center">
              <Send className="w-8 h-8 mx-auto text-text-muted dark:text-dark-text-muted mb-2" />
              <p className="text-sm text-text-muted dark:text-dark-text-muted">No channels yet</p>
              <button
                onClick={() => setShowSetup(true)}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Set up your first channel
              </button>
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {channels.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => setSelectedId(ch.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                    selectedId === ch.id
                      ? 'bg-primary/10 border border-primary/30'
                      : 'hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary border border-transparent'
                  }`}
                >
                  <div
                    className={`shrink-0 w-9 h-9 rounded-lg flex items-center justify-center ${
                      ch.status === 'connected'
                        ? 'bg-primary/10 text-primary'
                        : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted'
                    }`}
                  >
                    <PlatformIcon type={ch.type} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-text-primary dark:text-dark-text-primary truncate">
                        {ch.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className={`w-1.5 h-1.5 rounded-full ${getStatusColor(ch.status).replace('text-', 'bg-')}`} />
                      <span className="text-[10px] text-text-muted dark:text-dark-text-muted capitalize">
                        {ch.status}
                      </span>
                      {ch.botInfo?.username && (
                        <span className="text-[10px] text-text-muted dark:text-dark-text-muted">
                          @{ch.botInfo.username}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="flex-1 overflow-y-auto">
          {selectedChannel ? (
            <ChannelDetail
              channel={selectedChannel}
              users={users}
              stats={stats}
              isLoading={detailLoading}
              actionLoading={actionLoading}
              onConnect={handleConnect}
              onDisconnect={handleDisconnect}
              onReconnect={handleReconnect}
              onClearMessages={handleClearMessages}
              onApproveUser={handleApproveUser}
              onBlockUser={handleBlockUser}
              onUnblockUser={handleUnblockUser}
              onDeleteUser={handleDeleteUser}
            />
          ) : (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <Send className="w-10 h-10 mx-auto text-text-muted dark:text-dark-text-muted mb-3" />
                <p className="text-sm text-text-muted dark:text-dark-text-muted">
                  Select a channel to view details
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Setup modal */}
      {showSetup && (
        <ChannelSetupModal
          onClose={() => setShowSetup(false)}
          onSuccess={() => {
            setShowSetup(false);
            loadChannels();
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Channel Detail Panel
// ============================================================================

function ChannelDetail({
  channel,
  users,
  stats,
  isLoading,
  actionLoading,
  onConnect,
  onDisconnect,
  onReconnect,
  onClearMessages,
  onApproveUser,
  onBlockUser,
  onUnblockUser,
  onDeleteUser,
}: {
  channel: Channel;
  users: ChannelUser[];
  stats: ChannelStats | null;
  isLoading: boolean;
  actionLoading: string | null;
  onConnect: (id: string) => void;
  onDisconnect: (id: string) => void;
  onReconnect: (id: string) => void;
  onClearMessages: (id: string) => void;
  onApproveUser: (userId: string) => void;
  onBlockUser: (userId: string) => void;
  onUnblockUser: (userId: string) => void;
  onDeleteUser: (userId: string) => void;
}) {
  return (
    <div className="p-6 space-y-6">
      {/* Channel header */}
      <div className="flex items-start gap-4">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center ${
            channel.status === 'connected'
              ? 'bg-primary/10 text-primary'
              : 'bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-muted dark:text-dark-text-muted'
          }`}
        >
          <PlatformIcon type={channel.type} />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold text-text-primary dark:text-dark-text-primary">
            {channel.name}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            <StatusIcon status={channel.status} />
            <span className={`text-sm font-medium ${getStatusColor(channel.status)}`}>
              {channel.status === 'connected' ? 'Connected' : channel.status === 'connecting' ? 'Connecting...' : channel.status === 'error' ? 'Error' : 'Disconnected'}
            </span>
          </div>
          {channel.botInfo && (
            <p className="text-xs text-text-muted dark:text-dark-text-muted mt-1">
              Bot: @{channel.botInfo.username}
              {channel.botInfo.firstName && ` (${channel.botInfo.firstName})`}
            </p>
          )}
        </div>
        <span
          className={`px-2 py-1 text-[10px] font-bold uppercase rounded ${getStatusBg(channel.status)} ${getStatusColor(channel.status)}`}
        >
          {channel.type}
        </span>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Total Messages" value={stats.totalMessages} icon={MessageSquare} />
          <StatCard label="Today" value={stats.todayMessages} icon={Activity} />
          <StatCard label="This Week" value={stats.weekMessages} icon={Clock} />
        </div>
      )}

      {stats?.lastActivityAt && (
        <p className="text-xs text-text-muted dark:text-dark-text-muted">
          Last activity: {timeAgo(stats.lastActivityAt)}
        </p>
      )}

      {/* Users section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Users className="w-4 h-4 text-text-muted dark:text-dark-text-muted" />
          <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary">
            Users ({users.length})
          </h3>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-10 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded animate-pulse"
              />
            ))}
          </div>
        ) : users.length === 0 ? (
          <p className="text-xs text-text-muted dark:text-dark-text-muted italic py-3">
            No users have interacted with this channel yet.
          </p>
        ) : (
          <div className="border border-border dark:border-dark-border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-bg-tertiary dark:bg-dark-bg-tertiary">
                  <th className="text-left px-3 py-2 font-medium text-text-secondary dark:text-dark-text-secondary">
                    User
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-text-secondary dark:text-dark-text-secondary">
                    Status
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-text-secondary dark:text-dark-text-secondary">
                    Last Seen
                  </th>
                  <th className="text-left px-3 py-2 font-medium text-text-secondary dark:text-dark-text-secondary">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border dark:divide-dark-border">
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-bg-tertiary/50 dark:hover:bg-dark-bg-tertiary/50">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">
                          {(user.displayName ?? user.platformUsername ?? user.platformUserId).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <span className="font-medium text-text-primary dark:text-dark-text-primary">
                            {user.displayName ?? user.platformUsername ?? user.platformUserId}
                          </span>
                          {user.platformUsername && user.displayName && (
                            <span className="ml-1 text-text-muted dark:text-dark-text-muted">
                              @{user.platformUsername}
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {user.isBlocked ? (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-error/10 text-error rounded text-[10px] font-medium">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            Blocked
                          </span>
                        ) : user.isVerified ? (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-success/10 text-success rounded text-[10px] font-medium">
                            <Shield className="w-2.5 h-2.5" />
                            Verified
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 bg-warning/10 text-warning rounded text-[10px] font-medium">
                            Pending
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-text-muted dark:text-dark-text-muted">
                      {timeAgo(user.lastSeenAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {/* Pending: Approve + Block + Delete */}
                        {!user.isVerified && !user.isBlocked && (
                          <button
                            onClick={() => onApproveUser(user.id)}
                            title="Approve"
                            className="p-1 rounded hover:bg-success/10 text-success transition-colors"
                          >
                            <ShieldCheck className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {/* Verified: Block + Delete */}
                        {!user.isBlocked && (
                          <button
                            onClick={() => onBlockUser(user.id)}
                            title="Block"
                            className="p-1 rounded hover:bg-warning/10 text-warning transition-colors"
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {/* Blocked: Unblock */}
                        {user.isBlocked && (
                          <button
                            onClick={() => onUnblockUser(user.id)}
                            title="Unblock"
                            className="p-1 rounded hover:bg-primary/10 text-primary transition-colors"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {/* Always: Delete */}
                        <button
                          onClick={() => onDeleteUser(user.id)}
                          title="Delete"
                          className="p-1 rounded hover:bg-error/10 text-error transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="border-t border-border dark:border-dark-border pt-4">
        <h3 className="text-sm font-medium text-text-primary dark:text-dark-text-primary mb-3">
          Actions
        </h3>
        <div className="flex flex-wrap gap-2">
          {channel.status === 'connected' ? (
            <>
              <ActionButton
                icon={RefreshCw}
                label="Reconnect"
                loading={actionLoading === 'reconnect'}
                onClick={() => onReconnect(channel.id)}
              />
              <ActionButton
                icon={Power}
                label="Disconnect"
                variant="warning"
                loading={actionLoading === 'disconnect'}
                onClick={() => onDisconnect(channel.id)}
              />
            </>
          ) : (
            <ActionButton
              icon={Power}
              label="Connect"
              variant="success"
              loading={actionLoading === 'connect'}
              onClick={() => onConnect(channel.id)}
            />
          )}
          <ActionButton
            icon={Trash2}
            label="Clear Messages"
            variant="danger"
            loading={actionLoading === 'clear'}
            onClick={() => onClearMessages(channel.id)}
          />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Stat Card
// ============================================================================

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="px-4 py-3 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg">
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-3.5 h-3.5 text-text-muted dark:text-dark-text-muted" />
        <span className="text-[10px] text-text-muted dark:text-dark-text-muted uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
        {value.toLocaleString()}
      </p>
    </div>
  );
}

// ============================================================================
// Action Button
// ============================================================================

function ActionButton({
  icon: Icon,
  label,
  variant = 'default',
  loading = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  variant?: 'default' | 'success' | 'warning' | 'danger';
  loading?: boolean;
  onClick: () => void;
}) {
  const colors = {
    default:
      'border-border dark:border-dark-border text-text-primary dark:text-dark-text-primary hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary',
    success: 'border-success/30 text-success hover:bg-success/10',
    warning: 'border-warning/30 text-warning hover:bg-warning/10',
    danger: 'border-error/30 text-error hover:bg-error/10',
  };

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-md transition-colors disabled:opacity-50 ${colors[variant]}`}
    >
      {loading ? (
        <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        <Icon className="w-3.5 h-3.5" />
      )}
      {label}
    </button>
  );
}
