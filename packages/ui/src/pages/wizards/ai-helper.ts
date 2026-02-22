/**
 * AI Helper for Wizards
 *
 * Lightweight wrapper around the chat API for getting AI suggestions
 * in wizard flows. Fetches default provider/model on first call,
 * sends a non-streaming request, and extracts the text response.
 */

import { apiClient } from '../../api';
import { settingsApi } from '../../api';

interface ChatResponse {
  message?: string;
  response?: string;
}

let cachedDefaults: { provider: string; model: string; fetchedAt: number } | null = null;

/** Cache TTL — refetch after 5 minutes. */
const DEFAULTS_TTL_MS = 5 * 60 * 1000;

const FALLBACK_DEFAULTS = { provider: 'openai', model: 'gpt-4o' };

/** Fetch and cache default provider/model from settings. */
async function getDefaults(): Promise<{ provider: string; model: string }> {
  if (cachedDefaults && Date.now() - cachedDefaults.fetchedAt < DEFAULTS_TTL_MS) {
    return cachedDefaults;
  }
  try {
    const settings = await settingsApi.get();
    cachedDefaults = {
      provider: settings.defaultProvider || 'openai',
      model: settings.defaultModel || 'gpt-4o',
      fetchedAt: Date.now(),
    };
    return cachedDefaults;
  } catch {
    // Don't cache failure — retry on next call
    return FALLBACK_DEFAULTS;
  }
}

/**
 * Send a prompt to the AI and get a text response.
 * Uses the default provider/model configured in settings.
 */
export async function aiGenerate(prompt: string, signal?: AbortSignal): Promise<string> {
  const { provider, model } = await getDefaults();

  const res = await apiClient.post<ChatResponse>(
    '/chat',
    {
      message: prompt,
      provider,
      model,
      stream: false,
      historyLength: 0,
    },
    { signal }
  );

  return (res.message || res.response || '').trim();
}

/**
 * Extract a JSON array from an AI response that might contain markdown fences.
 */
export function extractJsonArray<T>(text: string): T[] {
  // Strip markdown code fences
  let cleaned = text
    .replace(/```(?:json)?\s*/gi, '')
    .replace(/```/g, '')
    .trim();

  // Find the first [ ... ] block
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start !== -1 && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }

  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
