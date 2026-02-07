interface Suggestion {
  title: string;
  detail: string;
}

interface SuggestionChipsProps {
  suggestions: Suggestion[];
  onSelect: (suggestion: Suggestion) => void;
  disabled?: boolean;
}

export function SuggestionChips({ suggestions, onSelect, disabled }: SuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 justify-start mt-3 mb-1 animate-fade-in">
      {suggestions.map((suggestion) => (
        <button
          key={suggestion.title}
          onClick={() => onSelect(suggestion)}
          disabled={disabled}
          title={suggestion.detail}
          className="px-3 py-1.5 text-sm bg-bg-tertiary dark:bg-dark-bg-tertiary text-text-secondary dark:text-dark-text-secondary border border-border dark:border-dark-border rounded-full hover:bg-primary hover:text-white hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {suggestion.title}
        </button>
      ))}
    </div>
  );
}
