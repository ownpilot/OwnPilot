/**
 * Shared message utilities for channel plugins.
 */

// ============================================================================
// Platform message length limits
// ============================================================================

export const PLATFORM_MESSAGE_LIMITS: Record<string, number> = {
  telegram: 4096,
  discord: 2000,
  whatsapp: 4096,
  slack: 4000,
};

// ============================================================================
// Message splitting
// ============================================================================

/**
 * Split a long message into parts that fit within `maxLength`.
 *
 * Splitting preference: newline → space → hard cut.
 * Hard cuts only happen when no suitable break point is found
 * in the last 50 % of the chunk.
 */
export function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }

    // Try to split at newline or space
    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = maxLength;
    }

    parts.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return parts;
}
