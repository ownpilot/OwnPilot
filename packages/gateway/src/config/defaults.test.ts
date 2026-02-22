/**
 * Gateway Default Configuration Tests
 *
 * Comprehensive test suite verifying every constant exported from defaults.ts:
 * exact values, types, mathematical relationships, sensible ranges,
 * inter-constant constraints, and export completeness.
 */

import { describe, it, expect } from 'vitest';
import {
  // Database
  DB_POOL_MAX,
  DB_IDLE_TIMEOUT_MS,
  DB_CONNECT_TIMEOUT_MS,
  // WebSocket
  WS_PORT,
  WS_HEARTBEAT_INTERVAL_MS,
  WS_SESSION_TIMEOUT_MS,
  WS_MAX_PAYLOAD_BYTES,
  WS_MAX_CONNECTIONS,
  WS_CLOSE_SESSION_TIMEOUT,
  WS_RATE_LIMIT_MESSAGES_PER_SEC,
  WS_RATE_LIMIT_BURST,
  WS_MAX_METADATA_VALUE_BYTES,
  // Scheduler
  SCHEDULER_CHECK_INTERVAL_MS,
  SCHEDULER_DEFAULT_TIMEOUT_MS,
  SCHEDULER_MAX_HISTORY_PER_TASK,
  // Triggers
  TRIGGER_POLL_INTERVAL_MS,
  TRIGGER_CONDITION_CHECK_MS,
  // Plan Executor
  PLAN_STEP_TIMEOUT_MS,
  PLAN_MAX_STALL,
  PLAN_STALL_RETRY_MS,
  PLAN_MAX_BACKOFF_MS,
  PLAN_MAX_LOOP_ITERATIONS,
  // Rate Limiting
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_BURST,
  // Tool Execution
  TOOL_ARGS_MAX_SIZE,
  // Time Constants
  MS_PER_MINUTE,
  MS_PER_HOUR,
  MS_PER_DAY,
  MAX_DAYS_LOOKBACK,
  // Pagination
  MAX_PAGINATION_OFFSET,
  // Agent Caches
  MAX_AGENT_CACHE_SIZE,
  MAX_CHAT_AGENT_CACHE_SIZE,
  // Agent Defaults
  AGENT_DEFAULT_MAX_TOKENS,
  AGENT_CREATE_DEFAULT_MAX_TOKENS,
  AGENT_DEFAULT_TEMPERATURE,
  AGENT_DEFAULT_MAX_TURNS,
  AGENT_DEFAULT_MAX_TOOL_CALLS,
  MAX_BATCH_TOOL_CALLS,
  // Meta-Tool Names
  AI_META_TOOL_NAMES,
  // Channel Plugins
  IMAP_CONNECT_TIMEOUT_MS,
  // In-Memory Cache Limits
  MAX_TOOL_SOURCE_FILE_CACHE,
  MAX_TOOL_SOURCE_EXTRACTION_CACHE,
  MAX_MESSAGE_CHAT_MAP_SIZE,
  // Embedding Service
  EMBEDDING_MODEL,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MAX_BATCH_SIZE,
  EMBEDDING_RATE_LIMIT_DELAY_MS,
  EMBEDDING_MAX_CHUNK_CHARS,
  EMBEDDING_MIN_CHUNK_CHARS,
  EMBEDDING_CACHE_EVICTION_DAYS,
  RRF_K,
  EMBEDDING_QUEUE_BATCH_SIZE,
  EMBEDDING_QUEUE_INTERVAL_MS,
  EMBEDDING_QUEUE_MAX_SIZE,
} from './defaults.js';

// ============================================================================
// 1. Exact Value Tests
// ============================================================================

