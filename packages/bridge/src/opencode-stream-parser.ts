/**
 * NDJSON stream parser for OpenCode `run --format json` output.
 *
 * OpenCode event types (top-level `type` field):
 *   step_start   - new step began
 *   text         - text chunk (part.text)
 *   tool_use     - tool invocation (part.tool)
 *   step_finish  - step completed
 *
 * sessionID is present on every event at the top level.
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { logger } from './utils/logger.ts';

export type OpenCodeEvent =
  | { kind: 'session_id'; sessionId: string }
  | { kind: 'text'; text: string }
  | { kind: 'tool_use'; tool: string }
  | { kind: 'step_finish' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

/**
 * Parse an OpenCode --format json NDJSON stream as an async generator.
 * Emits session_id once (first event with sessionID), then text/tool_use/step_finish,
 * and finally done when the stream closes.
 */
export async function* parseOpenCodeStream(
  stream: Readable,
): AsyncGenerator<OpenCodeEvent> {
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
    terminal: false,
  });

  let sessionIdEmitted = false;

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      logger.debug({ line: trimmed }, 'opencode-stream-parser: skipping non-JSON line');
      continue;
    }

    // Emit session_id once from first event that carries it
    if (!sessionIdEmitted && typeof event['sessionID'] === 'string' && event['sessionID']) {
      sessionIdEmitted = true;
      yield { kind: 'session_id', sessionId: event['sessionID'] };
    }

    const type = event['type'];
    const part = event['part'] as Record<string, unknown> | undefined;

    switch (type) {
      case 'text': {
        const text = part?.['text'];
        if (typeof text === 'string' && text) {
          yield { kind: 'text', text };
        }
        break;
      }

      case 'tool_use': {
        const tool = part?.['tool'];
        if (typeof tool === 'string') {
          yield { kind: 'tool_use', tool };
        }
        break;
      }

      case 'step_finish': {
        yield { kind: 'step_finish' };
        break;
      }

      case 'step_start':
        // lifecycle event — no yield
        break;

      default:
        logger.debug({ type }, 'opencode-stream-parser: unknown event type, skipping');
        break;
    }
  }

  yield { kind: 'done' };
}
