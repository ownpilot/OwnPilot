/**
 * Shared validation helper used by every route that parses JSON.
 *
 * The schemas themselves live in sibling files grouped by domain
 * (agent, productivity, workflow-claws, data, integrations).
 */

import type { z } from 'zod';

/**
 * Validate request body against a Zod schema.
 * Returns parsed data on success, throws descriptive error on failure.
 */
export function validateBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Validation failed: ${issues}`);
  }
  return result.data;
}
