/**
 * Extensions API Endpoints
 */

import { apiClient } from '../client';
import type { ExtensionInfo } from '../types';

export const extensionsApi = {
  list: (params?: { status?: string; category?: string; format?: string }) => {
    const search = new URLSearchParams();
    if (params?.status) search.set('status', params.status);
    if (params?.category) search.set('category', params.category);
    if (params?.format) search.set('format', params.format);
    const qs = search.toString();
    return apiClient
      .get<{ packages: ExtensionInfo[]; total: number }>(`/extensions${qs ? `?${qs}` : ''}`)
      .then((r) => r.packages ?? []);
  },
  getById: (id: string) =>
    apiClient.get<{ package: ExtensionInfo }>(`/extensions/${id}`).then((r) => r.package),
  install: (manifest: Record<string, unknown>) =>
    apiClient.post<{ package: ExtensionInfo }>('/extensions', { manifest }),
  installFromPath: (path: string) =>
    apiClient.post<{ package: ExtensionInfo }>('/extensions/install', { path }),
  uninstall: (id: string) => apiClient.delete<void>(`/extensions/${id}`),
  enable: (id: string) => apiClient.post<{ package: ExtensionInfo }>(`/extensions/${id}/enable`),
  disable: (id: string) => apiClient.post<{ package: ExtensionInfo }>(`/extensions/${id}/disable`),
  reload: (id: string) => apiClient.post<{ package: ExtensionInfo }>(`/extensions/${id}/reload`),
  scan: (directory?: string) =>
    apiClient.post<{ installed: number; updated: number; failed: number; errors: string[] }>(
      '/extensions/scan',
      directory ? { directory } : {}
    ),
  generate: (description: string) =>
    apiClient.post<{
      manifest: Record<string, unknown>;
      validation: { valid: boolean; errors: string[] };
    }>('/extensions/generate', { description }),
};
