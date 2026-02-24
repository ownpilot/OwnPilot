import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Clock,
} from '../../components/icons';
import { riskColors } from './helpers';
import type { PendingApproval } from '../../api';

interface ApprovalsSectionProps {
  pendingApprovals: PendingApproval[];
  onApproval: (actionId: string, decision: 'approve' | 'reject') => void;
}

export function ApprovalsSection({ pendingApprovals, onApproval }: ApprovalsSectionProps) {
  if (pendingApprovals.length === 0) return null;

  return (
    <section className="bg-warning/10 border border-warning/30 rounded-xl p-4">
      <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary mb-4 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-warning" />
        Pending Approvals ({pendingApprovals.length})
      </h3>
      <div className="space-y-3">
        {pendingApprovals.map((approval) => (
          <div
            key={approval.id}
            className="flex items-start gap-3 p-3 bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-lg"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-text-primary dark:text-dark-text-primary">
                  {approval.description}
                </span>
                <span
                  className={`px-2 py-0.5 text-xs rounded-full ${
                    riskColors[approval.risk.level as keyof typeof riskColors]
                  } bg-current/10`}
                >
                  {approval.risk.level} risk
                </span>
              </div>
              <p className="text-sm text-text-muted dark:text-dark-text-muted">
                {approval.category} / {approval.type}
              </p>
              <div className="flex items-center gap-2 mt-1 text-xs text-text-muted dark:text-dark-text-muted">
                <Clock className="w-3 h-3" />
                Expires: {new Date(approval.expiresAt).toLocaleTimeString()}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => onApproval(approval.id, 'approve')}
                className="p-2 text-success hover:bg-success/10 rounded-lg transition-colors"
                title="Approve"
              >
                <CheckCircle2 className="w-5 h-5" />
              </button>
              <button
                onClick={() => onApproval(approval.id, 'reject')}
                className="p-2 text-error hover:bg-error/10 rounded-lg transition-colors"
                title="Reject"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
