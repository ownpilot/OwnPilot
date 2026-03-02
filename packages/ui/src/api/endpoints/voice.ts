/**
 * Voice API endpoints
 *
 * Transcribe and synthesize use raw fetch (multipart upload / binary download).
 * Config uses the standard apiClient (JSON envelope).
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export interface VoiceConfig {
  available: boolean;
  sttAvailable: boolean;
  ttsAvailable: boolean;
  provider: string | null;
  voices: string[];
}

export interface TranscribeResult {
  text: string;
  language?: string;
  duration?: number;
}

// =============================================================================
// Helpers
// =============================================================================

const SESSION_TOKEN_KEY = 'ownpilot-session-token';

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  try {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    if (token) headers['X-Session-Token'] = token;
  } catch {
    // localStorage may not be available
  }
  return headers;
}

// =============================================================================
// API
// =============================================================================

export const voiceApi = {
  /** Check voice service availability and configuration */
  getConfig: () => apiClient.get<VoiceConfig>('/voice/config'),

  /** Transcribe audio blob to text (multipart upload) */
  async transcribe(blob: Blob, language?: string): Promise<TranscribeResult> {
    const form = new FormData();
    form.append('file', blob, 'recording.webm');
    if (language) form.append('language', language);

    const response = await fetch(`/api/v1/voice/transcribe`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: form,
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ error: { message: 'Transcription failed' } }));
      throw new Error(error?.error?.message || `HTTP ${response.status}`);
    }

    const envelope = await response.json();
    return envelope.data as TranscribeResult;
  },

  /** Synthesize text to audio (returns audio Blob) */
  async synthesize(
    text: string,
    options?: { voice?: string; format?: string; speed?: number }
  ): Promise<Blob> {
    const response = await fetch(`/api/v1/voice/synthesize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      },
      body: JSON.stringify({ text, ...options }),
    });

    if (!response.ok) {
      // Try to parse JSON error body
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error?.error?.message || `HTTP ${response.status}`);
      }
      throw new Error(`Synthesis failed: HTTP ${response.status}`);
    }

    return response.blob();
  },
};
