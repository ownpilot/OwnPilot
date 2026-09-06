/**
 * UCP Channel Bridge
 *
 * Manages message bridging between channel instances.
 * When a message arrives on one channel, the bridge can automatically
 * forward it to another (or both directions).
 *
 * Bridge configuration is stored in the database (channel_bridges table).
 * This class provides the runtime bridging logic.
 */

import type { UCPBridgeConfig, UCPMessage, UCPContent } from './types.js';
import { getLog } from '../../services/get-log.js';

const log = getLog('UCPBridge');

// ============================================================================
// Filter pattern safety (ReDoS guard)
// ============================================================================

/**
 * Reject regex patterns prone to catastrophic backtracking (ReDoS). The bridge
 * filter is compiled and run with `RegExp.test` SYNCHRONOUSLY against inbound
 * message text — which is attacker-influenceable (anyone who can message a
 * bridged channel). A pathological owner pattern such as `(a+)+$` against
 * crafted input would spin the event loop indefinitely, hanging the gateway.
 *
 * The check is a conservative, dependency-free heuristic covering the two
 * structural signatures of exponential backtracking: (1) one unbounded
 * quantifier (`*`, `+`, or `{n,}`) nested inside a group that is itself
 * unbounded-quantified ("star height", e.g. `(a+)+`), and (2) an
 * unbounded-quantified group whose alternation branches can overlap
 * (e.g. `(a|aa)+`, `(\w|aa)+`, `(.|a)+`). It can over-reject an
 * exotic-but-safe pattern, but bridge filters are simple keyword/substring
 * matchers in practice, so the trade-off favours never letting one hang the
 * process. A pattern that fails to compile is also unsafe.
 */
export function isSafeRegexPattern(pattern: string): boolean {
  if (typeof pattern !== 'string') return false;
  try {
    new RegExp(pattern);
  } catch {
    return false;
  }
  return !hasNestedUnboundedQuantifier(pattern) && !hasAmbiguousQuantifiedAlternation(pattern);
}

/** True if `s[i]` begins an unbounded quantifier: `*`, `+`, or `{n,}` (no upper bound). */
function unboundedQuantifierAt(s: string, i: number): boolean {
  const ch = s[i];
  if (ch === '*' || ch === '+') return true;
  if (ch === '{') return /^\{\d*,\}/.test(s.slice(i));
  return false;
}

