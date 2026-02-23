/**
 * CorePlugin Tests
 *
 * Tests for the buildCorePlugin function that assembles all built-in tools
 * into a single plugin entity.
 */

import { describe, it, expect } from 'vitest';
import { buildCorePlugin } from './core-plugin.js';

describe('buildCorePlugin', () => {
  it('should return manifest and implementation', () => {
    const result = buildCorePlugin();

    expect(result).toHaveProperty('manifest');
    expect(result).toHaveProperty('implementation');
  });

  it('should have correct plugin metadata', () => {
    const { manifest } = buildCorePlugin();

    expect(manifest.id).toBe('core');
    expect(manifest.name).toBe('OwnPilot Core');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.description).toContain('Built-in core tools');
  });

  it('should have core category', () => {
    const { manifest } = buildCorePlugin();

    expect(manifest.category).toBe('core');
  });

  it('should have tools capability', () => {
    const { manifest } = buildCorePlugin();

    expect(manifest.capabilities).toContain('tools');
  });

  it('should have empty permissions array', () => {
    const { manifest } = buildCorePlugin();

    expect(manifest.permissions).toEqual([]);
  });

  it('should have implementation with tools', () => {
    const { implementation } = buildCorePlugin();

    expect(implementation.tools).toBeDefined();
    expect(implementation.tools instanceof Map).toBe(true);
    expect((implementation.tools as Map<string, unknown>).size).toBeGreaterThan(0);
  });

  it('should map tool names to executors in implementation', () => {
    const { implementation } = buildCorePlugin();
    const toolsMap = implementation.tools as Map<string, { executor: unknown }>;

    // Each tool should have an executor function
    for (const [name, toolEntry] of toolsMap.entries()) {
      expect(typeof toolEntry.executor).toBe('function');
      expect(name).toBeTruthy();
    }
  });

  it('should have complete manifest structure', () => {
    const { manifest } = buildCorePlugin();

    expect(manifest.id).toBeTruthy();
    expect(manifest.name).toBeTruthy();
    expect(manifest.version).toBeTruthy();
    expect(manifest.description).toBeTruthy();
    expect(manifest.main).toBeTruthy();
    expect(Array.isArray(manifest.capabilities)).toBe(true);
    expect(Array.isArray(manifest.permissions)).toBe(true);
  });
});
