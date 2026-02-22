interface MemoryItem {
  type: string;
  content: string;
  importance?: number;
}

interface MemoryCardsProps {
  memories: MemoryItem[];
  onAccept: (index: number) => void;
  onReject: (index: number) => void;
}

const TYPE_LABELS: Record<string, string> = {
  fact: 'Fact',
  preference: 'Preference',
  conversation: 'Conversation',
  event: 'Event',
  skill: 'Skill',
};

const TYPE_COLORS: Record<string, string> = {
  fact: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  preference: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  conversation: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  event: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  skill: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
};

export function MemoryCards({ memories, onAccept, onReject }: MemoryCardsProps) {
  if (memories.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-3 mb-1 animate-fade-in">
      <span className="text-xs text-text-muted dark:text-dark-text-muted font-medium">
        Memories detected
      </span>
      {memories.map((memory, index) => (
        <div
          key={`${memory.type}-${index}`}
          className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary dark:bg-dark-bg-tertiary border border-border dark:border-dark-border rounded-lg text-sm"
        >
          <span
            className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${TYPE_COLORS[memory.type] ?? TYPE_COLORS.conversation}`}
          >
            {TYPE_LABELS[memory.type] ?? memory.type}
          </span>
          <span className="flex-1 truncate text-text-primary dark:text-dark-text-primary">
            {memory.content}
          </span>
          <button
            onClick={() => onAccept(index)}
            title="Save memory"
            className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-text-muted dark:text-dark-text-muted hover:text-green-600 dark:hover:text-green-400 transition-colors shrink-0"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3.5 8 6.5 11 12.5 5" />
            </svg>
          </button>
          <button
            onClick={() => onReject(index)}
            title="Dismiss memory"
            className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-text-muted dark:text-dark-text-muted hover:text-red-600 dark:hover:text-red-400 transition-colors shrink-0"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
