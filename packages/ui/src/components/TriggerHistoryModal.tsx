import type { TriggerHistoryEntry } from '../api';
import { useModalClose } from '../hooks';

export interface TriggerHistoryModalProps {
  history: TriggerHistoryEntry[];
  onClose: () => void;
}

export function TriggerHistoryModal({ history, onClose }: TriggerHistoryModalProps) {
  const { onBackdropClick } = useModalClose(onClose);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onBackdropClick}>
      <div className="w-full max-w-lg bg-bg-primary dark:bg-dark-bg-primary border border-border dark:border-dark-border rounded-xl shadow-xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-border dark:border-dark-border">
          <h3 className="text-lg font-semibold text-text-primary dark:text-dark-text-primary">
            Trigger History
          </h3>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {history.length === 0 ? (
            <p className="text-text-muted dark:text-dark-text-muted text-center">
              No history yet
            </p>
          ) : (
            <div className="space-y-3">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="p-3 bg-bg-secondary dark:bg-dark-bg-secondary border border-border dark:border-dark-border rounded-lg"
                >
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-text-primary dark:text-dark-text-primary">
                      {new Date(entry.firedAt).toLocaleString()}
                    </div>
                    <div className="flex items-center gap-2">
                      {entry.durationMs != null && (
                        <span className="text-xs text-text-muted dark:text-dark-text-muted">
                          {entry.durationMs}ms
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 text-xs rounded-full ${
                          entry.status === 'success'
                            ? 'bg-success/10 text-success'
                            : entry.status === 'failure'
                            ? 'bg-error/10 text-error'
                            : 'bg-text-muted/10 text-text-muted'
                        }`}
                      >
                        {entry.status}
                      </span>
                    </div>
                  </div>
                  {entry.error && (
                    <p className="mt-1 text-xs text-error">{entry.error}</p>
                  )}
                  {entry.result != null && (
                    <pre className="mt-2 text-xs text-text-muted dark:text-dark-text-muted overflow-x-auto">
                      {JSON.stringify(entry.result, null, 2)}
                    </pre>
                  )}
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
