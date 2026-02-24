/**
 * Conversation Memory Store
 *
 * Manages all memory operations for the AI assistant.
 * Provides CRUD, queries, summaries, profiles, retention, import/export.
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  MemoryEntry,
  MemoryCategory,
  MemoryImportance,
  MemorySource,
  ConversationSummary,
  UserProfile,
  MemoryQueryOptions,
  MemoryStats,
  MemoryRetentionPolicy,
} from './conversation-types.js';
import { DEFAULT_RETENTION_POLICY, IMPORTANCE_WEIGHTS } from './conversation-types.js';

// =============================================================================
// Conversation Memory Store
// =============================================================================

/**
 * Conversation Memory Store
 *
 * Manages all memory operations for the AI assistant.
 */
export class ConversationMemoryStore {
  private readonly userId: string;
  private readonly storageDir: string;
  private memories: Map<string, MemoryEntry> = new Map();
  private summaries: Map<string, ConversationSummary> = new Map();
  private retentionPolicy: MemoryRetentionPolicy;
  private initialized = false;

  constructor(
    userId: string,
    options?: {
      storageDir?: string;
      retentionPolicy?: Partial<MemoryRetentionPolicy>;
    }
  ) {
    this.userId = userId;
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    this.storageDir = options?.storageDir ?? path.join(homeDir, '.ownpilot', 'memory', userId);
    this.retentionPolicy = { ...DEFAULT_RETENTION_POLICY, ...options?.retentionPolicy };
  }

  /**
   * Initialize the memory store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await fs.mkdir(this.storageDir, { recursive: true });
    await this.loadMemories();
    await this.loadSummaries();
    this.initialized = true;
  }

  /**
   * Get user ID
   */
  getUserId(): string {
    return this.userId;
  }

  /**
   * Set retention policy
   */
  setRetentionPolicy(policy: MemoryRetentionPolicy): void {
    this.retentionPolicy = policy;
  }

  /**
   * Get current retention policy
   */
  getRetentionPolicy(): MemoryRetentionPolicy {
    return { ...this.retentionPolicy };
  }

  // ===========================================================================
  // Memory CRUD Operations
  // ===========================================================================

  /**
   * Add a new memory
   */
  async addMemory(
    memory: Omit<
      MemoryEntry,
      'id' | 'userId' | 'createdAt' | 'updatedAt' | 'accessCount' | 'archived'
    >
  ): Promise<MemoryEntry> {
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const entry: MemoryEntry = {
      ...memory,
      id: `mem_${randomUUID()}`,
      userId: this.userId,
      accessCount: 0,
      archived: false,
      createdAt: now,
      updatedAt: now,
    };

    this.memories.set(entry.id, entry);
    await this.saveMemories();

    return entry;
  }

  /**
   * Update a memory
   */
  async updateMemory(
    id: string,
    updates: Partial<Omit<MemoryEntry, 'id' | 'userId' | 'createdAt'>>
  ): Promise<MemoryEntry | null> {
    await this.ensureInitialized();

    const memory = this.memories.get(id);
    if (!memory) return null;

    const updated: MemoryEntry = {
      ...memory,
      ...updates,
      id: memory.id,
      userId: memory.userId,
      createdAt: memory.createdAt,
      updatedAt: new Date().toISOString(),
    };

    this.memories.set(id, updated);
    await this.saveMemories();

    return updated;
  }

  /**
   * Get a memory by ID
   */
  async getMemory(id: string): Promise<MemoryEntry | null> {
    await this.ensureInitialized();

    const memory = this.memories.get(id);
    if (!memory) return null;

    // Update access stats
    memory.accessCount++;
    memory.lastAccessed = new Date().toISOString();

    return memory;
  }

  /**
   * Delete a memory
   */
  async deleteMemory(id: string): Promise<boolean> {
    await this.ensureInitialized();

    const deleted = this.memories.delete(id);
    if (deleted) {
      await this.saveMemories();
    }

    return deleted;
  }

  /**
   * Archive a memory
   */
  async archiveMemory(id: string): Promise<boolean> {
    const memory = this.memories.get(id);
    if (!memory) return false;

    memory.archived = true;
    memory.updatedAt = new Date().toISOString();
    await this.saveMemories();

    return true;
  }

  /**
   * Restore an archived memory
   */
  async restoreMemory(id: string): Promise<boolean> {
    const memory = this.memories.get(id);
    if (!memory) return false;

    memory.archived = false;
    memory.updatedAt = new Date().toISOString();
    await this.saveMemories();

    return true;
  }

  // ===========================================================================
  // Memory Queries
  // ===========================================================================

