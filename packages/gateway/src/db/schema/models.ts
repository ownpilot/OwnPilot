/**
 * AI Models, Providers, Custom Tools, Config Center & Plugin Tables
 */

export const MODELS_TABLES_SQL = `
-- =====================================================
-- AI MODELS MANAGEMENT TABLES
-- =====================================================

-- User model configurations (overrides for models.dev data)
CREATE TABLE IF NOT EXISTS user_model_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  display_name TEXT,
  capabilities JSONB NOT NULL DEFAULT '[]',
  pricing_input REAL,
  pricing_output REAL,
  context_window INTEGER,
  max_output INTEGER,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider_id, model_id)
);

-- Custom providers (aggregators like fal.ai, together.ai, etc.)
CREATE TABLE IF NOT EXISTS custom_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  provider_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  api_base_url TEXT,
  api_key_setting TEXT,
  provider_type TEXT NOT NULL DEFAULT 'openai_compatible' CHECK(provider_type IN ('openai_compatible', 'custom')),
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider_id)
);

-- User provider configs (overrides for built-in providers - survives models.dev sync)
CREATE TABLE IF NOT EXISTS user_provider_configs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  provider_id TEXT NOT NULL,
  base_url TEXT,
  provider_type TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  api_key_env TEXT,
  notes TEXT,
  config JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider_id)
);

-- Custom Data table (for AI-created dynamic tools)
CREATE TABLE IF NOT EXISTS custom_data (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, key)
);

-- Custom Tools table (LLM-defined tools)
CREATE TABLE IF NOT EXISTS custom_tools (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  parameters JSONB NOT NULL DEFAULT '{}',
  code TEXT NOT NULL,
  category TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled', 'pending_approval', 'rejected')),
  permissions JSONB NOT NULL DEFAULT '[]',
  requires_approval BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT NOT NULL DEFAULT 'user' CHECK(created_by IN ('user', 'llm')),
  version INTEGER NOT NULL DEFAULT 1,
  metadata JSONB DEFAULT '{}',
  usage_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- =====================================================
-- CUSTOM DATA TABLES (AI-managed dynamic schemas)
-- =====================================================

-- Custom table schemas (metadata about AI-created tables)
CREATE TABLE IF NOT EXISTS custom_table_schemas (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  columns JSONB NOT NULL DEFAULT '[]',
  owner_plugin_id TEXT,
  is_protected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Custom data records (data stored in AI-created tables)
CREATE TABLE IF NOT EXISTS custom_data_records (
  id TEXT PRIMARY KEY,
  table_id TEXT NOT NULL REFERENCES custom_table_schemas(id) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- OAUTH INTEGRATIONS
-- =====================================================

-- OAuth integrations (Gmail, Google Calendar, Google Drive, etc.)
CREATE TABLE IF NOT EXISTS oauth_integrations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  provider TEXT NOT NULL,
  service TEXT NOT NULL,
  access_token_encrypted TEXT NOT NULL,
  refresh_token_encrypted TEXT,
  token_iv TEXT NOT NULL,
  expires_at TIMESTAMP,
  scopes JSONB NOT NULL DEFAULT '[]',
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'expired', 'revoked', 'error')),
  last_sync_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, provider, service)
);

-- =============================================================================
-- Config Center tables (replaces api_services)
-- =============================================================================
CREATE TABLE IF NOT EXISTS config_services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  description TEXT,
  docs_url TEXT,
  config_schema JSONB NOT NULL DEFAULT '[]',
  multi_entry BOOLEAN NOT NULL DEFAULT FALSE,
  required_by JSONB DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_config_services_name ON config_services(name);
CREATE INDEX IF NOT EXISTS idx_config_services_category ON config_services(category);
CREATE INDEX IF NOT EXISTS idx_config_services_active ON config_services(is_active);

CREATE TABLE IF NOT EXISTS config_entries (
  id TEXT PRIMARY KEY,
  service_name TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Default',
  data JSONB NOT NULL DEFAULT '{}',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_config_entries_service ON config_entries(service_name);
CREATE INDEX IF NOT EXISTS idx_config_entries_active ON config_entries(is_active);
CREATE UNIQUE INDEX IF NOT EXISTS idx_config_entries_default
  ON config_entries(service_name) WHERE is_default = TRUE;

-- =====================================================
-- PLUGIN STATE PERSISTENCE
-- =====================================================
CREATE TABLE IF NOT EXISTS plugins (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1.0.0',
  status TEXT NOT NULL DEFAULT 'enabled'
    CHECK(status IN ('enabled', 'disabled', 'error')),
  settings JSONB NOT NULL DEFAULT '{}',
  granted_permissions JSONB NOT NULL DEFAULT '[]',
  error_message TEXT,
  installed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =====================================================
-- LOCAL AI PROVIDERS
-- =====================================================

CREATE TABLE IF NOT EXISTS local_providers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL CHECK(provider_type IN ('lmstudio', 'ollama', 'localai', 'vllm', 'custom')),
  base_url TEXT NOT NULL,
  api_key TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  discovery_endpoint TEXT,
  last_discovered_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS local_models (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  local_provider_id TEXT NOT NULL REFERENCES local_providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  capabilities JSONB NOT NULL DEFAULT '["chat", "streaming"]',
  context_window INTEGER DEFAULT 32768,
  max_output INTEGER DEFAULT 4096,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, local_provider_id, model_id)
);
`;

