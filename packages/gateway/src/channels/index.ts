/**
 * Channels Module
 *
 * Unified channel system using plugin architecture.
 */

export {
  ChannelServiceImpl,
  createChannelServiceImpl,
  getChannelServiceImpl,
} from './service-impl.js';

export {
  UnifiedChannelBus,
  getUnifiedBus,
  resetUnifiedBus,
} from './unified-bus.js';
