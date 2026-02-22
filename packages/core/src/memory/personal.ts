/**
 * Personal Memory System
 *
 * Comprehensive personal data storage for AI personalization.
 * Stores everything about the user to enable truly personalized interactions.
 *
 * CATEGORIES:
 * - Identity: Name, age, occupation, education
 * - Location: Home, work, favorite places, timezone
 * - Lifestyle: Daily routines, eating habits, sleep patterns
 * - Preferences: Communication style, interests, likes/dislikes
 * - Health: Dietary restrictions, allergies, health goals
 * - Social: Family, friends, colleagues, relationships
 * - Work: Job, projects, skills, work style
 * - Goals: Short-term, long-term, aspirations
 * - History: Important events, milestones, experiences
 */

import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// =============================================================================
// Types
// =============================================================================

/**
 * Personal data categories
 */
export type PersonalDataCategory =
  // Core identity
  | 'identity' // Name, age, gender, nationality
  | 'contact' // Email, phone, addresses
  | 'occupation' // Job, company, role
  | 'education' // Schools, degrees, certifications

  // Location & Time
  | 'location' // Home, work, current location
  | 'timezone' // Preferred timezone, travel patterns
  | 'places' // Favorite places, frequent locations

  // Lifestyle
  | 'routine' // Daily schedule, habits
  | 'food' // Eating habits, favorite foods, dietary needs
  | 'sleep' // Sleep patterns, preferences
  | 'exercise' // Fitness routines, sports
  | 'hobbies' // Hobbies, activities

  // Preferences
  | 'communication' // How they like to communicate
  | 'technology' // Tech preferences, devices
  | 'entertainment' // Movies, music, games, books
  | 'style' // Fashion, aesthetics

  // Health & Wellness
  | 'health' // Health conditions, medications
  | 'diet' // Dietary restrictions, allergies
  | 'wellness' // Mental health, self-care

  // Social
  | 'family' // Family members, relationships
  | 'friends' // Friends, social circle
  | 'colleagues' // Work relationships
  | 'pets' // Pets and animal companions

  // Work & Productivity
  | 'work_style' // How they work best
  | 'projects' // Current and past projects
  | 'skills' // Technical and soft skills
  | 'tools' // Preferred tools and software

  // Goals & Aspirations
  | 'goals_short' // Short-term goals (days/weeks)
  | 'goals_medium' // Medium-term goals (months)
  | 'goals_long' // Long-term goals (years)
  | 'dreams' // Life dreams, aspirations

  // History & Context
  | 'history' // Important life events
  | 'milestones' // Achievements, milestones
  | 'context' // Current context, situation

  // AI Interaction
  | 'ai_preferences' // How they want AI to behave
  | 'instructions' // Custom instructions
  | 'boundaries'; // Things AI should not do

/**
 * Personal data entry
 */
export interface PersonalDataEntry {
  /** Unique ID */
  id: string;
  /** User ID */
  userId: string;
  /** Data category */
  category: PersonalDataCategory;
  /** Data key (e.g., "name", "favorite_food") */
  key: string;
  /** Data value */
  value: string;
  /** Structured data (optional) */
  data?: Record<string, unknown>;
  /** Confidence score (0-1) */
  confidence: number;
  /** Source of this data */
  source: 'user_stated' | 'user_confirmed' | 'ai_inferred' | 'imported';
  /** Is this data sensitive? */
  sensitive: boolean;
  /** Created timestamp */
  createdAt: string;
  /** Updated timestamp */
  updatedAt: string;
  /** Last accessed */
  lastAccessed?: string;
  /** Expiry date (optional, for temporary data) */
  expiresAt?: string;
}

/**
 * Comprehensive user profile
 */
export interface ComprehensiveProfile {
  userId: string;

  // Identity
  identity: {
    name?: string;
    nickname?: string;
    age?: number;
    birthday?: string;
    gender?: string;
    nationality?: string;
    languages?: string[];
  };

  // Location
  location: {
    home?: { city?: string; country?: string; timezone?: string };
    work?: { city?: string; company?: string };
    current?: string;
    favoritePlaces?: string[];
  };