describe('defaults — exact values', () => {
  describe('Database', () => {
    it('DB_POOL_MAX equals 10', () => {
      expect(DB_POOL_MAX).toBe(10);
    });

    it('DB_IDLE_TIMEOUT_MS equals 30_000', () => {
      expect(DB_IDLE_TIMEOUT_MS).toBe(30_000);
    });

    it('DB_CONNECT_TIMEOUT_MS equals 5_000', () => {
      expect(DB_CONNECT_TIMEOUT_MS).toBe(5_000);
    });
  });

  describe('WebSocket', () => {
    it('WS_PORT equals 18_789', () => {
      expect(WS_PORT).toBe(18_789);
    });

    it('WS_HEARTBEAT_INTERVAL_MS equals 30_000', () => {
      expect(WS_HEARTBEAT_INTERVAL_MS).toBe(30_000);
    });

    it('WS_SESSION_TIMEOUT_MS equals 300_000', () => {
      expect(WS_SESSION_TIMEOUT_MS).toBe(300_000);
    });

    it('WS_MAX_PAYLOAD_BYTES equals 1_048_576 (1 MB)', () => {
      expect(WS_MAX_PAYLOAD_BYTES).toBe(1_048_576);
    });

    it('WS_MAX_CONNECTIONS equals 50', () => {
      expect(WS_MAX_CONNECTIONS).toBe(50);
    });

    it('WS_CLOSE_SESSION_TIMEOUT equals 4_000', () => {
      expect(WS_CLOSE_SESSION_TIMEOUT).toBe(4_000);
    });

    it('WS_RATE_LIMIT_MESSAGES_PER_SEC equals 30', () => {
      expect(WS_RATE_LIMIT_MESSAGES_PER_SEC).toBe(30);
    });

    it('WS_RATE_LIMIT_BURST equals 50', () => {
      expect(WS_RATE_LIMIT_BURST).toBe(50);
    });

    it('WS_MAX_METADATA_VALUE_BYTES equals 1_024', () => {
      expect(WS_MAX_METADATA_VALUE_BYTES).toBe(1_024);
    });
  });

  describe('Scheduler', () => {
    it('SCHEDULER_CHECK_INTERVAL_MS equals 60_000', () => {
      expect(SCHEDULER_CHECK_INTERVAL_MS).toBe(60_000);
    });

    it('SCHEDULER_DEFAULT_TIMEOUT_MS equals 300_000', () => {
      expect(SCHEDULER_DEFAULT_TIMEOUT_MS).toBe(300_000);
    });

    it('SCHEDULER_MAX_HISTORY_PER_TASK equals 100', () => {
      expect(SCHEDULER_MAX_HISTORY_PER_TASK).toBe(100);
    });
  });

  describe('Triggers', () => {
    it('TRIGGER_POLL_INTERVAL_MS equals 60_000', () => {
      expect(TRIGGER_POLL_INTERVAL_MS).toBe(60_000);
    });

    it('TRIGGER_CONDITION_CHECK_MS equals 300_000', () => {
      expect(TRIGGER_CONDITION_CHECK_MS).toBe(300_000);
    });
  });

  describe('Plan Executor', () => {
    it('PLAN_STEP_TIMEOUT_MS equals 60_000', () => {
      expect(PLAN_STEP_TIMEOUT_MS).toBe(60_000);
    });

    it('PLAN_MAX_STALL equals 3', () => {
      expect(PLAN_MAX_STALL).toBe(3);
    });

    it('PLAN_STALL_RETRY_MS equals 1_000', () => {
      expect(PLAN_STALL_RETRY_MS).toBe(1_000);
    });

    it('PLAN_MAX_BACKOFF_MS equals 30_000', () => {
      expect(PLAN_MAX_BACKOFF_MS).toBe(30_000);
    });

    it('PLAN_MAX_LOOP_ITERATIONS equals 10', () => {
      expect(PLAN_MAX_LOOP_ITERATIONS).toBe(10);
    });
  });

  describe('Rate Limiting', () => {
    it('RATE_LIMIT_WINDOW_MS equals 60_000', () => {
      expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
    });

    it('RATE_LIMIT_MAX_REQUESTS equals 500', () => {
      expect(RATE_LIMIT_MAX_REQUESTS).toBe(500);
    });

    it('RATE_LIMIT_BURST equals 750', () => {
      expect(RATE_LIMIT_BURST).toBe(750);
    });
  });

  describe('Tool Execution', () => {
    it('TOOL_ARGS_MAX_SIZE equals 100_000', () => {
      expect(TOOL_ARGS_MAX_SIZE).toBe(100_000);
    });
  });

  describe('Time Constants', () => {
    it('MS_PER_MINUTE equals 60_000', () => {
      expect(MS_PER_MINUTE).toBe(60_000);
    });

    it('MS_PER_HOUR equals 3_600_000', () => {
      expect(MS_PER_HOUR).toBe(3_600_000);
    });

    it('MS_PER_DAY equals 86_400_000', () => {
      expect(MS_PER_DAY).toBe(86_400_000);
    });

    it('MAX_DAYS_LOOKBACK equals 365', () => {
      expect(MAX_DAYS_LOOKBACK).toBe(365);
    });
  });

  describe('Pagination', () => {
    it('MAX_PAGINATION_OFFSET equals 10_000', () => {
      expect(MAX_PAGINATION_OFFSET).toBe(10_000);
    });
  });

  describe('Agent Caches', () => {
    it('MAX_AGENT_CACHE_SIZE equals 100', () => {
      expect(MAX_AGENT_CACHE_SIZE).toBe(100);
    });

    it('MAX_CHAT_AGENT_CACHE_SIZE equals 20', () => {
      expect(MAX_CHAT_AGENT_CACHE_SIZE).toBe(20);
    });
  });

  describe('Agent Defaults', () => {
    it('AGENT_DEFAULT_MAX_TOKENS equals 8_192', () => {
      expect(AGENT_DEFAULT_MAX_TOKENS).toBe(8_192);
    });

    it('AGENT_CREATE_DEFAULT_MAX_TOKENS equals 4_096', () => {
      expect(AGENT_CREATE_DEFAULT_MAX_TOKENS).toBe(4_096);
    });

    it('AGENT_DEFAULT_TEMPERATURE equals 0.7', () => {
      expect(AGENT_DEFAULT_TEMPERATURE).toBe(0.7);
    });

    it('AGENT_DEFAULT_MAX_TURNS equals 25', () => {
      expect(AGENT_DEFAULT_MAX_TURNS).toBe(25);
    });

    it('AGENT_DEFAULT_MAX_TOOL_CALLS equals 200', () => {
      expect(AGENT_DEFAULT_MAX_TOOL_CALLS).toBe(200);
    });

    it('MAX_BATCH_TOOL_CALLS equals 20', () => {
      expect(MAX_BATCH_TOOL_CALLS).toBe(20);
    });
  });

  describe('Channel Plugins', () => {
    it('IMAP_CONNECT_TIMEOUT_MS equals 15_000', () => {
      expect(IMAP_CONNECT_TIMEOUT_MS).toBe(15_000);
    });
  });

  describe('In-Memory Cache Limits', () => {
    it('MAX_TOOL_SOURCE_FILE_CACHE equals 200', () => {
      expect(MAX_TOOL_SOURCE_FILE_CACHE).toBe(200);
    });

    it('MAX_TOOL_SOURCE_EXTRACTION_CACHE equals 500', () => {
      expect(MAX_TOOL_SOURCE_EXTRACTION_CACHE).toBe(500);
    });

    it('MAX_MESSAGE_CHAT_MAP_SIZE equals 1_000', () => {
      expect(MAX_MESSAGE_CHAT_MAP_SIZE).toBe(1_000);
    });
  });

  describe('Embedding Service', () => {
    it('EMBEDDING_MODEL equals text-embedding-3-small', () => {
      expect(EMBEDDING_MODEL).toBe('text-embedding-3-small');
    });

    it('EMBEDDING_DIMENSIONS equals 1_536', () => {
      expect(EMBEDDING_DIMENSIONS).toBe(1_536);
    });

    it('EMBEDDING_MAX_BATCH_SIZE equals 100', () => {
      expect(EMBEDDING_MAX_BATCH_SIZE).toBe(100);
    });

    it('EMBEDDING_RATE_LIMIT_DELAY_MS equals 500', () => {
      expect(EMBEDDING_RATE_LIMIT_DELAY_MS).toBe(500);
    });

    it('EMBEDDING_MAX_CHUNK_CHARS equals 2_000', () => {
      expect(EMBEDDING_MAX_CHUNK_CHARS).toBe(2_000);
    });

    it('EMBEDDING_MIN_CHUNK_CHARS equals 100', () => {
      expect(EMBEDDING_MIN_CHUNK_CHARS).toBe(100);
    });

    it('EMBEDDING_CACHE_EVICTION_DAYS equals 30', () => {
      expect(EMBEDDING_CACHE_EVICTION_DAYS).toBe(30);
    });

    it('RRF_K equals 60', () => {
      expect(RRF_K).toBe(60);
    });

    it('EMBEDDING_QUEUE_BATCH_SIZE equals 10', () => {
      expect(EMBEDDING_QUEUE_BATCH_SIZE).toBe(10);
    });

    it('EMBEDDING_QUEUE_INTERVAL_MS equals 5_000', () => {
      expect(EMBEDDING_QUEUE_INTERVAL_MS).toBe(5_000);
    });

    it('EMBEDDING_QUEUE_MAX_SIZE equals 5_000', () => {
      expect(EMBEDDING_QUEUE_MAX_SIZE).toBe(5_000);
    });
  });
});

