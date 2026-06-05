/**
 * Extension Host Gate
 *
 * Evaluates whether an extension/skill can run on the current machine based on
 * its declared {@link ExtensionRequirements} (OS, required binaries on PATH,
 * required env vars). Gated-out extensions contribute no tools or prompt
 * sections — they stay dormant instead of failing at call time.
 *
 * Pure and dependency-injectable: `evaluateExtensionGate` takes overridable
 * `platform` / `env` / `hasBinary` so it is unit-testable without touching the
 * real host. The default binary check shells out to `which`/`where` once per
 * binary and caches the result for the process lifetime.
 */

import { spawnSync } from 'node:child_process';
import type { ExtensionRequirements } from './types.js';

export interface ExtensionGateResult {
  ok: boolean;
  missing: { os?: string; binaries?: string[]; env?: string[] };
}

interface GateDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  hasBinary: (bin: string) => boolean;
}

const binaryCache = new Map<string, boolean>();

/** Default PATH lookup — `which` (POSIX) / `where` (Windows), cached. */
function defaultHasBinary(bin: string): boolean {
  const cached = binaryCache.get(bin);
  if (cached !== undefined) return cached;

  // Only allow safe executable names — never pass shell metacharacters.
  if (!/^[A-Za-z0-9._-]+$/.test(bin)) {
    binaryCache.set(bin, false);
    return false;
  }

  const cmd = process.platform === 'win32' ? 'where' : 'which';
  let ok = false;
  try {
    const res = spawnSync(cmd, [bin], { stdio: 'ignore', timeout: 3000, shell: false });
    ok = res.status === 0;
  } catch {
    ok = false;
  }
  binaryCache.set(bin, ok);
  return ok;
}

/**
 * Evaluate an extension's host requirements. Returns `{ ok: true }` when there
 * are no requirements or all are satisfied; otherwise `ok: false` with the
 * specific missing pieces for display.
 */
export function evaluateExtensionGate(
  requirements: ExtensionRequirements | undefined,
  deps: Partial<GateDeps> = {}
): ExtensionGateResult {
  if (!requirements) return { ok: true, missing: {} };

  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const hasBinary = deps.hasBinary ?? defaultHasBinary;

  const missing: ExtensionGateResult['missing'] = {};

  if (
    requirements.os &&
    requirements.os.length > 0 &&
    !requirements.os.includes(platform as never)
  ) {
    missing.os = platform;
  }

  if (requirements.env && requirements.env.length > 0) {
    const miss = requirements.env.filter((key) => {
      const v = env[key];
      return v === undefined || v === '';
    });
    if (miss.length > 0) missing.env = miss;
  }

  if (requirements.binaries && requirements.binaries.length > 0) {
    const miss = requirements.binaries.filter((bin) => !hasBinary(bin));
    if (miss.length > 0) missing.binaries = miss;
  }

  const ok = !missing.os && !missing.binaries && !missing.env;
  return { ok, missing };
}

/** Human-readable reason for a failed gate, for logs/UI. */
export function describeGateFailure(result: ExtensionGateResult): string {
  const parts: string[] = [];
  if (result.missing.os) parts.push(`requires OS not matching "${result.missing.os}"`);
  if (result.missing.binaries?.length)
    parts.push(`missing binaries: ${result.missing.binaries.join(', ')}`);
  if (result.missing.env?.length) parts.push(`missing env: ${result.missing.env.join(', ')}`);
  return parts.join('; ') || 'host requirements unmet';
}
