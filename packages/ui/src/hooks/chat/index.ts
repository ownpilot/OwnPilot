/**
 * Chat Store — Public API
 *
 * Barrel file for the modular chat store.
 * Consumers import from '../useChatStore' (the original path) which
 * re-exports everything below, maintaining full backward compatibility.
 */

export { ChatProvider, useChatStore, ChatContext } from './chat-provider';
export type {
  ChatStore,
  ChatState,
  ChatSessionSnapshot,
  FailedChatRequest,
  ProgressEvent,
} from './types';
export { parseProgressEvent } from './types';

// Re-export auto-compact constants (legacy consumers import these from useChatStore)
export {
  AUTO_COMPACT_THRESHOLD,
  AUTO_COMPACT_CLEAR_BELOW,
  AUTO_COMPACT_MIN_MESSAGES,
  computeAutoCompactPrompt,
} from '../useAutoCompact';
export type { AutoCompactPromptState } from '../useAutoCompact';
