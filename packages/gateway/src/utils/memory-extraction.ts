/**
 * Memory Extraction Utility
 *
 * Extracts memories from AI response content.
 * The AI embeds memories in a <memories>[{"type":"fact","content":"..."}]</memories>
 * tag in its response. This utility parses and strips the tag.
 */

const VALID_TYPES = new Set(['fact', 'preference', 'conversation', 'event', 'skill']);

export type MemoryType = 'fact' | 'preference' | 'conversation' | 'event' | 'skill';

export interface MemoryItem {
  type: MemoryType;
  content: string;
  importance?: number;
}

export interface MemoryExtractionResult {
  /** Response content with <memories> tag stripped */
  content: string;
  /** Extracted memory items, empty array if none found */
  memories: MemoryItem[];
}

const MEMORIES_REGEX = /<memories>\s*(\[[\s\S]*?\])\s*<\/memories>/;
const MAX_MEMORIES = 10;
const MAX_CONTENT_LENGTH = 500;

/**
 * Validate and normalize a parsed item into a MemoryItem.
 */
function normalizeItem(item: unknown): MemoryItem | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;

  const obj = item as Record<string, unknown>;
  const type = typeof obj.type === 'string' ? obj.type.trim() : '';
  const content = typeof obj.content === 'string' ? obj.content.trim() : '';

  if (!VALID_TYPES.has(type) || content.length === 0) return null;

  const result: MemoryItem = {
    type: type as MemoryType,
    content: content.slice(0, MAX_CONTENT_LENGTH),
  };

  if (typeof obj.importance === 'number' && obj.importance >= 0 && obj.importance <= 1) {
    result.importance = obj.importance;
  }

  return result;
}

/**
 * Extract memories from AI response content.
 *
 * 1. Finds `<memories>[...]</memories>` in the text
 * 2. Parses the JSON array of { type, content, importance? } objects
 * 3. Returns cleaned content (tag stripped) and memory items
 *
 * On any parse failure, returns content as-is with empty memories.
 */
export function extractMemoriesFromResponse(rawContent: string): MemoryExtractionResult {
  const match = rawContent.match(MEMORIES_REGEX);

  if (!match?.[1]) {
    return { content: rawContent, memories: [] };
  }

  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (!Array.isArray(parsed)) {
      return { content: rawContent, memories: [] };
    }

    const memories = parsed
      .map(normalizeItem)
      .filter((m): m is MemoryItem => m !== null)
      .slice(0, MAX_MEMORIES);

    if (memories.length === 0) {
      return { content: rawContent, memories: [] };
    }

    // Strip the <memories> tag from content
    const content = rawContent.replace(MEMORIES_REGEX, '').trimEnd();
    return { content, memories };
  } catch {
    return { content: rawContent, memories: [] };
  }
}
