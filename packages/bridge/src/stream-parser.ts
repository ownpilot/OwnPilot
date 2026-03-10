/**
 * NDJSON stream parser for Claude Code --output-format stream-json
 * Uses readline to process stdout line-by-line.
 *
 * Claude Code event types:
 *   message_start        - conversation began
 *   content_block_start  - new content block
 *   content_block_delta  - text arrived (delta.type === "text_delta")
 *   content_block_stop   - block finished
 *   message_delta        - usage info
 *   message_stop         - full message finished
 *   result               - final result (type: "result", subtype: "success"|"error")
 *   system               - system-level event (init, etc.)
 */

import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import type { ClaudeStreamEvent } from './types.ts';
import { logger } from './utils/logger.ts';

export type ParsedEvent =
  | { kind: 'text'; text: string }
  | { kind: 'result'; result: string; subtype: string; usage?: { input_tokens: number; output_tokens: number } }
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'done' }
  | { kind: 'system_init'; session_id?: string };

/**
 * Creates an async iterator over parsed Claude Code stream events.
 * Reads from a Readable stream line-by-line using readline.
 */
export async function* parseClaudeStream(
  stream: Readable,
): AsyncGenerator<ParsedEvent> {
  const rl = createInterface({
    input: stream,
    crlfDelay: Infinity,
    terminal: false,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let event: ClaudeStreamEvent;
    try {
      event = JSON.parse(trimmed) as ClaudeStreamEvent;
    } catch (err) {
      logger.debug({ line: trimmed, err }, 'Failed to parse NDJSON line');
      continue;
    }

    const parsed = processEvent(event);
    if (parsed) yield parsed;
  }

  yield { kind: 'done' };
}

function processEvent(event: ClaudeStreamEvent): ParsedEvent | null {
  switch (event.type) {
    case 'system': {
      // {"type":"system","subtype":"init","session_id":"...","tools":[...],"model":"...","permissionMode":"..."}
      const sysEvent = event as Record<string, unknown>;
      return {
        kind: 'system_init',
        session_id: sysEvent['session_id'] as string | undefined,
      };
    }

    case 'content_block_delta': {
      if (event.delta?.type === 'text_delta' && event.delta.text) {
        return { kind: 'text', text: event.delta.text };
      }
      return null;
    }

    case 'result': {
      // Final result event
      const resultEvent = event as Record<string, unknown>;
      const subtype = (resultEvent['subtype'] as string) ?? 'success';
      const resultText = (resultEvent['result'] as string) ?? '';
      const usage = event.usage;

      if (subtype === 'error') {
        return {
          kind: 'error',
          message: resultText || 'Claude Code returned an error result',
        };
      }

      return {
        kind: 'result',
        result: resultText,
        subtype,
        usage,
      };
    }

    case 'message_start':
    case 'content_block_start':
    case 'content_block_stop':
    case 'message_delta':
    case 'message_stop':
      // These are lifecycle events; not directly surfaced as text
      return null;

    default:
      logger.debug({ type: event.type }, 'Unknown event type from Claude Code');
      return null;
  }
}

/**
 * Collects all text chunks from a parsed stream into a single string.
 * Also returns usage stats if available.
 */
export async function collectStreamText(
  stream: Readable,
): Promise<{ text: string; usage?: { input_tokens: number; output_tokens: number } }> {
  const chunks: string[] = [];
  let usage: { input_tokens: number; output_tokens: number } | undefined;

  for await (const event of parseClaudeStream(stream)) {
    if (event.kind === 'text') {
      chunks.push(event.text);
    } else if (event.kind === 'result') {
      if (event.usage) usage = event.usage;
      // result.result is the final complete text if chunks are empty
      if (chunks.length === 0 && event.result) {
        chunks.push(event.result);
      }
    } else if (event.kind === 'error') {
      throw new Error(event.message);
    }
  }

  return { text: chunks.join(''), usage };
}
