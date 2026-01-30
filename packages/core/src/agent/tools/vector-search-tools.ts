/**
 * Vector Search Tools
 * Semantic search and embeddings for RAG applications
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';

// ============================================================================
// CREATE EMBEDDING TOOL
// ============================================================================

export const createEmbeddingTool: ToolDefinition = {
  name: 'create_embedding',
  description: 'Generate vector embeddings for text using AI models. Useful for semantic search and similarity comparisons. Provide either "text" (single string) or "texts" (array for batch) — at least one is required.',
  parameters: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'Single text to create embedding for. Provide this OR "texts", not both.',
      },
      texts: {
        type: 'array',
        description: 'Multiple texts to embed in batch (max 100). Provide this OR "text", not both.',
        items: { type: 'string' },
      },
      model: {
        type: 'string',
        description: 'Embedding model to use (default: text-embedding-3-small)',
        enum: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'],
      },
      dimensions: {
        type: 'number',
        description: 'Output dimensions (for models that support it, e.g. 256, 512, 1536)',
      },
    },
    required: [],
  },
};

export const createEmbeddingExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const text = params.text as string | undefined;
  const texts = params.texts as string[] | undefined;
  const model = (params.model as string) || 'text-embedding-3-small';
  const dimensions = params.dimensions as number | undefined;

  if (!text && (!texts || texts.length === 0)) {
    return {
      content: { error: 'Either text or texts array is required' },
      isError: true,
    };
  }

  const inputTexts = texts || [text!];

  if (inputTexts.length > 100) {
    return {
      content: { error: 'Maximum 100 texts per batch' },
      isError: true,
    };
  }

  // Check for empty texts
  const emptyIndices = inputTexts
    .map((t, i) => (t.trim().length === 0 ? i : -1))
    .filter(i => i >= 0);

  if (emptyIndices.length > 0) {
    return {
      content: { error: `Empty text at indices: ${emptyIndices.join(', ')}` },
      isError: true,
    };
  }

  // Return placeholder - actual embedding requires AI provider
  return {
    content: {
      model,
      dimensions,
      inputCount: inputTexts.length,
      inputPreview: inputTexts.slice(0, 3).map(t =>
        t.length > 50 ? t.substring(0, 50) + '...' : t
      ),
      requiresEmbeddingAPI: true,
      note: 'Embedding creation requires AI provider integration (OpenAI, Anthropic, etc.). Override this executor in gateway.',
    },
    isError: false,
  };
};

// ============================================================================
// SEMANTIC SEARCH TOOL
// ============================================================================

export const semanticSearchTool: ToolDefinition = {
  name: 'semantic_search',
  description: 'Search for semantically similar content in a vector store',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (will be converted to embedding)',
      },
      collection: {
        type: 'string',
        description: 'Vector collection/index name to search',
      },
      topK: {
        type: 'number',
        description: 'Number of results to return (default: 10)',
      },
      threshold: {
        type: 'number',
        description: 'Minimum similarity score (0-1)',
      },
      filter: {
        type: 'object',
        description: 'Metadata filters to apply',
      },
      includeMetadata: {
        type: 'boolean',
        description: 'Include metadata in results',
      },
      includeEmbeddings: {
        type: 'boolean',
        description: 'Include raw embeddings in results',
      },
    },
    required: ['query', 'collection'],
  },
};

export const semanticSearchExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const query = params.query as string;
  const collection = params.collection as string;
  const topK = (params.topK as number) || 10;
  const threshold = params.threshold as number | undefined;
  const filter = params.filter as Record<string, unknown> | undefined;
  const includeMetadata = params.includeMetadata !== false;
  const includeEmbeddings = params.includeEmbeddings === true;

  if (!query.trim()) {
    return {
      content: { error: 'Query is required' },
      isError: true,
    };
  }

  // Return placeholder - actual search requires vector database
  return {
    content: {
      query,
      collection,
      topK,
      threshold,
      filter,
      includeMetadata,
      includeEmbeddings,
      requiresVectorDB: true,
      note: 'Semantic search requires vector database integration (Pinecone, Milvus, Chroma, etc.). Override this executor in gateway.',
      supportedDatabases: ['pinecone', 'milvus', 'chroma', 'weaviate', 'qdrant', 'pgvector'],
    },
    isError: false,
  };
};

// ============================================================================
// UPSERT VECTORS TOOL
// ============================================================================

export const upsertVectorsTool: ToolDefinition = {
  name: 'upsert_vectors',
  description: 'Insert or update vectors in a collection. Provide either "vectors" (pre-computed embeddings) or "texts" (will be auto-embedded) — at least one is required alongside "collection".',
  parameters: {
    type: 'object',
    properties: {
      collection: {
        type: 'string',
        description: 'Vector collection/index name',
      },
      vectors: {
        type: 'array',
        description: 'Array of pre-computed vectors with id, values, and optional metadata. Provide this OR "texts".',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            values: { type: 'array', items: { type: 'number' } },
            metadata: { type: 'object' },
          },
        },
      },
      texts: {
        type: 'array',
        description: 'Array of texts to auto-embed and store. Provide this OR "vectors".',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            text: { type: 'string' },
            metadata: { type: 'object' },
          },
        },
      },
      namespace: {
        type: 'string',
        description: 'Namespace/partition for the vectors',
      },
    },
    required: ['collection'],
  },
};

export const upsertVectorsExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const collection = params.collection as string;
  const vectors = params.vectors as Array<{
    id: string;
    values: number[];
    metadata?: Record<string, unknown>;
  }> | undefined;
  const texts = params.texts as Array<{
    id: string;
    text: string;
    metadata?: Record<string, unknown>;
  }> | undefined;
  const namespace = params.namespace as string | undefined;

  if (!vectors && !texts) {
    return {
      content: { error: 'Either vectors or texts array is required' },
      isError: true,
    };
  }

  const count = vectors?.length || texts?.length || 0;

  if (count > 1000) {
    return {
      content: { error: 'Maximum 1000 vectors per batch' },
      isError: true,
    };
  }

  return {
    content: {
      collection,
      namespace,
      vectorCount: vectors?.length || 0,
      textCount: texts?.length || 0,
      requiresVectorDB: true,
      requiresEmbeddingAPI: !!texts,
      note: 'Vector upsert requires vector database integration. Override this executor in gateway.',
    },
    isError: false,
  };
};

// ============================================================================
// DELETE VECTORS TOOL
// ============================================================================

export const deleteVectorsTool: ToolDefinition = {
  name: 'delete_vectors',
  description: 'Delete vectors from a collection',
  parameters: {
    type: 'object',
    properties: {
      collection: {
        type: 'string',
        description: 'Vector collection/index name',
      },
      ids: {
        type: 'array',
        description: 'Vector IDs to delete',
        items: { type: 'string' },
      },
      filter: {
        type: 'object',
        description: 'Delete vectors matching filter',
      },
      deleteAll: {
        type: 'boolean',
        description: 'Delete all vectors in collection (dangerous!)',
      },
      namespace: {
        type: 'string',
        description: 'Namespace/partition',
      },
    },
    required: ['collection'],
  },
};

export const deleteVectorsExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const collection = params.collection as string;
  const ids = params.ids as string[] | undefined;
  const filter = params.filter as Record<string, unknown> | undefined;
  const deleteAll = params.deleteAll === true;
  const namespace = params.namespace as string | undefined;

  if (!ids && !filter && !deleteAll) {
    return {
      content: { error: 'Must specify ids, filter, or deleteAll' },
      isError: true,
    };
  }

  if (deleteAll) {
    return {
      content: {
        warning: 'This will delete ALL vectors in the collection',
        collection,
        namespace,
        requiresConfirmation: true,
        requiresVectorDB: true,
      },
      isError: false,
    };
  }

  return {
    content: {
      collection,
      namespace,
      idsToDelete: ids?.length || 0,
      filterProvided: !!filter,
      requiresVectorDB: true,
      note: 'Vector deletion requires vector database integration.',
    },
    isError: false,
  };
};

// ============================================================================
// LIST COLLECTIONS TOOL
// ============================================================================

export const listCollectionsTool: ToolDefinition = {
  name: 'list_vector_collections',
  description: 'List all vector collections/indexes. Optionally include statistics like vector count.',
  parameters: {
    type: 'object',
    properties: {
      includeStats: {
        type: 'boolean',
        description: 'Include vector count and other statistics (default: false)',
      },
    },
    required: [],
  },
};

export const listCollectionsExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const includeStats = params.includeStats === true;

  return {
    content: {
      includeStats,
      requiresVectorDB: true,
      note: 'Collection listing requires vector database integration.',
    },
    isError: false,
  };
};

// ============================================================================
// CREATE COLLECTION TOOL
// ============================================================================

export const createCollectionTool: ToolDefinition = {
  name: 'create_vector_collection',
  description: 'Create a new vector collection/index',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Collection name',
      },
      dimensions: {
        type: 'number',
        description: 'Vector dimensions (must match embedding model)',
      },
      metric: {
        type: 'string',
        description: 'Distance metric',
        enum: ['cosine', 'euclidean', 'dotproduct'],
      },
      metadata: {
        type: 'object',
        description: 'Collection metadata/configuration',
      },
    },
    required: ['name', 'dimensions'],
  },
};

export const createCollectionExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const name = params.name as string;
  const dimensions = params.dimensions as number;
  const metric = (params.metric as string) || 'cosine';
  const metadata = params.metadata as Record<string, unknown> | undefined;

  // Common dimension sizes
  const commonDimensions = [384, 768, 1024, 1536, 3072];

  if (!commonDimensions.includes(dimensions)) {
    return {
      content: {
        warning: `Unusual dimension size: ${dimensions}. Common sizes: ${commonDimensions.join(', ')}`,
        name,
        dimensions,
        metric,
        metadata,
        requiresVectorDB: true,
      },
      isError: false,
    };
  }

  return {
    content: {
      name,
      dimensions,
      metric,
      metadata,
      requiresVectorDB: true,
      note: 'Collection creation requires vector database integration.',
    },
    isError: false,
  };
};

// ============================================================================
// SIMILARITY SCORE TOOL
// ============================================================================

export const similarityScoreTool: ToolDefinition = {
  name: 'similarity_score',
  description: 'Calculate similarity between two texts or two vectors. Provide either (text1 + text2) for text comparison or (vector1 + vector2) for direct vector comparison.',
  parameters: {
    type: 'object',
    properties: {
      text1: {
        type: 'string',
        description: 'First text to compare (requires embedding API). Use with text2.',
      },
      text2: {
        type: 'string',
        description: 'Second text to compare (requires embedding API). Use with text1.',
      },
      vector1: {
        type: 'array',
        description: 'First vector for direct comparison (array of numbers). Use with vector2.',
        items: { type: 'number' },
      },
      vector2: {
        type: 'array',
        description: 'Second vector for direct comparison (array of numbers). Use with vector1.',
        items: { type: 'number' },
      },
      metric: {
        type: 'string',
        description: 'Similarity metric (default: cosine)',
        enum: ['cosine', 'euclidean', 'dotproduct'],
      },
    },
    required: [],
  },
};

export const similarityScoreExecutor: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const text1 = params.text1 as string | undefined;
  const text2 = params.text2 as string | undefined;
  const vector1 = params.vector1 as number[] | undefined;
  const vector2 = params.vector2 as number[] | undefined;
  const metric = (params.metric as string) || 'cosine';

  // If vectors provided, calculate directly
  if (vector1 && vector2) {
    if (vector1.length !== vector2.length) {
      return {
        content: { error: 'Vectors must have same dimensions' },
        isError: true,
      };
    }

    let score: number;

    switch (metric) {
      case 'cosine':
        score = cosineSimilarity(vector1, vector2);
        break;
      case 'euclidean':
        score = 1 / (1 + euclideanDistance(vector1, vector2));
        break;
      case 'dotproduct':
        score = dotProduct(vector1, vector2);
        break;
      default:
        score = cosineSimilarity(vector1, vector2);
    }

    return {
      content: {
        similarity: score,
        metric,
        dimensions: vector1.length,
      },
      isError: false,
    };
  }

  // If texts provided, need embedding API
  if (text1 && text2) {
    return {
      content: {
        text1Preview: text1.substring(0, 50) + (text1.length > 50 ? '...' : ''),
        text2Preview: text2.substring(0, 50) + (text2.length > 50 ? '...' : ''),
        metric,
        requiresEmbeddingAPI: true,
        note: 'Text similarity requires embedding API to generate vectors first.',
      },
      isError: false,
    };
  }

  return {
    content: { error: 'Provide either (text1, text2) or (vector1, vector2)' },
    isError: true,
  };
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function dotProduct(a: number[], b: number[]): number {
  return a.reduce((sum, val, i) => sum + val * b[i]!, 0);
}

function magnitude(v: number[]): number {
  return Math.sqrt(v.reduce((sum, val) => sum + val * val, 0));
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = dotProduct(a, b);
  const magA = magnitude(a);
  const magB = magnitude(b);
  return magA && magB ? dot / (magA * magB) : 0;
}

function euclideanDistance(a: number[], b: number[]): number {
  return Math.sqrt(a.reduce((sum, val, i) => sum + Math.pow(val - b[i]!, 2), 0));
}

// ============================================================================
// EXPORT ALL VECTOR SEARCH TOOLS
// ============================================================================

export const VECTOR_SEARCH_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: createEmbeddingTool, executor: createEmbeddingExecutor },
  { definition: semanticSearchTool, executor: semanticSearchExecutor },
  { definition: upsertVectorsTool, executor: upsertVectorsExecutor },
  { definition: deleteVectorsTool, executor: deleteVectorsExecutor },
  { definition: listCollectionsTool, executor: listCollectionsExecutor },
  { definition: createCollectionTool, executor: createCollectionExecutor },
  { definition: similarityScoreTool, executor: similarityScoreExecutor },
];

export const VECTOR_SEARCH_TOOL_NAMES = VECTOR_SEARCH_TOOLS.map((t) => t.definition.name);
