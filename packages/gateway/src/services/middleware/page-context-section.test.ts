import { describe, test, expect } from 'vitest';
import { buildPageContextSection } from './page-context-section.js';

describe('buildPageContextSection', () => {
  test('null/undefined pageContext → empty string', () => {
    expect(buildPageContextSection(undefined)).toBe('');
    expect(buildPageContextSection(null as any)).toBe('');
  });

  test('pageContext without pageType → empty string', () => {
    expect(buildPageContextSection({} as any)).toBe('');
  });

  test('pageType only → includes viewing line', () => {
    const result = buildPageContextSection({ pageType: 'workspace' });
    expect(result).toContain('## Page Context');
    expect(result).toContain('workspace');
  });

  test('pageType + path → includes working directory', () => {
    const result = buildPageContextSection({ pageType: 'workspace', path: '/home/ayaz/project' });
    expect(result).toContain('Working directory');
    expect(result).toContain('/home/ayaz/project');
  });

  test('pageType + entityId → includes entity', () => {
    const result = buildPageContextSection({ pageType: 'workflow', entityId: 'wf_123' });
    expect(result).toContain('wf_123');
  });

  test('pageType + contextData → includes JSON block', () => {
    const result = buildPageContextSection({
      pageType: 'workflow',
      contextData: { name: 'My Workflow', nodes: [{ type: 'trigger' }] },
    });
    expect(result).toContain('```json');
    expect(result).toContain('My Workflow');
  });

  test('pageType + systemPromptHint → includes hint', () => {
    const result = buildPageContextSection({
      pageType: 'agent',
      systemPromptHint: 'You are helping configure an AI agent.',
    });
    expect(result).toContain('You are helping configure an AI agent.');
  });

  test('full pageContext → all sections present', () => {
    const result = buildPageContextSection({
      pageType: 'workspace',
      entityId: 'ws_abc',
      path: '/home/ayaz/project',
      contextData: { fileCount: 42 },
      systemPromptHint: 'Help with files.',
    });
    expect(result).toContain('## Page Context');
    expect(result).toContain('workspace');
    expect(result).toContain('ws_abc');
    expect(result).toContain('/home/ayaz/project');
    expect(result).toContain('42');
    expect(result).toContain('Help with files.');
  });

  test('contextData truncation: >5000 chars → truncated', () => {
    const largeData: Record<string, string> = {};
    for (let i = 0; i < 300; i++) largeData[`key_${i}`] = 'x'.repeat(20);
    const result = buildPageContextSection({
      pageType: 'test',
      contextData: largeData,
    });
    expect(result).toContain('truncated');
    expect(result.length).toBeLessThan(6000);
  });
});
