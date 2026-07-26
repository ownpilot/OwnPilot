export const MAX_KEEP_RECENT_MESSAGES = 100;

export function isValidKeepRecentMessages(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_KEEP_RECENT_MESSAGES
  );
}
