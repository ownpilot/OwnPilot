/**
 * Approvals Page — lists pending and past workflow approval gates.
 * Allows users to approve or reject pending approvals.
 */

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGateway } from '../hooks/useWebSocket';
import { workflowsApi } from '../api/endpoints/workflows';
import type { WorkflowApproval } from '../api/types';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  GitBranch,
  Shield,
  Check,
  Settings,
  History,
  Home,
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';
import { PageHomeTab } from '../components/PageHomeTab';

type TabId = 'home' | 'approvals';
type TabFilter = 'pending' | 'all';

const TAB_LABELS: Record<TabId, string> = { home: 'Home', approvals: 'Approvals' };

const statusStyles: Record<string, string> = {
  pending: 'bg-warning/10 text-warning',
  approved: 'bg-success/10 text-success',
  rejected: 'bg-error/10 text-error',
};

const statusIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  pending: Clock,
  approved: CheckCircle2,
  rejected: XCircle,
};

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ApprovalsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Skip home preference from localStorage
  const SKIP_HOME_KEY = 'ownpilot:approvals:skipHome';
  const [skipHome, setSkipHome] = useState(() => {
    try {
      return localStorage.getItem(SKIP_HOME_KEY) === 'true';
    } catch {
      return false;
    }
  });

  // Save skip home preference
  const handleSkipHomeChange = useCallback((checked: boolean) => {
    setSkipHome(checked);
    try {
      localStorage.setItem(SKIP_HOME_KEY, String(checked));
    } catch {
      // localStorage might be disabled
    }
  }, []);

  const activeTab = (searchParams.get('tab') as TabId) || 'home';
  const setActiveTab = (t: TabId) => setSearchParams(t === 'home' ? {} : { tab: t });

  // Auto-redirect to approvals if skipHome is enabled and no explicit tab param
  useEffect(() => {
    if (skipHome && !searchParams.get('tab')) {
      setSearchParams({ tab: 'approvals' });
    }
  }, [skipHome, searchParams, setSearchParams]);

  const { confirm } = useDialog();
  const toast = useToast();
  const { subscribe } = useGateway();
  const [approvals, setApprovals] = useState<WorkflowApproval[]>([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<TabFilter>('pending');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchApprovals = useCallback(async () => {
    try {
      const api = tab === 'pending' ? workflowsApi.pendingApprovals : workflowsApi.allApprovals;
      const data = await api({ limit: '50' });
      setApprovals(data.approvals);
      setTotal(data.total);
    } catch {
      toast.error('Failed to load approvals');
    } finally {
      setIsLoading(false);
    }
  }, [tab, toast]);

  useEffect(() => {
    let stale = false;
    setIsLoading(true);
    fetchApprovals().then(() => {
      if (stale) return; // Tab changed before fetch completed — discard
    });
    return () => {
      stale = true;
    };
  }, [fetchApprovals]);

  // Listen for real-time approval events
  useEffect(() => {
    const unsub1 = subscribe('approval:required', () => fetchApprovals());
    const unsub2 = subscribe('approval:decided', () => fetchApprovals());
    return () => {
      unsub1();
      unsub2();
    };
  }, [subscribe, fetchApprovals]);

  const handleApprove = useCallback(
    async (approval: WorkflowApproval) => {
      const ok = await confirm({
        title: 'Approve Workflow',
        message: `Approve and resume workflow execution? This will continue the paused workflow from the approval gate.`,
        confirmText: 'Approve',
        variant: 'default',
      });
      if (!ok) return;

      setActionInProgress(approval.id);
      try {
        await workflowsApi.approveApproval(approval.id);
        toast.success('Approved — workflow execution resumed');
        fetchApprovals();
      } catch {
        toast.error('Failed to approve');
      } finally {
        setActionInProgress(null);
      }
    },
    [confirm, toast, fetchApprovals]
  );

  const handleReject = useCallback(
    async (approval: WorkflowApproval) => {
      const ok = await confirm({
        title: 'Reject Workflow',
        message: `Reject this approval? The workflow execution will be marked as failed.`,
        confirmText: 'Reject',
        variant: 'danger',
      });
      if (!ok) return;

      setActionInProgress(approval.id);
      try {
        await workflowsApi.rejectApproval(approval.id);
        toast.success('Rejected — workflow marked as failed');
        fetchApprovals();
      } catch {
        toast.error('Failed to reject');
      } finally {
        setActionInProgress(null);
      }
    },
    [confirm, toast, fetchApprovals]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-border dark:border-dark-border">
        <div>
          <h2 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Workflow Approvals
          </h2>
          <p className="text-sm text-text-muted dark:text-dark-text-muted">
            Review and approve paused workflow executions
          </p>
        </div>
        <span className="text-xs text-text-muted dark:text-dark-text-muted">
          {total} {tab === 'pending' ? 'pending' : 'total'}
        </span>
      </header>

      {/* URL-based tabs */}
      <div className="flex border-b border-border dark:border-dark-border px-6">
        {(['home', 'approvals'] as TabId[]).map((t) => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary hover:border-border dark:hover:border-dark-border'
            }`}
          >
            {t === 'home' && <Home className="w-3.5 h-3.5" />}
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Home Tab */}
        {activeTab === 'home' && (
          <PageHomeTab
            heroIcons={[
              { icon: CheckCircle2, color: 'text-primary bg-primary/10' },
              { icon: Shield, color: 'text-violet-500 bg-violet-500/10' },
              { icon: Clock, color: 'text-emerald-500 bg-emerald-500/10' },
            ]}
            title="Review & Approve Actions"
            subtitle="Your AI requests approval before executing sensitive actions. Review pending requests, approve or deny, and set auto-approval rules."
            cta={{
              label: 'View Approvals',
              icon: CheckCircle2,
              onClick: () => setActiveTab('approvals'),
            }}
            skipHomeChecked={skipHome}
            onSkipHomeChange={handleSkipHomeChange}
            skipHomeLabel="Skip this screen and go directly to Approvals"
            features={[
              {
                icon: Clock,
                color: 'text-amber-500 bg-amber-500/10',
                title: 'Pending Queue',
                description: 'See all actions waiting for your approval in one place.',
              },
              {
                icon: Check,
                color: 'text-green-500 bg-green-500/10',
                title: 'One-Click Approve',
                description: 'Approve or deny requests with a single click.',
              },
              {
                icon: Settings,
                color: 'text-violet-500 bg-violet-500/10',
                title: 'Auto-Rules',
                description: 'Define rules to automatically approve trusted actions.',
              },
              {
                icon: History,
                color: 'text-blue-500 bg-blue-500/10',
                title: 'Audit Trail',
                description: 'Full history of all approval decisions for accountability.',
              },
            ]}
            steps={[
              {
                title: 'AI encounters a gated action',
                detail:
                  'When the AI needs to perform a sensitive operation, it pauses and creates an approval request.',
              },
              {
                title: 'Request appears here',
                detail:
                  'Pending approvals show up in your queue with full context about the action.',
              },
              {
                title: 'Review & approve/deny',
                detail: 'Examine the details and approve or reject the request with one click.',
              },
              {
                title: 'Set auto-rules for trusted actions',
                detail: 'Create rules to automatically approve recurring actions you trust.',
              },
            ]}
          />
        )}

        {/* Approvals Tab */}
        {activeTab === 'approvals' && (
          <>
            <div className="p-6 max-w-4xl mx-auto space-y-6">
              {/* Tabs */}
              <div className="flex gap-1 p-0.5 bg-bg-tertiary dark:bg-dark-bg-tertiary rounded-lg w-fit">
                {(['pending', 'all'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      tab === t
                        ? 'bg-bg-primary dark:bg-dark-bg-primary text-text-primary dark:text-dark-text-primary shadow-sm'
                        : 'text-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary'
                    }`}
                  >
                    {t === 'pending' ? 'Pending' : 'All'}
                  </button>
                ))}
              </div>

              {/* Content */}
              {isLoading ? (
                <LoadingSpinner />
              ) : approvals.length === 0 ? (
                <EmptyState
                  icon={ShieldCheck}
                  title={tab === 'pending' ? 'No Pending Approvals' : 'No Approvals Yet'}
                  description={
                    tab === 'pending'
                      ? 'When a workflow reaches an approval gate, it will appear here for review.'
                      : 'Approval records will appear here when workflows use approval gate nodes.'
                  }
                />
              ) : (
                <div className="space-y-3">
                  {approvals.map((approval) => {
                    const StatusIcon = statusIcons[approval.status] ?? Clock;
                    const isActing = actionInProgress === approval.id;
                    const isPending = approval.status === 'pending';
                    const isExpired =
                      isPending &&
                      approval.expiresAt &&
                      new Date(approval.expiresAt).getTime() < Date.now();

                    return (
                      <div
                        key={approval.id}
                        className="p-4 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0 space-y-2">
                            {/* Status + ID */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full ${statusStyles[approval.status] ?? ''}`}
                              >
                                <StatusIcon className="w-3 h-3" />
                                {approval.status}
                              </span>
                              {isExpired && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-error/10 text-error">
                                  <AlertTriangle className="w-3 h-3" />
                                  Expired
                                </span>
                              )}
                              <span className="text-[10px] text-text-muted dark:text-dark-text-muted font-mono">
                                {approval.id}
                              </span>
                            </div>

                            {/* Message */}
                            {approval.message && (
                              <p className="text-sm text-text-primary dark:text-dark-text-primary">
                                {approval.message}
                              </p>
                            )}

                            {/* Meta */}
                            <div className="flex items-center gap-3 text-[10px] text-text-muted dark:text-dark-text-muted">
                              <span className="inline-flex items-center gap-1">
                                <GitBranch className="w-3 h-3" />
                                Workflow: {approval.workflowId}
                              </span>
                              <span>Node: {approval.nodeId}</span>
                              <span>Created {formatTimeAgo(approval.createdAt)}</span>
                              {approval.decidedAt && (
                                <span>Decided {formatTimeAgo(approval.decidedAt)}</span>
                              )}
                              {isPending && approval.expiresAt && !isExpired && (
                                <span>Expires {formatTimeAgo(approval.expiresAt)}</span>
                              )}
                            </div>

                            {/* Context */}
                            {approval.context && Object.keys(approval.context).length > 0 && (
                              <details className="text-xs">
                                <summary className="cursor-pointer text-text-muted dark:text-dark-text-muted hover:text-text-secondary dark:hover:text-dark-text-secondary">
                                  Context
                                </summary>
                                <pre className="mt-1 p-2 bg-bg-primary dark:bg-dark-bg-primary rounded text-[10px] font-mono overflow-x-auto max-h-32">
                                  {JSON.stringify(approval.context, null, 2)}
                                </pre>
                              </details>
                            )}
                          </div>

                          {/* Actions */}
                          {isPending && !isExpired && (
                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => handleApprove(approval)}
                                disabled={isActing}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-success hover:bg-success/90 rounded-md transition-colors disabled:opacity-50"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Approve
                              </button>
                              <button
                                onClick={() => handleReject(approval)}
                                disabled={isActing}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-error hover:bg-error/90 rounded-md transition-colors disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
