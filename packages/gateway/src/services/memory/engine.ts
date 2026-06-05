/**
 * Memory Engine (Gateway)
 *
 * The intelligence layer on top of the existing `memories` store:
 *  - extractFromConversations: distill recent conversation text into atomic
 *    long-term memories (dedup-aware via MemoryService.rememberMemory).
 *  - consolidate: cluster near-duplicate memories by embedding similarity,
 *    LLM-merge each cluster into one, retire the originals, then decay+cleanup.
 *  - recall: hybrid-search the store, then LLM-summarize the hits into a
 *    compact answer (summarize-then-recall).
 *
 * The store, repository, embeddings, hybrid search and dedup already exist; this
 * is the missing "fill / consolidate / recall" loop. An LLM `complete` fn is
 * injected by the caller (trigger handler / tool) so this stays provider-agnostic.
 */

import { getLog } from '@ownpilot/core';
import type { CompleteFn } from '@ownpilot/core';
import {
  buildMemoryExtractionPrompt,
  parseMemoryCandidates,
  buildConsolidationPrompt,
  parseConsolidation,
  buildRecallSummaryPrompt,
  cosineSimilarity,
} from '@ownpilot/core';
import { getMemoryService } from '@ownpilot/core';
import { createMemoriesRepository } from '../../db/repositories/memories.js';

const log = getLog('MemoryEngine');

interface ExtractResult {
  extracted: number;
  created: number;
  deduplicated: number;
}

interface ConsolidateResult {
  scanned: number;
  clusters: number;
  merged: number;
  removed: number;
  decayed: number;
  cleaned: number;
  skippedReason?: string;
}

interface RecallSource {
  id: string;
  content: string;
  score: number;
}

interface RecallResult {
  summary: string;
  sources: RecallSource[];
}

const DEFAULT_SIMILARITY = 0.9;
const DEFAULT_SCAN_LIMIT = 300;
const DEFAULT_MAX_MERGES = 10;

class MemoryEngineImpl {
  /**
   * Extract durable memories from conversation text and store them
   * (dedup-aware — similar memories boost importance instead of duplicating).
   */
  async extractFromConversations(
    userId: string,
    conversationText: string,
    complete: CompleteFn
  ): Promise<ExtractResult> {
    if (!conversationText.trim()) {
      return { extracted: 0, created: 0, deduplicated: 0 };
    }
    const raw = await complete(buildMemoryExtractionPrompt(conversationText));
    const candidates = parseMemoryCandidates(raw);
    if (candidates.length === 0) {
      return { extracted: 0, created: 0, deduplicated: 0 };
    }

    const service = getMemoryService();
    let created = 0;
    let deduplicated = 0;
    for (const cand of candidates) {
      try {
        const { deduplicated: dup } = await service.rememberMemory(userId, {
          type: cand.type,
          content: cand.content,
          importance: cand.importance,
          tags: cand.tags,
          source: 'memory_extract',
        });
        if (dup) deduplicated++;
        else created++;
      } catch (err) {
        log.warn('rememberMemory failed for a candidate', String(err));
      }
    }
    return { extracted: candidates.length, created, deduplicated };
  }

  /**
   * Cluster near-duplicate memories and merge each cluster into one consolidated
   * memory, then run importance decay + cleanup. Bounded by maxMerges LLM calls.
   */
  async consolidate(
    userId: string,
    complete: CompleteFn,
    options: {
      similarityThreshold?: number;
      scanLimit?: number;
      maxMerges?: number;
    } = {}
  ): Promise<ConsolidateResult> {
    const threshold = options.similarityThreshold ?? DEFAULT_SIMILARITY;
    const scanLimit = options.scanLimit ?? DEFAULT_SCAN_LIMIT;
    const maxMerges = options.maxMerges ?? DEFAULT_MAX_MERGES;

    const repo = createMemoriesRepository(userId);
    const memories = await repo.list({ limit: scanLimit, orderBy: 'created' });
    const embedded = memories.filter((m) => Array.isArray(m.embedding) && m.embedding.length > 0);

    let clusters = 0;
    let merged = 0;
    let removed = 0;

    if (embedded.length >= 2) {
      const visited = new Set<string>();
      for (let i = 0; i < embedded.length && merged < maxMerges; i++) {
        const base = embedded[i]!;
        if (visited.has(base.id)) continue;
        visited.add(base.id);
        const cluster = [base];
        for (let j = i + 1; j < embedded.length; j++) {
          const other = embedded[j]!;
          if (visited.has(other.id)) continue;
          // Only merge same-type memories so we don't blur fact/preference/event.
          if (other.type !== base.type) continue;
          if (cosineSimilarity(base.embedding!, other.embedding!) >= threshold) {
            cluster.push(other);
            visited.add(other.id);
          }
        }
        if (cluster.length < 2) continue;
        clusters++;

        let mergedText: string | null;
        try {
          mergedText = parseConsolidation(
            await complete(buildConsolidationPrompt(cluster.map((m) => m.content)))
          );
        } catch (err) {
          log.warn('consolidation completion failed', String(err));
          continue;
        }
        if (!mergedText) continue;

        const importance = Math.max(...cluster.map((m) => m.importance));
        const tags = [...new Set(cluster.flatMap((m) => m.tags))];
        try {
          await repo.create({
            type: base.type,
            content: mergedText,
            importance,
            tags,
            source: 'memory_consolidate',
          });
          for (const m of cluster) {
            if (await repo.delete(m.id)) removed++;
          }
          merged++;
        } catch (err) {
          log.warn('failed to write consolidated memory', String(err));
        }
      }
    }

    const decayed = await repo.decay();
    const cleaned = await repo.cleanup();

    return {
      scanned: memories.length,
      clusters,
      merged,
      removed,
      decayed,
      cleaned,
      skippedReason: embedded.length < 2 ? 'not enough embedded memories to cluster' : undefined,
    };
  }

  /**
   * Summarize-then-recall: hybrid-search the store, then distill the hits into a
   * compact answer to the query.
   */
  async recall(
    userId: string,
    query: string,
    complete: CompleteFn,
    limit = 8
  ): Promise<RecallResult> {
    const service = getMemoryService();
    const results = await service.hybridSearch(userId, query, { limit });
    if (results.length === 0) {
      return { summary: 'No relevant memories found.', sources: [] };
    }
    const contents = results.map((r) => r.content);
    let summary: string;
    try {
      summary = (await complete(buildRecallSummaryPrompt(query, contents))).trim();
    } catch (err) {
      log.warn('recall summary failed; returning raw matches', String(err));
      summary = contents.map((c) => `- ${c}`).join('\n');
    }
    return {
      summary,
      sources: results.map((r) => ({ id: r.id, content: r.content, score: r.score })),
    };
  }
}

let _engine: MemoryEngineImpl | null = null;

export function getMemoryEngine(): MemoryEngineImpl {
  if (!_engine) _engine = new MemoryEngineImpl();
  return _engine;
}
