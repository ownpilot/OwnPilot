/**
 * Channel Bridge Runtime
 *
 * Wires the UCP {@link UCPBridgeManager} into the live channel pipeline so that
 * configured bridges actually forward messages. Without this module the bridge
 * REST/UI/DB surface persists configs that never do anything at runtime.
 *
 * Semantics (single-owner, privacy-first): a bridge mirrors an inbound message
 * that arrives on one of the owner's channels to the owner's chat on another of
 * their channels (e.g. "mirror my Telegram DMs to my Discord"). The target chat
 * is resolved via the owner claimed through the pairing service — we never fan
 * a message out to arbitrary recipients.
 */

import {
  UCPBridgeManager,
  type UCPMessage,
  type ChannelIncomingMessage,
  type IChannelService,
} from '@ownpilot/core';
import { ChannelBridgesRepository } from '../db/repositories/channels/bridges.js';
import { getOwnerChatId } from '../services/pairing-service.js';
import { getErrorMessage } from '../utils/common.js';
import { getLog } from '../services/log.js';

const log = getLog('ChannelBridge');

let manager: UCPBridgeManager | null = null;
let bridgesRepo: ChannelBridgesRepository | null = null;

function getRepo(): ChannelBridgesRepository {
  if (!bridgesRepo) bridgesRepo = new ChannelBridgesRepository();
  return bridgesRepo;
}

/** Plain text extracted from a UCP message's text blocks. */
function extractText(msg: UCPMessage): string {
  return msg.content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
    .join(' ')
    .trim();
}

/**
 * Initialize the bridge manager: load persisted bridge configs and install the
 * send function that delivers a forwarded UCP message to the owner's chat on the
 * target channel. Safe to call once at startup; errors never block boot.
 */
export async function initChannelBridges(channelService: IChannelService): Promise<void> {
  const mgr = new UCPBridgeManager();

  mgr.setSendFunction(async (targetChannelPluginId, msg) => {
    const api = channelService.getChannel(targetChannelPluginId);
    if (!api) {
      log.debug('Bridge target channel not found', { targetChannelPluginId });
      return '';
    }

    // Deliver to the owner's chat on the target platform. No owner claimed ⇒
    // nowhere safe to send, so we drop rather than guess a recipient.
    const targetPlatform = api.getPlatform();
    const ownerChatId = await getOwnerChatId(targetPlatform);
    if (!ownerChatId) {
      log.debug('Bridge skipped: target platform has no claimed owner', {
        targetChannelPluginId,
        targetPlatform,
      });
      return '';
    }

    const text = extractText(msg);
    if (!text) return '';

    const from = (msg.metadata?.bridgedFrom as string | undefined) ?? msg.channel;
    const senderName = msg.sender?.displayName ? ` (${msg.sender.displayName})` : '';
    const body = `🔀 [from ${from}${senderName}]\n${text}`;

    return channelService.send(targetChannelPluginId, {
      platformChatId: ownerChatId,
      text: body,
    });
  });

  try {
    await mgr.loadBridges(getRepo());
    const active = mgr.getActiveBridges().length;
    log.info('Channel bridges initialized', { active });
  } catch (err) {
    log.warn('Failed to load channel bridges', { error: getErrorMessage(err) });
  }

  manager = mgr;
}

/**
 * Reload bridge configs from the DB into the in-memory manager. Called by the
 * bridges REST routes after a create/update/delete so runtime state stays in
 * sync without a DB hit on every inbound message.
 */
export async function reloadChannelBridges(): Promise<void> {
  if (!manager) return;
  try {
    await manager.loadBridges(getRepo());
  } catch (err) {
    log.warn('Failed to reload channel bridges', { error: getErrorMessage(err) });
  }
}

/**
 * Forward an inbound channel message through any matching bridges. Best-effort:
 * a bridging failure never affects the normal message-processing path. No-op
 * until {@link initChannelBridges} has run (e.g. in unit tests of other paths).
 */
export async function bridgeIncomingMessage(message: ChannelIncomingMessage): Promise<void> {
  if (!manager || manager.getActiveBridges().length === 0) return;

  const ucpMsg: UCPMessage = {
    id: message.id,
    externalId: message.metadata?.platformMessageId?.toString() ?? message.id,
    channel: message.platform,
    channelInstanceId: message.channelPluginId,
    direction: 'inbound',
    sender: {
      id: message.sender.platformUserId,
      displayName: message.sender.displayName,
      username: message.sender.username,
      avatarUrl: message.sender.avatarUrl,
      platform: message.platform,
      isBot: message.sender.isBot,
    },
    content: [{ type: 'text', text: message.text, format: 'plain' }],
    replyToId: message.replyToId,
    timestamp: message.timestamp,
    metadata: {},
  };

  try {
    const forwarded = await manager.bridgeMessage(ucpMsg);
    if (forwarded > 0) {
      log.info('Bridged inbound message', {
        source: message.channelPluginId,
        forwarded,
      });
    }
  } catch (err) {
    log.warn('Bridge forwarding failed', { error: getErrorMessage(err) });
  }
}

/** Access the live bridge manager (undefined before init). For tests/diagnostics. */
export function getChannelBridgeManager(): UCPBridgeManager | null {
  return manager;
}

/** Reset module state. Test-only. */
export function resetChannelBridges(): void {
  manager = null;
  bridgesRepo = null;
}