  /**
   * Query memories
   */
  async queryMemories(options: MemoryQueryOptions = {}): Promise<MemoryEntry[]> {
    await this.ensureInitialized();

    let results = Array.from(this.memories.values());

    // Filter by archived status
    if (!options.includeArchived) {
      results = results.filter((m) => !m.archived);
    }

    // Filter by single category
    if (options.category) {
      results = results.filter((m) => m.category === options.category);
    }

    // Filter by categories
    if (options.categories?.length) {
      results = results.filter((m) => options.categories!.includes(m.category));
    }

    // Filter by importance
    if (options.minImportance) {
      const minWeight = IMPORTANCE_WEIGHTS[options.minImportance];
      results = results.filter((m) => IMPORTANCE_WEIGHTS[m.importance] >= minWeight);
    }

    // Filter by confidence
    if (options.minConfidence !== undefined) {
      results = results.filter((m) => m.confidence >= options.minConfidence!);
    }

    // Filter by tags
    if (options.tags?.length) {
      results = results.filter((m) => options.tags!.some((tag) => m.tags.includes(tag)));
    }

    // Search query (supports both query and searchText)
    const searchQuery = options.query ?? options.searchText;
    if (searchQuery) {
      const queryLower = searchQuery.toLowerCase();
      results = results.filter(
        (m) =>
          m.content.toLowerCase().includes(queryLower) ||
          m.tags.some((t) => t.toLowerCase().includes(queryLower))
      );
    }

    // Sort
    switch (options.sortBy) {
      case 'recency':
        results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        break;
      case 'importance':
        results.sort((a, b) => IMPORTANCE_WEIGHTS[b.importance] - IMPORTANCE_WEIGHTS[a.importance]);
        break;
      case 'access_count':
        results.sort((a, b) => b.accessCount - a.accessCount);
        break;
      case 'relevance':
      default:
        // Sort by importance * confidence * recency
        results.sort((a, b) => {
          const scoreA = this.calculateRelevanceScore(a);
          const scoreB = this.calculateRelevanceScore(b);
          return scoreB - scoreA;
        });
    }

    // Limit
    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Get all facts about the user
   */
  async getFacts(): Promise<MemoryEntry[]> {
    return this.queryMemories({
      categories: ['fact'],
      sortBy: 'importance',
    });
  }

  /**
   * Get user preferences
   */
  async getPreferences(): Promise<MemoryEntry[]> {
    return this.queryMemories({
      categories: ['preference'],
      sortBy: 'importance',
    });
  }

  /**
   * Get custom instructions
   */
  async getInstructions(): Promise<MemoryEntry[]> {
    return this.queryMemories({
      categories: ['instruction'],
      sortBy: 'importance',
    });
  }

  /**
   * Get recent episode summaries
   */
  async getRecentEpisodes(limit: number = 10): Promise<MemoryEntry[]> {
    return this.queryMemories({
      categories: ['episode'],
      sortBy: 'recency',
      limit,
    });
  }

  /**
   * Search memories by content
   */
  async searchMemories(query: string, limit: number = 20): Promise<MemoryEntry[]> {
    return this.queryMemories({
      query,
      sortBy: 'relevance',
      limit,
    });
  }

  // ===========================================================================
  // Conversation Summaries
  // ===========================================================================

  /**
   * Add a conversation summary
   */
  async addConversationSummary(
    summary: Omit<ConversationSummary, 'createdAt'>
  ): Promise<ConversationSummary> {
    await this.ensureInitialized();

    const entry: ConversationSummary = {
      ...summary,
      createdAt: new Date().toISOString(),
    };

    this.summaries.set(entry.conversationId, entry);

    // Also create an episode memory
    await this.addMemory({
      category: 'episode',
      content: summary.summary,
      data: {
        topics: summary.topics,
        factsLearned: summary.factsLearned,
        actionsTaken: summary.actionsTaken,
        sentiment: summary.sentiment,
        messageCount: summary.messageCount,
        duration: summary.durationMinutes,
      },
      importance: 'medium',
      source: 'system_generated',
      confidence: 1.0,
      tags: [...summary.topics, 'conversation', 'episode'],
      conversationId: summary.conversationId,
    });

    await this.saveSummaries();

    return entry;
  }

  /**
   * Get conversation summary
   */
  async getConversationSummary(conversationId: string): Promise<ConversationSummary | null> {
    await this.ensureInitialized();
    return this.summaries.get(conversationId) ?? null;
  }

  /**
   * Get recent conversation summaries
   */
  async getRecentSummaries(limit: number = 10): Promise<ConversationSummary[]> {
    await this.ensureInitialized();

    return Array.from(this.summaries.values())
      .sort((a, b) => new Date(b.endedAt).getTime() - new Date(a.endedAt).getTime())
      .slice(0, limit);
  }

  // ===========================================================================
  // User Profile
  // ===========================================================================

  /**
   * Build user profile from memories
   */
  async getUserProfile(): Promise<UserProfile> {
    await this.ensureInitialized();

    const facts = await this.getFacts();
    const preferences = await this.getPreferences();
    const instructions = await this.getInstructions();
    const goals = await this.queryMemories({ categories: ['goal'] });
    const relationships = await this.queryMemories({ categories: ['relationship'] });

    // Extract name if available
    const nameFact = facts.find(
      (f) => f.tags.includes('name') || f.content.toLowerCase().includes('name')
    );

    // Extract topics of interest
    const topics = this.extractTopics(facts.concat(preferences));

    // Build profile
    const profile: UserProfile = {
      userId: this.userId,
      name: nameFact?.data?.name as string | undefined,
      facts: facts.map((f) => ({
        key: f.tags[0] ?? 'unknown',
        value: f.content,
        confidence: f.confidence,
      })),
      preferences: preferences.map((p) => p.content),
      preferencesDetailed: preferences.map((p) => ({
        category: p.tags[0] ?? 'general',
        preference: p.content,
        strength: p.confidence,
      })),
      interests: topics,
      topicsOfInterest: topics,
      goals: goals.map((g) => g.content),
      relationships: relationships.map((r) => r.content),
      customInstructions: instructions.map((i) => i.content),
      lastInteraction: this.getLastInteractionDate(),
      totalConversations: this.summaries.size,
      completeness: this.calculateProfileCompleteness(facts, preferences),
    };

    return profile;
  }

  // ===========================================================================
  // Memory Management
  // ===========================================================================

  /**
   * Get memory statistics
   */
  async getStats(): Promise<MemoryStats> {
    await this.ensureInitialized();

    const memories = Array.from(this.memories.values());

    const byCategory: Record<MemoryCategory, number> = {
      fact: 0,
      preference: 0,
      episode: 0,
      skill: 0,
      instruction: 0,
      relationship: 0,
      goal: 0,
      context: 0,
    };
    const byImportance: Record<MemoryImportance, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };
    const bySource: Record<MemorySource, number> = {
      user_stated: 0,
      user_confirmed: 0,
      ai_inferred: 0,
      system_generated: 0,
      imported: 0,
    };

    let archivedCount = 0;
    let oldest: string | undefined;
    let newest: string | undefined;

    for (const memory of memories) {
      byCategory[memory.category]++;
      byImportance[memory.importance]++;
      bySource[memory.source]++;

      if (memory.archived) archivedCount++;

      if (!oldest || memory.createdAt < oldest) oldest = memory.createdAt;
      if (!newest || memory.createdAt > newest) newest = memory.createdAt;
    }

    // Estimate storage size
    const storageBytes =
      JSON.stringify(memories).length + JSON.stringify(Array.from(this.summaries.values())).length;

    return {
      totalMemories: memories.length,
      byCategory,
      byImportance,
      bySource,
      archivedCount,
      totalConversations: this.summaries.size,
      storageBytes,
      oldestMemory: oldest,
      newestMemory: newest,
    };
  }