export const MODELS_MIGRATIONS_SQL = `
-- =====================================================
-- MODEL & PROVIDER CONFIG MIGRATIONS
-- =====================================================

-- User model configs: ensure 'is_enabled' column exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_model_configs' AND column_name = 'is_enabled') THEN
    ALTER TABLE user_model_configs ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- Custom providers: ensure 'is_enabled' column exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_providers' AND column_name = 'is_enabled') THEN
    ALTER TABLE custom_providers ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- User provider configs: ensure 'is_enabled' column exists
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_provider_configs' AND column_name = 'is_enabled') THEN
    ALTER TABLE user_provider_configs ADD COLUMN is_enabled BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- =====================================================
-- CUSTOM TOOLS TABLE MIGRATIONS
-- Handles both old schema (implementation, enabled) and new schema (code, status)
-- =====================================================

-- Custom tools: Add 'code' column (new name for 'implementation')
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'code') THEN
    -- Check if old 'implementation' column exists to migrate data
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'implementation') THEN
      ALTER TABLE custom_tools ADD COLUMN code TEXT;
      UPDATE custom_tools SET code = implementation;
      ALTER TABLE custom_tools ALTER COLUMN code SET NOT NULL;
    ELSE
      ALTER TABLE custom_tools ADD COLUMN code TEXT NOT NULL DEFAULT '';
    END IF;
  END IF;
END $$;

-- Custom tools: Add 'category' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'category') THEN
    ALTER TABLE custom_tools ADD COLUMN category TEXT;
  END IF;
END $$;

-- Custom tools: Add 'status' column (new name for 'enabled')
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'status') THEN
    ALTER TABLE custom_tools ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
    -- Migrate from 'enabled' column if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'enabled') THEN
      UPDATE custom_tools SET status = CASE WHEN enabled = TRUE THEN 'active' ELSE 'disabled' END;
    END IF;
  END IF;
END $$;

-- Custom tools: Add 'permissions' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'permissions') THEN
    ALTER TABLE custom_tools ADD COLUMN permissions JSONB NOT NULL DEFAULT '[]';
  END IF;
END $$;

-- Custom tools: Add 'requires_approval' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'requires_approval') THEN
    ALTER TABLE custom_tools ADD COLUMN requires_approval BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

-- Custom tools: Add 'created_by' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'created_by') THEN
    ALTER TABLE custom_tools ADD COLUMN created_by TEXT NOT NULL DEFAULT 'user';
    -- Migrate from 'source' column if it exists
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'source') THEN
      UPDATE custom_tools SET created_by = COALESCE(source, 'user');
    END IF;
  END IF;
END $$;

-- Custom tools: Add 'version' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'version') THEN
    ALTER TABLE custom_tools ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  END IF;
END $$;

-- Custom tools: Add 'metadata' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'metadata') THEN
    ALTER TABLE custom_tools ADD COLUMN metadata JSONB DEFAULT '{}';
  END IF;
END $$;

-- Custom tools: Add 'usage_count' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'usage_count') THEN
    ALTER TABLE custom_tools ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Custom tools: Add 'last_used_at' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'last_used_at') THEN
    ALTER TABLE custom_tools ADD COLUMN last_used_at TIMESTAMP;
  END IF;
END $$;

-- =====================================================
-- API CENTER: DEMAND-DRIVEN DEPENDENCIES
-- =====================================================

-- Custom tools: Add 'required_api_keys' column
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_tools' AND column_name = 'required_api_keys') THEN
    ALTER TABLE custom_tools ADD COLUMN required_api_keys JSONB DEFAULT '[]';
  END IF;
END $$;

-- API services: Add 'required_by' column (only if api_services still exists before migration)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'api_services') THEN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'api_services' AND column_name = 'required_by') THEN
      ALTER TABLE api_services ADD COLUMN required_by JSONB DEFAULT '[]';
    END IF;
  END IF;
END $$;

-- Migrate data from api_services to config_services (if api_services exists)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'api_services') THEN
    -- Migrate service definitions
    INSERT INTO config_services (id, name, display_name, category, description, docs_url, config_schema, multi_entry, required_by, is_active, created_at, updated_at)
    SELECT
      id, name, display_name, category, description, docs_url,
      jsonb_build_array(
        jsonb_build_object('name', 'api_key', 'label', 'API Key', 'type', 'secret', 'required', false, 'envVar', COALESCE(env_var_name, ''), 'order', 0),
        jsonb_build_object('name', 'base_url', 'label', 'Base URL', 'type', 'url', 'required', false, 'order', 1)
      ),
      false,
      COALESCE(required_by, '[]'::jsonb),
      is_active,
      created_at,
      updated_at
    FROM api_services
    ON CONFLICT(name) DO NOTHING;

    -- Migrate entries (api_key + base_url + extra_config values)
    INSERT INTO config_entries (id, service_name, label, data, is_default, is_active, created_at, updated_at)
    SELECT
      gen_random_uuid()::text,
      name,
      'Default',
      jsonb_strip_nulls(jsonb_build_object('api_key', api_key, 'base_url', base_url) || COALESCE(extra_config, '{}'::jsonb)),
      true,
      is_active,
      created_at,
      updated_at
    FROM api_services
    WHERE api_key IS NOT NULL OR base_url IS NOT NULL OR (extra_config IS NOT NULL AND extra_config != '{}'::jsonb)
    ON CONFLICT DO NOTHING;

    -- Drop old table
    DROP TABLE api_services;
  END IF;
END $$;

-- =====================================================
-- CUSTOM TABLE SCHEMAS: Plugin ownership
-- =====================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_table_schemas' AND column_name = 'owner_plugin_id') THEN
    ALTER TABLE custom_table_schemas ADD COLUMN owner_plugin_id TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'custom_table_schemas' AND column_name = 'is_protected') THEN
    ALTER TABLE custom_table_schemas ADD COLUMN is_protected BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;
`;

