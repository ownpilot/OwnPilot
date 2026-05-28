import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ToolDefinition } from '@ownpilot/core';

const hasEmbeddingMock = vi.fn();
const getEmbeddingMock = vi.fn();

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    hasEmbeddingService: () => hasEmbeddingMock(),
    getEmbeddingService: () => getEmbeddingMock(),
  };
});

import {
  semanticSearchTools,
  buildToolSearchText,
  _clearToolEmbeddingCache,
} from './semantic-search.js';

const toolA: ToolDefinition = {
  name: 'core.send_email',
  description: 'Send an email message to one or more recipients.',
  parameters: { type: 'object', properties: {} },
  category: 'Communication',
  tags: ['email', 'send', 'message'],
};

const toolB: ToolDefinition = {
  name: 'core.add_task',
  description: 'Create a new task in the productivity tracker.',
  parameters: { type: 'object', properties: {} },
  category: 'Tasks',
  tags: ['task', 'todo', 'productivity'],
};

const toolC: ToolDefinition = {
  name: 'core.search_web',
  description: 'Search the web and return ranked results.',
  parameters: { type: 'object', properties: {} },
  category: 'Web',
  tags: ['search', 'web', 'google'],
};

// Embeddings designed so the query "I want to mail someone" lands closest to
// toolA, then toolB (productivity, weakly related), then toolC (off-topic).
const QUERY_VEC = [1, 0, 0];
const VEC_A = [0.95, 0.1, 0.05];
const VEC_B = [0.4, 0.7, 0.2];
const VEC_C = [0.1, 0.2, 0.9];

beforeEach(() => {
  _clearToolEmbeddingCache();
  hasEmbeddingMock.mockReset();
  getEmbeddingMock.mockReset();
});

describe('buildToolSearchText', () => {
  it('combines base name, full name, description, category, tags', () => {
    const text = buildToolSearchText(toolA);
    expect(text).toContain('send email');
    expect(text).toContain('core send email');
    expect(text).toContain('Send an email message');
    expect(text).toContain('Communication');
    expect(text).toContain('email send message');
  });
});

