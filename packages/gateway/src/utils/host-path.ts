/**
 * Host Path Mapping Utility
 *
 * Translates paths between Docker container mount points and host filesystem.
 * Used for bridge CLI spawning — the bridge needs host paths, not container paths.
 *
 * Environment variables:
 * - OWNPILOT_HOST_FS: Container mount point (e.g., /host-home)
 * - OWNPILOT_HOST_FS_HOST_PREFIX: Corresponding host path (e.g., /home/user)
 */

function getHostFs(): string | undefined {
  return process.env.OWNPILOT_HOST_FS?.replace(/[\\/]+$/, '');
}

function getHostPrefix(): string | undefined {
  return process.env.OWNPILOT_HOST_FS_HOST_PREFIX?.replace(/[\\/]+$/, '');
}

function trimTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

function isSameOrChild(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}\\`);
}

function replacePrefix(path: string, prefix: string, replacement: string): string {
  return replacement + path.slice(prefix.length);
}

export function isHostFsConfigured(): boolean {
  return !!getHostFs() && !!getHostPrefix();
}

export function toHostPath(containerPath: string | null | undefined): string | null {
  if (!containerPath) return null;
  const hostFs = getHostFs();
  const hostPrefix = getHostPrefix();
  if (!hostFs || !hostPrefix) return null;
  const normalized = trimTrailingSeparators(containerPath);
  if (!isSameOrChild(normalized, hostFs)) return null;
  return normalized === hostFs ? hostPrefix : replacePrefix(normalized, hostFs, hostPrefix);
}

export function toContainerPath(hostPath: string | null | undefined): string | null {
  if (!hostPath) return null;
  const hostFs = getHostFs();
  const hostPrefix = getHostPrefix();
  if (!hostFs || !hostPrefix) return null;
  const normalized = trimTrailingSeparators(hostPath);
  if (!isSameOrChild(normalized, hostPrefix)) return null;
  return normalized === hostPrefix ? hostFs : replacePrefix(normalized, hostPrefix, hostFs);
}
