/**
 * Dynamic Tools — Sandbox setup utilities
 *
 * Safe fetch wrapper, input size assertions, permission mapping,
 * and sandbox utility helpers available to dynamic tool code.
 */

import * as crypto from 'node:crypto';
import type { SandboxPermissions } from '../../sandbox/types.js';
import type { DynamicToolPermission } from './dynamic-tool-types.js';
import { isPrivateUrl } from './dynamic-tool-permissions.js';

// =============================================================================
// SSRF-SAFE FETCH
// =============================================================================

/**
 * Create an SSRF-safe fetch wrapper that blocks private/internal URLs.
 */
export function createSafeFetch(toolName: string): typeof globalThis.fetch {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (isPrivateUrl(url)) {
      throw new Error(
        `[SSRF blocked] Tool '${toolName}' attempted to access a private/internal URL: ${new URL(url).hostname}. ` +
          `Only public URLs are allowed.`
      );
    }
    return globalThis.fetch(input, init);
  };
}

// =============================================================================
// SANDBOX UTILITY SIZE LIMITS
// =============================================================================

/** Maximum input size for utility functions (1MB) */
const MAX_UTIL_INPUT_SIZE = 1_000_000;

/** Maximum array size for utility functions */
const MAX_UTIL_ARRAY_SIZE = 100_000;

/**
 * Assert that a string input doesn't exceed the maximum size.
 */
export function assertInputSize(input: string, fnName: string): void {
  if (typeof input === 'string' && input.length > MAX_UTIL_INPUT_SIZE) {
    throw new Error(`${fnName}: Input exceeds maximum size of ${MAX_UTIL_INPUT_SIZE} characters`);
  }
}

/**
 * Assert that an array doesn't exceed the maximum element count.
 */
export function assertArraySize(arr: unknown[], fnName: string): void {
  if (arr.length > MAX_UTIL_ARRAY_SIZE) {
    throw new Error(`${fnName}: Array exceeds maximum size of ${MAX_UTIL_ARRAY_SIZE} elements`);
  }
}

// =============================================================================
// PERMISSION MAPPING
// =============================================================================

/**
 * Map dynamic tool permissions to sandbox permissions
 */
export function mapPermissions(permissions: DynamicToolPermission[]): Partial<SandboxPermissions> {
  const sandboxPermissions: Partial<SandboxPermissions> = {
    network: false,
    fsRead: false,
    fsWrite: false,
    spawn: false,
    env: false,
  };

  for (const perm of permissions) {
    switch (perm) {
      case 'network':
        sandboxPermissions.network = true;
        break;
      case 'filesystem':
        sandboxPermissions.fsRead = true;
        sandboxPermissions.fsWrite = true;
        break;
      case 'shell':
        sandboxPermissions.spawn = true;
        break;
      case 'local':
        // 'local' enables host-machine access via scoped APIs (fs, exec).
        // Actual API injection happens in executeDynamicTool() based on
        // 'local' + 'filesystem' or 'local' + 'shell' combos.
        // Grant underlying sandbox permissions so the VM can use them.
        sandboxPermissions.fsRead = true;
        sandboxPermissions.fsWrite = true;
        sandboxPermissions.spawn = true;
        break;
      case 'database':
      case 'email':
      case 'scheduling':
        // These are handled through injected APIs, not raw permissions
        break;
    }
  }

  return sandboxPermissions;
}

// =============================================================================
// SANDBOX UTILITY HELPERS
// =============================================================================

/**
 * Create utility helpers available to dynamic tool code via `utils.*`
 * These give custom tools access to common operations without needing
 * to reimplement them from scratch.
 */
