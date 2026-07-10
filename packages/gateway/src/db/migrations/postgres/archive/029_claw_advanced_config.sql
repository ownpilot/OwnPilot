-- Advanced Claw configuration: mission contracts, autonomy policies, and presets.

ALTER TABLE claws ADD COLUMN IF NOT EXISTS preset TEXT;
ALTER TABLE claws ADD COLUMN IF NOT EXISTS mission_contract JSONB DEFAULT '{}';
ALTER TABLE claws ADD COLUMN IF NOT EXISTS autonomy_policy JSONB DEFAULT '{}';

