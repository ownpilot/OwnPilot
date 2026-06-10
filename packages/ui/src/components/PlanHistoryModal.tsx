import type { PlanEventType, PlanHistoryEntry } from '../api';
import { Modal } from './Modal';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const eventTypeColors: Record<PlanEventType, string> = {
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

const eventTypeLabels: Record<PlanEventType, string> = {
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
  return (
    <Modal
      onClose={onClose}
      title="Plan History"
      size="lg"
      footer={
        <button
          onClick={onClose}
          className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          Close
        </button>
      }
    >
      {history.length === 0 ? (
        <p className="text-text-muted dark:text-dark-text-muted text-center">No history yet</p>
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
    </Modal>
  );
}
