/**
 * Security escape hatches — discovery and startup disclosure.
 *
 * A number of environment variables deliberately disable a protection so that
 * local development and self-hosting stay possible (local LLM endpoints, host
 * code execution, wider filesystem reach, …). Opt-in-by-default is the right
 * design, but an opt-in nobody can see is an opt-in nobody can audit: an
 * operator inheriting a deployment cannot answer "which defaults are off here?"
 * without grepping the source.
 *
 * This module is the single registry of those flags. It backs a startup WARN so
 * that every boot states, in the log, exactly which protections are disabled.
 *
 * When adding a new flag that weakens a default, add it here and to
 * `.env.example` in the same commit.
 */

import { getLog } from '../services/log.js';

const log = getLog('Security');

export interface EscapeHatch {
  /** Environment variable name. */
  env: string;
  /**
   * The exact value that activates it. Not uniform across the codebase:
   * most flags test `=== 'true'`, but OWNPILOT_ALLOW_LOCAL_EXEC tests `=== '1'`.
   * Encoding the real value here keeps this registry honest rather than
   * assuming a convention that does not hold.
   */
  activeValue: string;
  /** What protection is lost when the flag is active. */
  disables: string;
}

export const ESCAPE_HATCHES: readonly EscapeHatch[] = [
  {
    env: 'OWNPILOT_ALLOW_LOCAL_LLM_URL',
    activeValue: 'true',
    disables: 'SSRF guard on LLM base URLs (private/loopback addresses allowed)',
  },
  {
    env: 'OWNPILOT_ALLOW_LOCAL_EMBEDDING_URL',
    activeValue: 'true',
    disables: 'SSRF guard on the embedding service base URL',
  },
  {
    env: 'OWNPILOT_ALLOW_LOCAL_EXEC',
    activeValue: '1',
    disables: 'Docker sandbox for agent code execution (code runs on the host)',
  },
  {
    env: 'DOCKER_SANDBOX_RELAXED_SECURITY',
    activeValue: 'true',
    disables: 'hardening applied to the code-execution sandbox container',
  },
  {
    env: 'ALLOW_HOME_DIR_ACCESS',
    activeValue: 'true',
    disables: 'home-directory block for agent file tools',
  },
  {
    env: 'OWNPILOT_CODING_AGENT_ANY_DIR',
    activeValue: 'true',
    disables: 'directory allowlist for coding agents (any directory permitted)',
  },
  {
    env: 'OWNPILOT_ENABLE_SKILL_SCRIPTS',
    activeValue: 'true',
    disables: 'block on skills executing shell scripts',
  },
  {
    env: 'OWNPILOT_ENABLE_EXTENSION_HOST_ACCESS',
    activeValue: 'true',
    disables: 'sandbox boundary for extension tools reaching host resources',
  },
  {
    env: 'EXPOSE_INTERNAL_ERRORS',
    activeValue: 'true',
    disables: 'suppression of internal error details in production API responses',
  },
];

/**
 * Escape hatches currently active in this process.
 */
export function getActiveEscapeHatches(
  env: NodeJS.ProcessEnv = process.env
): readonly EscapeHatch[] {
  return ESCAPE_HATCHES.filter((hatch) => env[hatch.env] === hatch.activeValue);
}

/**
 * Log every active escape hatch at WARN. Called once during startup.
 *
 * Silent when none are active — a clean deployment should not be noisy.
 */
export function logActiveEscapeHatches(env: NodeJS.ProcessEnv = process.env): void {
  const active = getActiveEscapeHatches(env);
  if (active.length === 0) return;

  log.warn(
    `${active.length} security escape hatch${active.length === 1 ? ' is' : 'es are'} active — ` +
      'protections are disabled in this deployment:'
  );
  for (const hatch of active) {
    log.warn(`  ${hatch.env}=${hatch.activeValue} — disables ${hatch.disables}`);
  }
}
