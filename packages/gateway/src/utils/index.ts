/**
 * Gateway utilities
 */

export {
  parseLimit,
  parseOffset,
  parsePagination,
} from './query-params.js';

export { extractSuggestions, type Suggestion, type SuggestionExtractionResult } from './suggestions.js';