export const MODELS_INDEXES_SQL = `
-- OAuth indexes
CREATE INDEX IF NOT EXISTS idx_oauth_integrations_user ON oauth_integrations(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_integrations_provider ON oauth_integrations(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_oauth_integrations_service ON oauth_integrations(user_id, provider, service);
CREATE INDEX IF NOT EXISTS idx_oauth_integrations_status ON oauth_integrations(status);

-- AI Models management indexes
CREATE INDEX IF NOT EXISTS idx_user_model_configs_user ON user_model_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_model_configs_provider ON user_model_configs(user_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_user_model_configs_enabled ON user_model_configs(is_enabled);
CREATE INDEX IF NOT EXISTS idx_custom_providers_user ON custom_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_providers_enabled ON custom_providers(is_enabled);
CREATE INDEX IF NOT EXISTS idx_user_provider_configs_user ON user_provider_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_provider_configs_provider ON user_provider_configs(user_id, provider_id);
CREATE INDEX IF NOT EXISTS idx_user_provider_configs_enabled ON user_provider_configs(is_enabled);

-- Custom data indexes
CREATE INDEX IF NOT EXISTS idx_custom_data_user ON custom_data(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_data_key ON custom_data(user_id, key);

-- Custom tools indexes
CREATE INDEX IF NOT EXISTS idx_custom_tools_user ON custom_tools(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_tools_name ON custom_tools(user_id, name);
CREATE INDEX IF NOT EXISTS idx_custom_tools_status ON custom_tools(status);
CREATE INDEX IF NOT EXISTS idx_custom_tools_created_by ON custom_tools(created_by);
CREATE INDEX IF NOT EXISTS idx_custom_tools_category ON custom_tools(category);

-- Custom table schemas indexes
CREATE INDEX IF NOT EXISTS idx_custom_table_schemas_name ON custom_table_schemas(name);
CREATE INDEX IF NOT EXISTS idx_custom_table_schemas_owner ON custom_table_schemas(owner_plugin_id);
CREATE INDEX IF NOT EXISTS idx_custom_table_schemas_protected ON custom_table_schemas(is_protected);
CREATE INDEX IF NOT EXISTS idx_custom_data_records_table ON custom_data_records(table_id);

-- Local AI Providers indexes
CREATE INDEX IF NOT EXISTS idx_local_providers_user ON local_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_local_providers_enabled ON local_providers(is_enabled);
CREATE INDEX IF NOT EXISTS idx_local_providers_default ON local_providers(is_default);
CREATE INDEX IF NOT EXISTS idx_local_models_provider ON local_models(local_provider_id);
CREATE INDEX IF NOT EXISTS idx_local_models_enabled ON local_models(is_enabled);
`;