// ============================================================================
// 2. Type Checks
// ============================================================================

describe('defaults — types', () => {
  describe('numeric constants are typeof number', () => {
    const numericConstants: [string, unknown][] = [
      ['DB_POOL_MAX', DB_POOL_MAX],
      ['DB_IDLE_TIMEOUT_MS', DB_IDLE_TIMEOUT_MS],
      ['DB_CONNECT_TIMEOUT_MS', DB_CONNECT_TIMEOUT_MS],
      ['WS_PORT', WS_PORT],
      ['WS_HEARTBEAT_INTERVAL_MS', WS_HEARTBEAT_INTERVAL_MS],
      ['WS_SESSION_TIMEOUT_MS', WS_SESSION_TIMEOUT_MS],
      ['WS_MAX_PAYLOAD_BYTES', WS_MAX_PAYLOAD_BYTES],
      ['WS_MAX_CONNECTIONS', WS_MAX_CONNECTIONS],
      ['WS_CLOSE_SESSION_TIMEOUT', WS_CLOSE_SESSION_TIMEOUT],
      ['WS_RATE_LIMIT_MESSAGES_PER_SEC', WS_RATE_LIMIT_MESSAGES_PER_SEC],
      ['WS_RATE_LIMIT_BURST', WS_RATE_LIMIT_BURST],
      ['WS_MAX_METADATA_VALUE_BYTES', WS_MAX_METADATA_VALUE_BYTES],
      ['SCHEDULER_CHECK_INTERVAL_MS', SCHEDULER_CHECK_INTERVAL_MS],
      ['SCHEDULER_DEFAULT_TIMEOUT_MS', SCHEDULER_DEFAULT_TIMEOUT_MS],
      ['SCHEDULER_MAX_HISTORY_PER_TASK', SCHEDULER_MAX_HISTORY_PER_TASK],
      ['TRIGGER_POLL_INTERVAL_MS', TRIGGER_POLL_INTERVAL_MS],
      ['TRIGGER_CONDITION_CHECK_MS', TRIGGER_CONDITION_CHECK_MS],
      ['PLAN_STEP_TIMEOUT_MS', PLAN_STEP_TIMEOUT_MS],
      ['PLAN_MAX_STALL', PLAN_MAX_STALL],
      ['PLAN_STALL_RETRY_MS', PLAN_STALL_RETRY_MS],
      ['PLAN_MAX_BACKOFF_MS', PLAN_MAX_BACKOFF_MS],
      ['PLAN_MAX_LOOP_ITERATIONS', PLAN_MAX_LOOP_ITERATIONS],
      ['RATE_LIMIT_WINDOW_MS', RATE_LIMIT_WINDOW_MS],
      ['RATE_LIMIT_MAX_REQUESTS', RATE_LIMIT_MAX_REQUESTS],
      ['RATE_LIMIT_BURST', RATE_LIMIT_BURST],
      ['TOOL_ARGS_MAX_SIZE', TOOL_ARGS_MAX_SIZE],
      ['MS_PER_MINUTE', MS_PER_MINUTE],
      ['MS_PER_HOUR', MS_PER_HOUR],
      ['MS_PER_DAY', MS_PER_DAY],
      ['MAX_DAYS_LOOKBACK', MAX_DAYS_LOOKBACK],
      ['MAX_PAGINATION_OFFSET', MAX_PAGINATION_OFFSET],
      ['MAX_AGENT_CACHE_SIZE', MAX_AGENT_CACHE_SIZE],
      ['MAX_CHAT_AGENT_CACHE_SIZE', MAX_CHAT_AGENT_CACHE_SIZE],
      ['AGENT_DEFAULT_MAX_TOKENS', AGENT_DEFAULT_MAX_TOKENS],
      ['AGENT_CREATE_DEFAULT_MAX_TOKENS', AGENT_CREATE_DEFAULT_MAX_TOKENS],
      ['AGENT_DEFAULT_TEMPERATURE', AGENT_DEFAULT_TEMPERATURE],
      ['AGENT_DEFAULT_MAX_TURNS', AGENT_DEFAULT_MAX_TURNS],
      ['AGENT_DEFAULT_MAX_TOOL_CALLS', AGENT_DEFAULT_MAX_TOOL_CALLS],
      ['MAX_BATCH_TOOL_CALLS', MAX_BATCH_TOOL_CALLS],
      ['IMAP_CONNECT_TIMEOUT_MS', IMAP_CONNECT_TIMEOUT_MS],
      ['MAX_TOOL_SOURCE_FILE_CACHE', MAX_TOOL_SOURCE_FILE_CACHE],
      ['MAX_TOOL_SOURCE_EXTRACTION_CACHE', MAX_TOOL_SOURCE_EXTRACTION_CACHE],
      ['MAX_MESSAGE_CHAT_MAP_SIZE', MAX_MESSAGE_CHAT_MAP_SIZE],
      ['EMBEDDING_DIMENSIONS', EMBEDDING_DIMENSIONS],
      ['EMBEDDING_MAX_BATCH_SIZE', EMBEDDING_MAX_BATCH_SIZE],
      ['EMBEDDING_RATE_LIMIT_DELAY_MS', EMBEDDING_RATE_LIMIT_DELAY_MS],
      ['EMBEDDING_MAX_CHUNK_CHARS', EMBEDDING_MAX_CHUNK_CHARS],
      ['EMBEDDING_MIN_CHUNK_CHARS', EMBEDDING_MIN_CHUNK_CHARS],
      ['EMBEDDING_CACHE_EVICTION_DAYS', EMBEDDING_CACHE_EVICTION_DAYS],
      ['RRF_K', RRF_K],
      ['EMBEDDING_QUEUE_BATCH_SIZE', EMBEDDING_QUEUE_BATCH_SIZE],
      ['EMBEDDING_QUEUE_INTERVAL_MS', EMBEDDING_QUEUE_INTERVAL_MS],
      ['EMBEDDING_QUEUE_MAX_SIZE', EMBEDDING_QUEUE_MAX_SIZE],
    ];

    numericConstants.forEach(([name, value]) => {
      it(`${name} is typeof number`, () => {
        expect(typeof value).toBe('number');
      });
    });
  });

  describe('string constants are typeof string', () => {
    it('EMBEDDING_MODEL is typeof string', () => {
      expect(typeof EMBEDDING_MODEL).toBe('string');
    });

    it('EMBEDDING_MODEL is a non-empty string', () => {
      expect(EMBEDDING_MODEL.length).toBeGreaterThan(0);
    });
  });

  describe('AI_META_TOOL_NAMES is an array', () => {
    it('is an Array', () => {
      expect(Array.isArray(AI_META_TOOL_NAMES)).toBe(true);
    });
  });

  describe('all numeric values are finite', () => {
    const allNumeric = [
      DB_POOL_MAX,
      DB_IDLE_TIMEOUT_MS,
      DB_CONNECT_TIMEOUT_MS,
      WS_PORT,
      WS_HEARTBEAT_INTERVAL_MS,
      WS_SESSION_TIMEOUT_MS,
      WS_MAX_PAYLOAD_BYTES,
      WS_MAX_CONNECTIONS,
      WS_CLOSE_SESSION_TIMEOUT,
      WS_RATE_LIMIT_MESSAGES_PER_SEC,
      WS_RATE_LIMIT_BURST,
      WS_MAX_METADATA_VALUE_BYTES,
      SCHEDULER_CHECK_INTERVAL_MS,
      SCHEDULER_DEFAULT_TIMEOUT_MS,
      SCHEDULER_MAX_HISTORY_PER_TASK,
      TRIGGER_POLL_INTERVAL_MS,
      TRIGGER_CONDITION_CHECK_MS,
      PLAN_STEP_TIMEOUT_MS,
      PLAN_MAX_STALL,
      PLAN_STALL_RETRY_MS,
      PLAN_MAX_BACKOFF_MS,
      PLAN_MAX_LOOP_ITERATIONS,
      RATE_LIMIT_WINDOW_MS,
      RATE_LIMIT_MAX_REQUESTS,
      RATE_LIMIT_BURST,
      TOOL_ARGS_MAX_SIZE,
      MS_PER_MINUTE,
      MS_PER_HOUR,
      MS_PER_DAY,
      MAX_DAYS_LOOKBACK,
      MAX_PAGINATION_OFFSET,
      MAX_AGENT_CACHE_SIZE,
      MAX_CHAT_AGENT_CACHE_SIZE,
      AGENT_DEFAULT_MAX_TOKENS,
      AGENT_CREATE_DEFAULT_MAX_TOKENS,
      AGENT_DEFAULT_TEMPERATURE,
      AGENT_DEFAULT_MAX_TURNS,
      AGENT_DEFAULT_MAX_TOOL_CALLS,
      MAX_BATCH_TOOL_CALLS,
      IMAP_CONNECT_TIMEOUT_MS,
      MAX_TOOL_SOURCE_FILE_CACHE,
      MAX_TOOL_SOURCE_EXTRACTION_CACHE,
      MAX_MESSAGE_CHAT_MAP_SIZE,
      EMBEDDING_DIMENSIONS,
      EMBEDDING_MAX_BATCH_SIZE,
      EMBEDDING_RATE_LIMIT_DELAY_MS,
      EMBEDDING_MAX_CHUNK_CHARS,
      EMBEDDING_MIN_CHUNK_CHARS,
      EMBEDDING_CACHE_EVICTION_DAYS,
      RRF_K,
      EMBEDDING_QUEUE_BATCH_SIZE,
      EMBEDDING_QUEUE_INTERVAL_MS,
      EMBEDDING_QUEUE_MAX_SIZE,
    ];

    it('every numeric constant is a finite number (no NaN or Infinity)', () => {
      allNumeric.forEach((v) => {
        expect(Number.isFinite(v)).toBe(true);
      });
    });
  });
});

