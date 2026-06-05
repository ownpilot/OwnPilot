/**
 * Memory Distillation
 *
 * Pure prompt-builders + parsers for the memory engine. No I/O — the gateway
 * MemoryEngine injects an LLM `complete` fn and the memories repository.
 *
 * Three jobs:
 *  - extraction:    conversation text -> atomic durable memory candidates
 *  - consolidation: a cluster of near-duplicate memories -> one merged memory
 *  - recall:        a query + retrieved memories -> a distilled answer
 *
 * Distinct from the *profile* learning loop (profile-learning.ts): that writes
 * structured (category,key,value) facts to the curated personal profile; this
 * writes free-text memories into the AI-managed `memories` store (vector + FTS,
 * importance-decaying, deduplicated). They complement each other.
 */

/** Memory types the extractor is allowed to emit (subset of MemoryType). */
export const EXTRACTABLE_MEMORY_TYPES = ['fact', 'preference', 'event'] as const;
export type ExtractableMemoryType = (typeof EXTRACTABLE_MEMORY_TYPES)[number];

/** Max candidates accepted from one extraction pass (defensive cap). */
export const MAX_MEMORIES_PER_PASS = 20;
/** Max characters kept per memory content. */
export const MAX_MEMORY_CONTENT_CHARS = 500;

export interface MemoryCandidate {
  type: ExtractableMemoryType;
  content: string;
  importance: number; // 0..1
  tags: string[];
}

// ============================================================================
// Extraction
// ============================================================================

/**
 * Build the extraction prompt. Instructs the model to emit ONLY a JSON array of
 * durable, atomic memories worth remembering across sessions. Conservative and
 * privacy-aware: skip secrets, transient chatter, and anything sensitive.
 */
export function buildMemoryExtractionPrompt(conversationText: string): string {
  return [
    'You maintain the long-term memory of a personal AI assistant.',
    'From the conversation below, extract ONLY durable facts worth remembering in future sessions.',
    '',
    'Rules:',
    '- Each memory must be a single, self-contained, atomic statement (no pronouns — name the subject).',
    "- Only durable information: stable facts, lasting preferences, or notable events. NOT small talk, NOT one-off task details, NOT the assistant's own messages.",
    '- Do NOT record secrets, passwords, API keys, payment details, or sensitive health/financial data.',
    '- If nothing is worth remembering, return an empty array.',
    `- Return at most ${MAX_MEMORIES_PER_PASS} items.`,
    '',
    'Return ONLY a JSON array (no prose, no code fences). Each item:',
    '{"type": "fact" | "preference" | "event", "content": "<statement>", "importance": <0..1>, "tags": ["<tag>", ...]}',
    '',
    'Conversation:',
    conversationText,
  ].join('\n');
}

/**
 * Parse the model output into validated memory candidates.
 * Tolerates code fences and surrounding prose; drops malformed items.
 */
export function parseMemoryCandidates(raw: string): MemoryCandidate[] {
  const jsonText = extractJsonArray(raw);
  if (!jsonText) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: MemoryCandidate[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (out.length >= MAX_MEMORIES_PER_PASS) break;
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;

    const type = rec.type;
    if (
      typeof type !== 'string' ||
      !EXTRACTABLE_MEMORY_TYPES.includes(type as ExtractableMemoryType)
    ) {
      continue;
    }

    let content = typeof rec.content === 'string' ? rec.content.trim() : '';
    if (!content) continue;
    if (content.length > MAX_MEMORY_CONTENT_CHARS) {
      content = content.slice(0, MAX_MEMORY_CONTENT_CHARS).trim();
    }

    const dedupKey = `${type}::${content.toLowerCase()}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    let importance = typeof rec.importance === 'number' ? rec.importance : 0.5;
    if (!Number.isFinite(importance)) importance = 0.5;
    importance = Math.max(0, Math.min(1, importance));

    const tags = Array.isArray(rec.tags)
      ? rec.tags.filter((t): t is string => typeof t === 'string').slice(0, 10)
      : [];

    out.push({ type: type as ExtractableMemoryType, content, importance, tags });
  }
  return out;
}

// ============================================================================
// Consolidation
// ============================================================================

/**
 * Build a prompt that merges a cluster of related/near-duplicate memories into
 * one clear, comprehensive statement. Returns just the merged text instruction.
 */
export function buildConsolidationPrompt(contents: string[]): string {
  return [
    'These memory entries describe the same or closely-related information:',
    ...contents.map((c, i) => `${i + 1}. ${c}`),
    '',
    'Merge them into ONE clear, complete, non-redundant statement that preserves every',
    'distinct detail. Do not invent new information. Return ONLY the merged statement as',
    'plain text (no quotes, no JSON, no preamble).',
  ].join('\n');
}

/** Clean a consolidation completion into a usable single statement (or null). */
export function parseConsolidation(raw: string): string | null {
  let text = raw.trim();
  if (!text) return null;
  // Strip code fences if the model wrapped it anyway.
  const fenced = text.match(/```(?:[a-z]*)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1]!.trim();
  // Strip wrapping quotes.
  if (text.length >= 2 && /^["'].*["']$/.test(text)) text = text.slice(1, -1).trim();
  if (!text) return null;
  if (text.length > MAX_MEMORY_CONTENT_CHARS) text = text.slice(0, MAX_MEMORY_CONTENT_CHARS).trim();
  return text;
}

// ============================================================================
// Recall (summarize-then-answer)
// ============================================================================

/**
 * Build a prompt that distills retrieved memories into a compact answer to the
 * user's query. The model must only use the supplied memories.
 */
export function buildRecallSummaryPrompt(query: string, contents: string[]): string {
  return [
    'Using ONLY the remembered facts below, answer the question concisely.',
    'If the facts do not contain the answer, say you do not have that in memory.',
    'Do not invent details beyond what is stated.',
    '',
    'Remembered facts:',
    ...contents.map((c) => `- ${c}`),
    '',
    `Question: ${query}`,
    '',
    'Answer:',
  ].join('\n');
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Find the first top-level JSON array in arbitrary model output.
 * Handles ```json fences and leading/trailing prose.
 */
function extractJsonArray(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : raw;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/**
 * Cosine similarity between two equal-length vectors. Returns 0 on mismatch or
 * zero-magnitude. Used by the consolidation clustering pass.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    ma += a[i]! * a[i]!;
    mb += b[i]! * b[i]!;
  }
  if (ma === 0 || mb === 0) return 0;
  return dot / (Math.sqrt(ma) * Math.sqrt(mb));
}
