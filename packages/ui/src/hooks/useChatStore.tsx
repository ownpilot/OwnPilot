/**
 * Global Chat Store — Backward-Compatible Barrel
 *
 * This file was the 1132-line original monolith.
 * The implementation now lives in hooks/chat/ (types.ts + chat-provider.tsx + index.ts).
 * This file re-exports everything so every consumer import path still works.
 *
 * Use `import { useChatStore } from '../hooks/useChatStore'` as before.
 */

export {
  ChatProvider,
  useChatStore,
  AUTO_COMPACT_THRESHOLD,
  AUTO_COMPACT_CLEAR_BELOW,
  AUTO_COMPACT_MIN_MESSAGES,
  computeAutoCompactPrompt,
} from './chat/index';
export type {
  ChatStore,
  ChatState,
  ChatSessionSnapshot,
  FailedChatRequest,
  ProgressEvent,
} from './chat/types';
export type { AutoCompactPromptState } from './chat/index';
