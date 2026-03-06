/**
 * CLI Tools Catalog Tests
 *
 * Verifies catalog structure, completeness, and lookup map consistency.
 */

import { describe, it, expect } from 'vitest';
import { CLI_TOOLS_CATALOG, CLI_TOOLS_BY_NAME } from './cli-tools-catalog.js';

describe('CLI_TOOLS_CATALOG', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(CLI_TOOLS_CATALOG)).toBe(true);
    expect(CLI_TOOLS_CATALOG.length).toBeGreaterThan(0);
  });

  it('every entry has required fields', () => {
    for (const entry of CLI_TOOLS_CATALOG) {
      expect(entry.name, `${entry.name} missing name`).toBeTruthy();
      expect(entry.displayName, `${entry.name} missing displayName`).toBeTruthy();
      expect(entry.binaryName, `${entry.name} missing binaryName`).toBeTruthy();
      expect(entry.category, `${entry.name} missing category`).toBeTruthy();
      expect(entry.riskLevel, `${entry.name} missing riskLevel`).toBeTruthy();
      expect(entry.defaultPolicy, `${entry.name} missing defaultPolicy`).toBeTruthy();
      expect(Array.isArray(entry.installMethods), `${entry.name} installMethods not array`).toBe(
        true
      );
    }
  });

  it('all names are unique', () => {
    const names = CLI_TOOLS_CATALOG.map((e) => e.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('all riskLevels are valid values', () => {
    const validLevels = new Set(['low', 'medium', 'high', 'critical']);
    for (const entry of CLI_TOOLS_CATALOG) {
      expect(
        validLevels.has(entry.riskLevel),
        `${entry.name} invalid riskLevel: ${entry.riskLevel}`
      ).toBe(true);
    }
  });

  it('all defaultPolicies are valid values', () => {
    const validPolicies = new Set(['allowed', 'prompt', 'blocked']);
    for (const entry of CLI_TOOLS_CATALOG) {
      expect(
        validPolicies.has(entry.defaultPolicy),
        `${entry.name} invalid defaultPolicy: ${entry.defaultPolicy}`
      ).toBe(true);
    }
  });

  it('contains well-known tools', () => {
    const names = new Set(CLI_TOOLS_CATALOG.map((e) => e.name));
    expect(names.has('eslint')).toBe(true);
    expect(names.has('prettier')).toBe(true);
    expect(names.has('git')).toBe(true);
  });

  it('all installMethods are valid values', () => {
    const valid = new Set([
      'npm-global',
      'pnpm-global',
      'npx',
      'brew',
      'system',
      'manual',
      'winget',
      'scoop',
    ]);
    for (const entry of CLI_TOOLS_CATALOG) {
      for (const method of entry.installMethods) {
        expect(valid.has(method as string), `${entry.name} invalid installMethod: ${method}`).toBe(
          true
        );
      }
    }
  });

  it('npxPackage is defined when installMethods includes npx', () => {
    for (const entry of CLI_TOOLS_CATALOG) {
      if (entry.installMethods.includes('npx' as any)) {
        expect(entry.npxPackage, `${entry.name} has npx method but no npxPackage`).toBeTruthy();
      }
    }
  });
});

describe('CLI_TOOLS_BY_NAME', () => {
  it('is a Map', () => {
    expect(CLI_TOOLS_BY_NAME).toBeInstanceOf(Map);
  });

  it('has same number of entries as catalog', () => {
    expect(CLI_TOOLS_BY_NAME.size).toBe(CLI_TOOLS_CATALOG.length);
  });

  it('every catalog entry is in the map', () => {
    for (const entry of CLI_TOOLS_CATALOG) {
      expect(CLI_TOOLS_BY_NAME.has(entry.name), `${entry.name} not in lookup map`).toBe(true);
      expect(CLI_TOOLS_BY_NAME.get(entry.name)).toBe(entry);
    }
  });

  it('lookup returns correct entry', () => {
    const eslint = CLI_TOOLS_BY_NAME.get('eslint');
    expect(eslint).toBeDefined();
    expect(eslint!.binaryName).toBe('eslint');
    expect(eslint!.category).toBe('linter');
  });

  it('returns undefined for unknown tool', () => {
    expect(CLI_TOOLS_BY_NAME.get('nonexistent-tool-xyz')).toBeUndefined();
  });
});
