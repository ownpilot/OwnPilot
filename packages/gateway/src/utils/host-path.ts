/**
 * Host Path Mapping Utility
 *
 * Translates paths between Docker container mount points and host filesystem.
 * Used for bridge CLI spawning — the bridge needs host paths, not container paths.
 *
 * Environment variables:
 * - OWNPILOT_HOST_FS: Container mount point (e.g., /host-home)
 * - OWNPILOT_HOST_FS_HOST_PREFIX: Corresponding host path (e.g., /home/ayaz)
 */

function getHostFs(): string | undefined {
  return process.env.OWNPILOT_HOST_FS?.replace(/\/+$/, '');
}

function getHostPrefix(): string | undefined {
  return process.env.OWNPILOT_HOST_FS_HOST_PREFIX?.replace(/\/+$/, '');
}

export function isHostFsConfigured(): boolean {
  return !!getHostFs() && !!getHostPrefix();
}

export function toHostPath(containerPath: string | null | undefined): string | null {
  if (!containerPath) return null;
  const hostFs = getHostFs();
  const hostPrefix = getHostPrefix();
  if (!hostFs || !hostPrefix) return null;
  const normalized = containerPath.replace(/\/+$/, '');
  if (!normalized.startsWith(hostFs)) return null;
  return normalized === hostFs ? hostPrefix : normalized.replace(hostFs, hostPrefix);
}

export function toContainerPath(hostPath: string | null | undefined): string | null {
  if (!hostPath) return null;
  const hostFs = getHostFs();
  const hostPrefix = getHostPrefix();
  if (!hostFs || !hostPrefix) return null;
  const normalized = hostPath.replace(/\/+$/, '');
  if (!normalized.startsWith(hostPrefix)) return null;
  return normalized === hostPrefix ? hostFs : normalized.replace(hostPrefix, hostFs);
}
