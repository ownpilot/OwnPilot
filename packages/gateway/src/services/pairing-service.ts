/**
 * Pairing Service — first-boot ownership claim via one-time pairing key.
 *
 * Flow:
 *   1. On first start (no owner claimed on any platform), a random key like
 *      "A1B2-C3D4" is generated and printed prominently to the console.
 *   2. The owner sends `/connect A1B2-C3D4` on Telegram, WhatsApp, or any
 *      other channel. This is the ONLY accepted command until claimed.
 *   3. Ownership is stored per-platform. The same key can be used to claim
 *      ownership on multiple platforms (e.g., both Telegram and WhatsApp).
 *   4. Once claimed on a platform, all messages from non-owners on that
 *      platform are silently dropped.
 *   5. The pairing key itself is never invalidated — it can always be used to
 *      claim a new platform. To reset ownership, delete the relevant
 *      `owner_<platform>` rows from system_settings.
 */

import { randomBytes } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import { getSystemSettingsRepository } from '../db/repositories/system-settings.js';
import { getLog } from './log.js';

const log = getLog('PairingService');

// ── DB key helpers ────────────────────────────────────────────────────────────

const KEY_PAIRING     = 'pairing_key';
const ownerKey        = (platform: string) => `owner_${platform}`;
const ownerChatKey    = (platform: string) => `owner_chat_${platform}`;

// ── Key generation ────────────────────────────────────────────────────────────

function generateKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — easy to read
  const pick = () => chars[randomBytes(1)[0]! % chars.length]!
  return `${pick()}${pick()}${pick()}${pick()}-${pick()}${pick()}${pick()}${pick()}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns the current pairing key, generating and persisting one if needed.
 */
export async function getPairingKey(): Promise<string> {
  const repo = getSystemSettingsRepository();
  const stored = await repo.get(KEY_PAIRING);
  if (stored) return stored;

  const key = generateKey();
  await repo.set(KEY_PAIRING, key);
  return key;
}

/**
 * Checks whether ANY platform has been claimed, used to decide whether to
 * print the pairing key banner at startup.
 */
export async function hasAnyOwner(): Promise<boolean> {
  // We query all settings; if any key starts with 'owner_' and has a value → claimed
  const repo = getSystemSettingsRepository();
  // Peek at a few common platforms
  for (const platform of ['telegram', 'whatsapp', 'discord', 'slack']) {
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
 * Attempts to claim ownership of a platform using the provided pairing key.
 *
 * @returns ClaimResult — success=true when ownership is newly established.
 */
export async function claimOwnership(
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
      message: 'This channel is already configured. To reset, remove the owner entry from system_settings.',
    };
  }

  // Fetch stored key
  const storedKey = await repo.get(KEY_PAIRING);
  if (!storedKey) {
    return { success: false, alreadyClaimed: false, message: 'No pairing key found.' };
  }

  // Timing-safe comparison
  const a = Buffer.from(submittedKey.trim().toUpperCase());
  const b = Buffer.from(storedKey.trim().toUpperCase());
  const valid = a.length === b.length && timingSafeEqual(a, b);

  if (!valid) {
    log.warn('Invalid pairing key attempt', { platform, platformUserId });
    return { success: false, alreadyClaimed: false, message: 'Invalid pairing key.' };
  }

  // Persist ownership
  await repo.set(ownerKey(platform), platformUserId);
  await repo.set(ownerChatKey(platform), platformChatId);

  log.info(`Ownership claimed on ${platform}`, { platformUserId, platformChatId });

  return { success: true, alreadyClaimed: false, message: 'Ownership claimed.' };
}

/**
 * Print the pairing key banner to stdout so the operator can see it.
 * Called at server startup when no owner is claimed.
 */
export function printPairingBanner(key: string): void {
  const line  = '═'.repeat(54);
  const pad   = (s: string) => `║  ${s.padEnd(50)}  ║`;
  console.log(`\n╔${line}╗`);
  console.log(pad(''));
  console.log(pad('  🔑  OwnPilot — First-Time Setup'));
  console.log(pad(''));
  console.log(pad('  No owner is configured yet.'));
  console.log(pad('  Send the following command to your bot to claim'));
  console.log(pad('  ownership (Telegram, WhatsApp, or any channel):'));
  console.log(pad(''));
  console.log(pad(`      /connect ${key}`));
  console.log(pad(''));
  console.log(pad('  Only the first person to send this command'));
  console.log(pad('  per channel becomes the owner of that channel.'));
  console.log(pad(''));
  console.log(`╚${line}╝\n`);
}
