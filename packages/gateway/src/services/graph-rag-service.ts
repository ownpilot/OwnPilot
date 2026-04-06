/**
 * Graph RAG Service
 *
 * Knowledge graph management with hybrid retrieval (vector similarity +
 * graph traversal + keyword search). Optionally delegates to LightRAG
 * for enhanced retrieval when available.
 *
 * Entities and relations are stored in PostgreSQL (pgvector) and scoped
 * by user_id + agent_id.
 */

import { randomUUID } from 'crypto';
import {
  createProvider,
  type ProviderConfig,
  type IGraphRagService,
  type KnowledgeEntity,
  type KnowledgeRelation,
  type KnowledgeCollection,
  type GraphQueryResult,
  type ExtractedKnowledge,
  type HybridSearchOptions,
} from '@ownpilot/core';
import { getAdapterSync } from '../db/adapters/index.js';
import { getEmbeddingService } from './embedding-service.js';
import { getLog } from './log.js';

const log = getLog('GraphRagService');

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TOP_K = 10;
const DEFAULT_DEPTH = 2;
const DEFAULT_DECAY_FACTOR = 0.95;
const MIN_IMPORTANCE_THRESHOLD = 0.01;
const LIGHTRAG_TIMEOUT_MS = 15_000;

const EXTRACTION_SYSTEM_PROMPT = `You are a knowledge extraction engine. Extract entities and relationships from the provided text.
Return ONLY valid JSON with this exact structure:
{
  "entities": [{"name": "...", "type": "concept|person|organization|location|event|tool", "description": "brief description"}],
  "relations": [{"source": "entity name", "target": "entity name", "type": "relation type", "context": "relevant sentence"}]
}
Rules:
- Entity names should be normalized (title case for proper nouns, lowercase for concepts)
- Relation types should be short verb phrases (e.g. "works_at", "depends_on", "created_by")
- Only extract clearly stated facts, do not infer
- Deduplicate entities with the same name
- Return empty arrays if no entities/relations found`;

// ============================================================================
// LightRAG HTTP Client
// ============================================================================

interface LightRagInsertPayload {
  text: string;
  metadata?: Record<string, unknown>;
}

interface LightRagQueryPayload {
  query: string;
  mode: string;
}

async function lightRagFetch<T>(
  path: string,
  body: unknown,
): Promise<T | null> {
  const baseUrl = process.env.LIGHTRAG_URL;
  if (!baseUrl) return null;

  const apiKey = process.env.LIGHTRAG_API_KEY;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LIGHTRAG_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      log.warn('LightRAG request failed', {
        path,
        status: response.status,
        error: errorText.substring(0, 200),
      });
      return null;
    }

    return (await response.json()) as T;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      log.warn('LightRAG request timed out', { path });
    } else {
      log.debug('LightRAG unavailable', { path, error: String(err) });
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ============================================================================
// DB Row Types
// ============================================================================

interface EntityRow {
  id: string;
  user_id: string;
  agent_id: string | null;
  name: string;
  entity_type: string;
  description: string | null;
  properties: Record<string, unknown> | string;
  source_ids: string[] | string;
  mention_count: number;
  importance: number;
  created_at: string;
  updated_at: string;
}

interface RelationRow {
  id: string;
  user_id: string;
  agent_id: string | null;
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  weight: number;
  properties: Record<string, unknown> | string;
  context: string | null;
  source_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CollectionRow {
  id: string;
  user_id: string;
  agent_id: string | null;
  name: string;
  description: string | null;
  config: Record<string, unknown> | string;
  entity_count: number;
  relation_count: number;
  created_at: string;
  updated_at: string;
}

interface CountRow {
  count: string | number;
}

// ============================================================================
// Row Mappers
// ============================================================================

function parseJson<T>(value: T | string): T {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return {} as T;
    }
  }
  return value;
}

