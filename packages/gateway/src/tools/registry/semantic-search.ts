/**
 * Semantic Tool Search
 *
 * Rank tools by cosine similarity between an embedding of the user's intent
 * and per-tool embeddings of (name + description + tags + category).
 *
 * Design notes:
 *  - Embeddings are cached in-process by a content hash so re-embedding a
 *    stable tool definition is free across calls. The first semantic search
 *    after a registry change does the full batch.
 *  - Falls back gracefully — callers can ignore failures and use keyword
 *    matching. `hasEmbeddingService()` is the cheap precheck.
 *  - No DB access here; the embedding service has its own response-level cache
 *    keyed by text hash, so the same tool text only hits the embeddings API
 *    once across processes.
 */

import {
  cosineSimilarity,
  getBaseName,
  getEmbeddingService,
  hasEmbeddingService,
  TOOL_SEARCH_TAGS,
  type ToolDefinition,
} from '@ownpilot/core';
import { createHash } from 'node:crypto';
import { getLog } from '../../services/log.js';

const log = getLog('SemanticToolSearch');

interface CachedEmbedding {
  hash: string;
  vector: number[];
}

const embeddingCache = new Map<string, CachedEmbedding>();

export function buildToolSearchText(def: ToolDefinition): string {
  const base = getBaseName(def.name);
  const tags = TOOL_SEARCH_TAGS[base] ?? def.tags ?? [];
  const parts = [
    base.replace(/[_\-]/g, ' '),
    def.name.replace(/[_.]/g, ' '),
    def.description ?? '',
    def.category ?? '',
    tags.join(' '),
  ];
  return parts.filter(Boolean).join(' • ').trim();
}

function contentHash(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

interface SemanticMatch {
  def: ToolDefinition;
  score: number;
}

interface SemanticSearchResult {
  matches: SemanticMatch[];
  /** True iff every tool was successfully embedded. False signals partial. */
  complete: boolean;
}

/**
 * Embed the query + every candidate definition (cached), score by cosine,
 * return matches sorted by descending score.
 *
 * Returns `null` when the embedding service is not registered or the query
 * embedding call fails — callers should fall back to keyword matching.
 */
export async function semanticSearchTools(
  query: string,
  candidates: ToolDefinition[]
): Promise<SemanticSearchResult | null> {
  if (!hasEmbeddingService()) return null;
  if (candidates.length === 0) return { matches: [], complete: true };

  const service = getEmbeddingService();
  if (!service.isAvailable()) return null;

  let queryEmbedding: number[];
  try {
    const result = await service.generateEmbedding(query);
    queryEmbedding = result.embedding;
  } catch (err) {
    log.warn('Query embedding failed; semantic search disabled for this call', String(err));
    return null;
  }

  if (queryEmbedding.length === 0) return null;

  // Figure out which tools need embeddings (not in cache or hash changed).
  const toolTexts: string[] = [];
  const toolHashes: string[] = [];
  const missingIndexes: number[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const text = buildToolSearchText(candidates[i]!);
    const hash = contentHash(text);
    toolTexts.push(text);
    toolHashes.push(hash);
    const cached = embeddingCache.get(candidates[i]!.name);
    if (!cached || cached.hash !== hash) missingIndexes.push(i);
  }

  if (missingIndexes.length > 0) {
    try {
      const batchTexts = missingIndexes.map((idx) => toolTexts[idx]!);
      const batchResults = await service.generateBatchEmbeddings(batchTexts);
      for (let j = 0; j < missingIndexes.length; j++) {
        const idx = missingIndexes[j]!;
        const vec = batchResults[j]?.embedding;
        if (!vec || vec.length === 0) continue;
        embeddingCache.set(candidates[idx]!.name, {
          hash: toolHashes[idx]!,
          vector: vec,
        });
      }
    } catch (err) {
      log.warn(
        'Batch tool embedding failed; falling back to whatever is already cached',
        String(err)
      );
    }
  }

  const matches: SemanticMatch[] = [];
  let complete = true;
  for (let i = 0; i < candidates.length; i++) {
    const cached = embeddingCache.get(candidates[i]!.name);
    if (!cached || cached.vector.length !== queryEmbedding.length) {
      complete = false;
      continue;
    }
    const score = cosineSimilarity(queryEmbedding, cached.vector);
    matches.push({ def: candidates[i]!, score });
  }

  matches.sort((a, b) => b.score - a.score);
  return { matches, complete };
}

/** Test-only — drop in-memory embedding cache. */
export function _clearToolEmbeddingCache(): void {
  embeddingCache.clear();
}
