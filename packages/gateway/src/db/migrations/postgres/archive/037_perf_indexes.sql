-- 037_perf_indexes.sql
-- Hot-path indexes for the trigger dispatch loop and channel message queries.
--
-- The original migration also created idx_fleet_tasks_fleet_status, but the
-- fleet system was dropped in migration 038, so only trigger + channel-message
-- indexes remain here.

-- TriggersRepository.getDueTriggers() runs:
-- WHERE user_id = $1 AND enabled = true AND type = 'schedule'
--   AND next_fire IS NOT NULL AND next_fire <= $2
-- The existing idx_triggers_next_fire(next_fire) full-column index also
-- contains disabled / non-schedule / never-scheduled rows. A partial
-- index keeps only candidates, shrinking the polling scan dramatically
-- as users accumulate disabled or event-type triggers.
CREATE INDEX IF NOT EXISTS idx_triggers_due
  ON triggers(user_id, next_fire)
  WHERE enabled = true AND type = 'schedule' AND next_fire IS NOT NULL;

-- ChannelMessagesRepository hot queries:
--   getByChannel / getRecent / getAll({channelId}) — every Inbox page load:
--     WHERE channel_id = $1 ORDER BY created_at DESC LIMIT/OFFSET
--   getByConversation — every chat-thread render:
--     WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT/OFFSET
-- Existing indexes are (channel_id) and (created_at) separately, and
-- conversation_id has no index at all. The composites match the ORDER BY
-- so Postgres returns rows in index order without a sort step.
CREATE INDEX IF NOT EXISTS idx_channel_messages_channel_created
  ON channel_messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_messages_conversation_created
  ON channel_messages(conversation_id, created_at)
  WHERE conversation_id IS NOT NULL;
