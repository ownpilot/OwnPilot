import type { ConfigServiceView } from '../api';

function isEmptyConfigValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

export function normalizeConfigFormData(
  values: Record<string, unknown>,
  service: ConfigServiceView,
  existingValues: Record<string, unknown> = {}
): { data: Record<string, unknown>; errors: string[] } {
  const data = { ...values };
  const errors: string[] = [];

  for (const field of service.configSchema) {
    const value = data[field.name];
    const valueForRequired = isEmptyConfigValue(value) ? existingValues[field.name] : value;
    const label = field.label || field.name;

    if (field.required && isEmptyConfigValue(valueForRequired)) {
      errors.push(`${label} is required`);
      continue;
    }

    if (isEmptyConfigValue(value)) continue;

    switch (field.type) {
      case 'text':
      case 'string':
      case 'secret':
        if (typeof value !== 'string') errors.push(`${label} must be a string`);
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
          data[field.name] = numberValue;
        }
        break;
      }
      case 'boolean':
        if (typeof value !== 'boolean') errors.push(`${label} must be true or false`);
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
            data[field.name] = JSON.parse(value);
          } catch {
            errors.push(`${label} must be valid JSON`);
          }
        }
        break;
    }
  }

  return { data, errors };
}