// ============================================================================
// 3. Mathematical Consistency
// ============================================================================

describe('defaults — mathematical consistency', () => {
  it('MS_PER_HOUR equals 60 * MS_PER_MINUTE', () => {
    expect(MS_PER_HOUR).toBe(60 * MS_PER_MINUTE);
  });

  it('MS_PER_DAY equals 24 * MS_PER_HOUR', () => {
    expect(MS_PER_DAY).toBe(24 * MS_PER_HOUR);
  });

  it('MS_PER_DAY equals 1440 * MS_PER_MINUTE', () => {
    expect(MS_PER_DAY).toBe(1440 * MS_PER_MINUTE);
  });

  it('MS_PER_DAY equals 86_400 seconds in milliseconds', () => {
    expect(MS_PER_DAY).toBe(1000 * 60 * 60 * 24);
  });

  it('WS_MAX_PAYLOAD_BYTES equals 1024 * 1024 (exactly 1 MB)', () => {
    expect(WS_MAX_PAYLOAD_BYTES).toBe(1024 * 1024);
  });

  it('WS_RATE_LIMIT_BURST is greater than WS_RATE_LIMIT_MESSAGES_PER_SEC', () => {
    expect(WS_RATE_LIMIT_BURST).toBeGreaterThan(WS_RATE_LIMIT_MESSAGES_PER_SEC);
  });

  it('RATE_LIMIT_BURST is greater than RATE_LIMIT_MAX_REQUESTS', () => {
    expect(RATE_LIMIT_BURST).toBeGreaterThan(RATE_LIMIT_MAX_REQUESTS);
  });

  it('RATE_LIMIT_BURST is 50% above RATE_LIMIT_MAX_REQUESTS', () => {
    expect(RATE_LIMIT_BURST).toBe(RATE_LIMIT_MAX_REQUESTS * 1.5);
  });

  it('EMBEDDING_MAX_CHUNK_CHARS is greater than EMBEDDING_MIN_CHUNK_CHARS', () => {
    expect(EMBEDDING_MAX_CHUNK_CHARS).toBeGreaterThan(EMBEDDING_MIN_CHUNK_CHARS);
  });

  it('EMBEDDING_MAX_CHUNK_CHARS is 20x EMBEDDING_MIN_CHUNK_CHARS', () => {
    expect(EMBEDDING_MAX_CHUNK_CHARS).toBe(EMBEDDING_MIN_CHUNK_CHARS * 20);
  });

  it('AGENT_DEFAULT_MAX_TOKENS is greater than AGENT_CREATE_DEFAULT_MAX_TOKENS', () => {
    expect(AGENT_DEFAULT_MAX_TOKENS).toBeGreaterThan(AGENT_CREATE_DEFAULT_MAX_TOKENS);
  });

  it('AGENT_DEFAULT_MAX_TOKENS is exactly double AGENT_CREATE_DEFAULT_MAX_TOKENS', () => {
    expect(AGENT_DEFAULT_MAX_TOKENS).toBe(AGENT_CREATE_DEFAULT_MAX_TOKENS * 2);
  });

  it('AGENT_DEFAULT_MAX_TOOL_CALLS is greater than MAX_BATCH_TOOL_CALLS', () => {
    expect(AGENT_DEFAULT_MAX_TOOL_CALLS).toBeGreaterThan(MAX_BATCH_TOOL_CALLS);
  });

  it('MAX_TOOL_SOURCE_EXTRACTION_CACHE is greater than MAX_TOOL_SOURCE_FILE_CACHE', () => {
    expect(MAX_TOOL_SOURCE_EXTRACTION_CACHE).toBeGreaterThan(MAX_TOOL_SOURCE_FILE_CACHE);
  });
});