  // Lifestyle
  lifestyle: {
    wakeUpTime?: string;
    sleepTime?: string;
    workHours?: string;
    dailyRoutine?: string[];
    eatingHabits?: {
      breakfast?: string;
      lunch?: string;
      dinner?: string;
      snacks?: string[];
      favoriteFoods?: string[];
      dislikedFoods?: string[];
      dietaryRestrictions?: string[];
      allergies?: string[];
    };
    exercise?: string[];
    hobbies?: string[];
  };

  // Communication
  communication: {
    preferredStyle?: 'formal' | 'casual' | 'mixed';
    verbosity?: 'concise' | 'detailed' | 'mixed';
    primaryLanguage?: string;
    responseFormat?: 'text' | 'bullets' | 'mixed';
    emoji?: boolean;
    humor?: boolean;
  };

  // Work
  work: {
    occupation?: string;
    company?: string;
    role?: string;
    industry?: string;
    skills?: string[];
    tools?: string[];
    workStyle?: string;
    projects?: Array<{ name: string; status: string; description?: string }>;
  };

  // Social
  social: {
    family?: Array<{ name: string; relation: string; notes?: string }>;
    friends?: Array<{ name: string; notes?: string }>;
    pets?: Array<{ name: string; type: string; breed?: string }>;
  };

  // Goals
  goals: {
    shortTerm?: string[];
    mediumTerm?: string[];
    longTerm?: string[];
    dreams?: string[];
  };

  // AI preferences
  aiPreferences: {
    autonomyLevel?: 'none' | 'low' | 'medium' | 'high' | 'full';
    proactivity?: boolean;
    reminders?: boolean;
    suggestions?: boolean;
    boundaries?: string[];
    customInstructions?: string[];
  };

  // Metadata
  meta: {
    completeness: number;
    lastUpdated: string;
    totalEntries: number;
  };
}

// =============================================================================
// Personal Memory Store
// =============================================================================

/**
 * Personal Memory Store
 *
 * Manages comprehensive personal data for a user.
 */
export class PersonalMemoryStore {
  private readonly userId: string;
  private readonly storageDir: string;
  private data: Map<string, PersonalDataEntry> = new Map();
  private initialized = false;

  constructor(userId: string, storageDir?: string) {
    this.userId = userId;
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '.';
    this.storageDir = storageDir ?? path.join(homeDir, '.ownpilot', 'personal', userId);
  }

  /**
   * Initialize the store
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.storageDir, { recursive: true });
    await this.load();
    this.initialized = true;
  }

  /**
   * Set a personal data entry
   */
  async set(
    category: PersonalDataCategory,
    key: string,
    value: string,
    options?: {
      data?: Record<string, unknown>;
      confidence?: number;
      source?: PersonalDataEntry['source'];
      sensitive?: boolean;
      expiresAt?: string;
    }
  ): Promise<PersonalDataEntry> {
    await this.ensureInitialized();

    const existingId = this.findEntryId(category, key);
    const now = new Date().toISOString();

    if (existingId) {
      // Update existing entry
      const existing = this.data.get(existingId)!;
      const updated: PersonalDataEntry = {
        ...existing,
        value,
        data: options?.data ?? existing.data,
        confidence: options?.confidence ?? existing.confidence,
        source: options?.source ?? existing.source,
        sensitive: options?.sensitive ?? existing.sensitive,
        expiresAt: options?.expiresAt ?? existing.expiresAt,
        updatedAt: now,
      };
      this.data.set(existingId, updated);
      await this.save();
      return updated;
    }

    // Create new entry
    const entry: PersonalDataEntry = {
      id: `pd_${randomUUID()}`,
      userId: this.userId,
      category,
      key,
      value,
      data: options?.data,
      confidence: options?.confidence ?? 0.9,
      source: options?.source ?? 'user_stated',
      sensitive: options?.sensitive ?? false,
      createdAt: now,
      updatedAt: now,
      expiresAt: options?.expiresAt,
    };

    this.data.set(entry.id, entry);
    await this.save();
    return entry;
  }

