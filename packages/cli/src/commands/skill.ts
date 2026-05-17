/**
 * Skill Management Commands
 *
 * Install, search, and manage OwnPilot skills via the gateway REST API.
 * Skills can be installed from npm (keyword: ownpilot-skill) or local paths.
 */

import { select, confirm, checkbox } from '@inquirer/prompts';

// ============================================================================
// Types
// ============================================================================

interface NpmSearchPackage {
  name: string;
  version: string;
  description: string;
  author?: string;
  keywords: string[];
}

interface ExtensionInfo {
  id: string;
  name: string;
  description: string;
  format: string;
  status: string;
  manifest: {
    npm_package?: string;
    npm_version?: string;
    permissions?: { required: string[]; optional: string[] };
  };
  settings?: Record<string, unknown>;
}

interface ExtensionsListResponse {
  packages?: ExtensionInfo[];
  total?: number;
}

interface PermissionInfo {
  name: string;
  description: string;
  sensitivity: string;
}

// ============================================================================
// Gateway API Helper
// ============================================================================

const getBaseUrl = () => process.env.OWNPILOT_GATEWAY_URL ?? 'http://localhost:8080';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}/api/v1${path}`;
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const errField = body.error;
    const msg =
      typeof errField === 'object' && errField !== null
        ? ((errField as Record<string, string>).message ?? JSON.stringify(errField))
        : ((errField as string) ?? (body.message as string) ?? `HTTP ${res.status}`);
    throw new Error(msg);
  }

  const json = (await res.json()) as Record<string, unknown>;
  return (json.data ?? json) as T;
}

function ensureGatewayError(error: unknown): never {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed')) {
    console.error(
      '\nCould not reach gateway at ' +
        getBaseUrl() +
        '.\n' +
        'Make sure the server is running: ownpilot start\n'
    );
  } else {
    console.error(`\nError: ${msg}\n`);
  }
  process.exit(1);
}

async function listExtensions(): Promise<ExtensionInfo[]> {
  const data = await apiFetch<ExtensionInfo[] | ExtensionsListResponse>('/extensions');
  return Array.isArray(data) ? data : (data.packages ?? []);
}

function isLikelyLocalPath(value: string): boolean {
  return (
    value.includes('/') ||
    value.includes('\\') ||
    value.startsWith('.') ||
    /^[A-Za-z]:[\\/]/.test(value)
  );
}

// ============================================================================
// Helpers
// ============================================================================

const STATUS_ICONS: Record<string, string> = {
  enabled: '\u2705',
  disabled: '\u26AA',
  error: '\u274C',
};

function statusIcon(status: string): string {
  return STATUS_ICONS[status] ?? '\u2753';
}

const SENSITIVITY_ICONS: Record<string, string> = {
  high: '\u{1F534}',
  medium: '\u{1F7E1}',
  low: '\u{1F7E2}',
};

// ============================================================================
// Public Commands
// ============================================================================

/**
 * List installed skills/extensions.
 */
export async function skillList(): Promise<void> {
  try {
    const data = await listExtensions();

    console.log('\nInstalled Skills:');
    console.log('\u2500'.repeat(90));
    console.log(
      `${'ID'.padEnd(24)} ${'NAME'.padEnd(22)} ${'FORMAT'.padEnd(12)} ${'STATUS'.padEnd(12)} ${'VERSION'.padEnd(10)} SOURCE`
    );
    console.log('\u2500'.repeat(90));

    if (!data || data.length === 0) {
      console.log('  No skills installed.');
      console.log('  Use "ownpilot skill search <query>" to find skills.\n');
      return;
    }

    for (const ext of data) {
      const npmPkg =
        ext.manifest?.npm_package ?? (ext.settings as Record<string, unknown>)?.npmPackage;
      const npmVersion =
        ext.manifest?.npm_version ?? (ext.settings as Record<string, unknown>)?.npmVersion;
      const source = npmPkg ? `npm:${npmPkg}` : 'local';
      const version = npmVersion ? String(npmVersion) : '-';

      console.log(
        `${ext.id.padEnd(24)} ${ext.name.substring(0, 21).padEnd(22)} ${ext.format.padEnd(12)} ${statusIcon(ext.status)} ${ext.status.padEnd(10)} ${version.padEnd(10)} ${source}`
      );
    }

    console.log('\u2500'.repeat(90));
    console.log(`  ${data.length} skill(s) installed\n`);
  } catch (error) {
    ensureGatewayError(error);
  }
}

/**
 * Search npm registry for OwnPilot skills.
 */
export async function skillSearch(query: string): Promise<void> {
  if (!query) {
    console.error('\nUsage: ownpilot skill search <query>\n');
    return;
  }

  try {
    console.log(`\nSearching npm for "${query}"...\n`);

    const data = await apiFetch<{ packages: NpmSearchPackage[]; total: number }>(
      `/skills/search?q=${encodeURIComponent(query)}&limit=20`
    );

    if (data.packages.length === 0) {
      console.log('  No skills found matching your query.');
      console.log('  Skills must have the "ownpilot-skill" keyword on npm.\n');
      return;
    }

    console.log('\u2500'.repeat(80));
    console.log(`${'PACKAGE'.padEnd(30)} ${'VERSION'.padEnd(12)} ${'DESCRIPTION'}`);
    console.log('\u2500'.repeat(80));

    for (const pkg of data.packages) {
      console.log(
        `${pkg.name.substring(0, 29).padEnd(30)} ${pkg.version.padEnd(12)} ${pkg.description.substring(0, 36)}`
      );
    }

    console.log('\u2500'.repeat(80));
    console.log(`  ${data.total} result(s)`);
    console.log('\n  Install with: ownpilot skill install <package-name>\n');
  } catch (error) {
    ensureGatewayError(error);
  }
}

/**
 * Install a skill from npm or local path.
 * If the name starts with @ or contains no /, treat as npm package.
 */
export async function skillInstall(nameOrPath: string): Promise<void> {
  if (!nameOrPath) {
    console.error('\nUsage: ownpilot skill install <package-name-or-path>\n');
    return;
  }

  try {
    // Detect npm vs local
    const isNpm = !isLikelyLocalPath(nameOrPath);

    if (isNpm) {
      console.log(`\nFetching package info for ${nameOrPath}...`);

      // Get package info to show permissions before install
      const info = await apiFetch<{
        name: string;
        version: string;
        description: string;
      }>(`/skills/npm/${encodeURIComponent(nameOrPath)}`);

      console.log(`\n  Package: ${info.name}@${info.version}`);
      console.log(`  Description: ${info.description}`);

      // Get available permissions for display
      const permsList = await apiFetch<{ permissions: PermissionInfo[] }>('/skills/permissions');
      const allPerms = permsList.permissions;

      // Ask for permission grant
      if (allPerms.length > 0) {
        console.log('\nPermission Review:');
        console.log('  Select which permissions to grant this skill.\n');

        const granted = await checkbox({
          message: 'Grant permissions:',
          choices: allPerms.map((p) => ({
            name: `${SENSITIVITY_ICONS[p.sensitivity] ?? ''} ${p.name} — ${p.description}`,
            value: p.name,
            checked: false,
          })),
        });

        // Confirm install
        const ok = await confirm({
          message: `Install ${info.name}@${info.version} with ${granted.length} permission(s)?`,
          default: true,
        });

        if (!ok) {
          console.log('\nInstallation cancelled.\n');
          return;
        }

        console.log('\nInstalling...');

        const result = await apiFetch<{
          success: boolean;
          extensionId?: string;
          error?: string;
          packageName?: string;
          packageVersion?: string;
        }>('/skills/install-npm', {
          method: 'POST',
          body: JSON.stringify({ packageName: nameOrPath }),
        });

        if (!result.success) {
          console.error(`\nInstallation failed: ${result.error}\n`);
          return;
        }

        // Grant permissions
        if (granted.length > 0 && result.extensionId) {
          await apiFetch(`/skills/permissions/${result.extensionId}`, {
            method: 'POST',
            body: JSON.stringify({ grantedPermissions: granted }),
          });
        }

        console.log(`\n\u2705 Installed ${result.packageName}@${result.packageVersion}`);
        console.log(`  Extension ID: ${result.extensionId}`);
        console.log(`  Permissions: ${granted.length > 0 ? granted.join(', ') : 'none'}\n`);
      } else {
        // No permissions available — simple install
        console.log('\nInstalling...');
        const result = await apiFetch<{
          success: boolean;
          extensionId?: string;
          error?: string;
          packageName?: string;
          packageVersion?: string;
        }>('/skills/install-npm', {
          method: 'POST',
          body: JSON.stringify({ packageName: nameOrPath }),
        });

        if (!result.success) {
          console.error(`\nInstallation failed: ${result.error}\n`);
          return;
        }

        console.log(`\n\u2705 Installed ${result.packageName}@${result.packageVersion}`);
        console.log(`  Extension ID: ${result.extensionId}\n`);
      }
    } else {
      // Local path install — just call the existing extension install endpoint
      console.log(`\nInstalling from local path: ${nameOrPath}`);

      const result = await apiFetch<{ package?: ExtensionInfo; id?: string; name?: string }>(
        '/extensions/install',
        {
          method: 'POST',
          body: JSON.stringify({ path: nameOrPath }),
        }
      );

      const installed = result.package ?? result;
      console.log(`\n\u2705 Installed "${installed.name}"`);
      console.log(`  Extension ID: ${installed.id}\n`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('ExitPromptError')) return;
    ensureGatewayError(error);
  }
}

/**
 * Uninstall a skill by ID.
 */
export async function skillUninstall(id?: string): Promise<void> {
  try {
    const extensions = await listExtensions();

    if (!extensions || extensions.length === 0) {
      console.log('\nNo skills installed.\n');
      return;
    }

    const targetId =
      id ??
      (await select({
        message: 'Select skill to uninstall:',
        choices: extensions.map((e) => ({
          name: `${e.name} (${e.id})`,
          value: e.id,
        })),
      }));

    const ext = extensions.find((e) => e.id === targetId);
    if (!ext) {
      console.error(`\nSkill "${targetId}" not found.\n`);
      return;
    }

    const ok = await confirm({
      message: `Uninstall "${ext.name}" (${ext.id})?`,
      default: false,
    });

    if (!ok) {
      console.log('\nCancelled.\n');
      return;
    }

    await apiFetch(`/skills/${targetId}`, { method: 'DELETE' });
    console.log(`\n\u2705 Removed "${ext.name}"\n`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ExitPromptError')) return;
    ensureGatewayError(error);
  }
}

/**
 * Enable a skill.
 */
export async function skillEnable(id?: string): Promise<void> {
  try {
    const extensions = await listExtensions();
    const disabled = (extensions ?? []).filter((e) => e.status === 'disabled');

    if (disabled.length === 0) {
      console.log('\nNo disabled skills to enable.\n');
      return;
    }

    const targetId =
      id ??
      (await select({
        message: 'Select skill to enable:',
        choices: disabled.map((e) => ({
          name: `${e.name} (${e.id})`,
          value: e.id,
        })),
      }));

    await apiFetch(`/extensions/${targetId}/enable`, { method: 'POST' });

    console.log(`\n\u2705 Enabled "${targetId}"\n`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ExitPromptError')) return;
    ensureGatewayError(error);
  }
}

/**
 * Disable a skill.
 */
export async function skillDisable(id?: string): Promise<void> {
  try {
    const extensions = await listExtensions();
    const enabled = (extensions ?? []).filter((e) => e.status === 'enabled');

    if (enabled.length === 0) {
      console.log('\nNo enabled skills to disable.\n');
      return;
    }

    const targetId =
      id ??
      (await select({
        message: 'Select skill to disable:',
        choices: enabled.map((e) => ({
          name: `${e.name} (${e.id})`,
          value: e.id,
        })),
      }));

    await apiFetch(`/extensions/${targetId}/disable`, { method: 'POST' });

    console.log(`\n\u26AA Disabled "${targetId}"\n`);
  } catch (error) {
    if (error instanceof Error && error.message.includes('ExitPromptError')) return;
    ensureGatewayError(error);
  }
}

/**
 * Check for updates on installed npm skills.
 */
export async function skillCheckUpdates(): Promise<void> {
  try {
    console.log('\nChecking for updates...\n');

    const data = await apiFetch<{
      updates: { id: string; name: string; current: string; latest: string }[];
    }>('/skills/check-updates', { method: 'POST' });

    if (data.updates.length === 0) {
      console.log('  All skills are up to date.\n');
      return;
    }

    console.log('\u2500'.repeat(70));
    console.log(`${'NAME'.padEnd(24)} ${'CURRENT'.padEnd(14)} ${'LATEST'.padEnd(14)} ID`);
    console.log('\u2500'.repeat(70));

    for (const u of data.updates) {
      console.log(
        `${u.name.substring(0, 23).padEnd(24)} ${u.current.padEnd(14)} ${u.latest.padEnd(14)} ${u.id}`
      );
    }

    console.log('\u2500'.repeat(70));
    console.log(`\n  ${data.updates.length} update(s) available.`);
    console.log('  Reinstall with: ownpilot skill install <package-name>\n');
  } catch (error) {
    ensureGatewayError(error);
  }
}

/**
 * Run security audit on a skill.
 */
export async function skillAudit(id?: string): Promise<void> {
  try {
    const extensions = await listExtensions();

    if (!extensions || extensions.length === 0) {
      console.log('\nNo skills installed.\n');
      return;
    }

    const targetId =
      id ??
      (await select({
        message: 'Select skill to audit:',
        choices: extensions.map((e) => ({
          name: `${e.name} (${e.id})`,
          value: e.id,
        })),
      }));

    console.log(`\nRunning security audit for ${targetId}...`);

    const result = await apiFetch<{
      id: string;
      safe: boolean;
      risk: string;
      findings: { severity: string; message: string }[];
    }>(`/extensions/${targetId}/audit`, { method: 'POST' });

    console.log(`\n  Risk level: ${result.risk}`);
    console.log(`  Safe: ${result.safe ? '\u2705 Yes' : '\u274C No'}`);

    if (result.findings.length > 0) {
      console.log('\n  Findings:');
      for (const f of result.findings) {
        const icon =
          f.severity === 'high' ? '\u{1F534}' : f.severity === 'medium' ? '\u{1F7E1}' : '\u{1F7E2}';
        console.log(`    ${icon} [${f.severity}] ${f.message}`);
      }
    } else {
      console.log('\n  No issues found.');
    }

    console.log('');
  } catch (error) {
    if (error instanceof Error && error.message.includes('ExitPromptError')) return;
    ensureGatewayError(error);
  }
}
