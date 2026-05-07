/**
 * Provider Health Service
 *
 * Runs lightweight provider health checks at boot to detect unavailable
 * providers early. Logs warnings but does NOT fail boot.
 */

import { getLog } from '@ownpilot/core';

const log = getLog('ProviderHealth');

/** Lightweight health check result for a single provider */
interface HealthResult {
  providerId: string;
  status: 'ok' | 'unavailable';
  latencyMs?: number;
  error?: string;
}

/**
 * Probe a provider's /models endpoint with a lightweight GET request.
 * Returns 'ok' if the endpoint is reachable, 'unavailable' otherwise.
 */
async function probeEndpoint(
  baseUrl: string,
  apiKey: string,
  providerId: string
): Promise<HealthResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      return { providerId, status: 'ok', latencyMs: Date.now() - start };
    }
    return {
      providerId,
      status: 'unavailable',
      latencyMs: Date.now() - start,
      error: `HTTP ${response.status}: ${response.statusText}`,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      providerId,
      status: 'unavailable',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Known provider configurations for health checking */
interface ProviderProbeConfig {
  id: string;
  baseUrl: string;
  apiKey: string;
}

/**
 * Run health checks for all configured providers.
 *
 * Each provider is probed via its /models endpoint (5s timeout).
 * Results are logged at WARN level for unavailable providers.
 *
 * This runs at boot — it does NOT fail the server, only logs warnings.
 */
export async function runProviderHealthChecks(): Promise<void> {
  log.info('[health] Starting provider health checks...');

  try {
    // Build provider configs from environment variables
    const providerConfigs: ProviderProbeConfig[] = [];

    const openaiKey = process.env.OPENAI_API_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const googleKey = process.env.GOOGLE_API_KEY;
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    if (openaiKey) {
      providerConfigs.push({
        id: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: openaiKey,
      });
    }

    if (anthropicKey) {
      providerConfigs.push({
        id: 'anthropic',
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: anthropicKey,
      });
    }

    if (googleKey) {
      providerConfigs.push({
        id: 'google',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: googleKey,
      });
    }

    if (deepseekKey) {
      providerConfigs.push({
        id: 'deepseek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: deepseekKey,
      });
    }

    if (groqKey) {
      providerConfigs.push({
        id: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: groqKey,
      });
    }

    if (providerConfigs.length === 0) {
      log.info('[health] No providers configured — skipping checks');
      return;
    }

    const results: HealthResult[] = await Promise.all(
      providerConfigs.map((p) => probeEndpoint(p.baseUrl, p.apiKey, p.id))
    );

    // Log summary
    const okCount = results.filter((r) => r.status === 'ok').length;
    const unavailableCount = results.filter((r) => r.status === 'unavailable').length;

    log.info(`[health] Done. ok=${okCount} unavailable=${unavailableCount}`);

    for (const result of results) {
      if (result.status === 'ok') {
        log.info(`[health] ${result.providerId}: OK (${result.latencyMs}ms)`);
      } else {
        log.warn(`[health] ${result.providerId}: UNAVAILABLE — ${result.error}`);
      }
    }
  } catch (err) {
    log.error(`[health] Health check failed: ${err}`);
  }
}
