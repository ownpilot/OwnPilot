/**
 * Intent Adapter — Natural Language → Slash Command Resolution
 *
 * Resolves a user message to the first matching slash command, or null
 * if no pattern matches (message passes through to Claude unchanged).
 */

import { COMMAND_INTENT_MAP } from './command-metadata.ts';

/**
 * Turkish character normalization pairs.
 * Applied after toLowerCase() so patterns never need accent variants.
 */
const TR_NORMALIZE: [RegExp, string][] = [
  [/ı/g, 'i'], [/İ/g, 'i'],
  [/ş/g, 's'], [/Ş/g, 's'],
  [/ğ/g, 'g'], [/Ğ/g, 'g'],
  [/ü/g, 'u'], [/Ü/g, 'u'],
  [/ö/g, 'o'], [/Ö/g, 'o'],
  [/ç/g, 'c'], [/Ç/g, 'c'],
];

/**
 * Normalize a user message for pattern matching:
 * 1. Trim whitespace
 * 2. Lowercase
 * 3. Replace Turkish accented characters with ASCII equivalents
 */
function normalize(message: string): string {
  let s = message.trim().toLowerCase();
  for (const [regex, replacement] of TR_NORMALIZE) {
    s = s.replace(regex, replacement);
  }
  return s;
}

/**
 * Resolve a natural-language message to a slash command string.
 *
 * @param message - Raw user message (any case, any language)
 * @returns `/commandName` string if matched, `null` for pass-through
 *
 * @example
 * resolveIntent("ne kadar harcadım") // → "/cost"
 * resolveIntent("how much did i spend") // → "/cost"
 * resolveIntent("write me a poem") // → null
 */
export function resolveIntent(message: string): string | null {
  const normalized = normalize(message);
  if (!normalized) return null;

  // Long messages are CC tasks, not bridge commands.
  // Mirrors llm-router.ts bypass (MAX_MESSAGE_LENGTH=80, MAX_WORD_COUNT=6).
  if (normalized.length > 80 || normalized.split(/\s+/).length > 6) return null;

  for (const { pattern, command } of COMMAND_INTENT_MAP) {
    if (pattern.test(normalized)) {
      return command;
    }
  }

  return null;
}
