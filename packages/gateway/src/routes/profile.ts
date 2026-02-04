/**
 * User Profile Routes
 *
 * API for managing user profile and personal memory.
 * Enables comprehensive personalization of AI interactions.
 */

import { Hono } from 'hono';
import { apiResponse, apiError, ERROR_CODES, getUserId } from './helpers.js';
import {
  getPersonalMemoryStore,
  getMemoryInjector,
  type PersonalDataCategory,
} from '@ownpilot/core';

const app = new Hono();

/**
 * GET /profile - Get user profile
 */
app.get('/', async (c) => {
  try {
    const store = await getPersonalMemoryStore(getUserId(c));
    const profile = await store.getProfile();

    return apiResponse(c, profile);
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.PROFILE_FETCH_ERROR, message: error instanceof Error ? error.message : 'Failed to fetch profile' }, 500);
  }
});

/**
 * GET /profile/summary - Get profile summary for prompts
 */
app.get('/summary', async (c) => {
  try {
    const store = await getPersonalMemoryStore(getUserId(c));
    const summary = await store.getProfileSummary();

    return apiResponse(c, { summary });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.SUMMARY_FETCH_ERROR, message: error instanceof Error ? error.message : 'Failed to fetch summary' }, 500);
  }
});

/**
 * GET /profile/category/:category - Get entries in a category
 */
app.get('/category/:category', async (c) => {
  const category = c.req.param('category') as PersonalDataCategory;

  try {
    const store = await getPersonalMemoryStore(getUserId(c));
    const entries = await store.getCategory(category);

    return apiResponse(c, {
        category,
        entries,
        count: entries.length,
      });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.CATEGORY_FETCH_ERROR, message: error instanceof Error ? error.message : 'Failed to fetch category' }, 500);
  }
});

/**
 * POST /profile/data - Set personal data entry
 */
app.post('/data', async (c) => {
  try {
    const body = await c.req.json();
    const { category, key, value, data, confidence, source, sensitive } = body;

    if (!category || !key || value === undefined) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'category, key, and value are required' }, 400);
    }

    const store = await getPersonalMemoryStore(getUserId(c));
    const entry = await store.set(category, key, value, {
      data,
      confidence,
      source,
      sensitive,
    });

    // Invalidate prompt cache so next AI call sees updated profile
    getMemoryInjector().invalidateCache(getUserId(c));

    return apiResponse(c, entry, 201);
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.DATA_SET_ERROR, message: error instanceof Error ? error.message : 'Failed to set data' }, 500);
  }
});

/**
 * DELETE /profile/data - Delete personal data entry
 */
app.delete('/data', async (c) => {
  try {
    const body = await c.req.json();
    const { category, key } = body;

    if (!category || !key) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'category and key are required' }, 400);
    }

    const store = await getPersonalMemoryStore(getUserId(c));
    const deleted = await store.delete(category, key);

    getMemoryInjector().invalidateCache(getUserId(c));

    return apiResponse(c, { deleted });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.DATA_DELETE_ERROR, message: error instanceof Error ? error.message : 'Failed to delete data' }, 500);
  }
});

/**
 * GET /profile/search - Search personal data
 */
app.get('/search', async (c) => {
  const query = c.req.query('q');
  const categoriesParam = c.req.query('categories');

  if (!query) {
    return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'Query parameter "q" is required' }, 400);
  }

  try {
    const store = await getPersonalMemoryStore(getUserId(c));
    const categories = categoriesParam
      ? categoriesParam.split(',') as PersonalDataCategory[]
      : undefined;
    const results = await store.search(query, categories);

    return apiResponse(c, {
        query,
        results,
        count: results.length,
      });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.SEARCH_ERROR, message: error instanceof Error ? error.message : 'Failed to search' }, 500);
  }
});

/**
 * POST /profile/import - Import personal data
 */
app.post('/import', async (c) => {
  try {
    const body = await c.req.json();
    const { entries } = body;

    if (!Array.isArray(entries)) {
      return apiError(c, { code: ERROR_CODES.INVALID_INPUT, message: 'entries array is required' }, 400);
    }

    const store = await getPersonalMemoryStore(getUserId(c));
    const imported = await store.importData(entries);

    getMemoryInjector().invalidateCache(getUserId(c));

    return apiResponse(c, {
        imported,
        message: `Successfully imported ${imported} entries`,
      }, 201);
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.IMPORT_ERROR, message: error instanceof Error ? error.message : 'Failed to import' }, 500);
  }
});

