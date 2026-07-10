-- Add job queue + provider_metrics tables to existing installs
-- Job queue (ADR-001): persistent task queue with FOR UPDATE SKIP LOCKED
-- Provider metrics (gap 24.4): telemetry-based routing

-- =====================================================
-- Jobs table
-- =====================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'jobs') THEN
    CREATE TABLE jobs (
      id              TEXT        PRIMARY KEY,
      name            TEXT        NOT NULL,
      queue           TEXT        NOT NULL DEFAULT 'default',
      priority        INTEGER     NOT NULL DEFAULT 0,
      payload         JSONB       NOT NULL DEFAULT '{}',
      result          JSONB,
      status          TEXT        NOT NULL DEFAULT 'available'
                       CHECK(status IN ('available', 'active', 'completed', 'failed', 'cancelled')),
      run_after       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at      TIMESTAMPTZ,
      completed_at    TIMESTAMPTZ,
      attempts        INTEGER     NOT NULL DEFAULT 0,
      max_attempts    INTEGER     NOT NULL DEFAULT 3,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT jobs_attempts_check CHECK (attempts <= max_attempts)
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'job_history') THEN
    CREATE TABLE job_history (
      id              TEXT        PRIMARY KEY,
      job_id          TEXT        NOT NULL,
      job_name        TEXT        NOT NULL,
      queue           TEXT        NOT NULL,
      payload         JSONB       NOT NULL,
      result          JSONB,
      status          TEXT        NOT NULL,
      attempt         INTEGER     NOT NULL,
      max_attempts    INTEGER     NOT NULL,
      failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      error           TEXT
    );
  END IF;
END $$;

-- =====================================================
-- Provider metrics table (gap 24.4)
-- =====================================================
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'provider_metrics') THEN
    CREATE TABLE provider_metrics (
      id                  TEXT        PRIMARY KEY,
      provider_id         TEXT        NOT NULL,
      model_id            TEXT        NOT NULL,
      recorded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      latency_ms          REAL        NOT NULL,
      error               BOOLEAN     NOT NULL DEFAULT FALSE,
      error_type          TEXT,
      prompt_tokens       INTEGER,
      completion_tokens   INTEGER,
      cost_usd            REAL,
      workflow_id         TEXT,
      agent_id            TEXT,
      user_id             TEXT
    );
  END IF;
END $$;

-- =====================================================
-- Indexes (idempotent)
-- =====================================================

-- Job queue indexes
CREATE INDEX IF NOT EXISTS idx_jobs_priority_status_run_after ON jobs(priority DESC, status, run_after) WHERE status = 'available';
CREATE INDEX IF NOT EXISTS idx_jobs_name_queue ON jobs(name, queue);
CREATE INDEX IF NOT EXISTS idx_job_history_job_id ON job_history(job_id);
CREATE INDEX IF NOT EXISTS idx_job_history_failed_at ON job_history(failed_at);

-- Provider metrics indexes
CREATE INDEX IF NOT EXISTS idx_provider_metrics_provider_model ON provider_metrics(provider_id, model_id);
CREATE INDEX IF NOT EXISTS idx_provider_metrics_recorded_at ON provider_metrics(recorded_at DESC);
-- Removed: idx_provider_metrics_recent — `WHERE recorded_at > NOW() - INTERVAL '1 hour'`
-- is invalid as a partial-index predicate because NOW() is STABLE, not IMMUTABLE.
-- Even if accepted, the predicate would be evaluated at INSERT time (not query
-- time), so it would index ~nothing. The recorded_at DESC index above already
-- serves "recent rows" lookups efficiently.