describe('semanticSearchTools', () => {
  it('returns null when the embedding service is not registered', async () => {
    hasEmbeddingMock.mockReturnValue(false);
    const result = await semanticSearchTools('mail someone', [toolA, toolB, toolC]);
    expect(result).toBeNull();
  });

  it('returns null when the embedding service exists but is not available', async () => {
    hasEmbeddingMock.mockReturnValue(true);
    getEmbeddingMock.mockReturnValue({
      isAvailable: () => false,
      generateEmbedding: vi.fn(),
      generateBatchEmbeddings: vi.fn(),
    });
    const result = await semanticSearchTools('mail someone', [toolA, toolB, toolC]);
    expect(result).toBeNull();
  });

  it('returns an empty (complete) result when there are no candidates', async () => {
    hasEmbeddingMock.mockReturnValue(true);
    getEmbeddingMock.mockReturnValue({
      isAvailable: () => true,
      generateEmbedding: vi.fn(),
      generateBatchEmbeddings: vi.fn(),
    });
    const result = await semanticSearchTools('anything', []);
    expect(result).toEqual({ matches: [], complete: true });
  });

  it('returns null when the query embedding call throws', async () => {
    hasEmbeddingMock.mockReturnValue(true);
    getEmbeddingMock.mockReturnValue({
      isAvailable: () => true,
      generateEmbedding: vi.fn().mockRejectedValue(new Error('upstream')),
      generateBatchEmbeddings: vi.fn(),
    });
    const result = await semanticSearchTools('mail', [toolA]);
    expect(result).toBeNull();
  });

  it('ranks tools by descending cosine similarity to the query', async () => {
    hasEmbeddingMock.mockReturnValue(true);
    const generateBatch = vi.fn().mockResolvedValue([
      { embedding: VEC_A, cached: false },
      { embedding: VEC_B, cached: false },
      { embedding: VEC_C, cached: false },
    ]);
    getEmbeddingMock.mockReturnValue({
      isAvailable: () => true,
      generateEmbedding: vi.fn().mockResolvedValue({ embedding: QUERY_VEC, cached: false }),
      generateBatchEmbeddings: generateBatch,
    });

    const result = await semanticSearchTools('mail someone', [toolA, toolB, toolC]);
    expect(result).not.toBeNull();
    expect(result!.complete).toBe(true);
    expect(result!.matches.map((m) => m.def.name)).toEqual([
      'core.send_email',
      'core.add_task',
      'core.search_web',
    ]);
    // Scores monotonically decreasing
    expect(result!.matches[0]!.score).toBeGreaterThan(result!.matches[1]!.score);
    expect(result!.matches[1]!.score).toBeGreaterThan(result!.matches[2]!.score);
  });

  it('reuses cached embeddings on a second call (no second batch request)', async () => {
    hasEmbeddingMock.mockReturnValue(true);
    const generateBatch = vi.fn().mockResolvedValue([
      { embedding: VEC_A, cached: false },
      { embedding: VEC_B, cached: false },
      { embedding: VEC_C, cached: false },
    ]);
    const generateOne = vi.fn().mockResolvedValue({ embedding: QUERY_VEC, cached: false });
    getEmbeddingMock.mockReturnValue({
      isAvailable: () => true,
      generateEmbedding: generateOne,
      generateBatchEmbeddings: generateBatch,
    });

    await semanticSearchTools('q1', [toolA, toolB, toolC]);
    expect(generateBatch).toHaveBeenCalledTimes(1);

    // Second query — tool definitions unchanged, no re-embedding.
    await semanticSearchTools('q2', [toolA, toolB, toolC]);
    expect(generateBatch).toHaveBeenCalledTimes(1);
    expect(generateOne).toHaveBeenCalledTimes(2); // queries still embedded
  });

  it('re-embeds when a tool definition changes (different content hash)', async () => {
    hasEmbeddingMock.mockReturnValue(true);
    const generateBatch = vi
      .fn()
      .mockResolvedValueOnce([
        { embedding: VEC_A, cached: false },
        { embedding: VEC_B, cached: false },
      ])
      .mockResolvedValueOnce([{ embedding: VEC_C, cached: false }]);
    getEmbeddingMock.mockReturnValue({
      isAvailable: () => true,
      generateEmbedding: vi.fn().mockResolvedValue({ embedding: QUERY_VEC, cached: false }),
      generateBatchEmbeddings: generateBatch,
    });

    await semanticSearchTools('q', [toolA, toolB]);
    expect(generateBatch).toHaveBeenCalledTimes(1);

    const toolAChanged: ToolDefinition = { ...toolA, description: 'Different description now.' };
    await semanticSearchTools('q', [toolAChanged, toolB]);
    expect(generateBatch).toHaveBeenCalledTimes(2);
    // Only the changed tool is in the second batch.
    expect(generateBatch.mock.calls[1]![0]).toHaveLength(1);
  });

  it('reports complete=false when batch returns a partial result', async () => {
    hasEmbeddingMock.mockReturnValue(true);
    const generateBatch = vi.fn().mockResolvedValue([
      { embedding: VEC_A, cached: false },
      // tool B has empty embedding — should be skipped
      { embedding: [], cached: false },
    ]);
    getEmbeddingMock.mockReturnValue({
      isAvailable: () => true,
      generateEmbedding: vi.fn().mockResolvedValue({ embedding: QUERY_VEC, cached: false }),
      generateBatchEmbeddings: generateBatch,
    });

    const result = await semanticSearchTools('q', [toolA, toolB]);
    expect(result).not.toBeNull();
    expect(result!.complete).toBe(false);
    expect(result!.matches.map((m) => m.def.name)).toEqual(['core.send_email']);
  });

  it('still returns ranked partial matches when batch throws (uses prior cache)', async () => {
    hasEmbeddingMock.mockReturnValue(true);
    const generateBatch = vi
      .fn()
      .mockResolvedValueOnce([
        { embedding: VEC_A, cached: false },
        { embedding: VEC_B, cached: false },
      ])
      .mockRejectedValueOnce(new Error('rate-limit'));
    getEmbeddingMock.mockReturnValue({
      isAvailable: () => true,
      generateEmbedding: vi.fn().mockResolvedValue({ embedding: QUERY_VEC, cached: false }),
      generateBatchEmbeddings: generateBatch,
    });

    // Seed cache with first two tools.
    await semanticSearchTools('q', [toolA, toolB]);

    // Add a new tool — batch fails, so only the cached ones rank.
    const result = await semanticSearchTools('q', [toolA, toolB, toolC]);
    expect(result).not.toBeNull();
    expect(result!.complete).toBe(false);
    const names = result!.matches.map((m) => m.def.name);
    expect(names).toContain('core.send_email');
    expect(names).toContain('core.add_task');
    expect(names).not.toContain('core.search_web');
  });
});