  /**
   * Get a personal data entry
   */
  async get(category: PersonalDataCategory, key: string): Promise<PersonalDataEntry | null> {
    await this.ensureInitialized();

    const entryId = this.findEntryId(category, key);
    if (!entryId) return null;

    const entry = this.data.get(entryId)!;

    // Check expiry
    if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) {
      this.data.delete(entryId);
      await this.save();
      return null;
    }

    // Update access time
    entry.lastAccessed = new Date().toISOString();
    return entry;
  }

  /**
   * Get all entries in a category
   */
  async getCategory(category: PersonalDataCategory): Promise<PersonalDataEntry[]> {
    await this.ensureInitialized();

    const entries: PersonalDataEntry[] = [];
    const now = new Date();

    for (const entry of this.data.values()) {
      if (entry.category !== category) continue;

      // Skip expired entries
      if (entry.expiresAt && new Date(entry.expiresAt) < now) continue;

      entries.push(entry);
    }

    return entries.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Delete a personal data entry
   */
  async delete(category: PersonalDataCategory, key: string): Promise<boolean> {
    await this.ensureInitialized();

    const entryId = this.findEntryId(category, key);
    if (!entryId) return false;

    this.data.delete(entryId);
    await this.save();
    return true;
  }

  /**
   * Search personal data
   */
  async search(query: string, categories?: PersonalDataCategory[]): Promise<PersonalDataEntry[]> {
    await this.ensureInitialized();

    const queryLower = query.toLowerCase();
    const results: PersonalDataEntry[] = [];

    for (const entry of this.data.values()) {
      // Filter by categories
      if (categories && !categories.includes(entry.category)) continue;

      // Skip expired entries
      if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) continue;

      // Search in key and value
      if (
        entry.key.toLowerCase().includes(queryLower) ||
        entry.value.toLowerCase().includes(queryLower)
      ) {
        results.push(entry);
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Build comprehensive profile
   */
  async getProfile(): Promise<ComprehensiveProfile> {
    await this.ensureInitialized();

    const profile: ComprehensiveProfile = {
      userId: this.userId,
      identity: {},
      location: {},
      lifestyle: { eatingHabits: {} },
      communication: {},
      work: {},
      social: {},
      goals: {},
      aiPreferences: {},
      meta: {
        completeness: 0,
        lastUpdated: new Date().toISOString(),
        totalEntries: this.data.size,
      },
    };

    // Process all entries
    for (const entry of this.data.values()) {
      // Skip expired
      if (entry.expiresAt && new Date(entry.expiresAt) < new Date()) continue;

      this.applyEntryToProfile(profile, entry);
    }

    // Calculate completeness
    profile.meta.completeness = this.calculateCompleteness(profile);

    return profile;
  }

  /**
   * Get profile summary for system prompt
   */
  async getProfileSummary(): Promise<string> {
    const profile = await this.getProfile();
    const lines: string[] = [];

    // Identity
    if (profile.identity.name) {
      lines.push(`User's name: ${profile.identity.name}`);
    }
    if (profile.identity.nickname) {
      lines.push(`Nickname: ${profile.identity.nickname}`);
    }

    // Location & Time
    if (profile.location.home?.city) {
      lines.push(
        `Lives in: ${profile.location.home.city}${profile.location.home.country ? `, ${profile.location.home.country}` : ''}`
      );
    }
    if (profile.location.home?.timezone) {
      lines.push(`Timezone: ${profile.location.home.timezone}`);
    }

    // Work
    if (profile.work.occupation) {
      lines.push(
        `Occupation: ${profile.work.occupation}${profile.work.company ? ` at ${profile.work.company}` : ''}`
      );
    }

    // Lifestyle
    if (profile.lifestyle.eatingHabits?.favoriteFoods?.length) {
      lines.push(
        `Favorite foods: ${profile.lifestyle.eatingHabits.favoriteFoods.slice(0, 5).join(', ')}`
      );
    }
    if (profile.lifestyle.eatingHabits?.dietaryRestrictions?.length) {
      lines.push(
        `Dietary restrictions: ${profile.lifestyle.eatingHabits.dietaryRestrictions.join(', ')}`
      );
    }
    if (profile.lifestyle.hobbies?.length) {
      lines.push(`Hobbies: ${profile.lifestyle.hobbies.slice(0, 5).join(', ')}`);
    }

    // Communication
    if (profile.communication.preferredStyle) {
      lines.push(`Prefers ${profile.communication.preferredStyle} communication`);
    }
    if (profile.communication.verbosity) {
      lines.push(`Prefers ${profile.communication.verbosity} responses`);
    }
    if (profile.communication.primaryLanguage) {
      lines.push(`Primary language: ${profile.communication.primaryLanguage}`);
    }

    // Goals
    if (profile.goals.shortTerm?.length) {
      lines.push(`Current goals: ${profile.goals.shortTerm.slice(0, 3).join('; ')}`);
    }

    // AI preferences
    if (profile.aiPreferences.autonomyLevel) {
      lines.push(`Preferred autonomy level: ${profile.aiPreferences.autonomyLevel}`);
    }
    if (profile.aiPreferences.customInstructions?.length) {
      lines.push(`Custom instructions: ${profile.aiPreferences.customInstructions.join('; ')}`);
    }
    if (profile.aiPreferences.boundaries?.length) {
      lines.push(`Boundaries: ${profile.aiPreferences.boundaries.join('; ')}`);
    }

    return lines.join('\n');
  }

  /**
   * Import bulk data
   */
  async importData(
    entries: Array<{
      category: PersonalDataCategory;
      key: string;
      value: string;
      data?: Record<string, unknown>;
    }>
  ): Promise<number> {
    let imported = 0;

    for (const entry of entries) {
      await this.set(entry.category, entry.key, entry.value, {
        data: entry.data,
        source: 'imported',
      });
      imported++;
    }

    return imported;
  }

  /**
   * Export all data
   */
  async exportData(): Promise<PersonalDataEntry[]> {
    await this.ensureInitialized();
    return Array.from(this.data.values());
  }

  /**
   * Clear all data
   */
  async clearAll(): Promise<void> {
    this.data.clear();
    await this.save();
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  private findEntryId(category: PersonalDataCategory, key: string): string | null {
    for (const [id, entry] of this.data) {
      if (entry.category === category && entry.key === key) {
        return id;
      }
    }
    return null;
  }

  private applyEntryToProfile(profile: ComprehensiveProfile, entry: PersonalDataEntry): void {
    const { category, key, value, data } = entry;

    switch (category) {
      case 'identity':
        if (key === 'name') profile.identity.name = value;
        else if (key === 'nickname') profile.identity.nickname = value;
        else if (key === 'age') profile.identity.age = parseInt(value, 10);
        else if (key === 'birthday') profile.identity.birthday = value;
        else if (key === 'gender') profile.identity.gender = value;
        else if (key === 'nationality') profile.identity.nationality = value;
        else if (key === 'languages')
          profile.identity.languages = (data?.languages as string[]) ?? [value];
        break;

      case 'location':
        if (key === 'home_city') {
          profile.location.home = { ...profile.location.home, city: value };
        } else if (key === 'home_country') {
          profile.location.home = { ...profile.location.home, country: value };
        } else if (key === 'current') {
          profile.location.current = value;
        }
        break;

      case 'timezone':
        profile.location.home = { ...profile.location.home, timezone: value };
        break;

      case 'occupation':
        profile.work.occupation = value;
        if (data?.company) profile.work.company = data.company as string;
        if (data?.role) profile.work.role = data.role as string;
        break;

      case 'food':
        if (key === 'favorite') {
          profile.lifestyle.eatingHabits!.favoriteFoods = [
            ...(profile.lifestyle.eatingHabits?.favoriteFoods ?? []),
            value,
          ];
        } else if (key === 'disliked') {
          profile.lifestyle.eatingHabits!.dislikedFoods = [
            ...(profile.lifestyle.eatingHabits?.dislikedFoods ?? []),
            value,
          ];
        }
        break;

      case 'diet':
        if (key === 'restriction') {
          profile.lifestyle.eatingHabits!.dietaryRestrictions = [
            ...(profile.lifestyle.eatingHabits?.dietaryRestrictions ?? []),
            value,
          ];
        } else if (key === 'allergy') {
          profile.lifestyle.eatingHabits!.allergies = [
            ...(profile.lifestyle.eatingHabits?.allergies ?? []),
            value,
          ];
        }
        break;

      case 'hobbies':
        profile.lifestyle.hobbies = [...(profile.lifestyle.hobbies ?? []), value];
        break;

      case 'communication':
        if (key === 'style')
          profile.communication.preferredStyle = value as 'formal' | 'casual' | 'mixed';
        else if (key === 'verbosity')
          profile.communication.verbosity = value as 'concise' | 'detailed' | 'mixed';
        else if (key === 'language') profile.communication.primaryLanguage = value;
        else if (key === 'emoji') profile.communication.emoji = value === 'true';
        else if (key === 'humor') profile.communication.humor = value === 'true';
        break;

      case 'skills':
        profile.work.skills = [...(profile.work.skills ?? []), value];
        break;

      case 'goals_short':
        profile.goals.shortTerm = [...(profile.goals.shortTerm ?? []), value];
        break;

      case 'goals_medium':
        profile.goals.mediumTerm = [...(profile.goals.mediumTerm ?? []), value];
        break;

      case 'goals_long':
        profile.goals.longTerm = [...(profile.goals.longTerm ?? []), value];
        break;

      case 'ai_preferences':
        if (key === 'autonomy')
          profile.aiPreferences.autonomyLevel = value as
            | 'none'
            | 'low'
            | 'medium'
            | 'high'
            | 'full';
        else if (key === 'proactive') profile.aiPreferences.proactivity = value === 'true';
        else if (key === 'reminders') profile.aiPreferences.reminders = value === 'true';
        else if (key === 'suggestions') profile.aiPreferences.suggestions = value === 'true';
        break;

      case 'instructions':
        profile.aiPreferences.customInstructions = [
          ...(profile.aiPreferences.customInstructions ?? []),
          value,
        ];
        break;

      case 'boundaries':
        profile.aiPreferences.boundaries = [...(profile.aiPreferences.boundaries ?? []), value];
        break;

      case 'family':
        profile.social.family = [
          ...(profile.social.family ?? []),
          {
            name: value,
            relation: (data?.relation as string) ?? 'family',
            notes: data?.notes as string,
          },
        ];
        break;

      case 'pets':
        profile.social.pets = [
          ...(profile.social.pets ?? []),
          { name: value, type: (data?.type as string) ?? 'pet', breed: data?.breed as string },
        ];
        break;
    }
  }

  private calculateCompleteness(profile: ComprehensiveProfile): number {
    const checks = [
      !!profile.identity.name,
      !!profile.location.home?.city,
      !!profile.work.occupation,
      (profile.lifestyle.hobbies?.length ?? 0) > 0,
      !!profile.communication.preferredStyle,
      !!profile.communication.primaryLanguage,
      (profile.goals.shortTerm?.length ?? 0) > 0,
      !!profile.aiPreferences.autonomyLevel,
    ];

    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }

  private async load(): Promise<void> {
    const filePath = path.join(this.storageDir, 'personal.json');
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const entries = JSON.parse(content) as PersonalDataEntry[];
      this.data = new Map(entries.map((e) => [e.id, e]));
    } catch {
      this.data = new Map();
    }
  }

  private async save(): Promise<void> {
    const filePath = path.join(this.storageDir, 'personal.json');
    const entries = Array.from(this.data.values());
    await fs.writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a personal memory store
 */
export function createPersonalMemoryStore(
  userId: string,
  storageDir?: string
): PersonalMemoryStore {
  return new PersonalMemoryStore(userId, storageDir);
}

/**
 * Store cache (one per user)
 */
const personalStoreCache = new Map<string, PersonalMemoryStore>();

/**
 * Get or create personal memory store for a user
 */
export async function getPersonalMemoryStore(userId: string): Promise<PersonalMemoryStore> {
  let store = personalStoreCache.get(userId);
  if (!store) {
    store = createPersonalMemoryStore(userId);
    await store.initialize();
    personalStoreCache.set(userId, store);
  }
  return store;
}