/** Scan a group body for an unbounded quantifier, skipping escapes and char classes. */
function bodyHasUnboundedQuantifier(body: string): boolean {
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') {
      i++;
      while (i < body.length && body[i] !== ']') {
        if (body[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (unboundedQuantifierAt(body, i)) return true;
  }
  return false;
}

/** Detect an unbounded-quantified group whose body also contains an unbounded quantifier. */
function hasNestedUnboundedQuantifier(pattern: string): boolean {
  const groupStarts: number[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') {
      i++;
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '(') {
      groupStarts.push(i);
      continue;
    }
    if (ch === ')') {
      const start = groupStarts.pop();
      if (start === undefined) continue;
      if (!unboundedQuantifierAt(pattern, i + 1)) continue;
      if (bodyHasUnboundedQuantifier(pattern.slice(start + 1, i))) return true;
    }
  }
  return false;
}

/** Split a group body at top-level '|' (escape, char-class, and nested-group aware). */
function splitTopLevelAlternation(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === '\\') {
      current += ch + (body[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === '[') {
      current += ch;
      i++;
      while (i < body.length && body[i] !== ']') {
        if (body[i] === '\\') {
          current += body[i]!;
          i++;
        }
        current += body[i] ?? '';
        i++;
      }
      current += body[i] ?? ']';
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === '|' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * First literal character of an alternation branch (after an optional anchor
 * or group markers), or null when the branch leads with anything that is not
 * a single literal — a wildcard (.), a class escape (\w, \d…), a character
 * class ([…]), a group, or an empty branch. Non-literal leading tokens are
 * treated as potentially overlapping every other branch (conservative).
 */
function leadingLiteral(branch: string): string | null {
  let s = branch;
  if (s.startsWith('^')) s = s.slice(1);
  if (s.startsWith('?:') || s.startsWith('?=') || s.startsWith('?!')) s = s.slice(2);
  else if (s.startsWith('?<=') || s.startsWith('?<!')) s = s.slice(3);
  if (s.length === 0) return null;
  const c = s[0]!;
  if (c === '.' || c === '\\' || c === '[' || c === '(') return null;
  return c;
}

/**
 * Detect the OTHER canonical evil-regex signature besides nested quantifiers:
 * an unbounded-quantified group whose top-level alternation branches can
 * overlap — (a|aa)+, (ab|a)+, (\w|aa)+, (.|a)+. Overlapping branches make the
 * unbounded repetition ambiguous, so a non-matching tail forces exponential
 * backtracking exactly like (a+)+. Conservative by design: any branch leading
 * with a class/wildcard/group is treated as overlapping, so exotic-but-safe
 * patterns like (\d|x)+ are over-rejected — same trade-off as the
 * nested-quantifier check (never let a filter hang the process).
 */
function hasAmbiguousQuantifiedAlternation(pattern: string): boolean {
  const groupStarts: number[] = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '[') {
      i++;
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (ch === '(') {
      groupStarts.push(i);
      continue;
    }
    if (ch === ')') {
      const start = groupStarts.pop();
      if (start === undefined) continue;
      if (!unboundedQuantifierAt(pattern, i + 1)) continue;
      const branches = splitTopLevelAlternation(pattern.slice(start + 1, i));
      if (branches.length < 2) continue;
      const tokens = branches.map((b) => leadingLiteral(b));
      if (tokens.some((t) => t === null)) return true;
      const literals = tokens as string[];
      if (new Set(literals).size !== literals.length) return true;
    }
  }
  return false;
}

// ============================================================================
// Bridge Store Interface
// ============================================================================

/**
 * Persistence layer for bridge configurations.
 * Implemented by the gateway's BridgeRepository.
 */
export interface BridgeStore {
  getAll(): Promise<UCPBridgeConfig[]>;
  getById(id: string): Promise<UCPBridgeConfig | null>;
  getByChannel(channelId: string): Promise<UCPBridgeConfig[]>;
  save(config: Omit<UCPBridgeConfig, 'id' | 'createdAt'>): Promise<UCPBridgeConfig>;
  update(id: string, changes: Partial<UCPBridgeConfig>): Promise<void>;
  remove(id: string): Promise<void>;
}

// ============================================================================
// Bridge Send Function
// ============================================================================

/**
 * Function to send a UCPMessage to a specific channel instance.
 * Provided by the ChannelService during bridge setup.
 */
export type BridgeSendFn = (channelInstanceId: string, msg: UCPMessage) => Promise<string>;

// ============================================================================
// Bridge Manager
// ============================================================================

export class UCPBridgeManager {
  private bridges: UCPBridgeConfig[] = [];
  private sendFn: BridgeSendFn | null = null;

  /**
   * Load bridge configurations from the store.
   */
  async loadBridges(store: BridgeStore): Promise<void> {
    const loaded = await store.getAll();
    // Re-validate every stored filterPattern on load. The create/update route
    // rejects ReDoS-prone patterns, but a pattern persisted before that guard
    // existed must not be able to hang the event loop in bridgeMessage. Drop the
    // unsafe pattern (the bridge keeps forwarding, just unfiltered) rather than
    // compiling and running it — the owner can re-add a safe filter.
    for (const bridge of loaded) {
      if (bridge.filterPattern && !isSafeRegexPattern(bridge.filterPattern)) {
        log.warn('Dropping unsafe bridge filter pattern (ReDoS risk)', {
          bridgeId: bridge.id,
        });
        bridge.filterPattern = undefined;
      }
    }
    this.bridges = loaded;
  }

  /**
   * Set the function used to send messages through channels.
   */
  setSendFunction(fn: BridgeSendFn): void {
    this.sendFn = fn;
  }

  /**
   * Add a bridge configuration at runtime.
   */
  addBridge(config: UCPBridgeConfig): void {
    this.bridges.push(config);
  }

  /**
   * Remove a bridge configuration.
   */
  removeBridge(id: string): void {
    this.bridges = this.bridges.filter((b) => b.id !== id);
  }

  /**
   * Get all active bridges.
   */
  getActiveBridges(): UCPBridgeConfig[] {
    return this.bridges.filter((b) => b.enabled);
  }

  /**
   * Check if a message should be bridged and forward it to target channels.
   *
   * Returns the number of channels the message was forwarded to.
   */
  async bridgeMessage(msg: UCPMessage): Promise<number> {
    if (!this.sendFn || msg.direction !== 'inbound') return 0;

    // Loop guard (defense in depth): a bridge always re-emits a message AS the
    // bot, so anything bridged that later re-enters the inbound path is
    // bot-flagged. Skipping bot-originated messages stops cross-channel echo
    // loops even if a channel plugin fails to filter the bot's own messages —
    // today every plugin does, but the bridge must not depend on that invariant
    // holding for every current and future platform. The single-owner mirror
    // use case only ever bridges the human owner's messages.
    if (msg.sender?.isBot) return 0;

    const sourceId = msg.channelInstanceId;
    let forwardCount = 0;

    for (const bridge of this.bridges) {
      if (!bridge.enabled) continue;

      // Determine if this bridge applies to the source channel
      let targetId: string | null = null;

      if (bridge.sourceChannelId === sourceId) {
        if (bridge.direction === 'source_to_target' || bridge.direction === 'both') {
          targetId = bridge.targetChannelId;
        }
      } else if (bridge.targetChannelId === sourceId) {
        if (bridge.direction === 'target_to_source' || bridge.direction === 'both') {
          targetId = bridge.sourceChannelId;
        }
      }

      if (!targetId) continue;

      // Never forward a message back onto its own channel (a misconfigured
      // source === target bridge) — that would just echo to the owner.
      if (targetId === sourceId) continue;

      // Apply filter pattern if configured
      if (bridge.filterPattern) {
        const text = extractTextFromContent(msg.content);
        try {
          const regex = new RegExp(bridge.filterPattern);
          if (!regex.test(text)) continue;
        } catch {
          // Invalid regex — skip filter
        }
      }

      // Forward the message
      try {
        const forwardedMsg: UCPMessage = {
          ...msg,
          direction: 'outbound',
          channelInstanceId: targetId,
          metadata: {
            ...msg.metadata,
            bridgedFrom: sourceId,
            originalExternalId: msg.externalId,
          },
        };

        await this.sendFn(targetId, forwardedMsg);
        forwardCount++;
      } catch {
        // Log but don't fail — bridging is best-effort
      }
    }

    return forwardCount;
  }
}

// ============================================================================
// Helpers
// ============================================================================

function extractTextFromContent(content: UCPContent[]): string {
  return content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
    .join(' ');
}