/**
 * GET /profile/export - Export all personal data
 */
app.get('/export', async (c) => {
  try {
    const store = await getPersonalMemoryStore(getUserId(c));
    const data = await store.exportData();

    return apiResponse(c, {
        entries: data,
        count: data.length,
        exportedAt: new Date().toISOString(),
      });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.EXPORT_ERROR, message: error instanceof Error ? error.message : 'Failed to export' }, 500);
  }
});

/**
 * POST /profile/quick - Quick profile setup with common fields
 */
app.post('/quick', async (c) => {
  try {
    const body = await c.req.json();
    const {
      name,
      nickname,
      location,
      timezone,
      occupation,
      language,
      communicationStyle,
      autonomyLevel,
    } = body;

    const store = await getPersonalMemoryStore(getUserId(c));
    let count = 0;

    // Set provided values
    if (name) {
      await store.set('identity', 'name', name);
      count++;
    }
    if (nickname) {
      await store.set('identity', 'nickname', nickname);
      count++;
    }
    if (location) {
      await store.set('location', 'home_city', location);
      count++;
    }
    if (timezone) {
      await store.set('timezone', 'timezone', timezone);
      count++;
    }
    if (occupation) {
      await store.set('occupation', 'occupation', occupation);
      count++;
    }
    if (language) {
      await store.set('communication', 'language', language);
      count++;
    }
    if (communicationStyle) {
      await store.set('communication', 'style', communicationStyle);
      count++;
    }
    if (autonomyLevel) {
      await store.set('ai_preferences', 'autonomy', autonomyLevel);
      count++;
    }

    getMemoryInjector().invalidateCache(getUserId(c));

    // Get updated profile
    const profile = await store.getProfile();

    return apiResponse(c, {
        updated: count,
        profile,
      });
  } catch (error) {
    return apiError(c, { code: ERROR_CODES.QUICK_SETUP_ERROR, message: error instanceof Error ? error.message : 'Failed to setup profile' }, 500);
  }
});

/**
 * GET /profile/categories - Get available data categories
 */
app.get('/categories', (c) => {
  const categories: Record<string, { label: string; description: string; examples: string[] }> = {
    identity: {
      label: 'Identity',
      description: 'Personal identity information',
      examples: ['name', 'nickname', 'age', 'birthday', 'gender', 'nationality'],
    },
    location: {
      label: 'Location',
      description: 'Location and address information',
      examples: ['home_city', 'home_country', 'current'],
    },
    timezone: {
      label: 'Timezone',
      description: 'Timezone preferences',
      examples: ['timezone'],
    },
    occupation: {
      label: 'Occupation',
      description: 'Work and career information',
      examples: ['occupation', 'company', 'role'],
    },
    food: {
      label: 'Food',
      description: 'Food preferences and favorites',
      examples: ['favorite', 'disliked', 'cuisine'],
    },
    diet: {
      label: 'Diet',
      description: 'Dietary restrictions and allergies',
      examples: ['restriction', 'allergy'],
    },
    hobbies: {
      label: 'Hobbies',
      description: 'Hobbies and interests',
      examples: ['hobby'],
    },
    communication: {
      label: 'Communication',
      description: 'Communication preferences',
      examples: ['style', 'verbosity', 'language', 'emoji', 'humor'],
    },
    goals_short: {
      label: 'Short-term Goals',
      description: 'Goals for days/weeks',
      examples: ['goal'],
    },
    goals_medium: {
      label: 'Medium-term Goals',
      description: 'Goals for months',
      examples: ['goal'],
    },
    goals_long: {
      label: 'Long-term Goals',
      description: 'Goals for years',
      examples: ['goal'],
    },
    ai_preferences: {
      label: 'AI Preferences',
      description: 'How the AI should behave',
      examples: ['autonomy', 'proactive', 'reminders', 'suggestions'],
    },
    instructions: {
      label: 'Custom Instructions',
      description: 'Custom instructions for the AI',
      examples: ['instruction'],
    },
    boundaries: {
      label: 'Boundaries',
      description: 'Things the AI should not do',
      examples: ['boundary'],
    },
  };

  return apiResponse(c, categories);
});

export const profileRoutes = app;
