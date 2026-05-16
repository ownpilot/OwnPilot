/**
 * Sandbox Environment Builder
 *
 * Builds the minimal environment passed to child processes spawned by claw
 * tools (script execution, package install).
 *
 * Spreading `process.env` directly would leak every API key, DB URL, and
 * cloud credential the gateway has into a user-controlled script — a runaway
 * claw could read OPENAI_API_KEY, AWS_*, DATABASE_URL etc. and exfiltrate via
 * any network-capable tool.
 *
 * Only forwards variables strictly needed for interpreters to function:
 * PATH (find binaries), HOME, USERPROFILE, locale settings, temp dirs.
 * Caller-supplied overrides win.
 */
export function buildSandboxEnv(overrides: Record<string, string>): Record<string, string> {
  const ALLOW = [
    'PATH',
    'HOME',
    'USERPROFILE',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TZ',
    'SystemRoot', // Windows: required by node
    'SystemDrive',
    'COMSPEC',
    'PATHEXT',
  ];
  const env: Record<string, string> = {};
  for (const key of ALLOW) {
    const v = process.env[key];
    if (typeof v === 'string') env[key] = v;
  }
  return { ...env, ...overrides };
}
