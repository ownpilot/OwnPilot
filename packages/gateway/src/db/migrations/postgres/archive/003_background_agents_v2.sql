-- Background Agents v2: add provider, model, and workspace_id columns

ALTER TABLE background_agents ADD COLUMN IF NOT EXISTS provider TEXT;
ALTER TABLE background_agents ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE background_agents ADD COLUMN IF NOT EXISTS workspace_id TEXT;
