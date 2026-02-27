/**
 * Request Preprocessor Middleware
 *
 * Analyzes each incoming message and determines which extensions, skills,
 * and tool categories are relevant. Stores routing decisions in PipelineContext
 * so context-injection can selectively inject only matching content.
 *
 * Uses fast keyword matching (no LLM calls) — typically <5ms per request.
 *
 * Pipeline position: post-processing → [request-preprocessor] → context-injection
 */

import type { MessageMiddleware } from '@ownpilot/core';
import { getServiceRegistry, Services, type IExtensionService } from '@ownpilot/core';
import { getLog } from '../log.js';

const log = getLog('Middleware:RequestPreprocessor');

// =============================================================================
// Types
// =============================================================================

export interface RequestRouting {
  /** IDs of extensions/skills to inject into system prompt */
  relevantExtensionIds: string[];
  /** Tool categories that are most relevant */
  relevantCategories: string[];
  /** Short routing hint for the LLM */
  intentHint: string | null;
  /** Confidence score 0-1 */
  confidence: number;
}

interface ExtensionKeywords {
  id: string;
  name: string;
  keywords: Set<string>;
  category?: string;
}

interface KeywordIndex {
  extensions: ExtensionKeywords[];
  builtAt: number;
}

// =============================================================================
// Constants
// =============================================================================

/** Cache TTL: 5 minutes */
const INDEX_CACHE_TTL_MS = 5 * 60 * 1000;

/** Minimum message length (in words) to attempt routing. Below this, include all. */
const MIN_WORDS_FOR_ROUTING = 3;

/** Maximum extensions to inject per request */
const MAX_EXTENSIONS_PER_REQUEST = 5;

/** Minimum score threshold to consider an extension relevant */
const RELEVANCE_THRESHOLD = 0.15;

/** Fallback: if no extension scores above threshold, include top N */
const FALLBACK_TOP_N = 2;

/** Common stop words to filter from message tokenization */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'must',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
  'and', 'or', 'but', 'if', 'then', 'so', 'because', 'as', 'of', 'at',
  'by', 'for', 'with', 'about', 'to', 'from', 'in', 'on', 'not', 'no',
  'up', 'out', 'just', 'also', 'very', 'too', 'how', 'all', 'any',
  'both', 'each', 'more', 'most', 'other', 'some', 'such', 'only',
  'than', 'when', 'where', 'why', 'here', 'there', 'please', 'thanks',
  'hi', 'hey', 'hello', 'ok', 'okay', 'sure', 'yes', 'no', 'yeah',
]);

/** Category hint templates */
const CATEGORY_HINTS: Record<string, string> = {
  developer: 'development and coding',
  productivity: 'productivity and task management',
  communication: 'communication and messaging',
  data: 'data management',
  utilities: 'utility operations',
  integrations: 'external service integration',
  media: 'media and content',
  lifestyle: 'lifestyle and personal',
};

// =============================================================================
// Module-level cache
// =============================================================================

let cachedIndex: KeywordIndex | null = null;

/** Clear preprocessor cache (call on extension changes or in tests) */
export function clearPreprocessorCache(): void {
  cachedIndex = null;
}

// =============================================================================
// Keyword extraction
// =============================================================================

/**
 * Extract keywords from a string by splitting on delimiters,
 * expanding camelCase, and filtering stop words.
 */
export function extractKeywords(text: string): Set<string> {
  if (!text) return new Set();

  // Split on common delimiters (spaces, underscores, hyphens, dots, punctuation)
  const tokens = text
    .replace(/([a-z])([A-Z])/g, '$1 $2') // expand camelCase
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2') // expand ABCDef → ABC Def
    .split(/[\s_\-.,:;?!@#$%^&*/()[\]{}|'"]+/)
    .map((t) => t.toLowerCase().trim())
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));

  return new Set(tokens);
}

/**
 * Tokenize a user message into meaningful keywords.
 */
export function tokenizeMessage(message: string): Set<string> {
  return extractKeywords(message);
}

// =============================================================================
// Index building
// =============================================================================

/**
 * Build a keyword index from all enabled extensions.
 */
export function buildKeywordIndex(
  extensionService: IExtensionService & {
    getEnabledMetadata(): Array<{
      id: string;
      name: string;
      description: string;
      format: string;
      category?: string;
      toolNames: string[];
      keywords?: string[];
    }>;
  }
): KeywordIndex {
  const metadata = extensionService.getEnabledMetadata();
  const extensions: ExtensionKeywords[] = [];

  for (const ext of metadata) {
    const keywords = new Set<string>();

    // Extract from name
    for (const kw of extractKeywords(ext.name)) keywords.add(kw);

    // Extract from description
    for (const kw of extractKeywords(ext.description)) keywords.add(kw);

    // Extract from tool names
    for (const toolName of ext.toolNames) {
      for (const kw of extractKeywords(toolName)) keywords.add(kw);
    }

    // Add explicit keywords/tags
    if (ext.keywords) {
      for (const kw of ext.keywords) {
        for (const token of extractKeywords(kw)) keywords.add(token);
      }
    }

    // Add category as keyword
    if (ext.category) keywords.add(ext.category.toLowerCase());

    extensions.push({
      id: ext.id,
      name: ext.name,
      keywords,
      category: ext.category,
    });
  }

  return { extensions, builtAt: Date.now() };
}

