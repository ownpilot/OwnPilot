/**
 * Cost Formatting Helpers
 */

/**
 * Format cost as currency string
 */
export function formatCost(cost: number, currency: string = 'USD'): string {
  if (currency === 'USD') {
    if (cost < 0.01) {
      return `$${cost.toFixed(6)}`;
    } else if (cost < 1) {
      return `$${cost.toFixed(4)}`;
    } else {
      return `$${cost.toFixed(2)}`;
    }
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(cost);
}

/**
 * Format token count
 */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return tokens.toString();
  if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1000000).toFixed(2)}M`;
}
