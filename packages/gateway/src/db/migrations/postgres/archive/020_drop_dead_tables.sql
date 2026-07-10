-- Drop unused tables that have zero code references.
-- projects: was never implemented (no repo, no routes, no tools)
-- reminders: overlaps with triggers system, never implemented

DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS reminders;