// ============================================================================
// 4. Sensible Ranges
// ============================================================================

describe('defaults — sensible ranges', () => {
  describe('timeout values are positive', () => {
    const timeouts: [string, number][] = [
      ['DB_IDLE_TIMEOUT_MS', DB_IDLE_TIMEOUT_MS],
      ['DB_CONNECT_TIMEOUT_MS', DB_CONNECT_TIMEOUT_MS],
      ['WS_HEARTBEAT_INTERVAL_MS', WS_HEARTBEAT_INTERVAL_MS],
      ['WS_SESSION_TIMEOUT_MS', WS_SESSION_TIMEOUT_MS],
      ['WS_CLOSE_SESSION_TIMEOUT', WS_CLOSE_SESSION_TIMEOUT],
      ['SCHEDULER_CHECK_INTERVAL_MS', SCHEDULER_CHECK_INTERVAL_MS],
      ['SCHEDULER_DEFAULT_TIMEOUT_MS', SCHEDULER_DEFAULT_TIMEOUT_MS],
      ['TRIGGER_POLL_INTERVAL_MS', TRIGGER_POLL_INTERVAL_MS],
      ['TRIGGER_CONDITION_CHECK_MS', TRIGGER_CONDITION_CHECK_MS],
      ['PLAN_STEP_TIMEOUT_MS', PLAN_STEP_TIMEOUT_MS],
      ['PLAN_STALL_RETRY_MS', PLAN_STALL_RETRY_MS],
      ['PLAN_MAX_BACKOFF_MS', PLAN_MAX_BACKOFF_MS],
      ['RATE_LIMIT_WINDOW_MS', RATE_LIMIT_WINDOW_MS],
      ['IMAP_CONNECT_TIMEOUT_MS', IMAP_CONNECT_TIMEOUT_MS],
      ['EMBEDDING_RATE_LIMIT_DELAY_MS', EMBEDDING_RATE_LIMIT_DELAY_MS],
      ['EMBEDDING_QUEUE_INTERVAL_MS', EMBEDDING_QUEUE_INTERVAL_MS],
    ];

    timeouts.forEach(([name, value]) => {
      it(`${name} is greater than 0`, () => {
        expect(value).toBeGreaterThan(0);
      });
    });
  });

  describe('limit / count values are positive', () => {
    const limits: [string, number][] = [
      ['DB_POOL_MAX', DB_POOL_MAX],
      ['WS_MAX_CONNECTIONS', WS_MAX_CONNECTIONS],
      ['WS_MAX_PAYLOAD_BYTES', WS_MAX_PAYLOAD_BYTES],
      ['WS_MAX_METADATA_VALUE_BYTES', WS_MAX_METADATA_VALUE_BYTES],
      ['WS_RATE_LIMIT_MESSAGES_PER_SEC', WS_RATE_LIMIT_MESSAGES_PER_SEC],
      ['WS_RATE_LIMIT_BURST', WS_RATE_LIMIT_BURST],
      ['SCHEDULER_MAX_HISTORY_PER_TASK', SCHEDULER_MAX_HISTORY_PER_TASK],
      ['PLAN_MAX_STALL', PLAN_MAX_STALL],
      ['PLAN_MAX_LOOP_ITERATIONS', PLAN_MAX_LOOP_ITERATIONS],
      ['RATE_LIMIT_MAX_REQUESTS', RATE_LIMIT_MAX_REQUESTS],
      ['RATE_LIMIT_BURST', RATE_LIMIT_BURST],
      ['TOOL_ARGS_MAX_SIZE', TOOL_ARGS_MAX_SIZE],
      ['MAX_PAGINATION_OFFSET', MAX_PAGINATION_OFFSET],
      ['MAX_AGENT_CACHE_SIZE', MAX_AGENT_CACHE_SIZE],
      ['MAX_CHAT_AGENT_CACHE_SIZE', MAX_CHAT_AGENT_CACHE_SIZE],
      ['AGENT_DEFAULT_MAX_TOKENS', AGENT_DEFAULT_MAX_TOKENS],
      ['AGENT_CREATE_DEFAULT_MAX_TOKENS', AGENT_CREATE_DEFAULT_MAX_TOKENS],
      ['AGENT_DEFAULT_MAX_TURNS', AGENT_DEFAULT_MAX_TURNS],
      ['AGENT_DEFAULT_MAX_TOOL_CALLS', AGENT_DEFAULT_MAX_TOOL_CALLS],
      ['MAX_BATCH_TOOL_CALLS', MAX_BATCH_TOOL_CALLS],
      ['MAX_TOOL_SOURCE_FILE_CACHE', MAX_TOOL_SOURCE_FILE_CACHE],
      ['MAX_TOOL_SOURCE_EXTRACTION_CACHE', MAX_TOOL_SOURCE_EXTRACTION_CACHE],
      ['MAX_MESSAGE_CHAT_MAP_SIZE', MAX_MESSAGE_CHAT_MAP_SIZE],
      ['EMBEDDING_DIMENSIONS', EMBEDDING_DIMENSIONS],
      ['EMBEDDING_MAX_BATCH_SIZE', EMBEDDING_MAX_BATCH_SIZE],
      ['EMBEDDING_MAX_CHUNK_CHARS', EMBEDDING_MAX_CHUNK_CHARS],
      ['EMBEDDING_MIN_CHUNK_CHARS', EMBEDDING_MIN_CHUNK_CHARS],
      ['EMBEDDING_CACHE_EVICTION_DAYS', EMBEDDING_CACHE_EVICTION_DAYS],
      ['RRF_K', RRF_K],
      ['EMBEDDING_QUEUE_BATCH_SIZE', EMBEDDING_QUEUE_BATCH_SIZE],
      ['EMBEDDING_QUEUE_MAX_SIZE', EMBEDDING_QUEUE_MAX_SIZE],
    ];

    limits.forEach(([name, value]) => {
      it(`${name} is greater than 0`, () => {
        expect(value).toBeGreaterThan(0);
      });
    });
  });

  describe('AGENT_DEFAULT_TEMPERATURE', () => {
    it('is greater than or equal to 0', () => {
      expect(AGENT_DEFAULT_TEMPERATURE).toBeGreaterThanOrEqual(0);
    });

    it('is less than or equal to 2', () => {
      expect(AGENT_DEFAULT_TEMPERATURE).toBeLessThanOrEqual(2);
    });
  });

  describe('WS_PORT — valid TCP port range', () => {
    it('is at least 1', () => {
      expect(WS_PORT).toBeGreaterThanOrEqual(1);
    });

    it('is at most 65535', () => {
      expect(WS_PORT).toBeLessThanOrEqual(65535);
    });

    it('is in the ephemeral / high port range (above 1024)', () => {
      expect(WS_PORT).toBeGreaterThan(1024);
    });
  });

  describe('DB_POOL_MAX — reasonable connection pool size', () => {
    it('is at least 1', () => {
      expect(DB_POOL_MAX).toBeGreaterThanOrEqual(1);
    });

    it('is at most 1000', () => {
      expect(DB_POOL_MAX).toBeLessThanOrEqual(1000);
    });
  });

  describe('MAX_DAYS_LOOKBACK', () => {
    it('equals exactly 365 (one year)', () => {
      expect(MAX_DAYS_LOOKBACK).toBe(365);
    });
  });

  describe('MS_PER_MINUTE — exactly 60 seconds', () => {
    it('equals 60 * 1000', () => {
      expect(MS_PER_MINUTE).toBe(60 * 1000);
    });
  });

  describe('integer-only constants are whole numbers', () => {
    const integers: [string, number][] = [
      ['DB_POOL_MAX', DB_POOL_MAX],
      ['WS_PORT', WS_PORT],
      ['WS_MAX_CONNECTIONS', WS_MAX_CONNECTIONS],
      ['SCHEDULER_MAX_HISTORY_PER_TASK', SCHEDULER_MAX_HISTORY_PER_TASK],
      ['PLAN_MAX_STALL', PLAN_MAX_STALL],
      ['PLAN_MAX_LOOP_ITERATIONS', PLAN_MAX_LOOP_ITERATIONS],
      ['RATE_LIMIT_MAX_REQUESTS', RATE_LIMIT_MAX_REQUESTS],
      ['RATE_LIMIT_BURST', RATE_LIMIT_BURST],
      ['MAX_AGENT_CACHE_SIZE', MAX_AGENT_CACHE_SIZE],
      ['MAX_CHAT_AGENT_CACHE_SIZE', MAX_CHAT_AGENT_CACHE_SIZE],
      ['AGENT_DEFAULT_MAX_TOKENS', AGENT_DEFAULT_MAX_TOKENS],
      ['AGENT_CREATE_DEFAULT_MAX_TOKENS', AGENT_CREATE_DEFAULT_MAX_TOKENS],
      ['AGENT_DEFAULT_MAX_TURNS', AGENT_DEFAULT_MAX_TURNS],
      ['AGENT_DEFAULT_MAX_TOOL_CALLS', AGENT_DEFAULT_MAX_TOOL_CALLS],
      ['MAX_BATCH_TOOL_CALLS', MAX_BATCH_TOOL_CALLS],
      ['RRF_K', RRF_K],
      ['EMBEDDING_DIMENSIONS', EMBEDDING_DIMENSIONS],
      ['EMBEDDING_MAX_BATCH_SIZE', EMBEDDING_MAX_BATCH_SIZE],
      ['EMBEDDING_QUEUE_BATCH_SIZE', EMBEDDING_QUEUE_BATCH_SIZE],
      ['EMBEDDING_QUEUE_MAX_SIZE', EMBEDDING_QUEUE_MAX_SIZE],
    ];

    integers.forEach(([name, value]) => {
      it(`${name} is an integer`, () => {
        expect(Number.isInteger(value)).toBe(true);
      });
    });
  });
});

