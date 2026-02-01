/**
 * Models API Endpoints
 */

import { apiClient } from '../client';
import type { ModelsData } from '../../types';

export const modelsApi = {
  list: () => apiClient.get<ModelsData>('/models'),
};