function toEntity(row: EntityRow): KnowledgeEntity {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    name: row.name,
    entityType: row.entity_type,
    description: row.description,
    properties: parseJson(row.properties),
    sourceIds: Array.isArray(row.source_ids)
      ? row.source_ids
      : parseJson<string[]>(row.source_ids as string),
    mentionCount: Number(row.mention_count),
    importance: Number(row.importance),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRelation(row: RelationRow): KnowledgeRelation {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    sourceEntityId: row.source_entity_id,
    targetEntityId: row.target_entity_id,
    relationType: row.relation_type,
    weight: Number(row.weight),
    properties: parseJson(row.properties),
    context: row.context,
    sourceId: row.source_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toCollection(row: CollectionRow): KnowledgeCollection {
  return {
    id: row.id,
    userId: row.user_id,
    agentId: row.agent_id,
    name: row.name,
    description: row.description,
    config: parseJson(row.config),
    entityCount: Number(row.entity_count),
    relationCount: Number(row.relation_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// GraphRagService
// ============================================================================

export class GraphRagService implements IGraphRagService {
  // --------------------------------------------------------------------------
  // Extract Knowledge (LLM)
  // --------------------------------------------------------------------------

  async extractKnowledge(
    text: string,
    _userId: string,
    _agentId?: string | null,
  ): Promise<ExtractedKnowledge> {
    const trimmed = text.trim();
    if (!trimmed) {
      return { entities: [], relations: [] };
    }

    try {
      const provider = await this.resolveProvider();
      const result = await provider.complete({
        messages: [
          { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
          { role: 'user', content: `Extract entities and relationships from the following text:\n\n${trimmed}` },
        ],
        model: {
          model: await this.resolveModel(),
          maxTokens: 4096,
          temperature: 0.1,
        },
      });

      if (!result.ok) {
        log.warn('LLM returned error for knowledge extraction', { error: result.error.message });
        return { entities: [], relations: [] };
      }

      const content = result.value.content?.trim();
      if (!content) {
        log.warn('LLM returned empty content for knowledge extraction');
        return { entities: [], relations: [] };
      }

      // Parse JSON — strip markdown fences if present
      const jsonStr = content.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
      const parsed = JSON.parse(jsonStr) as ExtractedKnowledge;

      if (!Array.isArray(parsed.entities)) parsed.entities = [];
      if (!Array.isArray(parsed.relations)) parsed.relations = [];

      return parsed;
    } catch (err) {
      log.error('Knowledge extraction failed', { error: String(err) });
      return { entities: [], relations: [] };
    }
  }

  // --------------------------------------------------------------------------
  // Ingest Knowledge
  // --------------------------------------------------------------------------

  async ingestKnowledge(
    extracted: ExtractedKnowledge,
    userId: string,
    agentId?: string | null,
    sourceId?: string,
  ): Promise<{ entityCount: number; relationCount: number }> {
    const db = getAdapterSync();
    const effectiveAgentId = agentId ?? null;
    let entityCount = 0;
    let relationCount = 0;

    // Map entity name → id for relation linking
    const entityIdMap = new Map<string, string>();

    // Upsert entities
    for (const entity of extracted.entities) {
      const name = entity.name?.trim();
      if (!name) continue;

      const entityType = entity.type || 'concept';
      const description = entity.description || null;
      const sourceIds = sourceId ? JSON.stringify([sourceId]) : '[]';

      // Upsert: increment mention_count on conflict
      const rows = await db.query<EntityRow>(
        `INSERT INTO knowledge_entities (id, user_id, agent_id, name, entity_type, description, properties, source_ids, mention_count, importance, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '{}', ?::jsonb, 1, 0.5, NOW(), NOW())
         ON CONFLICT (user_id, COALESCE(agent_id, ''), name)
         DO UPDATE SET
           mention_count = knowledge_entities.mention_count + 1,
           description = COALESCE(NULLIF(?, ''), knowledge_entities.description),
           source_ids = (
             SELECT COALESCE(jsonb_agg(DISTINCT elem), '[]'::jsonb)
             FROM jsonb_array_elements(knowledge_entities.source_ids || ?::jsonb) AS elem
           ),
           importance = LEAST(1.0, knowledge_entities.importance + 0.05),
           updated_at = NOW()
         RETURNING id`,
        [randomUUID(), userId, effectiveAgentId, name, entityType, description, sourceIds, description, sourceIds],
      );

      if (rows.length > 0) {
        entityIdMap.set(name.toLowerCase(), rows[0]!.id);
        entityCount++;
      }

      // Generate and store embedding for the entity
      this.generateEntityEmbedding(rows[0]!.id, `${name}: ${description || entityType}`).catch(
        (err) => log.debug('Entity embedding failed', { entity: name, error: String(err) }),
      );
    }

    // Insert relations
    for (const relation of extracted.relations) {
      const sourceName = relation.source?.trim()?.toLowerCase();
      const targetName = relation.target?.trim()?.toLowerCase();
      if (!sourceName || !targetName) continue;

      const sourceEntityId = entityIdMap.get(sourceName);
      const targetEntityId = entityIdMap.get(targetName);
      if (!sourceEntityId || !targetEntityId) {
        log.debug('Skipping relation — entity not found', {
          source: relation.source,
          target: relation.target,
        });
        continue;
      }

      const relationType = relation.type || 'related_to';
      const context = relation.context || null;

      await db.execute(
        `INSERT INTO knowledge_relations (id, user_id, agent_id, source_entity_id, target_entity_id, relation_type, weight, properties, context, source_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 1.0, '{}', ?, ?, NOW(), NOW())
         ON CONFLICT (user_id, source_entity_id, target_entity_id, relation_type)
         DO UPDATE SET
           weight = knowledge_relations.weight + 0.1,
           context = COALESCE(NULLIF(?, ''), knowledge_relations.context),
           updated_at = NOW()`,
        [
          randomUUID(),
          userId,
          effectiveAgentId,
          sourceEntityId,
          targetEntityId,
          relationType,
          context,
          sourceId ?? null,
          context,
        ],
      );
      relationCount++;
    }

    log.info('Knowledge ingested', { entityCount, relationCount, userId });
    return { entityCount, relationCount };
  }

  // --------------------------------------------------------------------------
  // Hybrid Search
  // --------------------------------------------------------------------------

  async search(
    query: string,
    userId: string,
    options?: HybridSearchOptions,
  ): Promise<GraphQueryResult> {
    const mode = options?.mode ?? 'hybrid';
    const topK = options?.topK ?? DEFAULT_TOP_K;
    const agentId = options?.agentId ?? null;
    const minScore = options?.minScore ?? 0.0;

    const entities: KnowledgeEntity[] = [];
    const relations: KnowledgeRelation[] = [];
    const contextParts: string[] = [];
    let bestScore = 0;

    // Vector similarity search
    if (mode === 'hybrid' || mode === 'vector') {
      const vectorResults = await this.vectorSearch(query, userId, agentId, topK, minScore);
      for (const entity of vectorResults) {
        if (!entities.some((e) => e.id === entity.id)) {
          entities.push(entity);
        }
      }
    }

    // Graph traversal — expand from vector hits
    if (mode === 'hybrid' || mode === 'graph') {
      const seedIds = entities.slice(0, 3).map((e) => e.id);
      for (const seedId of seedIds) {
        const neighbors = await this.getNeighbors(seedId, userId, 1);
        for (const entity of neighbors.entities) {
          if (!entities.some((e) => e.id === entity.id)) {
            entities.push(entity);
          }
        }
        for (const relation of neighbors.relations) {
          if (!relations.some((r) => r.id === relation.id)) {
            relations.push(relation);
          }
        }
      }
    }

    // Keyword search (pg_trgm)
    if (mode === 'hybrid' || mode === 'keyword') {
      const keywordResults = await this.keywordSearch(query, userId, agentId, topK);
      for (const entity of keywordResults) {
        if (!entities.some((e) => e.id === entity.id)) {
          entities.push(entity);
        }
      }
    }

    // Fetch relations between found entities
    if (entities.length > 1 && relations.length === 0) {
      const entityIds = entities.map((e) => e.id);
      const fetchedRelations = await this.fetchRelationsBetween(entityIds, userId);
      relations.push(...fetchedRelations);
    }

    // LightRAG integration — merge if available
    if (mode === 'hybrid') {
      const lightRagResult = await this.queryLightRag(query, 'hybrid');
      if (lightRagResult) {
        contextParts.push(lightRagResult);
      }
    }

    // Build context summary
    if (entities.length > 0) {
      const entitySummary = entities
        .slice(0, topK)
        .map((e) => `${e.name} (${e.entityType}): ${e.description || 'no description'}`)
        .join('\n');
      contextParts.unshift(entitySummary);
    }

    if (relations.length > 0) {
      const relationSummary = relations
        .slice(0, topK)
        .map((r) => {
          const src = entities.find((e) => e.id === r.sourceEntityId)?.name ?? r.sourceEntityId;
          const tgt = entities.find((e) => e.id === r.targetEntityId)?.name ?? r.targetEntityId;
          return `${src} --[${r.relationType}]--> ${tgt}`;
        })
        .join('\n');
      contextParts.push(relationSummary);
    }

    bestScore = entities.length > 0 ? entities[0]!.importance : 0;

    return {
      entities: entities.slice(0, topK),
      relations: relations.slice(0, topK),
      context: contextParts.join('\n\n'),
      score: bestScore,
    };
  }

  // --------------------------------------------------------------------------
  // Entity CRUD
  // --------------------------------------------------------------------------

  async getEntity(id: string, userId: string): Promise<KnowledgeEntity | null> {
    const db = getAdapterSync();
    const row = await db.queryOne<EntityRow>(
      `SELECT * FROM knowledge_entities WHERE id = ? AND user_id = ?`,
      [id, userId],
    );
    return row ? toEntity(row) : null;
  }

  async listEntities(
    userId: string,
    agentId?: string | null,
    options?: { type?: string; limit?: number; offset?: number },
  ): Promise<{ items: KnowledgeEntity[]; total: number }> {
    const db = getAdapterSync();
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions = ['user_id = ?'];
    const params: unknown[] = [userId];

    if (agentId !== undefined) {
      if (agentId === null) {
        conditions.push('agent_id IS NULL');
      } else {
        conditions.push(`agent_id = ?`);
        params.push(agentId);
      }
    }

    if (options?.type) {
      conditions.push(`entity_type = ?`);
      params.push(options.type);
    }

    const where = conditions.join(' AND ');

    const countRow = await db.queryOne<CountRow>(
      `SELECT COUNT(*) AS count FROM knowledge_entities WHERE ${where}`,
      params,
    );
    const total = Number(countRow?.count ?? 0);

    const rows = await db.query<EntityRow>(
      `SELECT * FROM knowledge_entities WHERE ${where} ORDER BY importance DESC, updated_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    return { items: rows.map(toEntity), total };
  }

  async deleteEntity(id: string, userId: string): Promise<void> {
    const db = getAdapterSync();
    // Delete relations first (both directions)
    await db.execute(
      `DELETE FROM knowledge_relations WHERE user_id = ? AND (source_entity_id = ? OR target_entity_id = ?)`,
      [userId, id, id],
    );
    await db.execute(
      `DELETE FROM knowledge_entities WHERE id = ? AND user_id = ?`,
      [id, userId],
    );
  }

  // --------------------------------------------------------------------------
  // Neighbors (Graph Traversal)
  // --------------------------------------------------------------------------

  async getNeighbors(
    entityId: string,
    userId: string,
    depth: number = DEFAULT_DEPTH,
  ): Promise<{ entities: KnowledgeEntity[]; relations: KnowledgeRelation[] }> {
    const db = getAdapterSync();

    // Recursive CTE for N-hop neighbor discovery
    const entityRows = await db.query<EntityRow>(
      `WITH RECURSIVE hops AS (
        -- Seed: the starting entity
        SELECT id, 0 AS depth
        FROM knowledge_entities
        WHERE id = ? AND user_id = ?

        UNION

        -- Expand through relations (both directions)
        SELECT CASE
          WHEN kr.source_entity_id = h.id THEN kr.target_entity_id
          ELSE kr.source_entity_id
        END AS id,
        h.depth + 1 AS depth
        FROM hops h
        JOIN knowledge_relations kr ON (kr.source_entity_id = h.id OR kr.target_entity_id = h.id)
          AND kr.user_id = ?
        WHERE h.depth < ?
      )
      SELECT DISTINCT ke.*
      FROM hops h
      JOIN knowledge_entities ke ON ke.id = h.id AND ke.user_id = ?
      WHERE ke.id != ?
      ORDER BY ke.importance DESC
      LIMIT 50`,
      [entityId, userId, userId, depth, userId, entityId],
    );

    const entities = entityRows.map(toEntity);
    const allIds = [entityId, ...entities.map((e) => e.id)];
    const relations = await this.fetchRelationsBetween(allIds, userId);

    return { entities, relations };
  }

  // --------------------------------------------------------------------------
  // Collections
  // --------------------------------------------------------------------------

  async createCollection(
    userId: string,
    agentId: string | null,
    name: string,
    description?: string,
  ): Promise<KnowledgeCollection> {
    const db = getAdapterSync();
    const id = randomUUID();

    const row = await db.queryOne<CollectionRow>(
      `INSERT INTO knowledge_collections (id, user_id, agent_id, name, description, config, entity_count, relation_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', 0, 0, NOW(), NOW())
       RETURNING *`,
      [id, userId, agentId, name, description ?? null],
    );

    return toCollection(row!);
  }

  async listCollections(
    userId: string,
    agentId?: string | null,
  ): Promise<KnowledgeCollection[]> {
    const db = getAdapterSync();

    if (agentId !== undefined) {
      if (agentId === null) {
        const rows = await db.query<CollectionRow>(
          `SELECT * FROM knowledge_collections WHERE user_id = ? AND agent_id IS NULL ORDER BY created_at DESC`,
          [userId],
        );
        return rows.map(toCollection);
      }
      const rows = await db.query<CollectionRow>(
        `SELECT * FROM knowledge_collections WHERE user_id = ? AND agent_id = ? ORDER BY created_at DESC`,
        [userId, agentId],
      );
      return rows.map(toCollection);
    }

    const rows = await db.query<CollectionRow>(
      `SELECT * FROM knowledge_collections WHERE user_id = ? ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(toCollection);
  }

  async deleteCollection(id: string, userId: string): Promise<void> {
    const db = getAdapterSync();
    await db.execute(
      `DELETE FROM knowledge_collections WHERE id = ? AND user_id = ?`,
      [id, userId],
    );
  }

  // --------------------------------------------------------------------------
  // LightRAG Integration
  // --------------------------------------------------------------------------

  async insertDocument(
    text: string,
    _userId: string,
    _agentId?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    const payload: LightRagInsertPayload = { text, metadata };
    const result = await lightRagFetch<{ status: string }>('/documents/insert', payload);
    if (!result) {
      log.debug('LightRAG document insert skipped — service unavailable');
    }
  }

  async queryLightRag(
    query: string,
    mode: 'hybrid' | 'naive' | 'local' | 'global' = 'hybrid',
  ): Promise<string | null> {
    const payload: LightRagQueryPayload = { query, mode };
    const result = await lightRagFetch<{ response?: string; result?: string }>('/query', payload);
    return result?.response ?? result?.result ?? null;
  }

  async isLightRagAvailable(): Promise<boolean> {
    const baseUrl = process.env.LIGHTRAG_URL;
    if (!baseUrl) return false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(`${baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  // --------------------------------------------------------------------------
  // Decay
  // --------------------------------------------------------------------------

  async applyDecay(userId: string, decayFactor: number = DEFAULT_DECAY_FACTOR): Promise<number> {
    const db = getAdapterSync();
    const result = await db.execute(
      `UPDATE knowledge_entities
       SET importance = importance * ?, updated_at = NOW()
       WHERE user_id = ? AND importance > ?`,
      [decayFactor, userId, MIN_IMPORTANCE_THRESHOLD],
    );
    const affected = result.changes;
    log.info('Decay applied', { userId, decayFactor, affectedEntities: affected });
    return affected;
  }

  // --------------------------------------------------------------------------
  // Private Helpers
  // --------------------------------------------------------------------------

  /**
   * Vector similarity search using pgvector cosine distance.
   */
  private async vectorSearch(
    query: string,
    userId: string,
    agentId: string | null,
    topK: number,
    minScore: number,
  ): Promise<KnowledgeEntity[]> {
    try {
      const embeddingService = getEmbeddingService();
      if (!embeddingService.isAvailable()) {
        log.debug('Embedding service not available, skipping vector search');
        return [];
      }

      const { embedding } = await embeddingService.generateEmbedding(query);
      const vectorLiteral = `[${embedding.join(',')}]`;

      const db = getAdapterSync();

      // Cosine similarity: 1 - cosine distance
      const agentFilter = agentId
        ? `AND ke.agent_id = ?`
        : `AND ke.agent_id IS NULL`;

      const params: unknown[] = [vectorLiteral, userId];
      if (agentId) params.push(agentId);
      params.push(vectorLiteral, topK);

      const rows = await db.query<EntityRow & { similarity: number }>(
        `SELECT ke.*, 1 - (kee.embedding <=> ?::vector) AS similarity
         FROM knowledge_entities ke
         JOIN knowledge_entity_embeddings kee ON kee.entity_id = ke.id
         WHERE ke.user_id = ? ${agentFilter}
         ORDER BY kee.embedding <=> ?::vector
         LIMIT ?`,
        params,
      );

      return rows
        .filter((r) => Number(r.similarity) >= minScore)
        .map(toEntity);
    } catch (err) {
      log.warn('Vector search failed, falling back to keyword only', { error: String(err) });
      return [];
    }
  }

  /**
   * Keyword search using pg_trgm similarity.
   */
  private async keywordSearch(
    query: string,
    userId: string,
    agentId: string | null,
    topK: number,
  ): Promise<KnowledgeEntity[]> {
    const db = getAdapterSync();

    const agentFilter = agentId
      ? `AND agent_id = ?`
      : `AND agent_id IS NULL`;

    const params: unknown[] = [userId];
    if (agentId) params.push(agentId);
    const likePattern = `%${query}%`;
    params.push(likePattern, likePattern, topK);

    const rows = await db.query<EntityRow>(
      `SELECT * FROM knowledge_entities
       WHERE user_id = ?
         ${agentFilter}
         AND (name ILIKE ? OR description ILIKE ?)
       ORDER BY importance DESC, updated_at DESC
       LIMIT ?`,
      params,
    );

    return rows.map(toEntity);
  }

  /**
   * Fetch all relations between a set of entity IDs.
   */
  private async fetchRelationsBetween(
    entityIds: string[],
    userId: string,
  ): Promise<KnowledgeRelation[]> {
    if (entityIds.length === 0) return [];

    const db = getAdapterSync();

    // Build parameterized IN clause
    const placeholders = entityIds.map(() => '?').join(', ');
    const params: unknown[] = [userId, ...entityIds, ...entityIds];

    const rows = await db.query<RelationRow>(
      `SELECT * FROM knowledge_relations
       WHERE user_id = ?
         AND source_entity_id IN (${placeholders})
         AND target_entity_id IN (${placeholders})
       ORDER BY weight DESC
       LIMIT 100`,
      params,
    );

    return rows.map(toRelation);
  }

  /**
   * Generate and store embedding for a knowledge entity.
   */
  private async generateEntityEmbedding(entityId: string, text: string): Promise<void> {
    const embeddingService = getEmbeddingService();
    if (!embeddingService.isAvailable()) return;

    const { embedding } = await embeddingService.generateEmbedding(text);
    const vectorLiteral = `[${embedding.join(',')}]`;

    const db = getAdapterSync();
    await db.execute(
      `INSERT INTO knowledge_entity_embeddings (entity_id, embedding, updated_at)
       VALUES (?, ?::vector, NOW())
       ON CONFLICT (entity_id) DO UPDATE SET embedding = ?::vector, updated_at = NOW()`,
      [entityId, vectorLiteral, vectorLiteral],
    );
  }

  /**
   * Resolve the AI provider for entity extraction.
   */
  private async resolveProvider() {
    const { getProviderApiKey, loadProviderConfig, NATIVE_PROVIDERS } =
      await import('../routes/agent-cache.js');
    const { resolveProviderAndModel } = await import('../routes/settings.js');

    const resolved = await resolveProviderAndModel('default', 'default');
    const providerName = resolved.provider;
    if (!providerName) {
      throw new Error('No AI provider configured. Set up a provider in Settings.');
    }

    const apiKey = await getProviderApiKey(providerName);
    const providerCfg = loadProviderConfig(providerName);
    const providerType = NATIVE_PROVIDERS.has(providerName) ? providerName : 'openai';

    return createProvider({
      provider: providerType as ProviderConfig['provider'],
      apiKey,
      baseUrl: providerCfg?.baseUrl,
      headers: providerCfg?.headers,
    });
  }

  /**
   * Resolve the model name for entity extraction.
   */
  private async resolveModel(): Promise<string> {
    const { resolveProviderAndModel } = await import('../routes/settings.js');
    const resolved = await resolveProviderAndModel('default', 'default');
    return resolved.model ?? 'gpt-4o-mini';
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _instance: GraphRagService | null = null;

export function getGraphRagService(): GraphRagService {
  if (!_instance) {
    _instance = new GraphRagService();
  }
  return _instance;
}
