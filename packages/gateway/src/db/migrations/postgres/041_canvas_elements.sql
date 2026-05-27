-- Migration 041: Live Canvas elements
-- Agent-driven spatial visual workspace. The agent emits canvas operations
-- (add/update/move/remove/clear) via tools; the UI renders elements at their
-- (x, y) positions and updates live over the `canvas:op` WebSocket event.

CREATE TABLE IF NOT EXISTS canvas_elements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL DEFAULT 'main',
  type TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  x DOUBLE PRECISION NOT NULL DEFAULT 0,
  y DOUBLE PRECISION NOT NULL DEFAULT 0,
  w DOUBLE PRECISION NOT NULL DEFAULT 200,
  h DOUBLE PRECISION NOT NULL DEFAULT 120,
  z INTEGER NOT NULL DEFAULT 0,
  style TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_canvas_elements_user_canvas
  ON canvas_elements(user_id, canvas_id, z);
