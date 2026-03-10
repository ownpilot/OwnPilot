/**
 * Pattern matcher for structured output from Claude Code.
 * Detects GSD-style structured markers in assistant responses.
 */

export const PATTERNS = {
  PROGRESS: /^PROGRESS:\s*(.+)/m,
  TASK_COMPLETE: /^TASK_COMPLETE:\s*(.+)/m,
  TASK_BLOCKED: /^TASK_BLOCKED:\s*(.+)/m,
  QUESTION: /^QUESTION:\s*(.+)/m,
  ANSWER: /^ANSWER:\s*(.+)/m,
  PHASE_COMPLETE: /^Phase \d+ complete/im,
  ERROR: /^ERROR:\s*(.+)/m,
} as const;

export type PatternKey = keyof typeof PATTERNS;

export interface MatchResult {
  key: PatternKey;
  value: string;
  raw: string;
}

/**
 * Scans text for all known patterns and returns matches.
 */
export function matchPatterns(text: string): MatchResult[] {
  const results: MatchResult[] = [];

  for (const [key, regex] of Object.entries(PATTERNS) as [PatternKey, RegExp][]) {
    const match = text.match(regex);
    if (match) {
      results.push({
        key,
        value: match[1] ?? match[0],
        raw: match[0],
      });
    }
  }

  return results;
}

/**
 * Returns the first match for a specific pattern, or null.
 */
export function matchPattern(text: string, key: PatternKey): MatchResult | null {
  const regex = PATTERNS[key];
  const match = text.match(regex);
  if (!match) return null;
  return {
    key,
    value: match[1] ?? match[0],
    raw: match[0],
  };
}

/**
 * Returns true if the text contains any structured pattern.
 */
export function hasStructuredOutput(text: string): boolean {
  return matchPatterns(text).length > 0;
}

/**
 * Determines if a response is "blocking" (needs user input).
 */
export function isBlocking(text: string): boolean {
  return (
    matchPattern(text, 'QUESTION') !== null ||
    matchPattern(text, 'TASK_BLOCKED') !== null
  );
}
