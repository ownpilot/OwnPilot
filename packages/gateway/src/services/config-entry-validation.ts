import type { ConfigFieldDefinition } from '@ownpilot/core';

type LegacyConfigFieldDefinition = Omit<ConfigFieldDefinition, 'type'> & {
  type: ConfigFieldDefinition['type'] | 'text';
};

export function isEmptyConfigValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

export function hasConfiguredData(data: Record<string, unknown>): boolean {
  return Object.values(data).some((value) => !isEmptyConfigValue(value));
}

/**
 * Validate entry data against service schema's required fields.
 * Returns array of missing required field labels (empty = valid).
 */
export function validateRequiredFields(
  data: Record<string, unknown>,
  schema: LegacyConfigFieldDefinition[]
): string[] {
  const missing: string[] = [];
  for (const field of schema) {
    if (!field.required) continue;
    if (isEmptyConfigValue(data[field.name])) {
      missing.push(field.label || field.name);
    }
  }
  return missing;
}

export function normalizeAndValidateEntryData(
  data: Record<string, unknown>,
  schema: LegacyConfigFieldDefinition[]
): { data: Record<string, unknown>; errors: string[] } {
  const normalized = { ...data };
  const errors: string[] = [];

  for (const field of schema) {
    const value = normalized[field.name];
    if (isEmptyConfigValue(value)) continue;

    const label = field.label || field.name;
    switch (field.type) {
      case 'text':
      case 'string':
      case 'secret':
        if (typeof value !== 'string') {
          errors.push(`${label} must be a string`);
        }
        break;
      case 'url':
        if (typeof value !== 'string') {
          errors.push(`${label} must be a URL string`);
          break;
        }
        try {
          new URL(value);
        } catch {
          errors.push(`${label} must be a valid URL`);
        }
        break;
      case 'number': {
        const numberValue = typeof value === 'string' ? Number(value) : value;
        if (typeof numberValue !== 'number' || !Number.isFinite(numberValue)) {
          errors.push(`${label} must be a number`);
        } else {
          normalized[field.name] = numberValue;
        }
        break;
      }
      case 'boolean':
        if (typeof value !== 'boolean') {
          errors.push(`${label} must be true or false`);
        }
        break;
      case 'select': {
        if (typeof value !== 'string') {
          errors.push(`${label} must be one of the configured options`);
          break;
        }
        const allowed = field.options?.map((option) => option.value);
        if (allowed && allowed.length > 0 && !allowed.includes(value)) {
          errors.push(`${label} must be one of: ${allowed.join(', ')}`);
        }
        break;
      }
      case 'json':
        if (typeof value === 'string') {
          try {
            normalized[field.name] = JSON.parse(value);
          } catch {
            errors.push(`${label} must be valid JSON`);
          }
        }
        break;
    }
  }

  return { data: normalized, errors };
}
