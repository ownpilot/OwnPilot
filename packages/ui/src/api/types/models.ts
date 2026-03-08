// Model Configs, AI Models, and Profile types

export interface SyncApplyResult {
  stats?: { providers: number; totalModels: number };
}

export interface SyncResetResult {
  stats?: { deleted: number; synced: number };
}

export type ModelCapability =
  | 'chat'
  | 'code'
  | 'vision'
  | 'function_calling'
  | 'json_mode'
  | 'streaming'
  | 'embeddings'
  | 'image_generation'
  | 'audio'
  | 'reasoning';

export interface MergedModel {
  providerId: string;
  providerName: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapability[];
  pricingInput?: number;
  pricingOutput?: number;
  pricingPerRequest?: number;
  contextWindow?: number;
  maxOutput?: number;
  isEnabled: boolean;
  isCustom: boolean;
  hasOverride: boolean;
  isConfigured: boolean;
  source: 'builtin' | 'aggregator' | 'custom' | 'local';
}

export interface AvailableProvider {
  id: string;
  name: string;
  type: 'builtin' | 'aggregator';
  description?: string;
  apiBase?: string;
  apiKeyEnv: string;
  docsUrl?: string;
  modelCount: number;
  isEnabled: boolean;
  isConfigured: boolean;
}

export interface LocalProvider {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  isEnabled: boolean;
  isDefault: boolean;
  modelCount: number;
  lastDiscoveredAt?: string;
}

export interface LocalProviderTemplate {
  id: string;
  name: string;
  providerType: string;
  baseUrl: string;
  discoveryEndpoint: string;
  description: string;
}

export interface CapabilityDef {
  id: ModelCapability;
  name: string;
  description: string;
}

// ---- Profile ----

export interface ProfileData {
  userId: string;
  identity: {
    name?: string;
    nickname?: string;
    age?: number;
    birthday?: string;
    gender?: string;
    nationality?: string;
    languages?: string[];
  };
  location: {
    home?: { city?: string; country?: string; timezone?: string };
    work?: { city?: string; company?: string };
    current?: string;
  };
  lifestyle: {
    wakeUpTime?: string;
    sleepTime?: string;
    workHours?: string;
    eatingHabits?: {
      favoriteFoods?: string[];
      dislikedFoods?: string[];
      dietaryRestrictions?: string[];
      allergies?: string[];
    };
    hobbies?: string[];
  };
  communication: {
    preferredStyle?: 'formal' | 'casual' | 'mixed';
    verbosity?: 'concise' | 'detailed' | 'mixed';
    primaryLanguage?: string;
  };
  work: {
    occupation?: string;
    industry?: string;
    skills?: string[];
    tools?: string[];
  };
  preferences: {
    customInstructions?: string[];
    boundaries?: string[];
    goals?: string[];
  };
  aiPreferences?: {
    autonomyLevel?: 'none' | 'low' | 'medium' | 'high' | 'full';
    customInstructions?: string[];
    boundaries?: string[];
  };
  meta?: {
    completeness?: number;
    totalEntries?: number;
  };
  goals?: {
    shortTerm?: string[];
    mediumTerm?: string[];
    longTerm?: string[];
  };
}
