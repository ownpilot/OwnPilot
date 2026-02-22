/**
 * Markdown-Aware Text Chunking
 *
 * Splits long text into semantic chunks for embedding generation.
 * Preserves heading context so each chunk is self-contained.
 *
 * Split hierarchy: heading → paragraph → sentence → hard split
 */

import { EMBEDDING_MAX_CHUNK_CHARS, EMBEDDING_MIN_CHUNK_CHARS } from '../config/defaults.js';

// ============================================================================
// Types
// ============================================================================

export interface TextChunk {
  /** Chunk content (with heading context prepended) */
  text: string;
  /** Position in parent document (0-based) */
  index: number;
  /** Parent heading(s) joined by " > " */
  headingContext: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Split markdown text into semantic chunks, preserving heading context.
 *
 * Each chunk gets the parent heading(s) prepended so the embedding
 * captures the section context even when the chunk is small.
 */
export function chunkMarkdown(
  text: string,
  maxChunkChars: number = EMBEDDING_MAX_CHUNK_CHARS
): TextChunk[] {
  const trimmed = text.trim();

  // Empty text → no chunks
  if (trimmed.length === 0) return [];

  // If text is short enough, return as single chunk
  if (trimmed.length <= maxChunkChars) {
    return [{ text: trimmed, index: 0, headingContext: '' }];
  }

  const lines = trimmed.split('\n');
  const chunks: TextChunk[] = [];
  let currentChunk = '';
  const currentHeadings: string[] = [];
  let chunkIndex = 0;

  function flushChunk() {
    const content = currentChunk.trim();
    if (content.length >= EMBEDDING_MIN_CHUNK_CHARS) {
      const headingContext = currentHeadings.filter(Boolean).join(' > ');
      const fullText = headingContext ? `${headingContext}\n\n${content}` : content;
      chunks.push({
        text: fullText,
        index: chunkIndex++,
        headingContext,
      });
    } else if (content.length > 0 && chunks.length > 0) {
      // Append tiny chunk to previous one
      const prev = chunks[chunks.length - 1]!;
      prev.text += '\n\n' + content;
    } else if (content.length > 0) {
      // First chunk is tiny — still emit it
      chunks.push({
        text: content,
        index: chunkIndex++,
        headingContext: currentHeadings.filter(Boolean).join(' > '),
      });
    }
    currentChunk = '';
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);

    if (headingMatch) {
      const level = headingMatch[1]!.length; // 1, 2, or 3
      const headingText = headingMatch[2]!.trim();

      // Flush current chunk before new section
      flushChunk();

      // Update heading stack
      // Level 1 resets everything, level 2 keeps H1, etc.
      currentHeadings.length = level - 1;
      currentHeadings[level - 1] = headingText;
    }

    currentChunk += line + '\n';

    // Check if we need to split
    if (currentChunk.length >= maxChunkChars) {
      // Try to split at last paragraph boundary (\n\n)
      const lastDoubleNewline = currentChunk.lastIndexOf('\n\n', maxChunkChars);
      if (lastDoubleNewline > EMBEDDING_MIN_CHUNK_CHARS) {
        const before = currentChunk.substring(0, lastDoubleNewline);
        const after = currentChunk.substring(lastDoubleNewline + 2);
        currentChunk = before;
        flushChunk();
        currentChunk = after;
      } else {
        // Try sentence boundary
        const lastSentenceEnd = currentChunk.lastIndexOf('. ', maxChunkChars);
        if (lastSentenceEnd > EMBEDDING_MIN_CHUNK_CHARS) {
          const before = currentChunk.substring(0, lastSentenceEnd + 1);
          const after = currentChunk.substring(lastSentenceEnd + 2);
          currentChunk = before;
          flushChunk();
          currentChunk = after;
        } else {
          // Hard split at max
          flushChunk();
        }
      }
    }
  }

  // Flush remaining
  flushChunk();

  return chunks;
}

/**
 * Check if text should be chunked (exceeds threshold).
 */
export function shouldChunk(
  text: string,
  maxChunkChars: number = EMBEDDING_MAX_CHUNK_CHARS
): boolean {
  return text.trim().length > maxChunkChars;
}
