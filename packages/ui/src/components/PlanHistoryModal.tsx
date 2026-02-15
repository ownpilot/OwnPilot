import type { PlanEventType, PlanHistoryEntry } from '../api';
import { useModalClose } from '../hooks';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const eventTypeColors: Record<PlanEventType, string> = {
  started: 'text-primary',
  step_started: 'text-primary',
  step_completed: 'text-success',
  step_failed: 'text-error',
  paused: 'text-warning',
  resumed: 'text-primary',
  completed: 'text-success',
  failed: 'text-error',
  cancelled: 'text-text-muted',
  checkpoint: 'text-warning',
  rollback: 'text-warning',
};

export const eventTypeLabels: Record<PlanEventType, string> = {
  started: 'Started',
  step_started: 'Step Started',
  step_completed: 'Step Completed',
  step_failed: 'Step Failed',
  paused: 'Paused',
  resumed: 'Resumed',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  checkpoint: 'Checkpoint',
  rollback: 'Rollback',
};

// ---------------------------------------------------------------------------
// PlanHistoryModal
// ---------------------------------------------------------------------------

interface PlanHistoryModalProps {
  history: PlanHistoryEntry[];
  onClose: () => void;
}

export function PlanHistoryModal({ history, onClose }: PlanHistoryModalProps) {
  const { onBackdropClick } = useModalClose(onClose);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onBackdropClick}>
      <div className="w-full max-w-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Plan History
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {history.length === 0 ? (
            <p className="text-text-muted dark:text-dark-text-muted text-center">
              No history yet
            </p>
          ) : (
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 p-2 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${eventTypeColors[entry.eventType]}`}>
                        {eventTypeLabels[entry.eventType]}
                      </span>
                      <span className="text-xs text-text-muted dark:text-dark-text-muted">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {entry.details && Object.keys(entry.details).length > 0 && (
                      <pre className="mt-1 text-xs text-text-muted dark:text-dark-text-muted overflow-x-auto">
                        {JSON.stringify(entry.details, null, 2)}
                      </pre>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border dark:border-dark-border flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
