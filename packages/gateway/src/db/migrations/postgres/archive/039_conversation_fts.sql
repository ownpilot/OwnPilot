-- Migration 039: Add FTS5 search to conversations
-- Adds full-text search capability for conversation history

-- Enable FTS extension if not already
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add search_vector column to conversations
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- Create index for FTS search (GIN index for tsvector)
CREATE INDEX IF NOT EXISTS idx_conversations_search_vector ON conversations USING gin(search_vector);

-- Also add trigram index for ILIKE fallback searches on title
CREATE INDEX IF NOT EXISTS idx_conversations_title_trgm ON conversations USING gin(title gin_trgm_ops);

-- Trigger function to auto-update search_vector on insert/update
CREATE OR REPLACE FUNCTION conversations_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Combine title, agent_name, and metadata->'source' into search vector
  -- Use coalesce to handle nulls
  NEW.search_vector :=
    setweight(to_tsvector('english', COALESCE(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(NEW.agent_name, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(NEW.metadata->>'source', '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS trg_conversations_search_vector ON conversations;
CREATE TRIGGER trg_conversations_search_vector
  BEFORE INSERT OR UPDATE OF title, agent_name, metadata ON conversations
  FOR EACH ROW EXECUTE FUNCTION conversations_search_vector_update();

-- Backfill existing rows
UPDATE conversations SET
  search_vector :=
    setweight(to_tsvector('english', COALESCE(title, '')), 'A') ||
    setweight(to_tsvector('english', COALESCE(agent_name, '')), 'B') ||
    setweight(to_tsvector('english', COALESCE(metadata->>'source', '')), 'C')
WHERE search_vector IS NULL;