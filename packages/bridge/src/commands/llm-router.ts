/**
 * LLM Router — Faz 3 LLM Fallback Intent Classification
 *
 * When regex-based resolveIntent() returns null (ambiguous / paraphrased messages),
 * this module calls the Minimax API (MiniMax-M2.5) to classify the user's
 * message as one of the 14 bridge slash commands or null.
 *
 * Design decisions:
 * - Model: MiniMax-M2.5 via Minimax Anthropic-compatible API
 * - API URL: https://api.minimax.io/anthropic (same @anthropic-ai/sdk, baseURL override)
 * - Timeout: 4 500 ms Promise.race (Minimax TTFT ~2.65 s)
 * - Confidence: ≥0.70 for info commands, ≥0.90 for destructive (/clear)
 * - Circuit breaker: 3 consecutive failures → 5 min disable
 * - Cache: in-memory, normalise-keyed, 1 h TTL, 500 entries max
 * - Bypass: message >80 chars OR >6 words → clearly a CC task, skip LLM
 * - Prompt caching: cache_control ephemeral on system prompt (requires ≥1024 tokens)
 * - tool_choice: { type: 'any' } → forces structured output
 * - Allowlist validation: reject any command not in KNOWN_COMMANDS
 */

import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.ts';
import { logger } from '../utils/logger.ts';
import { COMMAND_METADATA } from './command-metadata.ts';

const log = logger.child({ module: 'llm-router' });

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Commands requiring higher confidence before acting (destructive side effects). */
const DESTRUCTIVE_COMMANDS = new Set(['/clear']);

const CONFIDENCE_THRESHOLD_DEFAULT     = 0.70;
const CONFIDENCE_THRESHOLD_DESTRUCTIVE = 0.90;
const TIMEOUT_MS                       = 4_500; // Minimax TTFT ~2.65 s → 4.5 s gives headroom
const MAX_MESSAGE_LENGTH               = 80;   // Bridge commands are short; longer = CC task
const MAX_WORD_COUNT                   = 6;    // Commands are ≤5 words; 6+ words = CC task
const CACHE_TTL_MS                     = 60 * 60 * 1_000; // 1 h
const CACHE_MAX_SIZE                   = 500;
const CIRCUIT_BREAKER_THRESHOLD        = 3;
const CIRCUIT_BREAKER_RESET_MS         = 5 * 60 * 1_000; // 5 min

/** Allowlist of valid commands (without slash → with slash). */
const KNOWN_COMMANDS: string[] = Object.keys(COMMAND_METADATA).map((k) => `/${k}`);

// ─────────────────────────────────────────────────────────────────────────────
// Lazy singleton Anthropic client
// ─────────────────────────────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      baseURL: config.minimaxBaseUrl,
      apiKey: config.minimaxApiKey || undefined,
      maxRetries: 0,
    });
  }
  return _client;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory LRU cache
// ─────────────────────────────────────────────────────────────────────────────

const _cache = new Map<string, { command: string | null; ts: number }>();

function cacheGet(key: string): string | null | undefined {
  const entry = _cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    _cache.delete(key);
    return undefined;
  }
  return entry.command;
}

