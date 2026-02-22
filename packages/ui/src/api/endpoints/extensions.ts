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

  generateSkill: (description: string) =>
    apiClient.post<{
      content: string;
      name: string;
      validation: { valid: boolean; errors: string[] };
    }>('/extensions/generate-skill', { description }),

  upload: async (file: File): Promise<{ package: ExtensionInfo; message: string }> => {
    const formData = new FormData();
    formData.append('file', file);

    // Use raw fetch for multipart upload (apiClient only supports JSON)
    const headers: Record<string, string> = {};
    try {
      const token = localStorage.getItem('ownpilot-session-token');
      if (token) headers['X-Session-Token'] = token;
    } catch { /* ignore */ }

    const response = await fetch('/api/v1/extensions/upload', {
      method: 'POST',
      headers,
      body: formData,
    });

    const body = await response.json();

    if (!response.ok || !body.success) {
      const msg = typeof body.error === 'string' ? body.error : body.error?.message ?? 'Upload failed';
      throw new Error(msg);
    }

    return body.data;
  },
};
