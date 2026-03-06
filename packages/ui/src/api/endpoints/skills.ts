/**
 * Skills API Endpoints
 *
 * npm-based skill discovery, installation, permissions, and update checking.
 */

import { apiClient } from '../client';

// =============================================================================
// Types
// =============================================================================

export interface NpmSearchPackage {
  name: string;
  version: string;
  description: string;
  author?: string;
  keywords: string[];
  date: string;
  links?: { npm?: string; homepage?: string; repository?: string };
}

export interface NpmSearchResult {
  packages: NpmSearchPackage[];
  total: number;
}

export interface NpmPackageInfo {
  name: string;
  version: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;
  keywords?: string[];
}

export interface NpmInstallResult {
  success: boolean;
  extensionId?: string;
  error?: string;
  packageName?: string;
  packageVersion?: string;
}

export interface SkillPermissionInfo {
  name: string;
  description: string;
  sensitivity: 'low' | 'medium' | 'high';
}

export interface SkillPermissionData {
  declared: { required: string[]; optional: string[] };
  granted: string[];
}

export interface SkillUpdateInfo {
  id: string;
  name: string;
  current: string;
  latest: string;
}

// =============================================================================
// API
// =============================================================================

export const skillsApi = {
  /** Search npm for OwnPilot skills */
  search: (query: string, limit = 20, offset = 0) =>
    apiClient.get<NpmSearchResult>(
      `/skills/search?q=${encodeURIComponent(query)}&limit=${limit}${offset ? `&offset=${offset}` : ''}`
    ),

  /** Get npm package info */
  getPackageInfo: (name: string) =>
    apiClient.get<NpmPackageInfo>(`/skills/npm/${encodeURIComponent(name)}`),

  /** Install a skill from npm */
  installNpm: (packageName: string) =>
    apiClient.post<NpmInstallResult>('/skills/install-npm', { packageName }),

  /** Check all installed skills for updates */
  checkUpdates: () => apiClient.post<{ updates: SkillUpdateInfo[] }>('/skills/check-updates'),

  /** List all available permission categories */
  listPermissions: () =>
    apiClient.get<{ permissions: SkillPermissionInfo[] }>('/skills/permissions'),

  /** Get permissions for a specific extension */
  getPermissions: (extensionId: string) =>
    apiClient.get<SkillPermissionData>(`/skills/permissions/${extensionId}`),

  /** Update granted permissions for an extension */
  updatePermissions: (extensionId: string, grantedPermissions: string[]) =>
    apiClient.post<{ grantedPermissions: string[] }>(`/skills/permissions/${extensionId}`, {
      grantedPermissions,
    }),
};