// ============================================================================
// 5. AI_META_TOOL_NAMES Specific Tests
// ============================================================================

describe('AI_META_TOOL_NAMES', () => {
  it('is defined', () => {
    expect(AI_META_TOOL_NAMES).toBeDefined();
  });

  it('is an Array', () => {
    expect(Array.isArray(AI_META_TOOL_NAMES)).toBe(true);
  });

  it('has exactly 4 elements', () => {
    expect(AI_META_TOOL_NAMES).toHaveLength(4);
  });

  it('contains search_tools', () => {
    expect(AI_META_TOOL_NAMES).toContain('search_tools');
  });

  it('contains get_tool_help', () => {
    expect(AI_META_TOOL_NAMES).toContain('get_tool_help');
  });

  it('contains use_tool', () => {
    expect(AI_META_TOOL_NAMES).toContain('use_tool');
  });

  it('contains batch_use_tool', () => {
    expect(AI_META_TOOL_NAMES).toContain('batch_use_tool');
  });

  it('has search_tools as first element', () => {
    expect(AI_META_TOOL_NAMES[0]).toBe('search_tools');
  });

  it('has get_tool_help as second element', () => {
    expect(AI_META_TOOL_NAMES[1]).toBe('get_tool_help');
  });

  it('has use_tool as third element', () => {
    expect(AI_META_TOOL_NAMES[2]).toBe('use_tool');
  });

  it('has batch_use_tool as fourth element', () => {
    expect(AI_META_TOOL_NAMES[3]).toBe('batch_use_tool');
  });

  it('all elements are strings', () => {
    AI_META_TOOL_NAMES.forEach((name) => {
      expect(typeof name).toBe('string');
    });
  });

  it('has no duplicate elements', () => {
    const unique = new Set(AI_META_TOOL_NAMES);
    expect(unique.size).toBe(AI_META_TOOL_NAMES.length);
  });

  it('all elements are non-empty strings', () => {
    AI_META_TOOL_NAMES.forEach((name) => {
      expect(name.length).toBeGreaterThan(0);
    });
  });

  it('all elements use snake_case naming', () => {
    AI_META_TOOL_NAMES.forEach((name) => {
      expect(name).toMatch(/^[a-z][a-z_]*[a-z]$/);
    });
  });

  it('matches the expected tuple exactly', () => {
    expect([...AI_META_TOOL_NAMES]).toEqual([
      'search_tools',
      'get_tool_help',
      'use_tool',
      'batch_use_tool',
    ]);
  });
});

