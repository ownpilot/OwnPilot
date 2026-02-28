/**
 * Request Preprocessor Middleware
 *
 * Analyzes each incoming message and determines which extensions, skills,
 * tools, custom data tables, and MCP servers are relevant. Stores routing
 * decisions in PipelineContext so context-injection can selectively inject
 * only matching content.
 *
 * Data sources:
 *   1. Extensions/skills — name, description, tool names, keywords
 *   2. TOOL_SEARCH_TAGS — 100+ tool→keyword synonym map (static)
 *   3. ToolRegistry — tool briefs for display (in-memory singleton)
 *   4. Custom data tables — table names, descriptions (async DB, cached)
 *   5. MCP servers — server names, tool names (service call, cached)
 *
 * Uses fast keyword matching (no LLM calls) — typically <10ms per request.
 *
 * Pipeline position: post-processing → [request-preprocessor] → context-injection
 */

import type { MessageMiddleware, IMcpClientService } from '@ownpilot/core';
import {
  getServiceRegistry,
  Services,
  type IExtensionService,
  TOOL_SEARCH_TAGS,
} from '@ownpilot/core';
import { getSharedToolRegistry } from '../tool-executor.js';
import { CustomDataRepository } from '../../db/repositories/index.js';
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
  /** Suggested tools based on TOOL_SEARCH_TAGS matching */
  suggestedTools: Array<{ name: string; brief: string }>;
  /** Custom data table displayNames that may be relevant */
  relevantTables?: string[];
  /** Connected MCP server names that may be relevant */
  relevantMcpServers?: string[];
}

interface ExtensionKeywords {
  id: string;
  name: string;
  keywords: Set<string>;
  category?: string;
}

interface CustomTableEntry {
  displayName: string;
  keywords: Set<string>;
}

interface McpServerEntry {
  name: string;
  keywords: Set<string>;
}

interface KeywordIndex {
  extensions: ExtensionKeywords[];
  /** Reverse index: keyword → Set<toolBaseName> from TOOL_SEARCH_TAGS */
  toolTagIndex: Map<string, Set<string>>;
  /** toolBaseName → brief description */
  toolBriefs: Map<string, string>;
  /** Custom data tables with extracted keywords */
  customTables: CustomTableEntry[];
  /** MCP servers with extracted keywords */
  mcpServers: McpServerEntry[];
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

/** Maximum tool suggestions per request */
const MAX_TOOL_SUGGESTIONS = 8;

/** Maximum custom tables to suggest per request */
const MAX_TABLE_SUGGESTIONS = 3;

/** Minimum score threshold to consider an extension relevant */
const RELEVANCE_THRESHOLD = 0.15;

/** Minimum score for tool suggestions (lower than extensions — tool tags are more specific) */
const TOOL_RELEVANCE_THRESHOLD = 0.1;

/** Fallback: if no extension scores above threshold, include top N */
const FALLBACK_TOP_N = 2;

/** Common stop words to filter from message tokenization */
const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'shall',
  'can',
  'need',
  'must',
  'i',
  'me',
  'my',
  'we',
  'our',
  'you',
  'your',
  'he',
  'she',
  'it',
  'they',
  'this',
  'that',
  'these',
  'those',
  'what',
  'which',
  'who',
  'whom',
  'and',
  'or',
  'but',
  'if',
  'then',
  'so',
  'because',
  'as',
  'of',
  'at',
  'by',
  'for',
  'with',
  'about',
  'to',
  'from',
  'in',
  'on',
  'not',
  'no',
  'up',
  'out',
  'just',
  'also',
  'very',
  'too',
  'how',
  'all',
  'any',
  'both',
  'each',
  'more',
  'most',
  'other',
  'some',
  'such',
  'only',
  'than',
  'when',
  'where',
  'why',
  'here',
  'there',
  'please',
  'thanks',
  'hi',
  'hey',
  'hello',
  'ok',
  'okay',
  'sure',
  'yes',
  'no',
  'yeah',
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
// Tool tag index (static, from TOOL_SEARCH_TAGS)
// =============================================================================

/**
 * Build a reverse index from TOOL_SEARCH_TAGS: keyword → Set<toolBaseName>.
 * Also handles multi-word tags by splitting them into individual keywords.
 */
export function buildToolTagIndex(): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();

