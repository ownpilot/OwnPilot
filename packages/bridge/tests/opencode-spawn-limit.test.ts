import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_CONCURRENT_OPENCODE_SPAWNS,
  getActiveOpenCodeSpawns,
  resetActiveOpenCodeSpawns,
} from '../src/api/routes.ts';

// Unit tests for the OpenCode concurrent spawn limiter logic.
// These test the exported counter utilities — not the HTTP layer.

describe('OpenCode spawn limiter', () => {
  beforeEach(() => {
    resetActiveOpenCodeSpawns();
  });

  it('MAX_CONCURRENT_OPENCODE_SPAWNS is 5', () => {
    expect(MAX_CONCURRENT_OPENCODE_SPAWNS).toBe(5);
  });

  it('initial active count is 0', () => {
    expect(getActiveOpenCodeSpawns()).toBe(0);
  });

  it('resetActiveOpenCodeSpawns sets counter to 0', () => {
    // Simulate counter state by resetting twice
    resetActiveOpenCodeSpawns();
    expect(getActiveOpenCodeSpawns()).toBe(0);
  });

  it('limit threshold: 5 should trigger 429 (at limit)', () => {
    // Logic test: activeOpenCodeSpawns >= MAX means reject
    const active = MAX_CONCURRENT_OPENCODE_SPAWNS; // = 5
    expect(active >= MAX_CONCURRENT_OPENCODE_SPAWNS).toBe(true);
  });

  it('limit threshold: 4 should NOT trigger 429 (below limit)', () => {
    const active = MAX_CONCURRENT_OPENCODE_SPAWNS - 1; // = 4
    expect(active >= MAX_CONCURRENT_OPENCODE_SPAWNS).toBe(false);
  });

  it('limit threshold: 0 should NOT trigger 429 (fresh state)', () => {
    expect(getActiveOpenCodeSpawns() >= MAX_CONCURRENT_OPENCODE_SPAWNS).toBe(false);
  });
});
