/**
 * User Profile Routes
 *
 * API for managing user profile and personal memory.
 * Enables comprehensive personalization of AI interactions.
 */

import { LOCAL_OWNER_ID } from '../config/defaults.js';
import { Hono } from 'hono';
import {
  apiResponse,
  apiError,
  ERROR_CODES,
  zodValidationError,
  getErrorMessage,
  parseJsonBody,
} from './helpers.js';
import {
  getPersonalMemoryStore,
  getMemoryInjector,
  type PersonalDataCategory,
} from '@ownpilot/core';

const VALID_CATEGORIES: ReadonlySet<string> = new Set<PersonalDataCategory>([
  'identity',
  'contact',
  'occupation',
  'education',
  'location',
  'timezone',
  'places',
  'routine',
  'food',
  'sleep',
  'exercise',
  'hobbies',
  'communication',
  'technology',
  'entertainment',
  'style',
  'health',
  'diet',
  'wellness',
  'family',
  'friends',
  'colleagues',
  'pets',
  'work_style',
  'projects',
  'skills',
  'tools',
  'goals_short',
  'goals_medium',
  'goals_long',
  'dreams',
  'history',
  'milestones',
  'context',
  'ai_preferences',
  'instructions',
  'boundaries',
]);

const app = new Hono();

/**
 * GET /profile - Get user profile
 */
app.get('/', async (c) => {
  try {
    const store = await getPersonalMemoryStore(LOCAL_OWNER_ID);
    const profile = await store.getProfile();

    return apiResponse(c, profile);
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.PROFILE_FETCH_ERROR,
        message: getErrorMessage(error, 'Failed to fetch profile'),
      },
      500
    );
  }
});

/**
 * GET /profile/summary - Get profile summary for prompts
 */
app.get('/summary', async (c) => {
  try {
    const store = await getPersonalMemoryStore(LOCAL_OWNER_ID);
    const summary = await store.getProfileSummary();

    return apiResponse(c, { summary });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.SUMMARY_FETCH_ERROR,
        message: getErrorMessage(error, 'Failed to fetch summary'),
      },
      500
    );
  }
});

/**
 * GET /profile/category/:category - Get entries in a category
 */
app.get('/category/:category', async (c) => {
  const category = c.req.param('category');
  if (!VALID_CATEGORIES.has(category)) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_INPUT, message: `Invalid category: ${category}` },
      400
    );
  }

  try {
    const store = await getPersonalMemoryStore(LOCAL_OWNER_ID);
    const entries = await store.getCategory(category as PersonalDataCategory);

    return apiResponse(c, {
      category,
      entries,
      count: entries.length,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.CATEGORY_FETCH_ERROR,
        message: getErrorMessage(error, 'Failed to fetch category'),
      },
      500
    );
  }
});

/**
 * POST /profile/data - Set personal data entry
 */
app.post('/data', async (c) => {
  try {
    const body = await parseJsonBody(c);
    const { profileSetDataSchema } = await import('../middleware/validation.js');
    const parsed = profileSetDataSchema.safeParse(body);

    if (!parsed.success) {
      return zodValidationError(c, parsed.error.issues);
    }

    const { category, key, value, data, confidence, source, sensitive } = parsed.data;

    const store = await getPersonalMemoryStore(LOCAL_OWNER_ID);
    const entry = await store.set(category as PersonalDataCategory, key, value as string, {
      data,
      confidence,
      source,
      sensitive,
    });

    // Invalidate prompt cache so next AI call sees updated profile
    getMemoryInjector().invalidateCache(LOCAL_OWNER_ID);

    return apiResponse(c, entry, 201);
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.DATA_SET_ERROR, message: getErrorMessage(error, 'Failed to set data') },
      500
    );
  }
});

/**
 * DELETE /profile/data - Delete personal data entry
 */
app.delete('/data', async (c) => {
  try {
    // Accept either a JSON body OR query params (?category=&key=). Browsers
    // and most fetch wrappers don't send a body on DELETE; the UI api client
    // uses query params, while existing CLI/test callers pass a body.
    const queryCategory = c.req.query('category');
    const queryKey = c.req.query('key');
    let parsedInput: unknown;
    if (queryCategory && queryKey) {
      parsedInput = { category: queryCategory, key: queryKey };
    } else {
      parsedInput = await parseJsonBody(c);
    }
    const { profileDeleteDataSchema } = await import('../middleware/validation.js');
    const parsed = profileDeleteDataSchema.safeParse(parsedInput);

    if (!parsed.success) {
      return zodValidationError(c, parsed.error.issues);
    }

    const { category, key } = parsed.data;

    const store = await getPersonalMemoryStore(LOCAL_OWNER_ID);
    const deleted = await store.delete(category as PersonalDataCategory, key);

    getMemoryInjector().invalidateCache(LOCAL_OWNER_ID);

    return apiResponse(c, { deleted });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.DATA_DELETE_ERROR,
        message: getErrorMessage(error, 'Failed to delete data'),
      },
      500
    );
  }
});

/**
 * GET /profile/search - Search personal data
 */
app.get('/search', async (c) => {
  const query = c.req.query('q');
  const categoriesParam = c.req.query('categories');

  if (!query) {
    return apiError(
      c,
      { code: ERROR_CODES.INVALID_INPUT, message: 'Query parameter "q" is required' },
      400
    );
  }

  try {
    const store = await getPersonalMemoryStore(LOCAL_OWNER_ID);
    const categories = categoriesParam
      ? (categoriesParam.split(',') as PersonalDataCategory[])
      : undefined;
    const results = await store.search(query, categories);

    return apiResponse(c, {
      query,
      results,
      count: results.length,
    });
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.SEARCH_ERROR, message: getErrorMessage(error, 'Failed to search') },
      500
    );
  }
});