  for (const [toolName, tags] of Object.entries(TOOL_SEARCH_TAGS)) {
    for (const tag of tags) {
      // Split multi-word tags (e.g., "read mail" → "read", "mail")
      const words = tag
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 1);
      for (const word of words) {
        let toolSet = index.get(word);
        if (!toolSet) {
          toolSet = new Set();
          index.set(word, toolSet);
        }
        toolSet.add(toolName);
      }
    }

    // Also add the tool name parts as keywords for self-matching
    for (const part of toolName.split('_')) {
      if (part.length > 1 && !STOP_WORDS.has(part)) {
        let toolSet = index.get(part);
        if (!toolSet) {
          toolSet = new Set();
          index.set(part, toolSet);
        }
        toolSet.add(toolName);
      }
    }
  }

  return index;
}

/**
 * Build a tool brief map from the ToolRegistry.
 * Returns toolBaseName → brief string.
 */
function buildToolBriefs(): Map<string, string> {
  const briefs = new Map<string, string>();
  try {
    const registry = getSharedToolRegistry();
    for (const { definition } of registry.getAllTools()) {
      // Use brief if available, otherwise first sentence of description
      const baseName = definition.name.includes('.')
        ? definition.name.split('.').pop()!
        : definition.name;
      const brief =
        definition.brief ?? definition.description.split(/[.!?]\s/)[0]?.slice(0, 80) ?? '';
      if (brief) briefs.set(baseName, brief);
    }
  } catch {
    // ToolRegistry not initialized yet
  }
  return briefs;
}

// =============================================================================
// Custom data table index
// =============================================================================

/**
 * Build keyword entries from custom data tables.
 */
async function buildCustomDataIndex(): Promise<CustomTableEntry[]> {
  try {
    const repo = new CustomDataRepository();
    const tables = await repo.listTables();
    return tables.map((t) => {
      const keywords = new Set<string>();
      for (const kw of extractKeywords(t.displayName)) keywords.add(kw);
      if (t.description) {
        for (const kw of extractKeywords(t.description)) keywords.add(kw);
      }
      // Add column names as keywords
      for (const col of t.columns) {
        for (const kw of extractKeywords(col.name)) keywords.add(kw);
      }
      return { displayName: t.displayName, keywords };
    });
  } catch {
    // DB not available
    return [];
  }
}

// =============================================================================
// MCP server index
// =============================================================================

/**
 * Build keyword entries from connected MCP servers.
 */
function buildMcpIndex(): McpServerEntry[] {
  try {
    const mcpService = getServiceRegistry().get(Services.McpClient) as
      | IMcpClientService
      | undefined;
    if (!mcpService) return [];

    const status = mcpService.getStatus();
    const entries: McpServerEntry[] = [];

    for (const [name, info] of status.entries()) {
      if (!info.connected) continue;

      const keywords = new Set<string>();
      for (const kw of extractKeywords(name)) keywords.add(kw);

      // Add tool names as keywords
      const tools = mcpService.getServerTools(name);
      for (const tool of tools) {
        for (const kw of extractKeywords(tool.name)) keywords.add(kw);
        if (tool.description) {
          // Only first few keywords from description to avoid noise
          const descKw = extractKeywords(tool.description);
          let count = 0;
          for (const kw of descKw) {
            if (count >= 5) break;
            keywords.add(kw);
            count++;
          }
        }
      }

      entries.push({ name, keywords });
    }

    return entries;
  } catch {
    // MCP service not available
    return [];
  }
}

// =============================================================================
// Extension index building (existing, unchanged)
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
): ExtensionKeywords[] {
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

  return extensions;
}

// =============================================================================
// Comprehensive index building
// =============================================================================

/**
 * Get or build the comprehensive keyword index (with caching).
 * Async because custom data table lookup requires DB access.
 */
