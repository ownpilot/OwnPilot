/**
 * Pairing Service — per-channel ownership claim via rotating one-time pairing keys.
 *
 * Flow:
 *   1. Each channel gets its own rotating pairing key (e.g., "A1B2-C3D4").
 *      Keys are printed to the console at startup for unclaimed channels.
 *   2. The owner sends `/connect A1B2-C3D4` on that channel. This is the ONLY
 *      accepted command until an owner is claimed for that channel's platform.
 *   3. On success, ownership is stored per-platform and the channel's key is
 *      immediately rotated — the old key cannot be reused.
 *   4. Once claimed, all messages from non-owners are silently dropped.
 *   5. Ownership can be revoked via revokeOwnership(), which clears the owner
 *      and rotates the key so a fresh /connect claim can be made.
 */

import { randomBytes } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import { getSystemSettingsRepository } from '../db/repositories/system-settings.js';
import { getLog } from './log.js';

const log = getLog('PairingService');

// ── DB key helpers ────────────────────────────────────────────────────────────

const pairingKey = (pluginId: string) => `pairing_key_${pluginId}`;
const ownerKey = (platform: string) => `owner_${platform}`;
const ownerChatKey = (platform: string) => `owner_chat_${platform}`;

// ── Key generation ────────────────────────────────────────────────────────────

function generateKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — easy to read
  const pick = () => chars[randomBytes(1)[0]! % chars.length]!;
  return `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}${pick()}`;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function rotatePairingKey(pluginId: string): Promise<string> {
  const newKey = generateKey();
  await getSystemSettingsRepository().set(pairingKey(pluginId), newKey);
  return newKey;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the current pairing key for a channel, generating and persisting
 * one if needed.
 */
export async function getPairingKey(pluginId: string): Promise<string> {
  const repo = getSystemSettingsRepository();
  const stored = await repo.get(pairingKey(pluginId));
  if (stored) return stored;

  const key = generateKey();
  await repo.set(pairingKey(pluginId), key);
  return key;
}

/**
 * Checks whether ANY platform has been claimed, used to decide whether to
 * print pairing key banners at startup.
 */
export async function hasAnyOwner(): Promise<boolean> {
  const repo = getSystemSettingsRepository();
  for (const platform of ['telegram', 'whatsapp']) {
    const v = await repo.get(ownerKey(platform));
    if (v) return true;
  }
  return false;
}

/**
 * Returns the stored owner platformUserId for a given channel platform,
 * or null if not yet claimed.
 */
export async function getOwnerUserId(platform: string): Promise<string | null> {
  return getSystemSettingsRepository().get(ownerKey(platform));
}

/**
 * Returns the stored owner platformChatId for a given channel platform,
 * or null if not yet claimed.
 */
export async function getOwnerChatId(platform: string): Promise<string | null> {
  return getSystemSettingsRepository().get(ownerChatKey(platform));
}

/**
 * Returns true if the given platformUserId is the registered owner of the platform.
 */
export async function isOwner(platform: string, platformUserId: string): Promise<boolean> {
  const owner = await getOwnerUserId(platform);
  return owner !== null && owner === platformUserId;
}

export interface ClaimResult {
  success: boolean;
  alreadyClaimed: boolean;
  message: string;
}

/**
 * Attempts to claim ownership of a platform using the channel's current pairing key.
 * On success, the key is immediately rotated so it cannot be reused.
 */
export async function claimOwnership(
  pluginId: string,
  platform: string,
  platformUserId: string,
  platformChatId: string,
  submittedKey: string
): Promise<ClaimResult> {
  const repo = getSystemSettingsRepository();

  // Already claimed on this platform?
  const existing = await repo.get(ownerKey(platform));
  if (existing) {
    return {
      success: false,
      alreadyClaimed: true,
      message: 'This channel already has an owner. Use /revoke to reset ownership.',
    };
  }

  // Fetch stored key for this specific channel
  const storedKey = await repo.get(pairingKey(pluginId));
  if (!storedKey) {
    return { success: false, alreadyClaimed: false, message: 'No pairing key found.' };
  }

  // Timing-safe comparison
  const a = Buffer.from(submittedKey.trim().toUpperCase());
  const b = Buffer.from(storedKey.trim().toUpperCase());
  const valid = a.length === b.length && timingSafeEqual(a, b);

  if (!valid) {
    log.warn('Invalid pairing key attempt', { pluginId, platform, platformUserId });
    return { success: false, alreadyClaimed: false, message: 'Invalid pairing key.' };
  }

  // Persist ownership
  await repo.set(ownerKey(platform), platformUserId);
  await repo.set(ownerChatKey(platform), platformChatId);

  // Rotate the key immediately — old key is now invalid
  await rotatePairingKey(pluginId);

  log.info(`Ownership claimed on ${platform} via channel ${pluginId}`, {
    platformUserId,
    platformChatId,
  });

  return { success: true, alreadyClaimed: false, message: 'Ownership claimed.' };
}

/**
 * Directly claim ownership without requiring a pairing key.
 * Used for channels where the transport layer already provides authentication
 * (e.g. WhatsApp self-chat where `fromMe:true` guarantees the phone owner).
 * No-ops if ownership is already claimed by the same user.
 */
export async function autoClaimOwnership(
  pluginId: string,
  platform: string,
  platformUserId: string,
  platformChatId: string
): Promise<void> {
  const repo = getSystemSettingsRepository();
  const existing = await repo.get(ownerKey(platform));
  if (existing) return; // already claimed — don't overwrite

  await repo.set(ownerKey(platform), platformUserId);
  await repo.set(ownerChatKey(platform), platformChatId);
  // Rotate key so the startup-banner key can't be used after auto-claim
  await rotatePairingKey(pluginId);
  log.info(`Auto-claimed ownership on ${platform} via channel ${pluginId}`, { platformUserId });
}

/**
 * Revokes ownership of a platform and rotates the channel's pairing key.
 * After revoking, a fresh /connect claim can be made with the new key.
 */
export async function revokeOwnership(pluginId: string, platform: string): Promise<void> {
  const repo = getSystemSettingsRepository();
  await repo.delete(ownerKey(platform));
  await repo.delete(ownerChatKey(platform));
  await rotatePairingKey(pluginId);
  log.info(`Ownership revoked for ${platform} via channel ${pluginId}`);
}

/**
 * Print the pairing key banner for a specific channel to stdout.
 * Called at server startup for each unclaimed channel.
 */
export function printPairingBanner(channelName: string, key: string): void {
  const line = '═'.repeat(54);
  const pad = (s: string) => `║  ${s.padEnd(50)}  ║`;
  console.log(`\n╔${line}╗`);
  console.log(pad(''));
  console.log(pad(`  🔑  OwnPilot — Channel Setup`));
  console.log(pad(`      ${channelName}`));
  console.log(pad(''));
  console.log(pad('  No owner is configured for this channel yet.'));
  console.log(pad('  Send the following command on this channel:'));
  console.log(pad(''));
  console.log(pad(`      /connect ${key}`));
  console.log(pad(''));
  console.log(pad('  The key rotates after each successful claim.'));
  console.log(pad(''));
  console.log(`╚${line}╝\n`);
}
