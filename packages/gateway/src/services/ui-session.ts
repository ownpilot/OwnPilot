/**
 * UI Session Service
 *
 * Password hashing + in-memory session store for web UI protection.
 * Uses settingsRepo for persistent password hash storage.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { settingsRepo } from '../db/repositories/settings.js';
import { getLog } from './log.js';

const log = getLog('UISession');

const SETTINGS_KEY = 'ui_password_hash';
const DEFAULT_SESSION_TTL_HOURS = 7 * 24; // 7 days
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SCRYPT_KEY_LENGTH = 64;

interface SessionInfo {
  token: string;
  createdAt: Date;
  expiresAt: Date;
}

// In-memory session store
const sessions = new Map<string, SessionInfo>();
let cleanupTimer: NodeJS.Timeout | null = null;

// ── Password Hashing ──────────────────────────────────────────────────────

/**
 * Hash a password using scrypt. Returns `salt:hash` in hex.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(32).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a password against a stored `salt:hash` string.
 * Uses timing-safe comparison.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [salt, storedHash] = stored.split(':');
  if (!salt || !storedHash) return false;

  const hashBuf = scryptSync(password, salt, SCRYPT_KEY_LENGTH);
  const storedBuf = Buffer.from(storedHash, 'hex');

  if (hashBuf.length !== storedBuf.length) return false;
  return timingSafeEqual(hashBuf, storedBuf);
}

// ── Session Management ────────────────────────────────────────────────────

function getSessionTtlMs(): number {
  const hours = parseInt(process.env.UI_SESSION_TTL_HOURS ?? String(DEFAULT_SESSION_TTL_HOURS), 10);
  return (Number.isNaN(hours) || hours <= 0 ? DEFAULT_SESSION_TTL_HOURS : hours) * 60 * 60 * 1000;
}

/**
 * Create a new session. Returns token and expiration.
 */
export function createSession(): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + getSessionTtlMs());

  sessions.set(token, { token, createdAt: now, expiresAt });
  log.info('Session created', { sessionCount: sessions.size });

  return { token, expiresAt };
}

/**
 * Validate a session token. Returns true if token exists and is not expired.
 */
export function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;

  if (session.expiresAt.getTime() < Date.now()) {
    sessions.delete(token);
    return false;
  }

  return true;
}

/**
 * Invalidate (remove) a single session.
 */
export function invalidateSession(token: string): void {
  sessions.delete(token);
}

/**
 * Invalidate all sessions (e.g. on password change/remove).
 */
export function invalidateAllSessions(): void {
  const count = sessions.size;
  sessions.clear();
  if (count > 0) {
    log.info('All sessions invalidated', { count });
  }
}

/**
 * Get the number of active (non-expired) sessions.
 */
export function getActiveSessionCount(): number {
  const now = Date.now();
  let count = 0;
  for (const session of sessions.values()) {
    if (session.expiresAt.getTime() > now) count++;
  }
  return count;
}

// ── Password Persistence ──────────────────────────────────────────────────

/**
 * Check if a UI password is configured (sync, from cache).
 */
export function isPasswordConfigured(): boolean {
  return settingsRepo.get<string>(SETTINGS_KEY) !== null;
}

/**
 * Get the stored password hash (sync, from cache).
 */
export function getPasswordHash(): string | null {
  return settingsRepo.get<string>(SETTINGS_KEY);
}

/**
 * Store a password hash in the database.
 */
export async function setPasswordHash(hash: string): Promise<void> {
  await settingsRepo.set(SETTINGS_KEY, hash);
}

/**
 * Remove the password and invalidate all sessions.
 */
export async function removePassword(): Promise<void> {
  await settingsRepo.delete(SETTINGS_KEY);
  invalidateAllSessions();
  log.info('UI password removed');
}

// ── Cleanup ───────────────────────────────────────────────────────────────

/**
 * Purge expired sessions from the in-memory store.
 */
export function purgeExpiredSessions(): number {
  const now = Date.now();
  let purged = 0;
  for (const [token, session] of sessions) {
    if (session.expiresAt.getTime() < now) {
      sessions.delete(token);
      purged++;
    }
  }
  if (purged > 0) {
    log.debug('Purged expired sessions', { purged, remaining: sessions.size });
  }
  return purged;
}

/**
 * Start hourly cleanup of expired sessions.
 */
export function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(purgeExpiredSessions, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

/**
 * Stop the cleanup timer.
 */
export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
