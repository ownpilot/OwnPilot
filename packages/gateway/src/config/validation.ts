/**
 * Boot-Time Configuration Validation
 *
 * Fail-fast discipline: running with wrong config is worse than not running at all.
 * All critical env vars are validated BEFORE any heavy initialization.
 *
 * In production (NODE_ENV=production), insecure defaults cause immediate exit.
 * In development, warnings are logged but boot continues.
 */

import { getLog } from '../services/log.js';

const log = getLog('ConfigValidation');

// ============================================================================
// Known Insecure Default Values
// ============================================================================

const INSECURE_DEFAULTS = {
  MEMORY_SALT: 'change-this-in-production',
} as const;

// Minimum lengths for secrets
const MIN_SECRET_LENGTH = 32;

// Sensitive env vars that must NOT be the insecure placeholder
const REQUIRED_NON_DEFAULT: Array<{
  key: string;
  envKey: string;
  description: string;
}> = [
  {
    key: 'MEMORY_SALT',
    envKey: 'MEMORY_SALT',
    description: 'Memory encryption salt — must be unique per deployment',
  },
];

// Env vars required when a specific AUTH_TYPE is set
const AUTH_DEPENDENT_REQUIRED: Array<{
  conditionKey: string;
  conditionValue: string;
  requiredKey: string;
  envKey: string;
  minLength?: number;
  description: string;
}> = [
  {
    conditionKey: 'AUTH_TYPE',
    conditionValue: 'jwt',
    requiredKey: 'JWT_SECRET',
    envKey: 'JWT_SECRET',
    minLength: MIN_SECRET_LENGTH,
    description: 'JWT signing secret — must be at least 32 characters',
  },
];

// Critical database settings
const REQUIRED_DB_CONFIG = [
  'POSTGRES_HOST',
  'POSTGRES_PORT',
  'POSTGRES_DB',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
] as const;

// ============================================================================
// Validation
// ============================================================================

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate all critical configuration at boot time.
 * Returns a result with errors (fail in production) and warnings.
 */
export function validateBootConfig(): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isProduction = process.env.NODE_ENV === 'production';

  // 1. Check required non-default values (should NOT be insecure placeholders)
  for (const { key, envKey } of REQUIRED_NON_DEFAULT) {
    const value = process.env[envKey];
    if (value === undefined || value === '') {
      if (isProduction) {
        errors.push(`[FATAL] ${key}: environment variable ${envKey} is required but not set`);
      } else {
        warnings.push(`[WARN] ${key}: ${envKey} is not set — using empty string (INSECURE)`);
      }
    } else if (value === INSECURE_DEFAULTS[key as keyof typeof INSECURE_DEFAULTS]) {
      if (isProduction) {
        errors.push(
          `[FATAL] ${key}: ${envKey} must not be the default placeholder value "${value}" in production.\n` +
            `         Refer to https://ownpilot.dev/docs/configuration for guidance.`
        );
      } else {
        warnings.push(
          `[WARN] ${key}: ${envKey} is the default placeholder — this is INSECURE in production`
        );
      }
    }
  }

  // 2. Check auth-dependent requirements
  const authType = process.env.AUTH_TYPE ?? 'api-key';
  for (const {
    conditionKey,
    conditionValue,
    requiredKey,
    envKey,
    minLength,
  } of AUTH_DEPENDENT_REQUIRED) {
    if (authType === conditionValue) {
      const value = process.env[envKey];
      if (!value) {
        errors.push(
          `[FATAL] ${requiredKey}: ${envKey} is required when ${conditionKey}=${conditionValue} but is not set`
        );
      } else if (minLength && value.length < minLength) {
        errors.push(
          `[FATAL] ${requiredKey}: ${envKey} must be at least ${minLength} characters when ${conditionKey}=${conditionValue} (got ${value.length})`
        );
      }
    }
  }

  // 3. Check required database config (at least one must be present)
  const hasDbUrl = Boolean(process.env.DATABASE_URL);
  const hasIndividualDbConfig = REQUIRED_DB_CONFIG.every(
    (key) => Boolean(process.env[key])
  );

  if (!hasDbUrl && !hasIndividualDbConfig) {
    const missingIndividual = REQUIRED_DB_CONFIG.filter((key) => !process.env[key]);
    if (isProduction) {
      errors.push(
        `[FATAL] Database: neither DATABASE_URL nor individual POSTGRES_* variables are set.\n` +
          `         Missing: ${missingIndividual.join(', ')}`
      );
    } else {
      warnings.push(
        `[WARN] Database: neither DATABASE_URL nor POSTGRES_* variables are set — database connection will likely fail`
      );
    }
  }

  // 4. Warn about JWT secret if it looks generated from a template
  const jwtSecret = process.env.JWT_SECRET;
  if (jwtSecret && (jwtSecret.includes(' ') || jwtSecret.includes('template'))) {
    warnings.push(
      `[WARN] JWT_SECRET appears to contain placeholder text — this is not secure in production`
    );
  }

  // 5. Warn about CORS_ORIGINS in production if it looks like a template
  const corsOrigins = process.env.CORS_ORIGINS;
  if (isProduction && corsOrigins && corsOrigins.includes('localhost')) {
    warnings.push(
      `[WARN] CORS_ORIGINS contains localhost in production — this may allow unintended origins`
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ============================================================================
// Boot Entry Point
// ============================================================================

/**
 * Call this at the very top of server.ts main(), before any heavy initialization.
 * In production: exits process with clear error messages on validation failure.
 * In development: logs warnings but allows boot to continue.
 */
export function assertBootConfig(): void {
  const result = validateBootConfig();

  // Log all warnings
  for (const warning of result.warnings) {
    log.warn(warning);
  }

  // Log and exit on errors in production
  if (!result.valid) {
    log.error('=== Configuration Validation Failed ===');
    for (const error of result.errors) {
      log.error(error);
    }
    log.error('');
    log.error('Fix the errors above before starting the server.');
    log.error('Refer to https://ownpilot.dev/docs/configuration for guidance.');

    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }

    // In dev, only exit if NODE_ENV is explicitly production
    log.warn('Continuing in development mode despite validation errors...');
  } else if (result.warnings.length === 0) {
    log.info('Configuration validation passed');
  }
}
