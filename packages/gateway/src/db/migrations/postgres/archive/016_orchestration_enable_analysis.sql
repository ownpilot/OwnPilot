-- Orchestration runs: add enable_analysis column

ALTER TABLE orchestration_runs ADD COLUMN IF NOT EXISTS enable_analysis BOOLEAN NOT NULL DEFAULT TRUE;