async function getIndexAsync(): Promise<KeywordIndex | null> {
  if (cachedIndex && Date.now() - cachedIndex.builtAt < INDEX_CACHE_TTL_MS) {
    return cachedIndex;
  }

  try {
    // Build extension index
    let extensions: ExtensionKeywords[] = [];
    try {
      const extService = getServiceRegistry().get(Services.Extension) as
        | (IExtensionService & { getEnabledMetadata?: () => unknown })
        | undefined;
      if (extService?.getEnabledMetadata) {
        extensions = buildKeywordIndex(extService as Parameters<typeof buildKeywordIndex>[0]);
      }
    } catch {
      // Extension service not initialized yet
    }

    // Build tool tag index (static, always available)
    const toolTagIndex = buildToolTagIndex();

    // Build tool briefs (from ToolRegistry singleton)
    const toolBriefs = buildToolBriefs();

    // Build custom data index (async DB query)
    const customTables = await buildCustomDataIndex();

    // Build MCP server index
    const mcpServers = buildMcpIndex();

    cachedIndex = {
      extensions,
      toolTagIndex,
      toolBriefs,
      customTables,
      mcpServers,
      builtAt: Date.now(),
    };

    return cachedIndex;
  } catch {
    return null;
  }
}

// =============================================================================
// Request classification
// =============================================================================

/**
 * Match user message keywords against the tool tag index.
 * Returns scored tools sorted by relevance.
 */