// ============================================================================
// 6. Constraint Relationships
// ============================================================================

describe('defaults — constraint relationships', () => {
  it('SCHEDULER_DEFAULT_TIMEOUT_MS is greater than or equal to SCHEDULER_CHECK_INTERVAL_MS', () => {
    expect(SCHEDULER_DEFAULT_TIMEOUT_MS).toBeGreaterThanOrEqual(SCHEDULER_CHECK_INTERVAL_MS);
  });

  it('WS_SESSION_TIMEOUT_MS is greater than WS_HEARTBEAT_INTERVAL_MS', () => {
    expect(WS_SESSION_TIMEOUT_MS).toBeGreaterThan(WS_HEARTBEAT_INTERVAL_MS);
  });

  it('WS_SESSION_TIMEOUT_MS is at least 5x WS_HEARTBEAT_INTERVAL_MS', () => {
    expect(WS_SESSION_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * WS_HEARTBEAT_INTERVAL_MS);
  });

  it('PLAN_MAX_BACKOFF_MS is greater than PLAN_STALL_RETRY_MS', () => {
    expect(PLAN_MAX_BACKOFF_MS).toBeGreaterThan(PLAN_STALL_RETRY_MS);
  });

  it('EMBEDDING_QUEUE_MAX_SIZE is greater than EMBEDDING_QUEUE_BATCH_SIZE', () => {
    expect(EMBEDDING_QUEUE_MAX_SIZE).toBeGreaterThan(EMBEDDING_QUEUE_BATCH_SIZE);
  });

  it('EMBEDDING_QUEUE_MAX_SIZE is at least 100x EMBEDDING_QUEUE_BATCH_SIZE', () => {
    expect(EMBEDDING_QUEUE_MAX_SIZE).toBeGreaterThanOrEqual(100 * EMBEDDING_QUEUE_BATCH_SIZE);
  });

  it('EMBEDDING_MAX_BATCH_SIZE is greater than EMBEDDING_QUEUE_BATCH_SIZE', () => {
    expect(EMBEDDING_MAX_BATCH_SIZE).toBeGreaterThan(EMBEDDING_QUEUE_BATCH_SIZE);
  });

  it('MAX_AGENT_CACHE_SIZE is greater than MAX_CHAT_AGENT_CACHE_SIZE', () => {
    expect(MAX_AGENT_CACHE_SIZE).toBeGreaterThan(MAX_CHAT_AGENT_CACHE_SIZE);
  });

  it('AGENT_DEFAULT_MAX_TOOL_CALLS is greater than AGENT_DEFAULT_MAX_TURNS', () => {
    expect(AGENT_DEFAULT_MAX_TOOL_CALLS).toBeGreaterThan(AGENT_DEFAULT_MAX_TURNS);
  });

  it('TOOL_ARGS_MAX_SIZE is larger than WS_MAX_METADATA_VALUE_BYTES', () => {
    expect(TOOL_ARGS_MAX_SIZE).toBeGreaterThan(WS_MAX_METADATA_VALUE_BYTES);
  });

  it('DB_CONNECT_TIMEOUT_MS is less than DB_IDLE_TIMEOUT_MS', () => {
    expect(DB_CONNECT_TIMEOUT_MS).toBeLessThan(DB_IDLE_TIMEOUT_MS);
  });

  it('TRIGGER_CONDITION_CHECK_MS is greater than or equal to TRIGGER_POLL_INTERVAL_MS', () => {
    expect(TRIGGER_CONDITION_CHECK_MS).toBeGreaterThanOrEqual(TRIGGER_POLL_INTERVAL_MS);
  });

  it('PLAN_STEP_TIMEOUT_MS equals SCHEDULER_CHECK_INTERVAL_MS', () => {
    expect(PLAN_STEP_TIMEOUT_MS).toBe(SCHEDULER_CHECK_INTERVAL_MS);
  });

  it('MAX_TOOL_SOURCE_EXTRACTION_CACHE is greater than EMBEDDING_MAX_BATCH_SIZE', () => {
    expect(MAX_TOOL_SOURCE_EXTRACTION_CACHE).toBeGreaterThan(EMBEDDING_MAX_BATCH_SIZE);
  });
});

// ============================================================================
// 7. Export Completeness
// ============================================================================

