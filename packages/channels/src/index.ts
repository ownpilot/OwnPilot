/**
 * @ownpilot/channels
 *
 * Communication channels for OwnPilot
 *
 * @packageDocumentation
 */

// Types
export type {
  ChannelConfig,
  TelegramConfig,
  IncomingMessage,
  OutgoingMessage,
  ChannelHandler,
  ChannelEvent,
} from './types/index.js';

// Telegram
export { TelegramBot, createTelegramBot } from './telegram/index.js';

// Manager
export { ChannelManager, createChannelManager, type ChannelManagerOptions } from './manager.js';
