# SSE TTFC Analysis — Root Cause Investigation

> Status: H1 CONFIRMED — architectural limitation, not a bug.

## Problem

SSE Time To First Chunk (TTFC) ≈ total response latency.
- TTFC (SSE): **3425ms**
- P50 latency: **3241ms**
- Streaming provides virtually zero perceived-speed advantage.

## Root Cause (H1 — Confirmed)

Claude Code with `--print --output-format stream-json` does **NOT** emit
`content_block_delta` events during response generation. Instead, CC accumulates
the entire response internally and emits a single `result` event containing the
complete text when finished.

### Evidence

1. `claude-manager.ts` line ~638: bridge listens for `content_block_delta` to
   set `firstChunkMs`, but this event never arrives for `--print` mode responses.
2. `firstChunkMs` is always `null` across 146+ logged requests (metrics show
   `avgFirstChunkMs: 0`).
3. The `result` event (line ~656) delivers `result.result` as a complete string,
   not incrementally.
4. Bridge log analysis: `firstChunkMs` vs `totalMs` delta is consistently <50ms,
   confirming all text arrives in one burst.

### CC Stream-JSON Event Flow (--print mode)

```
stdin.write(message) → stdin.end()
    ↓
CC processes internally (3-5 seconds)
    ↓
stdout: {"type":"system",...}           ← init (ignored)
stdout: {"type":"result","result":...}  ← ENTIRE response in one event
    ↓
Bridge yields text + done chunks
```

No `content_block_delta` events are emitted. The `assistant` event type exists
but contains the same complete content blocks, not incremental deltas.

## Why --print Mode Behaves This Way

CC's `--print` flag is designed for non-interactive, single-shot usage:
1. Read input from stdin
2. Process completely
3. Print result to stdout
4. Exit

This is fundamentally different from CC's interactive mode (no `--print`) where
the assistant response streams token-by-token to the terminal.

## Fix Options

| Option | Effort | TTFC Impact | Risk |
|--------|--------|-------------|------|
| A: Remove `--print`, use interactive mode | HIGH | Real streaming (~500ms TTFC) | Major architectural change — stdin/stdout protocol changes, process lifecycle different |
| B: Use CC SDK/API directly (not CLI) | VERY HIGH | Real streaming | Bypass CLI entirely, use Anthropic API with streaming |
| C: Accept current behavior | NONE | No change | Document as known limitation |
| D: Warm process pool | MEDIUM | Faster spawn (~1s saved) | Complexity, idle resource usage |

## Recommendation

**Option C (Accept) for now.** The 3.2s response time is acceptable for the
current use case (WhatsApp bot, async workflows). Real streaming would require
either removing `--print` (Option A) or bypassing CC CLI entirely (Option B),
both of which are major architectural changes that should only be pursued if
sub-second TTFC becomes a hard requirement.

**Option D (Warm pool)** is worth exploring separately as it reduces total
latency regardless of streaming behavior.

---

*Created: 2026-02-28 | Bug #21 documentation*

## Fix Applied (v3.2 / Phase 12)

The `resultText && resultText.trim()` guard in `claude-manager.ts` result handler
was removed. `firstChunkMs` is now always set when the `result` event arrives,
making `avgFirstChunkMs` a meaningful time-to-completion metric for `--print` mode.
Tool-only responses and error subtypes that previously caused `firstChunkMs === null`
now contribute a valid sample.
