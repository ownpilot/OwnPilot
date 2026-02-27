/**
 * Approvals Page — lists pending and past workflow approval gates.
 * Allows users to approve or reject pending approvals.
 */

import { useState, useEffect, useCallback } from 'react';
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
} from '../components/icons';
import { useDialog } from '../components/ConfirmDialog';
import { useToast } from '../components/ToastProvider';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { EmptyState } from '../components/EmptyState';

type TabFilter = 'pending' | 'all';

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
    setIsLoading(true);
    fetchApprovals();
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
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6 text-warning" />
          <div>
            <h1 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
              Workflow Approvals
            </h1>
            <p className="text-xs text-text-muted dark:text-dark-text-muted">
              Review and approve paused workflow executions
            </p>
          </div>
        </div>
        <span className="text-xs text-text-muted dark:text-dark-text-muted">
          {total} {tab === 'pending' ? 'pending' : 'total'}
        </span>
      </div>

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
  );
}
