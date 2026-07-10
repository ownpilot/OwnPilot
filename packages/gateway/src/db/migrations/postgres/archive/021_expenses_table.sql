-- Expenses table — migrated from file-based JSON to PostgreSQL
-- Previously stored in ~/.ownpilot/expenses.json

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  date TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'TRY',
  category TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  payment_method TEXT,
  tags JSONB DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual',
  receipt_image TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expenses_user_date ON expenses(user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_user_category ON expenses(user_id, category);
