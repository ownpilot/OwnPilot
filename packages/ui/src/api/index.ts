/**
 * API Client — public exports
 */

export { apiClient, ApiError } from './client';
export type { ApiClient, RequestOptions, StreamOptions } from './client';

// Re-export all typed endpoint modules
export * from './endpoints';
