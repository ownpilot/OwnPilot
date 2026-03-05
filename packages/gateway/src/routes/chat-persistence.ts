/**
 * Chat persistence — re-exports from ConversationService.
 *
 * Logic has moved to packages/gateway/src/services/conversation-service.ts.
 * This file is kept as a compatibility shim for imports and tests.
 */

export type { AttachmentMeta, SaveChatParams } from '../services/conversation-service.js';
export {
  ConversationService,
  broadcastChatUpdate,
  saveChatToDatabase,
  saveStreamingChat,
  runPostChatProcessing,
  waitForPendingProcessing,
} from '../services/conversation-service.js';
