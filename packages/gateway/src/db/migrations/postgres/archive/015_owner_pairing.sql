-- ============================================================
-- 015: Owner Pairing & System Settings
--
-- Adds a simple key-value store for system-level settings.
-- Used to persist:
--   - pairing_key          : one-time key shown at first boot
--   - owner_<platform>     : platformUserId of the claimed owner
--   - owner_chat_<platform>: platformChatId to send responses to
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
