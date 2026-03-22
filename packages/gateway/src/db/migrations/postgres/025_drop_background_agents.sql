-- Drop Background Agent tables (deprecated — functionality replaced by Claw Runtime)
-- Idempotent: safe to run on databases that already dropped these tables

DROP TABLE IF EXISTS background_agent_history;
DROP TABLE IF EXISTS background_agent_sessions;
DROP TABLE IF EXISTS background_agents;
