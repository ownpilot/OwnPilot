-- Autonomy log: add signal_ids and urgency_score columns

ALTER TABLE autonomy_log ADD COLUMN IF NOT EXISTS signal_ids JSONB NOT NULL DEFAULT '[]';
ALTER TABLE autonomy_log ADD COLUMN IF NOT EXISTS urgency_score REAL NOT NULL DEFAULT 0;
