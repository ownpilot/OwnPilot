/**
 * WhatsApp Session Store (File-based)
 *
 * Wraps Baileys' useMultiFileAuthState() for persistent session storage.
 * Sessions are stored in the app data directory (e.g. %LOCALAPPDATA%\OwnPilot\whatsapp-sessions\).
 * Supports clearing a session for re-authentication (new QR scan).
 */

import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { useMultiFileAuthState } from '@whiskeysockets/baileys';
import { getLog } from '../../../services/log.js';
import { getDataPath } from '../../../paths/index.js';

const log = getLog('WhatsAppSession');

/** Base directory for WhatsApp sessions — uses the app data root, NOT the codebase. */
function getSessionsBaseDir(): string {
  return join(getDataPath('root'), 'whatsapp-sessions');
}

/** Get the session directory for a specific plugin instance. */
export function getSessionDir(pluginId: string): string {
  // Sanitize pluginId for use as directory name
  const safe = pluginId.replace(/[^a-zA-Z0-9._-]/g, '_');
  return join(getSessionsBaseDir(), safe);
}

/**
 * Load or create a file-based auth state for Baileys.
 * Returns the auth state and a saveCreds callback.
 */
export async function loadAuthState(pluginId: string) {
  const sessionDir = getSessionDir(pluginId);

  // Ensure directory exists
  await mkdir(sessionDir, { recursive: true });

  log.info(`Loading auth state from ${sessionDir}`);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  return { state, saveCreds, sessionDir };
}

/**
 * Check if a session exists (has saved credentials).
 */
export function hasSession(pluginId: string): boolean {
  const sessionDir = getSessionDir(pluginId);
  return existsSync(join(sessionDir, 'creds.json'));
}

/**
 * Clear a session directory to force re-authentication.
 * Next connect() will generate a new QR code.
 */
export async function clearSession(pluginId: string): Promise<void> {
  const sessionDir = getSessionDir(pluginId);
  if (existsSync(sessionDir)) {
    await rm(sessionDir, { recursive: true, force: true });
    log.info(`Cleared WhatsApp session for ${pluginId}`);
  }
}
