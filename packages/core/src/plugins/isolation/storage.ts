/**
 * Per-plugin isolated key/value storage with quota and key validation.
 */

import type { PluginId } from '../../types/branded.js';
import type { Result } from '../../types/result.js';
import { ok, err } from '../../types/result.js';
import { getErrorMessage } from '../../services/error-utils.js';
import type { IsolatedStorage, StorageError } from './types.js';

export class PluginIsolatedStorage implements IsolatedStorage {
  private data: Map<string, string> = new Map();
  private readonly pluginId: PluginId;
  private readonly quota: number;
  private readonly maxKeyLength = 256;
  private readonly maxValueSize = 1024 * 1024; // 1MB per value

  constructor(pluginId: PluginId, quota: number) {
    this.pluginId = pluginId;
    this.quota = quota;
  }

  async get<T = unknown>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key);
    const value = this.data.get(prefixedKey);
    if (value === undefined) return null;

    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async set<T = unknown>(key: string, value: T): Promise<Result<void, StorageError>> {
    if (key.length > this.maxKeyLength) {
      return err({ type: 'key_too_long', maxLength: this.maxKeyLength });
    }

    if (!/^[a-zA-Z0-9_\-.:]+$/.test(key)) {
      return err({ type: 'invalid_key', reason: 'Key contains invalid characters' });
    }

    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch (e) {
      return err({
        type: 'serialization_failed',
        error: getErrorMessage(e),
      });
    }

    if (serialized.length > this.maxValueSize) {
      return err({ type: 'value_too_large', maxSize: this.maxValueSize });
    }

    const currentUsage = await this.calculateUsage();
    const existingSize = this.data.get(this.prefixKey(key))?.length ?? 0;
    const newUsage = currentUsage - existingSize + serialized.length;

    if (newUsage > this.quota) {
      return err({
        type: 'quota_exceeded',
        used: currentUsage,
        quota: this.quota,
        requested: serialized.length,
      });
    }

    this.data.set(this.prefixKey(key), serialized);
    return ok(undefined);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(this.prefixKey(key));
  }

  async keys(): Promise<string[]> {
    const prefix = `${this.pluginId}:`;
    const keys: string[] = [];

    for (const key of this.data.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key.substring(prefix.length));
      }
    }

    return keys;
  }

  async usage(): Promise<{ used: number; quota: number }> {
    return {
      used: await this.calculateUsage(),
      quota: this.quota,
    };
  }

  async clear(): Promise<void> {
    const prefix = `${this.pluginId}:`;
    for (const key of this.data.keys()) {
      if (key.startsWith(prefix)) {
        this.data.delete(key);
      }
    }
  }

  private prefixKey(key: string): string {
    return `${this.pluginId}:${key}`;
  }

  private async calculateUsage(): Promise<number> {
    let total = 0;
    const prefix = `${this.pluginId}:`;

    for (const [key, value] of this.data.entries()) {
      if (key.startsWith(prefix)) {
        total += value.length;
      }
    }

    return total;
  }
}
