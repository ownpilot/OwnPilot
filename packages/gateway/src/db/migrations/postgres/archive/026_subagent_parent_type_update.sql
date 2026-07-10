-- Update subagent parent_type constraint: 'background-agent' → 'claw'
-- Background agents removed in favor of Claw Runtime

-- Update existing rows
UPDATE subagent_history SET parent_type = 'claw' WHERE parent_type = 'background-agent';

-- Replace CHECK constraint (idempotent via DROP IF EXISTS + re-add)
ALTER TABLE subagent_history DROP CONSTRAINT IF EXISTS subagent_history_parent_type_check;
ALTER TABLE subagent_history ADD CONSTRAINT subagent_history_parent_type_check
  CHECK (parent_type IN ('chat', 'claw', 'subagent'));
