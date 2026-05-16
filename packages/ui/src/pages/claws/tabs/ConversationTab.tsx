import { LoadingSpinner } from '../../../components/LoadingSpinner';
import { timeAgo } from '../utils';

export function ConversationTab({
  conversation,
  isLoadingConvo,
}: {
  conversation: Array<{ role: string; content: string; createdAt?: string }>;
  isLoadingConvo: boolean;
}) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted dark:text-dark-text-muted">
        Messages from claw_send_output and claw_complete_report. These are the claw's narrative log.
      </p>
      {isLoadingConvo ? (
        <LoadingSpinner message="Loading..." />
      ) : conversation.length === 0 ? (
        <p className="text-sm text-text-muted dark:text-dark-text-muted py-4 text-center">
          No messages yet. The claw writes here when using claw_send_output or claw_complete_report.
        </p>
      ) : (
        <div className="space-y-3">
          {conversation.map((msg, i) => (
            <div
              key={i}
              className={`p-4 rounded-lg border ${
                msg.role === 'assistant'
                  ? 'bg-primary/5 border-primary/10'
                  : 'bg-bg-secondary dark:bg-dark-bg-secondary border-border dark:border-dark-border'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-xs font-bold uppercase ${
                    msg.role === 'assistant'
                      ? 'text-primary'
                      : msg.role === 'system'
                        ? 'text-amber-500'
                        : 'text-text-muted'
                  }`}
                >
                  {msg.role}
                </span>
                {msg.createdAt && (
                  <span className="text-xs text-text-muted">{timeAgo(msg.createdAt)}</span>
                )}
              </div>
              <div className="text-sm text-text-primary dark:text-dark-text-primary whitespace-pre-wrap leading-relaxed">
                {msg.content.length > 3000 ? msg.content.slice(0, 3000) + '\n\n...' : msg.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