function matchTools(
  messageWords: Set<string>,
  toolTagIndex: Map<string, Set<string>>,
  toolBriefs: Map<string, string>
): Array<{ name: string; brief: string }> {
  if (messageWords.size < 2) return [];

  // Collect match counts per tool
  const toolScores = new Map<string, number>();
  for (const word of messageWords) {
    const matchedTools = toolTagIndex.get(word);
    if (!matchedTools) continue;
    for (const toolName of matchedTools) {
      toolScores.set(toolName, (toolScores.get(toolName) ?? 0) + 1);
    }
  }

  // Score and filter
  const scored: Array<{ name: string; brief: string; score: number }> = [];
  for (const [name, matchCount] of toolScores) {
    const score = matchCount / messageWords.size;
    if (score >= TOOL_RELEVANCE_THRESHOLD) {
      scored.push({ name, brief: toolBriefs.get(name) ?? '', score });
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, MAX_TOOL_SUGGESTIONS).map(({ name, brief }) => ({ name, brief }));
}

/**
 * Match user message keywords against custom data tables.
 */
function matchTables(messageWords: Set<string>, customTables: CustomTableEntry[]): string[] {
  if (messageWords.size < 2 || customTables.length === 0) return [];

  const scored: Array<{ displayName: string; score: number }> = [];
  for (const table of customTables) {
    let matchCount = 0;
    for (const word of messageWords) {
      if (table.keywords.has(word)) matchCount++;
    }
    const score = matchCount / messageWords.size;
    if (score >= TOOL_RELEVANCE_THRESHOLD) {
      scored.push({ displayName: table.displayName, score });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_TABLE_SUGGESTIONS).map((s) => s.displayName);
}

/**
 * Match user message keywords against MCP servers.
 */
function matchMcpServers(messageWords: Set<string>, mcpServers: McpServerEntry[]): string[] {
  if (messageWords.size < 2 || mcpServers.length === 0) return [];

  const matched: string[] = [];
  for (const server of mcpServers) {
    let matchCount = 0;
    for (const word of messageWords) {
      if (server.keywords.has(word)) matchCount++;
    }
    const score = matchCount / messageWords.size;
    if (score >= TOOL_RELEVANCE_THRESHOLD) {
      matched.push(server.name);
    }
  }
  return matched;
}

/**
 * Classify a request message and determine relevant extensions, tools, tables, and MCP servers.
 */
export function classifyRequest(message: string, index: KeywordIndex): RequestRouting {
  const messageWords = tokenizeMessage(message);

  // If message is too short to classify, return all extensions, no suggestions
  if (messageWords.size < MIN_WORDS_FOR_ROUTING) {
    return {
      relevantExtensionIds: index.extensions.map((e) => e.id),
      relevantCategories: [],
      intentHint: null,
      confidence: 0,
      suggestedTools: [],
    };
  }

  // --- Extension scoring (existing) ---
  const scored: Array<{ ext: ExtensionKeywords; score: number }> = [];

  for (const ext of index.extensions) {
    let matchCount = 0;
    for (const word of messageWords) {
      if (ext.keywords.has(word)) matchCount++;
    }

    let score = matchCount / messageWords.size;

    // Name match bonus
    const nameWords = extractKeywords(ext.name);
    for (const nw of nameWords) {
      if (messageWords.has(nw)) {
        score += 0.3;
        break;
      }
    }

    scored.push({ ext, score });
  }

  scored.sort((a, b) => b.score - a.score);

  let selected = scored.filter((s) => s.score >= RELEVANCE_THRESHOLD);
  if (selected.length === 0 && scored.length > 0) {
    selected = scored.slice(0, FALLBACK_TOP_N);
  }
  if (selected.length > MAX_EXTENSIONS_PER_REQUEST) {
    selected = selected.slice(0, MAX_EXTENSIONS_PER_REQUEST);
  }

  const relevantExtensionIds = selected.map((s) => s.ext.id);

  const categories = new Set<string>();
  for (const s of selected) {
    if (s.ext.category) categories.add(s.ext.category);
  }
  const relevantCategories = [...categories];

  // --- Tool matching (new) ---
  const suggestedTools = matchTools(messageWords, index.toolTagIndex, index.toolBriefs);

  // --- Custom data table matching (new) ---
  const relevantTables = matchTables(messageWords, index.customTables);

  // --- MCP server matching (new) ---
  const relevantMcpServers = matchMcpServers(messageWords, index.mcpServers);

  // --- Intent hint generation ---
  let intentHint: string | null = null;
  const hintParts: string[] = [];

  if (relevantCategories.length > 0) {
    const catHints = relevantCategories.map((c) => CATEGORY_HINTS[c] ?? c).slice(0, 3);
    hintParts.push(`Request relates to: ${catHints.join(', ')}`);
  }
  if (relevantTables.length > 0) {
    hintParts.push(`Data tables: ${relevantTables.join(', ')}`);
  }
  if (relevantMcpServers.length > 0) {
    hintParts.push(`MCP: ${relevantMcpServers.join(', ')}`);
  }
  if (hintParts.length > 0) {
    intentHint = hintParts.join('. ');
  }

  const confidence = scored.length > 0 ? Math.min(scored[0]!.score, 1) : 0;

  return {
    relevantExtensionIds,
    relevantCategories,
    intentHint,
    confidence,
    suggestedTools,
    ...(relevantTables.length > 0 && { relevantTables }),
    ...(relevantMcpServers.length > 0 && { relevantMcpServers }),
  };
}

// =============================================================================
// Middleware
// =============================================================================

/**
 * Create the request preprocessor middleware.
 *
 * Analyzes message content to determine which extensions, tools, custom data
 * tables, and MCP servers are relevant, then stores routing decisions in
 * PipelineContext for downstream middleware.
 */
export function createRequestPreprocessorMiddleware(): MessageMiddleware {
  return async (message, ctx, next) => {
    const index = await getIndexAsync();

    // If no index available, skip preprocessing
    if (!index) {
      return next();
    }

    try {
      const content = message.content?.trim();
      if (!content) {
        return next();
      }

      const routing = classifyRequest(content, index);
      ctx.set('routing', routing);

      const parts: string[] = [];
      if (
        routing.relevantExtensionIds.length < index.extensions.length &&
        index.extensions.length > 0
      ) {
        parts.push(`${routing.relevantExtensionIds.length}/${index.extensions.length} ext`);
      }
      if (routing.suggestedTools.length > 0) {
        parts.push(`${routing.suggestedTools.length} tools`);
      }
      if (routing.relevantTables?.length) {
        parts.push(`${routing.relevantTables.length} tables`);
      }
      if (routing.relevantMcpServers?.length) {
        parts.push(`${routing.relevantMcpServers.length} mcp`);
      }
      if (parts.length > 0) {
        log.debug(
          `Preprocessor: ${parts.join(', ')}${routing.intentHint ? ` — ${routing.intentHint}` : ''}`
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
