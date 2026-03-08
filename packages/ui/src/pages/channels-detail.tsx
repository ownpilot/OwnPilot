/**
 * Channel Detail Panel & Shared Components
 *
 * Extracted from ChannelsPage.tsx:
 * - ChannelDetail: detailed view of a single channel
 * - StatCard, ActionButton: shared presentational components
 * - PairingBanner: channel pairing/claiming UI
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { channelsApi } from '../api/endpoints/misc';
import { useToast } from '../components/ToastProvider';
import { useDialog } from '../components/ConfirmDialog';
import {
  Power,
  AlertTriangle,
  Users,
  MessageSquare,
  Activity,
  CheckCircle2,
  Clock,
  Send,
  Shield,
  ShieldCheck,
  ShieldAlert,
  Unlock,
  Trash2,
  LogOut,
  Key,
  Copy,
  RefreshCw,
} from '../components/icons';
import type { Channel, ChannelUser, ChannelStats } from '../api/types';
import { timeAgo, getStatusColor, getStatusBg, StatusIcon, PlatformIcon } from './ChannelsPage';

// ============================================================================
// Channel Detail Panel
// ============================================================================

export function ChannelDetail({
  channel,
  users,
  stats,
  isLoading,
  actionLoading,
  onConnect,
  onDisconnect,
  onLogout,
  onReconnect,
  onClearMessages,
  onSendTest,
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
  onLogout: (id: string) => void;
  onReconnect: (id: string) => void;
  onClearMessages: (id: string) => void;
  onSendTest: (id: string, text: string, chatId?: string) => Promise<void>;
  onApproveUser: (userId: string) => void;
  onBlockUser: (userId: string) => void;
  onUnblockUser: (userId: string) => void;
  onDeleteUser: (userId: string) => void;
}) {
  const toast = useToast();
  const [showTestForm, setShowTestForm] = useState(false);
  const [testText, setTestText] = useState('Hello! This is a test message from OwnPilot.');
  const [testChatId, setTestChatId] = useState('');
  const [isSending, setIsSending] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // For WhatsApp, chatId is own phone (self-chat) — auto-filled from botInfo if available
  const isWhatsApp = channel.type === 'whatsapp';
  const autoChat = channel.botInfo?.username ?? '';
  // Hide chat ID input for WhatsApp when we already know the own number
  const chatIdAutoResolved = isWhatsApp && !!autoChat;

  const handleSend = async () => {
    const text = testText.trim();
    if (!text) return;
    const chatId = chatIdAutoResolved ? autoChat : testChatId.trim() || undefined;
    if (!chatIdAutoResolved && !chatId) {
      toast.error('Enter a Chat ID to send the test message');
      return;
    }
    setIsSending(true);
    try {
      await onSendTest(channel.id, text, chatId);
      toast.success('Test message sent');
      setShowTestForm(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send test message');
    } finally {
      setIsSending(false);
    }
  };
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
              {channel.status === 'connected'
                ? 'Connected'
                : channel.status === 'connecting'
                  ? 'Connecting...'
                  : channel.status === 'error'
                    ? 'Error'
                    : 'Disconnected'}
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
                  <tr
                    key={user.id}
                    className="hover:bg-bg-tertiary/50 dark:hover:bg-dark-bg-tertiary/50"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold">
                          {(user.displayName ?? user.platformUsername ?? user.platformUserId)
                            .charAt(0)
                            .toUpperCase()}
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
                icon={Send}
                label="Send Test"
                variant="success"
                loading={false}
                onClick={() => {
                  setShowTestForm((v) => !v);
                  setTimeout(() => textRef.current?.focus(), 50);
                }}
              />
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
          {/* Logout is always available — clears session so next connect requires re-auth */}
          <ActionButton
            icon={LogOut}
            label="Logout"
            variant="danger"
            loading={actionLoading === 'logout'}
            onClick={() => onLogout(channel.id)}
          />
          <ActionButton
            icon={Trash2}
            label="Clear Messages"
            variant="danger"
            loading={actionLoading === 'clear'}
            onClick={() => onClearMessages(channel.id)}
          />
        </div>

        {/* Inline test message form */}
        {showTestForm && channel.status === 'connected' && (
          <div className="mt-3 p-3 border border-border dark:border-dark-border rounded-lg space-y-2 bg-bg-secondary dark:bg-dark-bg-secondary">
            <p className="text-xs font-medium text-text-primary dark:text-dark-text-primary">
              Send Test Message
            </p>
            {/* Chat ID — hidden for WhatsApp when own number is known, visible for others */}
            {!chatIdAutoResolved ? (
              <div className="space-y-1">
                <label className="text-[10px] text-text-muted dark:text-dark-text-muted uppercase tracking-wide">
                  Chat ID
                </label>
                <input
                  type="text"
                  value={testChatId}
                  onChange={(e) => setTestChatId(e.target.value)}
                  placeholder="e.g. 123456789"
                  className="w-full px-2.5 py-1.5 text-xs rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary"
                />
              </div>
            ) : (
              <p className="text-[10px] text-text-muted dark:text-dark-text-muted">
                Sending to self-chat · {autoChat}
              </p>
            )}
            <div className="space-y-1">
              <label className="text-[10px] text-text-muted dark:text-dark-text-muted uppercase tracking-wide">
                Message
              </label>
              <textarea
                ref={textRef}
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                rows={2}
                className="w-full px-2.5 py-1.5 text-xs rounded border border-border dark:border-dark-border bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary resize-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSend();
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSend}
                disabled={isSending || !testText.trim()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-primary text-white rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                {isSending ? (
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="w-3 h-3" />
                )}
                {isSending ? 'Sending...' : 'Send'}
              </button>
              <button
                onClick={() => setShowTestForm(false)}
                className="text-xs text-text-muted dark:text-dark-text-muted hover:text-text-primary dark:hover:text-dark-text-primary transition-colors"
              >
                Cancel
              </button>
              <span className="text-[10px] text-text-muted dark:text-dark-text-muted ml-auto">
                Ctrl+Enter to send
              </span>
            </div>
          </div>
        )}
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