  /**
   * Apply retention policy
   */
  async applyRetentionPolicy(): Promise<{
    archived: number;
    deleted: number;
  }> {
    await this.ensureInitialized();

    const now = Date.now();
    let archived = 0;
    let deleted = 0;

    for (const [id, memory] of this.memories) {
      // Skip exempt categories
      if (this.retentionPolicy.exemptCategories.includes(memory.category)) {
        continue;
      }

      const ageInDays = (now - new Date(memory.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const lastAccessDays = memory.lastAccessed
        ? (now - new Date(memory.lastAccessed).getTime()) / (1000 * 60 * 60 * 24)
        : ageInDays;

      // Delete old archived memories
      if (memory.archived && ageInDays > this.retentionPolicy.deleteArchivedAfterDays) {
        this.memories.delete(id);
        deleted++;
        continue;
      }

      // Auto-archive inactive memories
      if (!memory.archived && lastAccessDays > this.retentionPolicy.autoArchiveDays) {
        memory.archived = true;
        archived++;
        continue;
      }

      // Delete old low-importance memories
      if (memory.importance === 'low' && ageInDays > this.retentionPolicy.lowImportanceMaxAgeDays) {
        this.memories.delete(id);
        deleted++;
        continue;
      }

      // Delete old medium-importance memories
      if (
        memory.importance === 'medium' &&
        ageInDays > this.retentionPolicy.mediumImportanceMaxAgeDays
      ) {
        this.memories.delete(id);
        deleted++;
      }
    }

    // Enforce max memories limit
    if (this.memories.size > this.retentionPolicy.maxMemories) {
      const sortedMemories = Array.from(this.memories.entries()).sort(
        (a, b) => this.calculateRelevanceScore(b[1]) - this.calculateRelevanceScore(a[1])
      );

      while (sortedMemories.length > this.retentionPolicy.maxMemories) {
        const entry = sortedMemories.pop();
        if (!entry) break;
        this.memories.delete(entry[0]);
        deleted++;
      }
    }

    if (archived > 0 || deleted > 0) {
      await this.saveMemories();
    }

    return { archived, deleted };
  }

  /**
   * Clear all memories (dangerous!)
   */
  async clearAllMemories(): Promise<void> {
    this.memories.clear();
    this.summaries.clear();
    await this.saveMemories();
    await this.saveSummaries();
  }

  /**
   * Export memories for backup
   */
  async exportMemories(): Promise<{
    memories: MemoryEntry[];
    summaries: ConversationSummary[];
    exportedAt: string;
  }> {
    await this.ensureInitialized();

    return {
      memories: Array.from(this.memories.values()),
      summaries: Array.from(this.summaries.values()),
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Import memories from backup
   */
  async importMemories(data: {
    memories: MemoryEntry[];
    summaries: ConversationSummary[];
  }): Promise<{ imported: number; skipped: number }> {
    await this.ensureInitialized();

    let imported = 0;
    let skipped = 0;

    for (const memory of data.memories) {
      if (!this.memories.has(memory.id)) {
        this.memories.set(memory.id, memory);
        imported++;
      } else {
        skipped++;
      }
    }

    for (const summary of data.summaries) {
      if (!this.summaries.has(summary.conversationId)) {
        this.summaries.set(summary.conversationId, summary);
      }
    }

    await this.saveMemories();
    await this.saveSummaries();

    return { imported, skipped };
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private calculateRelevanceScore(memory: MemoryEntry): number {
    const importanceWeight = IMPORTANCE_WEIGHTS[memory.importance];
    const confidence = memory.confidence;
    const recency =
      1 / (1 + (Date.now() - new Date(memory.updatedAt).getTime()) / (1000 * 60 * 60 * 24 * 30));
    const accessBonus = Math.min(memory.accessCount / 10, 1);

    return importanceWeight * confidence * recency * (1 + accessBonus);
  }

  private extractTopics(memories: MemoryEntry[]): string[] {
    const topics = new Map<string, number>();

    for (const memory of memories) {
      for (const tag of memory.tags) {
        topics.set(tag, (topics.get(tag) ?? 0) + 1);
      }
    }

    return Array.from(topics.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([topic]) => topic);
  }

  private getLastInteractionDate(): string {
    let latest = '';
    for (const summary of this.summaries.values()) {
      if (!latest || summary.endedAt > latest) {
        latest = summary.endedAt;
      }
    }
    return latest || new Date().toISOString();
  }

  private calculateProfileCompleteness(facts: MemoryEntry[], preferences: MemoryEntry[]): number {
    const hasName = facts.some((f) => f.tags.includes('name'));
    const hasJob = facts.some((f) => f.tags.includes('job') || f.tags.includes('occupation'));
    const hasLocation = facts.some((f) => f.tags.includes('location') || f.tags.includes('city'));
    const hasPreferences = preferences.length > 0;
    const hasFacts = facts.length >= 3;

    const checks = [hasName, hasJob, hasLocation, hasPreferences, hasFacts];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }

  private async loadMemories(): Promise<void> {
    const filePath = path.join(this.storageDir, 'memories.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const memories = JSON.parse(content) as MemoryEntry[];
      this.memories = new Map(memories.map((m) => [m.id, m]));
    } catch {
      this.memories = new Map();
    }
  }

  private async saveMemories(): Promise<void> {
    const filePath = path.join(this.storageDir, 'memories.json');
    const memories = Array.from(this.memories.values());
    await fs.writeFile(filePath, JSON.stringify(memories, null, 2), 'utf-8');
  }

  private async loadSummaries(): Promise<void> {
    const filePath = path.join(this.storageDir, 'summaries.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const summaries = JSON.parse(content) as ConversationSummary[];
      this.summaries = new Map(summaries.map((s) => [s.conversationId, s]));
    } catch {
      this.summaries = new Map();
    }
  }

  private async saveSummaries(): Promise<void> {
    const filePath = path.join(this.storageDir, 'summaries.json');
    const summaries = Array.from(this.summaries.values());
    await fs.writeFile(filePath, JSON.stringify(summaries, null, 2), 'utf-8');
  }
}
