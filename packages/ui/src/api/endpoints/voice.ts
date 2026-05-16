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
  provider: string | null;
  sttSupported: boolean;
  ttsSupported: boolean;
  sttAvailable: boolean;
  ttsAvailable: boolean;
  voices: Array<{ id: string; name: string }>;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  duration?: number;
}

export interface VoiceListResult {
  available: boolean;
  provider: string | null;
  voices: Array<{ id: string; name: string }>;
}

export interface VoiceDiagnosticCheck {
  name: string;
  ok: boolean;
  message: string;
  optional?: boolean;
}

export interface VoiceDiagnostics {
  configured: boolean;
  provider: string | null;
  stt: { supported: boolean; ok: boolean; message: string };
  tts: { supported: boolean; ok: boolean; message: string };
  checks: VoiceDiagnosticCheck[];
}

// =============================================================================
// API
// =============================================================================

export const voiceApi = {
  /** Check voice service availability and configuration */
  getConfig: () => apiClient.get<VoiceConfig>('/voice/config'),

  /** Alias for voice service availability and configuration */
  getStatus: () => apiClient.get<VoiceConfig>('/voice/status'),

  /** List voices supported by the configured TTS provider */
  getVoices: () => apiClient.get<VoiceListResult>('/voice/voices'),

  /** Diagnose configured voice provider readiness */
  getDiagnostics: () => apiClient.get<VoiceDiagnostics>('/voice/diagnostics'),

  /** Transcribe audio blob to text (multipart upload) */
  async transcribe(blob: Blob, language?: string): Promise<TranscribeResult> {
    const form = new FormData();
    form.append('file', blob, 'recording.webm');
    if (language) form.append('language', language);

    const response = await fetch(`/api/v1/voice/transcribe`, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
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
      },
      body: JSON.stringify({ text, ...options }),
      credentials: 'same-origin',
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