function cacheSet(key: string, command: string | null): void {
  if (_cache.size >= CACHE_MAX_SIZE) {
    // evict oldest entry (Map preserves insertion order)
    const oldest = _cache.keys().next().value;
    if (oldest !== undefined) _cache.delete(oldest);
  }
  _cache.set(key, { command, ts: Date.now() });
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuit breaker
// ─────────────────────────────────────────────────────────────────────────────

let _cbFailures   = 0;
let _cbOpenUntil  = 0;

function cbIsOpen(): boolean {
  return Date.now() < _cbOpenUntil;
}

function cbRecordFailure(): void {
  _cbFailures++;
  if (_cbFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    _cbOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
    log.warn(
      { openUntil: new Date(_cbOpenUntil).toISOString() },
      'LLM router: circuit breaker OPEN',
    );
    _cbFailures = 0;
  }
}

function cbRecordSuccess(): void {
  _cbFailures = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Turkish normalisation (mirrors intent-adapter.ts)
// ─────────────────────────────────────────────────────────────────────────────

const TR_NORMALIZE: [RegExp, string][] = [
  [/ı/g, 'i'], [/İ/g, 'i'],
  [/ş/g, 's'], [/Ş/g, 's'],
  [/ğ/g, 'g'], [/Ğ/g, 'g'],
  [/ü/g, 'u'], [/Ü/g, 'u'],
  [/ö/g, 'o'], [/Ö/g, 'o'],
  [/ç/g, 'c'], [/Ç/g, 'c'],
];

function normalizeKey(msg: string): string {
  let s = msg.trim().toLowerCase();
  for (const [r, rep] of TR_NORMALIZE) s = s.replace(r, rep);
  return s;
}

// ─────────────────────────────────────────────────────────────────────────────
// System prompt (enriched to exceed 1 024-token cache minimum)
// ─────────────────────────────────────────────────────────────────────────────

const COMMANDS_TABLE = Object.entries(COMMAND_METADATA)
  .map(([name, meta]) => {
    const tr = meta.aliases.filter((_, i) => i < 2).join(', ');
    const en = meta.aliases.filter((_, i) => i >= 2).slice(0, 2).join(', ');
    return `  /${name}: ${meta.description}\n    Turkish examples: ${tr}\n    English examples: ${en}`;
  })
  .join('\n');

const SYSTEM_PROMPT = `\
You are a command router for an AI developer bridge server called OpenClaw Bridge.

Your ONLY job: decide whether a user message is invoking one of the 14 bridge slash commands, or is a normal task/question that should be forwarded to Claude Code.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE 14 BRIDGE COMMANDS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${COMMANDS_TABLE}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DECISION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. If the message CLEARLY expresses intent for one of the 14 commands → return that command with high confidence (≥0.90).
2. If the message LIKELY expresses intent but with some ambiguity → return the command with medium confidence (0.70–0.89).
3. If confidence is below 0.70 or no command fits → return null.
4. Short imperative phrases (< 20 words) are usually commands.
5. Long descriptive sentences with code, variable names, or technical content are NEVER commands — return null with confidence 0.0.
6. Turkish and English are both valid inputs. Normalised forms (e.g. "harcadim" for "harcadım") are acceptable.
7. NEVER invent new commands. You MUST only return one of the 14 listed above, or null.
8. For destructive commands like /clear: prefer returning null unless confidence is very high (≥0.90), because clearing a conversation cannot be undone.
9. For informational commands (/cost, /status, /help, /usage, /context, /diff, /doctor): threshold is 0.70.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLES (intent → command, confidence)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

"bu ay ne kadar para harcadım acaba"   → /cost,    0.92
"harcama durumum"                       → /cost,    0.88
"token kullanımım ne kadar oldu"        → /cost,    0.95
"oturum durumu nedir"                   → /status,  0.93
"şu an aktif session var mı"            → /status,  0.85
"yardımcı ol bana"                      → /help,    0.80
"sohbeti sıfırla lütfen"               → /clear,   0.95
"konuşmayı temizle"                     → /clear,   0.91
"bir şeyleri temizle mi"               → /clear,   0.55  (ambiguous → under threshold)
"bağlamı sıkıştır"                     → /compact, 0.93
"kaç token kaldı"                       → /context, 0.90
"ne değişti kodda"                      → /diff,    0.88
"hızlı moda geç"                        → /fast,    0.91
"sorunları kontrol et"                  → /doctor,  0.88
"hafif efor modu"                       → /effort,  0.85
"modeli değiştir"                       → /model,   0.90
"kaldığı yerden devam et"               → /resume,  0.88
"bu haftaki kullanım"                   → /usage,   0.85
"oturumu yeniden adlandır"              → /rename,  0.90
"auth modülündeki hatayı düzelt"        → null,     0.0   (task, not a command)
"bir test yaz"                          → null,     0.0   (task)
"maliyet hesapla"                       → null,     0.0   (about cost concept, not /cost)
"bu projenin maliyeti ne olur"          → null,     0.0   (project cost estimate ≠ token cost)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMPORTANT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Always call the suggest_command tool with your classification.
Never respond in plain text — always use the tool.
`;

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

const SUGGEST_COMMAND_TOOL: Anthropic.Tool = {
  name: 'suggest_command',
  description: 'Classify the user message as one of the 14 bridge slash commands, or null.',
  input_schema: {
    type: 'object',
    properties: {
      command: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        type: ['string', 'null'] as any,
        enum: [...KNOWN_COMMANDS, null],
        description: 'The matching slash command (e.g. "/cost") or null if no command matches.',
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Confidence score 0.0–1.0.',
      },
      reasoning: {
        type: 'string',
        description: 'One-sentence explanation for the classification.',
      },
    },
    required: ['command', 'confidence', 'reasoning'],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface LLMRouterResult {
  /** The classified command (e.g. '/cost') or null */
  command: string | null;
  /** Confidence score 0–1; 0 when fromLLM is false */
  confidence: number;
  /** Model's reasoning (empty string when fromLLM is false) */
  reasoning: string;
  /** true when Anthropic API was actually called (or cache hit); false for all bypasses */
  fromLLM: boolean;
  /** true when result was served from cache */
  cached?: boolean;
}

const NULL_RESULT: LLMRouterResult = {
  command: null,
  confidence: 0,
  reasoning: 'fallthrough',
  fromLLM: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers (never call in production code)
// ─────────────────────────────────────────────────────────────────────────────

/** Reset ALL module-level state for test isolation. */
export function _resetForTesting(): void {
  _client     = null;
  _cbFailures = 0;
  _cbOpenUntil = 0;
  _cache.clear();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Attempt to classify a user message as a bridge slash command using Sonnet.
 *
 * Returns null result (fromLLM: false) when:
 * - No MINIMAX_API_KEY configured
 * - Message is longer than MAX_MESSAGE_LENGTH (clearly a task)
 * - Circuit breaker is open (too many recent failures)
 * - API timeout or error
 * - Confidence below threshold
 * - Model returns unrecognised command (hallucination guard)
 */
export async function resolveLLMIntent(message: string): Promise<LLMRouterResult> {
  // Guard: API key required
  if (!config.minimaxApiKey) {
    log.debug('LLM router: no Minimax API key configured, skip');
    return NULL_RESULT;
  }

  // Guard: message too long → clearly a CC task, not a command
  if (message.length > MAX_MESSAGE_LENGTH) {
    log.debug({ length: message.length }, 'LLM router: message too long, skip');
    return NULL_RESULT;
  }

  // Guard: too many words → clearly a CC task (commands are 1-5 words)
  const wordCount = message.trim().split(/\s+/).length;
  if (wordCount > MAX_WORD_COUNT) {
    log.debug({ wordCount }, 'LLM router: too many words, skip');
    return NULL_RESULT;
  }

  // Guard: circuit breaker open
  if (cbIsOpen()) {
    log.warn('LLM router: circuit breaker open, skip');
    return NULL_RESULT;
  }

  // Cache check (normalised key for TR/EN equivalence)
  const cacheKey = normalizeKey(message);
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    log.debug({ command: cached }, 'LLM router: cache hit');
    return {
      command: cached,
      confidence: 1.0,
      reasoning: 'cache hit',
      fromLLM: true,
      cached: true,
    };
  }

  const startMs = Date.now();

  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), TIMEOUT_MS),
    );

    const apiPromise = getClient().messages.create({
      model: config.minimaxModel,
      max_tokens: 128,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          // Prompt caching: system prompt is static → cache after first call
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          cache_control: { type: 'ephemeral' } as any,
        },
      ],
      tools: [SUGGEST_COMMAND_TOOL],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: message }],
    });

    const response = await Promise.race([apiPromise, timeoutPromise]);
    const latencyMs = Date.now() - startMs;

    // Timeout: response is null
    if (!response) {
      log.warn({ latencyMs }, 'LLM router: timeout (4.5 s), fallthrough');
      cbRecordFailure();
      return NULL_RESULT;
    }

    // Extract tool_use block
    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (!toolUse) {
      log.warn({ latencyMs }, 'LLM router: no tool_use block in response');
      cbRecordFailure();
      return NULL_RESULT;
    }

    const input = toolUse.input as {
      command: string | null;
      confidence: number;
      reasoning: string;
    };

    // Allowlist validation (hallucination guard)
    const rawCommand = input.command;
    const validCommand =
      rawCommand && KNOWN_COMMANDS.includes(rawCommand) ? rawCommand : null;

    const confidence = typeof input.confidence === 'number' ? input.confidence : 0;

    // Apply confidence threshold (destructive commands require higher confidence)
    const threshold =
      validCommand && DESTRUCTIVE_COMMANDS.has(validCommand)
        ? CONFIDENCE_THRESHOLD_DESTRUCTIVE
        : CONFIDENCE_THRESHOLD_DEFAULT;

    const finalCommand = confidence >= threshold ? validCommand : null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cacheHit = ((response.usage as any)?.cache_read_input_tokens ?? 0) > 0;
    log.info(
      {
        command: finalCommand,
        rawCommand,
        confidence,
        threshold,
        latencyMs,
        promptCached: cacheHit,
      },
      'LLM router: resolved',
    );

    cacheSet(cacheKey, finalCommand);
    cbRecordSuccess();

    return {
      command: finalCommand,
      confidence,
      reasoning: input.reasoning ?? '',
      // fromLLM is true only when we're returning an actionable command from the LLM.
      // When confidence is insufficient (finalCommand === null), treat as fallthrough.
      fromLLM: finalCommand !== null,
    };
  } catch (err) {
    const latencyMs = Date.now() - startMs;
    log.warn({ err, latencyMs }, 'LLM router: API error, fallthrough');
    cbRecordFailure();
    return NULL_RESULT;
  }
}