// ============================================================================
// Pairing Banner
// ============================================================================

interface PairingChannel {
  pluginId: string;
  platform: string;
  name: string;
  key: string;
  claimed: boolean;
  ownerUserId: string | null;
}

export function PairingBanner() {
  const [channels, setChannels] = useState<PairingChannel[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const toast = useToast();
  const dialog = useDialog();

  const load = useCallback(() => {
    channelsApi
      .getPairing()
      .then((data) => setChannels(data.channels))
      .catch(() => {
        /* silently ignore */
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (channels.length === 0) return null;

  const handleCopy = async (pluginId: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(pluginId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  const handleRevoke = async (ch: PairingChannel) => {
    const confirmed = await dialog.confirm({
      title: 'Revoke Ownership',
      message: `Remove the owner from "${ch.name}"? A new pairing key will be generated and you'll need to /connect again to reclaim ownership.`,
      confirmText: 'Revoke',
      cancelText: 'Cancel',
      variant: 'danger',
    });
    if (!confirmed) return;
    setRevokingId(ch.pluginId);
    try {
      await channelsApi.revokeOwner(ch.pluginId);
      toast.success(`Ownership revoked for ${ch.name}`);
      load();
    } catch {
      toast.error('Failed to revoke ownership');
    } finally {
      setRevokingId(null);
    }
  };

  const unclaimedChannels = channels.filter((ch) => !ch.claimed);
  const claimedChannels = channels.filter((ch) => ch.claimed);

  return (
    <div className="mx-6 mt-4 space-y-2">
      {/* Unclaimed channels — prominent warning */}
      {unclaimedChannels.map((ch) => (
        <div key={ch.pluginId} className="p-4 rounded-lg border border-warning/40 bg-warning/5">
          <div className="flex items-start gap-3">
            <Key className="w-5 h-5 text-warning mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary dark:text-dark-text-primary">
                Claim ownership — {ch.name}
              </p>
              <p className="text-xs text-text-secondary dark:text-dark-text-secondary mt-0.5">
                Send this command on <span className="capitalize">{ch.platform}</span> to become the
                owner of this channel.
              </p>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-md border border-border dark:border-dark-border font-mono text-sm">
                  <span className="text-text-muted dark:text-dark-text-muted text-xs">
                    /connect
                  </span>
                  <span className="font-bold text-text-primary dark:text-dark-text-primary tracking-widest">
                    {ch.key}
                  </span>
                </div>
                <button
                  onClick={() => handleCopy(ch.pluginId, `/connect ${ch.key}`)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border dark:border-dark-border rounded-md hover:bg-bg-tertiary dark:hover:bg-dark-bg-tertiary transition-colors text-text-primary dark:text-dark-text-primary"
                >
                  {copiedId === ch.pluginId ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-success" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy
                    </>
                  )}
                </button>
              </div>
              <p className="text-[11px] text-text-muted dark:text-dark-text-muted mt-1.5">
                Key rotates after each successful claim.
              </p>
            </div>
          </div>
        </div>
      ))}

      {/* Claimed channels — compact row with revoke option */}
      {claimedChannels.map((ch) => (
        <div
          key={ch.pluginId}
          className="p-3 rounded-lg border border-success/30 bg-success/5 flex items-center gap-3"
        >
          <ShieldCheck className="w-4 h-4 text-success shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-success">{ch.name} — owner claimed</p>
            <p className="text-[11px] text-text-muted dark:text-dark-text-muted">
              {ch.platform} · ID {ch.ownerUserId}
            </p>
          </div>
          <button
            onClick={() => handleRevoke(ch)}
            disabled={revokingId === ch.pluginId}
            title="Revoke ownership"
            className="flex items-center gap-1 text-[11px] text-text-muted dark:text-dark-text-muted hover:text-error transition-colors disabled:opacity-50"
          >
            <Unlock className="w-3.5 h-3.5" />
            {revokingId === ch.pluginId ? 'Revoking…' : 'Revoke'}
          </button>
        </div>
      ))}
    </div>
  );
}
