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
export type { EvictionPolicy } from './bounded-map.js';
