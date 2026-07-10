-- Migration 040: DM Pairing Security
-- Adds pending-sender verification flow for DMs from unknown senders.
-- Flow: unknown DM → bot replies with 6-digit code → owner approves via dashboard

-- Add status column to channel_users for pending trust flow
ALTER TABLE channel_users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- dm_pairing_requests: stores pending 6-digit codes for non-owner DMs
CREATE TABLE IF NOT EXISTS dm_pairing_requests (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  used_at TIMESTAMP,
  UNIQUE(platform, platform_user_id, code)
);

CREATE INDEX IF NOT EXISTS idx_dm_pairing_code
  ON dm_pairing_requests(code, platform);