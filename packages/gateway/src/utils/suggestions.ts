/**
 * Suggestion Extraction Utility
 *
 * Extracts follow-up suggestions from AI response content.
 * The AI embeds suggestions in a <suggestions>[{"title":"...","detail":"..."}]</suggestions>
 * tag at the end of its response. This utility parses and strips the tag.
 */

export interface Suggestion {
  title: string;
  detail: string;
}

export interface SuggestionExtractionResult {
  /** Response content with <suggestions> tag stripped */
  content: string;
  /** Extracted suggestions, empty array if none found */
  suggestions: Suggestion[];
}

const SUGGESTIONS_REGEX = /<suggestions>\s*(\[[\s\S]*?\])\s*<\/suggestions>\s*$/;
const MAX_SUGGESTIONS = 5;
const MAX_TITLE_LENGTH = 40;
const MAX_DETAIL_LENGTH = 200;

/**
 * Normalize a parsed item into a Suggestion.
 * Accepts either { title, detail } objects or plain strings (backward compat).
 */
function normalizeItem(item: unknown): Suggestion | null {
  if (typeof item === 'string') {
    const trimmed = item.trim();
    if (trimmed.length === 0) return null;
    return {
      title: trimmed.slice(0, MAX_TITLE_LENGTH),
      detail: trimmed.slice(0, MAX_DETAIL_LENGTH),
    };
  }

  if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
    const obj = item as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    const detail = typeof obj.detail === 'string' ? obj.detail.trim() : '';
    if (title.length === 0 || detail.length === 0) return null;
    return {
      title: title.slice(0, MAX_TITLE_LENGTH),
      detail: detail.slice(0, MAX_DETAIL_LENGTH),
    };
  }

  return null;
}

/**
 * Extract follow-up suggestions from AI response content.
 *
 * 1. Finds `<suggestions>[...]</suggestions>` at the end of the text
 * 2. Parses the JSON array of { title, detail } objects (or plain strings)
 * 3. Returns cleaned content (tag stripped) and suggestions
 *
 * On any parse failure, returns content as-is with empty suggestions.
 */
export function extractSuggestions(rawContent: string): SuggestionExtractionResult {
  const match = rawContent.match(SUGGESTIONS_REGEX);

  if (!match?.[1]) {
    return { content: rawContent, suggestions: [] };
  }

  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) {
      return { content: rawContent, suggestions: [] };
    }

    const suggestions = parsed
      .map(normalizeItem)
      .filter((s): s is Suggestion => s !== null)
      .slice(0, MAX_SUGGESTIONS);

    if (suggestions.length === 0) {
      return { content: rawContent, suggestions: [] };
    }

    const content = rawContent.slice(0, match.index).trimEnd();
    return { content, suggestions };
  } catch {
    return { content: rawContent, suggestions: [] };
  }
}
