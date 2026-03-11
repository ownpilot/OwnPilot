/**
 * OpenClaw Bridge — In-memory Metrics
 * Simple counters and gauges for observability.
 * Reset on bridge restart (not persisted).
 */

export interface BridgeMetrics {
  // Counters
  spawnCount: number;           // Total CC spawn attempts
  spawnErrors: number;          // Failed spawns (any error)
  spawnSuccess: number;         // Successful spawns (at least 1 chunk yielded)

  // Timing (running average)
  avgFirstChunkMs: number;      // Average ms to first SSE chunk
  avgTotalMs: number;           // Average total session duration ms

  // Gauges (current state)
  activeSessions: number;       // Currently active sessions in ClaudeManager
  pausedSessions: number;       // Currently paused sessions

  // System
  bridgeStartedAt: Date;
  uptimeSeconds: number;
}

const startedAt = new Date();

// Internal state
let _spawnCount = 0;
let _spawnErrors = 0;
let _spawnSuccess = 0;
let _totalFirstChunkMs = 0;
let _firstChunkSamples = 0;
let _totalDurationMs = 0;
let _durationSamples = 0;

// Counter functions — called by claude-manager and routes
export function incrementSpawnCount(): void { _spawnCount++; }
export function incrementSpawnErrors(): void { _spawnErrors++; }
export function incrementSpawnSuccess(): void { _spawnSuccess++; }

export function recordFirstChunk(ms: number): void {
  _totalFirstChunkMs += ms;
  _firstChunkSamples++;
}

export function recordDuration(ms: number): void {
  _totalDurationMs += ms;
  _durationSamples++;
}

// Snapshot getter — call this from /metrics endpoint
export function getMetrics(activeSessions: number, pausedSessions: number): BridgeMetrics {
  return {
    spawnCount: _spawnCount,
    spawnErrors: _spawnErrors,
    spawnSuccess: _spawnSuccess,
    avgFirstChunkMs: _firstChunkSamples > 0 ? Math.round(_totalFirstChunkMs / _firstChunkSamples) : 0,
    avgTotalMs: _durationSamples > 0 ? Math.round(_totalDurationMs / _durationSamples) : 0,
    activeSessions,
    pausedSessions,
    bridgeStartedAt: startedAt,
    uptimeSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
  };
}

// Reset (for testing)
export function resetMetrics(): void {
  _spawnCount = 0;
  _spawnErrors = 0;
  _spawnSuccess = 0;
  _totalFirstChunkMs = 0;
  _firstChunkSamples = 0;
  _totalDurationMs = 0;
  _durationSamples = 0;
}

// ---------------------------------------------------------------------------
// Per-project metrics (MON-03)
// ---------------------------------------------------------------------------

const _projectMetrics = new Map<string, { spawnCount: number; activeDurationMs: number }>();

/** Cap for per-project metrics map (P0-2). */
const METRICS_PROJECT_CAP = 1000;

/**
 * Evict the oldest (first-inserted) entry if the map is at capacity.
 * Called before inserting a NEW project key only.
 */
function evictOldestProjectMetric(): void {
  if (_projectMetrics.size >= METRICS_PROJECT_CAP) {
    const oldest = _projectMetrics.keys().next().value as string;
    _projectMetrics.delete(oldest);
  }
}

/** Returns the current number of tracked projects (for testing). */
export function getMetricsSize(): number {
  return _projectMetrics.size;
}

/** Increment the spawn count for a specific project. Called when a CC process is spawned. */
export function incrementProjectSpawn(projectDir: string): void {
  if (_projectMetrics.has(projectDir)) {
    _projectMetrics.get(projectDir)!.spawnCount++;
    return;
  }
  evictOldestProjectMetric();
  _projectMetrics.set(projectDir, { spawnCount: 1, activeDurationMs: 0 });
}

/** Accumulate active duration for a project. Called when a CC process finishes. */
export function recordProjectActiveDuration(projectDir: string, ms: number): void {
  if (_projectMetrics.has(projectDir)) {
    _projectMetrics.get(projectDir)!.activeDurationMs += ms;
    return;
  }
  evictOldestProjectMetric();
  _projectMetrics.set(projectDir, { spawnCount: 0, activeDurationMs: ms });
}

/** Returns all per-project aggregates. Empty array when no projects have spawned. */
export function getProjectMetrics(): Array<{ projectDir: string; spawnCount: number; activeDurationMs: number }> {
  return [..._projectMetrics.entries()].map(([projectDir, data]) => ({
    projectDir,
    spawnCount: data.spawnCount,
    activeDurationMs: data.activeDurationMs,
  }));
}

/** Reset per-project metrics — for testing. */
export function resetProjectMetrics(): void {
  _projectMetrics.clear();
}
