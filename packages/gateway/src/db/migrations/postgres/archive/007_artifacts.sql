-- Migration 007: Artifacts System (AI-generated interactive content with data bindings)

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  user_id TEXT NOT NULL DEFAULT 'default',
  type VARCHAR(20) NOT NULL CHECK (type IN ('html', 'svg', 'markdown', 'form', 'chart', 'react')),
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  data_bindings JSONB NOT NULL DEFAULT '[]',
  pinned BOOLEAN NOT NULL DEFAULT false,
  dashboard_position INTEGER,
  dashboard_size VARCHAR(10) NOT NULL DEFAULT 'medium' CHECK (dashboard_size IN ('small', 'medium', 'large', 'full')),
  version INTEGER NOT NULL DEFAULT 1,
  tags TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_user ON artifacts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_conversation ON artifacts(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_pinned ON artifacts(user_id, pinned) WHERE pinned = true;

CREATE TABLE IF NOT EXISTS artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  data_bindings JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact ON artifact_versions(artifact_id, version DESC);
