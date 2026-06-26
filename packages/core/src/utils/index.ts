/**
 * Core utilities exports
 *
 * Safe JSON parsing, safe value guards, bounded LRU/FIFO maps.
 */

export {
  safeJsonParse,
  safeJsonParseWithDefault,
  safeJsonStringify,
  isValidJson,
} from './safe-json.js';

export { safeCost, safeDuration } from './safe-value.js';

export { BoundedMap } from './bounded-map.js';

export { ignoreError, silentCatch } from './ignore-error.js';
export type { IgnoredErrorHandler } from './ignore-error.js';
