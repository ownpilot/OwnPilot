-- Background Agents: add skills column for skill access

ALTER TABLE background_agents ADD COLUMN IF NOT EXISTS skills JSONB DEFAULT '[]'::jsonb;