/**
 * POST /profile/import - Import personal data
 */
app.post('/import', async (c) => {
  try {
    const body = await parseJsonBody(c);
    const { profileImportSchema } = await import('../middleware/validation.js');
    const parsed = profileImportSchema.safeParse(body);

    if (!parsed.success) {
      return zodValidationError(c, parsed.error.issues);
    }

    const { entries } = parsed.data;

    const store = await getPersonalMemoryStore(LOCAL_OWNER_ID);
    const imported = await store.importData(
      entries as Array<{
        category: PersonalDataCategory;
        key: string;
        value: string;
        data?: Record<string, unknown>;
      }>
    );

    getMemoryInjector().invalidateCache(LOCAL_OWNER_ID);

    return apiResponse(
      c,
      {
        imported,
        message: `Successfully imported ${imported} entries`,
      },
      201
    );
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.IMPORT_ERROR, message: getErrorMessage(error, 'Failed to import') },
      500
    );
  }
});

/**
 * POST /profile/inferred/confirm — promote an ai_inferred entry to
 * user_confirmed so subsequent profile-learning passes treat it as
 * canonical (learnInferred() never overwrites user_confirmed). Accepts
 * { category, key } as either body or query params (mirrors DELETE /data).
 * 404 when the entry doesn't exist or isn't currently ai_inferred —
 * confirming user_stated / user_confirmed / imported is a no-op we
 * reject so the operator notices the wrong call instead of silently
 * stamping a confidence change onto unrelated data.
 */
app.post('/inferred/confirm', async (c) => {
  try {
    const queryCategory = c.req.query('category');
    const queryKey = c.req.query('key');
    let input: unknown;
    if (queryCategory && queryKey) {
      input = { category: queryCategory, key: queryKey };
    } else {
      input = await parseJsonBody(c);
    }
    const { profileDeleteDataSchema } = await import('../middleware/validation.js');
    const parsed = profileDeleteDataSchema.safeParse(input);
    if (!parsed.success) return zodValidationError(c, parsed.error.issues);

    const { category, key } = parsed.data;
    const store = await getPersonalMemoryStore(LOCAL_OWNER_ID);
    const existing = await store.get(category as PersonalDataCategory, key);
    if (!existing) {
      return apiError(c, { code: ERROR_CODES.NOT_FOUND, message: 'Entry not found' }, 404);
    }
    if (existing.source !== 'ai_inferred') {
      return apiError(
        c,
        {
          code: ERROR_CODES.INVALID_INPUT,
          message: `Entry source is "${existing.source}", not "ai_inferred"`,
        },
        400
      );
    }

    const updated = await store.set(category as PersonalDataCategory, key, existing.value, {
      data: existing.data,
      source: 'user_confirmed',
      // Promote confidence — the user has explicitly endorsed this fact.
      confidence: 1.0,
      sensitive: existing.sensitive,
    });

    getMemoryInjector().invalidateCache(LOCAL_OWNER_ID);
    return apiResponse(c, updated);
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.DATA_SET_ERROR,
        message: getErrorMessage(error, 'Failed to confirm entry'),
      },
      500
    );
  }
});

/**
 * GET /profile/inferred — list every entry the profile-learning loop wrote
 * with source='ai_inferred'. Lets users audit what the AI assumed about them
 * and delete entries they disagree with, without dumping the whole profile.
 * Sorted newest-first so freshly-learned facts surface at the top.
 */
app.get('/inferred', async (c) => {
  try {
    const store = await getPersonalMemoryStore(LOCAL_OWNER_ID);
    const all = await store.exportData();
    const entries = all
      .filter((e) => e.source === 'ai_inferred')
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return apiResponse(c, { entries, count: entries.length });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.PROFILE_FETCH_ERROR,
        message: getErrorMessage(error, 'Failed to list inferred entries'),
      },
      500
    );
  }
});

/**
 * GET /profile/export - Export all personal data
 */
app.get('/export', async (c) => {
  try {
    const store = await getPersonalMemoryStore(LOCAL_OWNER_ID);
    const data = await store.exportData();

    return apiResponse(c, {
      entries: data,
      count: data.length,
      exportedAt: new Date().toISOString(),
    });
  } catch (error) {
    return apiError(
      c,
      { code: ERROR_CODES.EXPORT_ERROR, message: getErrorMessage(error, 'Failed to export') },
      500
    );
  }
});

/**
 * POST /profile/quick - Quick profile setup with common fields
 */
app.post('/quick', async (c) => {
  try {
    const body = await parseJsonBody(c);
    const { profileQuickSetupSchema } = await import('../middleware/validation.js');
    const parsed = profileQuickSetupSchema.safeParse(body);

    if (!parsed.success) {
      return zodValidationError(c, parsed.error.issues);
    }

    const {
      name,
      nickname,
      location,
      timezone,
      occupation,
      language,
      communicationStyle,
      autonomyLevel,
    } = parsed.data;

    const store = await getPersonalMemoryStore(LOCAL_OWNER_ID);
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

    getMemoryInjector().invalidateCache(LOCAL_OWNER_ID);

    // Get updated profile
    const profile = await store.getProfile();

    return apiResponse(c, {
      updated: count,
      profile,
    });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.QUICK_SETUP_ERROR,
        message: getErrorMessage(error, 'Failed to setup profile'),
      },
      500
    );
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