export function createSandboxUtils() {
  return {
    // --- Hashing ---
    hash(text: string, algorithm: string = 'sha256'): string {
      assertInputSize(text, 'hash');
      return crypto.createHash(algorithm).update(text).digest('hex');
    },

    // --- UUID ---
    uuid(): string {
      return crypto.randomUUID();
    },

    // --- Encoding/Decoding ---
    base64Encode(text: string): string {
      assertInputSize(text, 'base64Encode');
      return Buffer.from(text).toString('base64');
    },
    base64Decode(text: string): string {
      assertInputSize(text, 'base64Decode');
      return Buffer.from(text, 'base64').toString('utf-8');
    },
    urlEncode(text: string): string {
      return encodeURIComponent(text);
    },
    urlDecode(text: string): string {
      return decodeURIComponent(text);
    },
    hexEncode(text: string): string {
      assertInputSize(text, 'hexEncode');
      return Buffer.from(text).toString('hex');
    },
    hexDecode(hex: string): string {
      assertInputSize(hex, 'hexDecode');
      return Buffer.from(hex, 'hex').toString('utf-8');
    },

    // --- Date/Time ---
    now(): string {
      return new Date().toISOString();
    },
    timestamp(): number {
      return Date.now();
    },
    dateDiff(date1: string, date2: string, unit: string = 'days'): number {
      const d1 = new Date(date1);
      const d2 = new Date(date2);
      const diffMs = d2.getTime() - d1.getTime();
      const units: Record<string, number> = {
        seconds: 1000,
        minutes: 60000,
        hours: 3600000,
        days: 86400000,
        weeks: 604800000,
      };
      return diffMs / (units[unit] || units.days!);
    },
    dateAdd(date: string, amount: number, unit: string = 'days'): string {
      const d = date === 'now' ? new Date() : new Date(date);
      switch (unit) {
        case 'seconds':
          d.setSeconds(d.getSeconds() + amount);
          break;
        case 'minutes':
          d.setMinutes(d.getMinutes() + amount);
          break;
        case 'hours':
          d.setHours(d.getHours() + amount);
          break;
        case 'days':
          d.setDate(d.getDate() + amount);
          break;
        case 'weeks':
          d.setDate(d.getDate() + amount * 7);
          break;
        case 'months':
          d.setMonth(d.getMonth() + amount);
          break;
        case 'years':
          d.setFullYear(d.getFullYear() + amount);
          break;
      }
      return d.toISOString();
    },
    formatDate(date: string, locale: string = 'en-US'): string {
      return new Date(date).toLocaleDateString(locale, {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    },

    // --- Text ---
    slugify(text: string): string {
      assertInputSize(text, 'slugify');
      return text
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    },
    camelCase(text: string): string {
      return text.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase());
    },
    snakeCase(text: string): string {
      return text
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .toLowerCase();
    },
    kebabCase(text: string): string {
      return text
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .replace(/[\s_]+/g, '-')
        .toLowerCase();
    },
    titleCase(text: string): string {
      return text.replace(
        /\w\S*/g,
        (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
      );
    },
    truncate(text: string, maxLength: number = 100, suffix: string = '...'): string {
      return text.length > maxLength ? text.slice(0, maxLength - suffix.length) + suffix : text;
    },
    countWords(text: string): number {
      return text
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0).length;
    },
    removeDiacritics(text: string): string {
      return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    },

    // --- Validation ---
    isEmail(value: string): boolean {
      return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(value);
    },
    isUrl(value: string): boolean {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    isJson(value: string): boolean {
      try {
        JSON.parse(value);
        return true;
      } catch {
        return false;
      }
    },
    isUuid(value: string): boolean {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value
      );
    },

    // --- Math ---
    clamp(value: number, min: number, max: number): number {
      return Math.min(Math.max(value, min), max);
    },
    round(value: number, decimals: number = 2): number {
      return Number(value.toFixed(decimals));
    },
    randomInt(min: number = 0, max: number = 100): number {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    },
    sum(numbers: number[]): number {
      assertArraySize(numbers, 'sum');
      return numbers.reduce((a, b) => a + b, 0);
    },
    avg(numbers: number[]): number {
      assertArraySize(numbers, 'avg');
      return numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0;
    },

    // --- Data ---
    parseJson(text: string): unknown {
      assertInputSize(text, 'parseJson');
      return JSON.parse(text);
    },
    toJson(data: unknown, indent: number = 2): string {
      const result = JSON.stringify(data, null, indent);
      if (result && result.length > MAX_UTIL_INPUT_SIZE) {
        throw new Error(`toJson: Output exceeds maximum size of ${MAX_UTIL_INPUT_SIZE} characters`);
      }
      return result;
    },
    parseCsv(csv: string, delimiter: string = ','): Record<string, string>[] {
      assertInputSize(csv, 'parseCsv');
      const lines = csv.split('\n').filter((l) => l.trim());
      if (lines.length < 2) return [];
      const headers = lines[0]!.split(delimiter).map((h) => h.trim());
      return lines.slice(1).map((line) => {
        const values = line.split(delimiter);
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          obj[h] = (values[i] || '').trim();
        });
        return obj;
      });
    },
    flatten(obj: Record<string, unknown>, prefix: string = ''): Record<string, unknown> {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          Object.assign(result, this.flatten(value as Record<string, unknown>, newKey));
        } else {
          result[newKey] = value;
        }
      }
      return result;
    },
    getPath(obj: unknown, path: string): unknown {
      const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
      let current: unknown = obj;
      for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        if (typeof current === 'object') {
          current = (current as Record<string, unknown>)[part];
        } else {
          return undefined;
        }
      }
      return current;
    },

    // --- Array ---
    unique<T>(arr: T[]): T[] {
      assertArraySize(arr, 'unique');
      return [...new Set(arr)];
    },
    chunk<T>(arr: T[], size: number): T[][] {
      assertArraySize(arr, 'chunk');
      const chunks: T[][] = [];
      for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
      }
      return chunks;
    },
    shuffle<T>(arr: T[]): T[] {
      assertArraySize(arr, 'shuffle');
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const temp = shuffled[i]!;
        shuffled[i] = shuffled[j]!;
        shuffled[j] = temp;
      }
      return shuffled;
    },
    sample<T>(arr: T[], n: number = 1): T[] {
      assertArraySize(arr, 'sample');
      return this.shuffle(arr).slice(0, n);
    },
    groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
      assertArraySize(arr, 'groupBy');
      return arr.reduce(
        (groups, item) => {
          const groupKey = String(item[key]);
          if (!groups[groupKey]) groups[groupKey] = [];
          groups[groupKey].push(item);
          return groups;
        },
        {} as Record<string, T[]>
      );
    },

    // --- Password ---
    generatePassword(length: number = 16): string {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
      let password = '';
      const bytes = crypto.randomBytes(length);
      for (let i = 0; i < length; i++) {
        password += chars[bytes[i]! % chars.length];
      }
      return password;
    },
  };
}
