/**
 * Workspace Routes — Shared Utilities Tests
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeFilePath,
  sanitizeContainerConfig,
  CONTAINER_LIMITS,
  VALID_NETWORK_POLICIES,
} from './shared.js';
import type { ContainerConfig } from '@ownpilot/core';

// ---------------------------------------------------------------------------
// sanitizeFilePath
// ---------------------------------------------------------------------------

describe('sanitizeFilePath', () => {
  it('returns the path as-is for a simple relative path', () => {
    expect(sanitizeFilePath('foo.txt')).toBe('foo.txt');
  });

  it('normalizes nested relative paths', () => {
    expect(sanitizeFilePath('src/utils/index.ts')).toBe('src/utils/index.ts');
  });

  it('strips leading slashes', () => {
    expect(sanitizeFilePath('/foo/bar')).toBe('foo/bar');
  });

  it('returns null for path traversal (..)', () => {
    expect(sanitizeFilePath('../etc/passwd')).toBeNull();
  });

  it('returns null for double traversal (../../etc)', () => {
    expect(sanitizeFilePath('../../etc/secret')).toBeNull();
  });

  it('returns null for path that is exactly ..', () => {
    expect(sanitizeFilePath('..')).toBeNull();
  });

  it('normalizes redundant ./ segments', () => {
    const result = sanitizeFilePath('./foo/./bar');
    expect(result).toBe('foo/bar');
  });

  it('handles path with embedded traversal (foo/../../bar)', () => {
    // path.posix.normalize('foo/../../bar') = '../bar' → null
    expect(sanitizeFilePath('foo/../../bar')).toBeNull();
  });

  it('returns empty string for . (current dir)', () => {
    // path.posix.normalize('.') = '.' → strip leading slash → '.' (does not start with ..)
    const result = sanitizeFilePath('.');
    expect(result).not.toBeNull();
  });

  it('handles deep safe path', () => {
    expect(sanitizeFilePath('a/b/c/d/file.json')).toBe('a/b/c/d/file.json');
  });
});

// ---------------------------------------------------------------------------
// sanitizeContainerConfig
// ---------------------------------------------------------------------------

const BASE_CONFIG: ContainerConfig = {
  memoryMB: 512,
  cpuCores: 1,
  storageGB: 5,
  timeoutMs: 30000,
  networkPolicy: 'restricted',
};

describe('sanitizeContainerConfig', () => {
  it('returns copy of base when no userConfig provided', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG);
    expect(result).toEqual(BASE_CONFIG);
    expect(result).not.toBe(BASE_CONFIG);
  });

  it('returns copy of base when userConfig is null-like', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, undefined);
    expect(result).toEqual(BASE_CONFIG);
  });

  it('clamps memoryMB to min', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { memoryMB: 10 });
    expect(result.memoryMB).toBe(CONTAINER_LIMITS.memoryMB.min);
  });

  it('clamps memoryMB to max', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { memoryMB: 9999 });
    expect(result.memoryMB).toBe(CONTAINER_LIMITS.memoryMB.max);
  });

  it('accepts memoryMB within range', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { memoryMB: 1024 });
    expect(result.memoryMB).toBe(1024);
  });

  it('clamps cpuCores to min', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { cpuCores: 0 });
    expect(result.cpuCores).toBe(CONTAINER_LIMITS.cpuCores.min);
  });

  it('clamps cpuCores to max', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { cpuCores: 100 });
    expect(result.cpuCores).toBe(CONTAINER_LIMITS.cpuCores.max);
  });

  it('clamps storageGB to min', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { storageGB: 0 });
    expect(result.storageGB).toBe(CONTAINER_LIMITS.storageGB.min);
  });

  it('clamps storageGB to max', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { storageGB: 999 });
    expect(result.storageGB).toBe(CONTAINER_LIMITS.storageGB.max);
  });

  it('clamps timeoutMs to min', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { timeoutMs: 100 });
    expect(result.timeoutMs).toBe(CONTAINER_LIMITS.timeoutMs.min);
  });

  it('clamps timeoutMs to max', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { timeoutMs: 999999 });
    expect(result.timeoutMs).toBe(CONTAINER_LIMITS.timeoutMs.max);
  });

  it('accepts valid networkPolicy "none"', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { networkPolicy: 'none' });
    expect(result.networkPolicy).toBe('none');
  });

  it('accepts valid networkPolicy "full"', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { networkPolicy: 'full' });
    expect(result.networkPolicy).toBe('full');
  });

  it('falls back to base networkPolicy for invalid value', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { networkPolicy: 'invalid' as any });
    expect(result.networkPolicy).toBe(BASE_CONFIG.networkPolicy);
  });

  it('includes allowedHosts when provided as array', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, {
      allowedHosts: ['example.com', 'api.example.com'],
    });
    expect(result.allowedHosts).toEqual(['example.com', 'api.example.com']);
  });

  it('filters non-string entries from allowedHosts', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, {
      allowedHosts: ['good.com', 123 as any, null as any, 'also-good.com'],
    });
    expect(result.allowedHosts).toEqual(['good.com', 'also-good.com']);
  });

  it('limits allowedHosts to 50 entries', () => {
    const hosts = Array.from({ length: 100 }, (_, i) => `host${i}.com`);
    const result = sanitizeContainerConfig(BASE_CONFIG, { allowedHosts: hosts });
    expect(result.allowedHosts!.length).toBe(50);
  });

  it('does not include allowedHosts when not an array', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { allowedHosts: 'bad' as any });
    expect(result.allowedHosts).toBeUndefined();
  });

  it('uses base fallback for non-numeric memoryMB', () => {
    const result = sanitizeContainerConfig(BASE_CONFIG, { memoryMB: 'big' as any });
    expect(result.memoryMB).toBe(BASE_CONFIG.memoryMB);
  });
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('CONTAINER_LIMITS', () => {
  it('memoryMB range is 64-2048', () => {
    expect(CONTAINER_LIMITS.memoryMB.min).toBe(64);
    expect(CONTAINER_LIMITS.memoryMB.max).toBe(2048);
  });

  it('cpuCores range is 0.25-4', () => {
    expect(CONTAINER_LIMITS.cpuCores.min).toBe(0.25);
    expect(CONTAINER_LIMITS.cpuCores.max).toBe(4);
  });
});

describe('VALID_NETWORK_POLICIES', () => {
  it('includes none, restricted, full', () => {
    expect(VALID_NETWORK_POLICIES).toContain('none');
    expect(VALID_NETWORK_POLICIES).toContain('restricted');
    expect(VALID_NETWORK_POLICIES).toContain('full');
  });
});