/**
 * Get or build the keyword index (with caching).
 */
function getIndex(): KeywordIndex | null {
  if (cachedIndex && Date.now() - cachedIndex.builtAt < INDEX_CACHE_TTL_MS) {
    return cachedIndex;
  }

  try {
    const extService = getServiceRegistry().get(Services.Extension) as IExtensionService & {
      getEnabledMetadata: () => ReturnType<typeof buildKeywordIndex extends (s: infer _S) => infer _R ? never : never>;
    };
    if (!extService?.getEnabledMetadata) return null;

    cachedIndex = buildKeywordIndex(extService as Parameters<typeof buildKeywordIndex>[0]);
    return cachedIndex;
  } catch {
    // Extension service not initialized yet
    return null;
  }
}

// =============================================================================
// Request classification
// =============================================================================

/**
 * Classify a request message and determine relevant extensions.
 */
export function classifyRequest(message: string, index: KeywordIndex): RequestRouting {
  const messageWords = tokenizeMessage(message);

  // If message is too short to classify, return all extensions
  if (messageWords.size < MIN_WORDS_FOR_ROUTING) {
    return {
      relevantExtensionIds: index.extensions.map((e) => e.id),
      relevantCategories: [],
      intentHint: null,
      confidence: 0,
    };
  }

  // Score each extension
  const scored: Array<{ ext: ExtensionKeywords; score: number }> = [];

  for (const ext of index.extensions) {
    let matchCount = 0;
    for (const word of messageWords) {
      if (ext.keywords.has(word)) matchCount++;
    }

    // Base score: ratio of matched keywords
    let score = matchCount / messageWords.size;

    // Name match bonus: if any word from the extension name is in the message
    const nameWords = extractKeywords(ext.name);
    for (const nw of nameWords) {
      if (messageWords.has(nw)) {
        score += 0.3;
        break;
      }
    }

    scored.push({ ext, score });
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Select relevant extensions
  let selected = scored.filter((s) => s.score >= RELEVANCE_THRESHOLD);

  // Fallback: if nothing matched well, take top N
  if (selected.length === 0 && scored.length > 0) {
    selected = scored.slice(0, FALLBACK_TOP_N);
  }

  // Cap at max
  if (selected.length > MAX_EXTENSIONS_PER_REQUEST) {
    selected = selected.slice(0, MAX_EXTENSIONS_PER_REQUEST);
  }

  const relevantExtensionIds = selected.map((s) => s.ext.id);

  // Determine relevant categories
  const categories = new Set<string>();
  for (const s of selected) {
    if (s.ext.category) categories.add(s.ext.category);
  }
  const relevantCategories = [...categories];

  // Generate intent hint
  let intentHint: string | null = null;
  if (relevantCategories.length > 0) {
    const hints = relevantCategories
      .map((c) => CATEGORY_HINTS[c] ?? c)
      .slice(0, 3);
    intentHint = `Request relates to: ${hints.join(', ')}`;
  }

  // Confidence based on best score
  const confidence = scored.length > 0 ? Math.min(scored[0]!.score, 1) : 0;

  return { relevantExtensionIds, relevantCategories, intentHint, confidence };
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Create the request preprocessor middleware.
 *
 * Analyzes message content to determine which extensions/skills are relevant,
 * then stores routing decisions in PipelineContext for downstream middleware.
 */
export function createRequestPreprocessorMiddleware(): MessageMiddleware {
  return async (message, ctx, next) => {
    const index = getIndex();

    // If no index (no extensions or service not ready), skip preprocessing
    if (!index || index.extensions.length === 0) {
      return next();
    }

    try {
      const content = message.content?.trim();
      if (!content) {
        return next();
      }

      const routing = classifyRequest(content, index);
      ctx.set('routing', routing);

      if (routing.relevantExtensionIds.length < index.extensions.length) {
        log.debug(
          `Preprocessor: ${routing.relevantExtensionIds.length}/${index.extensions.length} extensions selected` +
            (routing.intentHint ? ` — ${routing.intentHint}` : '')
        );
      }
    } catch (error) {
      // Preprocessing failure should never block the pipeline
      log.warn('Request preprocessing failed, proceeding without routing', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return next();
  };
}
