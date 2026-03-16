/**
 * Channels Management Page
 *
 * Displays all channel plugins, their live connection status,
 * message stats, users, and provides connect/disconnect/reconnect actions.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { channelsApi } from '../api/endpoints/misc';
import { useGateway } from '../hooks/useWebSocket';
import { useToast } from '../components/ToastProvider';
import { useDialog } from '../components/ConfirmDialog';
import { ChannelSetupModal } from '../components/ChannelSetupModal';
import { PageHomeTab } from '../components/PageHomeTab';
import { Plus, Activity, Send, Home, MessageSquare, Globe, Inbox, Bot } from '../components/icons';
import type { Channel, ChannelUser, ChannelStats } from '../api/types';
import { ChannelDetail, PairingBanner } from './channels-detail';
import { timeAgo, getStatusColor, getStatusBg, StatusIcon, PlatformIcon } from './channels-helpers';

// Re-export for backward compatibility
export { timeAgo, getStatusColor, getStatusBg, StatusIcon, PlatformIcon };

// ============================================================================
// Tab system
// ============================================================================

type TabId = 'home' | 'channels';

const TAB_LABELS: Record<TabId, string> = {
  home: 'Home',
  channels: 'Channels',
};

// ============================================================================
// Main Component
// ============================================================================

export function ChannelsPage() {
  const toast = useToast();
  const { confirm } = useDialog();
  const { subscribe } = useGateway();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const activeTab = (searchParams.get('tab') as TabId) || 'home';
  const setTab = (tab: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    navigate({ search: params.toString() }, { replace: true });
  };

  const [channels, setChannels] = useState<Channel[]>([]);
  const [summary, setSummary] = useState<{
    total: number;
    connected: number;
    disconnected: number;
  }>({
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

  const handleLogout = useCallback(
    async (channelId: string) => {
      if (
        !(await confirm({
          message:
            'Logout will clear session data. You will need to re-authenticate (e.g. scan QR code) on next connect. Continue?',
          variant: 'danger',
        }))
      )
        return;
      setActionLoading('logout');
      try {
        await channelsApi.logout(channelId);
        toast.success('Channel logged out (session cleared)');
        await loadChannels();
      } catch {
        toast.error('Failed to logout channel');
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

  const handleSendTest = useCallback(async (channelId: string, text: string, chatId?: string) => {
    await channelsApi.send(channelId, { text, ...(chatId ? { chatId } : {}) });
  }, []);

  const handleClearMessages = useCallback(
    async (channelId: string) => {
      if (
        !(await confirm({
          message: 'Clear all messages for this channel? This cannot be undone.',
          variant: 'danger',
        }))
      )
        return;
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
      if (
        !(await confirm({
          message: 'Block this user? They will no longer be able to message the bot.',
          variant: 'danger',
        }))
      )
        return;
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
      if (
        !(await confirm({ message: 'Delete this user? This cannot be undone.', variant: 'danger' }))
      )
        return;
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

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Channels
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
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
      </header>

      {/* Status summary bar */}
      <div className="flex items-center gap-4 px-6 py-2">
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

      {/* Tab Bar */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'channels'] as TabId[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setTab(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {tab === 'home' && <Home className="w-3.5 h-3.5" />}
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Home Tab */}
      {activeTab === 'home' && (
        <div className="flex-1 overflow-y-auto">
          <PageHomeTab
            heroIcons={[
              { icon: MessageSquare, color: 'text-primary bg-primary/10' },
              { icon: Send, color: 'text-emerald-500 bg-emerald-500/10' },
              { icon: Globe, color: 'text-violet-500 bg-violet-500/10' },
            ]}
            title="Chat from Any Platform"
            subtitle="Connect messaging platforms to your AI — Telegram, WhatsApp, and more. Messages flow through the same intelligent pipeline."
            cta={{
              label: 'View Channels',
              icon: MessageSquare,
              onClick: () => setTab('channels'),
            }}
            features={[
              {
                icon: Globe,
                color: 'text-blue-500 bg-blue-500/10',
                title: 'Multi-Platform',
                description:
                  'Connect Telegram, WhatsApp, and other messaging platforms from a single dashboard.',
              },
              {
                icon: Inbox,
                color: 'text-emerald-500 bg-emerald-500/10',
                title: 'Unified Inbox',
                description:
                  'All messages from every platform land in one inbox. Never miss a conversation.',
              },
              {
                icon: Bot,
                color: 'text-violet-500 bg-violet-500/10',
                title: 'Bot Integration',
                description:
                  'Your AI responds automatically through each platform using configured bot tokens.',
              },
              {
                icon: Activity,
                color: 'text-amber-500 bg-amber-500/10',
                title: 'Message Pipeline',
                description:
                  'Messages pass through middleware, context injection, and agent execution in a unified pipeline.',
              },
            ]}
            steps={[
              {
                title: 'Choose a platform',
                detail: 'Select Telegram, WhatsApp, or another supported messaging platform.',
              },
              {
                title: 'Configure bot tokens',
                detail: 'Enter your bot token or scan a QR code to authenticate with the platform.',
              },
              {
                title: 'Connect & test',
                detail: 'Activate the channel and send a test message to verify everything works.',
              },
              {
                title: 'Messages flow to your AI',
                detail:
                  'Incoming messages are processed by your AI and responses are sent back automatically.',
              },
            ]}
            quickActions={[
              {
                icon: MessageSquare,
                label: 'Manage Channels',
                description: 'View and configure your messaging channels',
                onClick: () => setTab('channels'),
              },
            ]}
          />
        </div>
      )}

      {/* Channels Tab */}
      {activeTab === 'channels' && (
        <>
          {/* Pairing banner */}
          <PairingBanner />

          {/* Loading skeleton */}
          {isLoading ? (
            <div className="p-6 space-y-4">
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
          ) : (
            /* Main content */
            <div className="flex-1 flex overflow-hidden">
              {/* Sidebar — channel list */}
              <div className="w-72 border-r border-border dark:border-dark-border overflow-y-auto">
                {channels.length === 0 ? (
                  <div className="p-6 text-center">
                    <Send className="w-8 h-8 mx-auto text-text-muted dark:text-dark-text-muted mb-2" />
                    <p className="text-sm text-text-muted dark:text-dark-text-muted">
                      No channels yet
                    </p>
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
                            <div
                              className={`w-1.5 h-1.5 rounded-full ${getStatusColor(ch.status).replace('text-', 'bg-')}`}
                            />
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
                    onLogout={handleLogout}
                    onReconnect={handleReconnect}
                    onClearMessages={handleClearMessages}
                    onSendTest={handleSendTest}
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
          )}
        </>
      )}

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
