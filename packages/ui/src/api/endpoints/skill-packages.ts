/**
 * Skill Packages API Endpoints
 */

import { apiClient } from '../client';
import type { SkillPackageInfo } from '../types';

export const skillPackagesApi = {
  list: (params?: { status?: string; category?: string }) => {
    const search = new URLSearchParams();
    if (params?.status) search.set('status', params.status);
    if (params?.category) search.set('category', params.category);
    const qs = search.toString();
    return apiClient
      .get<{ packages: SkillPackageInfo[]; total: number }>(`/skill-packages${qs ? `?${qs}` : ''}`)
      .then((r) => r.packages ?? []);
  },
  getById: (id: string) =>
    apiClient.get<{ package: SkillPackageInfo }>(`/skill-packages/${id}`).then((r) => r.package),
  install: (manifest: Record<string, unknown>) =>
    apiClient.post<{ package: SkillPackageInfo }>('/skill-packages', { manifest }),
  installFromPath: (path: string) =>
    apiClient.post<{ package: SkillPackageInfo }>('/skill-packages/install', { path }),
  uninstall: (id: string) => apiClient.delete<void>(`/skill-packages/${id}`),
  enable: (id: string) =>
    apiClient.post<{ package: SkillPackageInfo }>(`/skill-packages/${id}/enable`),
  disable: (id: string) =>
    apiClient.post<{ package: SkillPackageInfo }>(`/skill-packages/${id}/disable`),
  reload: (id: string) =>
    apiClient.post<{ package: SkillPackageInfo }>(`/skill-packages/${id}/reload`),
  scan: (directory?: string) =>
    apiClient.post<{ installed: number; updated: number; failed: number; errors: string[] }>(
      '/skill-packages/scan',
      directory ? { directory } : {},
    ),
  generate: (description: string) =>
    apiClient.post<{ manifest: Record<string, unknown>; validation: { valid: boolean; errors: string[] } }>(
      '/skill-packages/generate',
      { description },
    ),
};
