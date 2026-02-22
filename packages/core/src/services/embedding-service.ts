/**
 * IEmbeddingService - Embedding Generation Interface
 *
 * Generates vector embeddings for text content.
 * Used for semantic search in memories and other resources.
 *
 * Usage:
 *   const embeddings = registry.get(Services.Embedding);
 *   if (embeddings.isAvailable()) {
 *     const result = await embeddings.generateEmbedding('some text');
 *   }
 */

// ============================================================================
// Types
// ============================================================================

export interface EmbeddingResult {
  readonly embedding: number[];
  readonly cached: boolean;
}

// ============================================================================
// IEmbeddingService
// ============================================================================

export interface IEmbeddingService {
  /**
   * Generate an embedding for a single text string.
   */
  generateEmbedding(text: string): Promise<EmbeddingResult>;

  /**
   * Generate embeddings for multiple text strings.
   */
  generateBatchEmbeddings(texts: string[]): Promise<EmbeddingResult[]>;

  /**
   * Check if the embedding service is available (has valid API key).
   */
  isAvailable(): boolean;
}