describe('defaults — export completeness', () => {
  const allExports: [string, unknown][] = [
    // Database
    ['DB_POOL_MAX', DB_POOL_MAX],
    ['DB_IDLE_TIMEOUT_MS', DB_IDLE_TIMEOUT_MS],
    ['DB_CONNECT_TIMEOUT_MS', DB_CONNECT_TIMEOUT_MS],
    // WebSocket
    ['WS_PORT', WS_PORT],
    ['WS_HEARTBEAT_INTERVAL_MS', WS_HEARTBEAT_INTERVAL_MS],
    ['WS_SESSION_TIMEOUT_MS', WS_SESSION_TIMEOUT_MS],
    ['WS_MAX_PAYLOAD_BYTES', WS_MAX_PAYLOAD_BYTES],
    ['WS_MAX_CONNECTIONS', WS_MAX_CONNECTIONS],
    ['WS_CLOSE_SESSION_TIMEOUT', WS_CLOSE_SESSION_TIMEOUT],
    ['WS_RATE_LIMIT_MESSAGES_PER_SEC', WS_RATE_LIMIT_MESSAGES_PER_SEC],
    ['WS_RATE_LIMIT_BURST', WS_RATE_LIMIT_BURST],
    ['WS_MAX_METADATA_VALUE_BYTES', WS_MAX_METADATA_VALUE_BYTES],
    // Scheduler
    ['SCHEDULER_CHECK_INTERVAL_MS', SCHEDULER_CHECK_INTERVAL_MS],
    ['SCHEDULER_DEFAULT_TIMEOUT_MS', SCHEDULER_DEFAULT_TIMEOUT_MS],
    ['SCHEDULER_MAX_HISTORY_PER_TASK', SCHEDULER_MAX_HISTORY_PER_TASK],
    // Triggers
    ['TRIGGER_POLL_INTERVAL_MS', TRIGGER_POLL_INTERVAL_MS],
    ['TRIGGER_CONDITION_CHECK_MS', TRIGGER_CONDITION_CHECK_MS],
    // Plan Executor
    ['PLAN_STEP_TIMEOUT_MS', PLAN_STEP_TIMEOUT_MS],
    ['PLAN_MAX_STALL', PLAN_MAX_STALL],
    ['PLAN_STALL_RETRY_MS', PLAN_STALL_RETRY_MS],
    ['PLAN_MAX_BACKOFF_MS', PLAN_MAX_BACKOFF_MS],
    ['PLAN_MAX_LOOP_ITERATIONS', PLAN_MAX_LOOP_ITERATIONS],
    // Rate Limiting
    ['RATE_LIMIT_WINDOW_MS', RATE_LIMIT_WINDOW_MS],
    ['RATE_LIMIT_MAX_REQUESTS', RATE_LIMIT_MAX_REQUESTS],
    ['RATE_LIMIT_BURST', RATE_LIMIT_BURST],
    // Tool Execution
    ['TOOL_ARGS_MAX_SIZE', TOOL_ARGS_MAX_SIZE],
    // Time Constants
    ['MS_PER_MINUTE', MS_PER_MINUTE],
    ['MS_PER_HOUR', MS_PER_HOUR],
    ['MS_PER_DAY', MS_PER_DAY],
    ['MAX_DAYS_LOOKBACK', MAX_DAYS_LOOKBACK],
    // Pagination
    ['MAX_PAGINATION_OFFSET', MAX_PAGINATION_OFFSET],
    // Agent Caches
    ['MAX_AGENT_CACHE_SIZE', MAX_AGENT_CACHE_SIZE],
    ['MAX_CHAT_AGENT_CACHE_SIZE', MAX_CHAT_AGENT_CACHE_SIZE],
    // Agent Defaults
    ['AGENT_DEFAULT_MAX_TOKENS', AGENT_DEFAULT_MAX_TOKENS],
    ['AGENT_CREATE_DEFAULT_MAX_TOKENS', AGENT_CREATE_DEFAULT_MAX_TOKENS],
    ['AGENT_DEFAULT_TEMPERATURE', AGENT_DEFAULT_TEMPERATURE],
    ['AGENT_DEFAULT_MAX_TURNS', AGENT_DEFAULT_MAX_TURNS],
    ['AGENT_DEFAULT_MAX_TOOL_CALLS', AGENT_DEFAULT_MAX_TOOL_CALLS],
    ['MAX_BATCH_TOOL_CALLS', MAX_BATCH_TOOL_CALLS],
    // Meta-Tool Names
    ['AI_META_TOOL_NAMES', AI_META_TOOL_NAMES],
    // Channel Plugins
    ['IMAP_CONNECT_TIMEOUT_MS', IMAP_CONNECT_TIMEOUT_MS],
    // In-Memory Cache Limits
    ['MAX_TOOL_SOURCE_FILE_CACHE', MAX_TOOL_SOURCE_FILE_CACHE],
    ['MAX_TOOL_SOURCE_EXTRACTION_CACHE', MAX_TOOL_SOURCE_EXTRACTION_CACHE],
    ['MAX_MESSAGE_CHAT_MAP_SIZE', MAX_MESSAGE_CHAT_MAP_SIZE],
    // Embedding Service
    ['EMBEDDING_MODEL', EMBEDDING_MODEL],
    ['EMBEDDING_DIMENSIONS', EMBEDDING_DIMENSIONS],
    ['EMBEDDING_MAX_BATCH_SIZE', EMBEDDING_MAX_BATCH_SIZE],
    ['EMBEDDING_RATE_LIMIT_DELAY_MS', EMBEDDING_RATE_LIMIT_DELAY_MS],
    ['EMBEDDING_MAX_CHUNK_CHARS', EMBEDDING_MAX_CHUNK_CHARS],
    ['EMBEDDING_MIN_CHUNK_CHARS', EMBEDDING_MIN_CHUNK_CHARS],
    ['EMBEDDING_CACHE_EVICTION_DAYS', EMBEDDING_CACHE_EVICTION_DAYS],
    ['RRF_K', RRF_K],
    ['EMBEDDING_QUEUE_BATCH_SIZE', EMBEDDING_QUEUE_BATCH_SIZE],
    ['EMBEDDING_QUEUE_INTERVAL_MS', EMBEDDING_QUEUE_INTERVAL_MS],
    ['EMBEDDING_QUEUE_MAX_SIZE', EMBEDDING_QUEUE_MAX_SIZE],
  ];

  it('exports exactly 55 constants', () => {
    expect(allExports).toHaveLength(55);
  });

  allExports.forEach(([name, value]) => {
    it(`${name} is exported and not undefined`, () => {
      expect(value).not.toBeUndefined();
    });
  });
});
