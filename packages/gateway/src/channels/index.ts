/**
 * Channels Module
 *
 * Unified channel system using plugin architecture.
 * Re-exports the bridge for backward compatibility.
 */

// New: Plugin-based channel service
export { ChannelServiceImpl, createChannelServiceImpl, getChannelServiceImpl } from './service-impl.js';

// Bridge: backward-compatible channelManager (delegates to IChannelService)
export { channelManager, initializeChannelFactories } from './manager.js';
