/**
 * Graph RAG Service Interface
 *
 * Manages knowledge graph (entities + relations) with hybrid retrieval
 * (vector similarity + graph traversal). Knowledge is scoped by user_id + agent_id.
 */

export interface KnowledgeEntity {
  id: string;
  userId: string;
  agentId: string | null;
  name: string;
  entityType: string;
  description: string | null;
  properties: Record<string, unknown>;
  sourceIds: string[];
  mentionCount: number;
  importance: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeRelation {
  id: string;
  userId: string;
  agentId: string | null;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  weight: number;
  properties: Record<string, unknown>;
  context: string | null;
  sourceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeCollection {
  id: string;
  userId: string;
  agentId: string | null;
  name: string;
  description: string | null;
  config: Record<string, unknown>;
  entityCount: number;
  relationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GraphQueryResult {
  entities: KnowledgeEntity[];
  relations: KnowledgeRelation[];
  context: string;
  score: number;
}

export interface ExtractedKnowledge {
  entities: Array<{ name: string; type: string; description?: string }>;
  relations: Array<{ source: string; target: string; type: string; context?: string }>;
}

export interface HybridSearchOptions {
  mode?: 'hybrid' | 'vector' | 'graph' | 'keyword';
  topK?: number;
  agentId?: string | null;
  collectionId?: string | null;
  minScore?: number;
}

export interface IGraphRagService {
  /** Extract entities and relations from text using LLM */
  extractKnowledge(text: string, userId: string, agentId?: string | null): Promise<ExtractedKnowledge>;

  /** Ingest extracted knowledge into the graph */
  ingestKnowledge(
    extracted: ExtractedKnowledge,
    userId: string,
    agentId?: string | null,
    sourceId?: string,
  ): Promise<{ entityCount: number; relationCount: number }>;

  /** Hybrid search: combines vector similarity + graph traversal + keyword */
  search(query: string, userId: string, options?: HybridSearchOptions): Promise<GraphQueryResult>;

  /** Get entity by ID */
  getEntity(id: string, userId: string): Promise<KnowledgeEntity | null>;

  /** Get entity neighbors (related entities within N hops) */
  getNeighbors(
    entityId: string,
    userId: string,
    depth?: number,
  ): Promise<{ entities: KnowledgeEntity[]; relations: KnowledgeRelation[] }>;

  /** List entities for a user/agent */
  listEntities(
    userId: string,
    agentId?: string | null,
    options?: { type?: string; limit?: number; offset?: number },
  ): Promise<{ items: KnowledgeEntity[]; total: number }>;

  /** Delete entity and its relations */
  deleteEntity(id: string, userId: string): Promise<void>;

  /** Manage collections */
  createCollection(
    userId: string,
    agentId: string | null,
    name: string,
    description?: string,
  ): Promise<KnowledgeCollection>;
  listCollections(userId: string, agentId?: string | null): Promise<KnowledgeCollection[]>;
  deleteCollection(id: string, userId: string): Promise<void>;

  /** Insert document into LightRAG (if available) */
  insertDocument(
    text: string,
    userId: string,
    agentId?: string | null,
    metadata?: Record<string, unknown>,
  ): Promise<void>;

  /** Query LightRAG directly (if available) */
  queryLightRag(query: string, mode?: 'hybrid' | 'naive' | 'local' | 'global'): Promise<string | null>;

  /** Check if LightRAG is available */
  isLightRagAvailable(): Promise<boolean>;

  /** Apply memory decay — reduce importance of unused entities */
  applyDecay(userId: string, decayFactor?: number): Promise<number>;
}
