-- Memories: add content_hash column for deduplication fallback

ALTER TABLE memories ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Create index for efficient hash lookups
CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash) WHERE content_hash IS NOT NULL;

-- Backfill content_hash for existing memories
UPDATE memories
SET content_hash = encode(digest(lower(trim(content)), 'sha256'), 'hex')
WHERE content_hash IS NULL;
