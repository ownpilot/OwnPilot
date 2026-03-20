-- Provider billing type migration
-- Adds billing type distinction: pay-per-use (API), subscription (flat fee), free (local/free tier)

-- Add billing columns to custom_providers
ALTER TABLE custom_providers ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'pay-per-use';
ALTER TABLE custom_providers ADD COLUMN IF NOT EXISTS subscription_cost_usd REAL;
ALTER TABLE custom_providers ADD COLUMN IF NOT EXISTS subscription_plan TEXT;
ALTER TABLE custom_providers ADD COLUMN IF NOT EXISTS billing_notes TEXT;

-- Set known free providers
UPDATE custom_providers SET billing_type = 'free'
WHERE provider_id IN ('local', 'ollama', 'lmstudio', 'localai', 'vllm')
  AND billing_type = 'pay-per-use';
