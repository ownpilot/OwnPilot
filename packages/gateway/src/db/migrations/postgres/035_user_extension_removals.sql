-- 035: User extension removals
-- Records explicit user removals so bundled/default skills are not reinstalled
-- by startup or manual directory scans after the user uninstalls them.

CREATE TABLE IF NOT EXISTS user_extension_removals (
  user_id TEXT NOT NULL,
  extension_id TEXT NOT NULL,
  source_path TEXT,
  removed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, extension_id)
);

CREATE INDEX IF NOT EXISTS idx_user_extension_removals_source
  ON user_extension_removals(user_id, source_path)
  WHERE source_path IS NOT NULL;
