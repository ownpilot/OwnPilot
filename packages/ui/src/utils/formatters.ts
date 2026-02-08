/**
 * Shared formatting utilities
 */

/**
 * Format a large number with K/M suffixes.
 * @param kDecimals decimals for thousands (default 1)
 * @param mDecimals decimals for millions (default 1)
 */
export function formatNumber(
  num: number,
  options?: { kDecimals?: number; mDecimals?: number },
): string {
  const { kDecimals = 1, mDecimals = 1 } = options ?? {};
  if (num >= 1000000) return `${(num / 1000000).toFixed(mDecimals)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(kDecimals)}K`;
  return num.toString();
}

/**
 * Format bytes to human-readable size (B, KB, MB, GB).
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}
