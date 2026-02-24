/**
 * Extensions Generation Routes Tests
 *
 * Integration tests for POST /generate and POST /generate-skill endpoints.
 * Mocks AI provider, settings, core modules, and related dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorHandler } from '../../middleware/error-handler.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleManifest = {
  id: 'text-utils',
  name: 'Text Utilities',
  version: '1.0.0',
  description: 'Text manipulation tools',
  category: 'utilities',
  tools: [
    {
      name: 'word_count',
      description: 'Count words',
      parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      code: 'return { content: { count: args.text.split(" ").length } };',
    },
  ],
};

const sampleSkillMd = `---
name: Code Review Assistant
description: Systematic code review
version: 1.0.0
category: developer
tags: [code-review]
---

# Code Review Assistant

## Overview
Reviews code for security and quality.

## Instructions
1. Read the code
2. Check for issues
`;

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockComplete = vi.fn();

vi.mock('@ownpilot/core', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createProvider: vi.fn(() => ({ complete: mockComplete })),
    getProviderConfig: vi.fn(() => null),
  };
});

const mockValidateManifest = vi.fn(() => ({ valid: true, errors: [] }));
vi.mock('../../services/extension-types.js', () => ({
  validateManifest: (...args: unknown[]) => mockValidateManifest(...(args as [unknown])),
}));

const mockSerializeExtensionMarkdown = vi.fn(() => '# Extension\nSome markdown');
vi.mock('../../services/extension-markdown.js', () => ({
  serializeExtensionMarkdown: (...args: unknown[]) =>
    mockSerializeExtensionMarkdown(...(args as [unknown])),
}));

const mockParseAgentSkillsMd = vi.fn(() => ({ name: 'Code Review Assistant' }));
vi.mock('../../services/agentskills-parser.js', () => ({
  parseAgentSkillsMd: (...args: unknown[]) => mockParseAgentSkillsMd(...(args as [string])),
}));

const mockResolveProviderAndModel = vi.fn(async () => ({ provider: 'openai', model: 'gpt-4' }));
const mockGetApiKey = vi.fn(async () => 'test-api-key');

vi.mock('../settings.js', () => ({
  resolveProviderAndModel: (...args: unknown[]) =>
    mockResolveProviderAndModel(...(args as [string, string])),
  getApiKey: (...args: unknown[]) => mockGetApiKey(...(args as [string])),
}));

vi.mock('../../db/repositories/index.js', () => ({
  localProvidersRepo: {
    getProvider: vi.fn(async () => null),
  },
}));

// Import after mocks
const { generationRoutes } = await import('./generation.js');

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

function createApp() {
  const app = new Hono();
  app.route('/ext', generationRoutes);
  app.onError(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Extensions Generation Routes', () => {
  let app: Hono;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProviderAndModel.mockResolvedValue({ provider: 'openai', model: 'gpt-4' });
    mockGetApiKey.mockResolvedValue('test-api-key');
    mockValidateManifest.mockReturnValue({ valid: true, errors: [] });
    mockParseAgentSkillsMd.mockReturnValue({ name: 'Code Review Assistant' });
    app = createApp();
  });

  // ========================================================================
  // POST /generate - Generate extension manifest from description
  // ========================================================================

  describe('POST /ext/generate', () => {
    it('generates manifest from description', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify(sampleManifest) },
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create text utility tools' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.manifest).toBeDefined();
      expect(json.data.manifest.id).toBe('text-utils');
      expect(json.data.validation).toBeDefined();
    });

    it('strips markdown code blocks from AI response', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: '```json\n' + JSON.stringify(sampleManifest) + '\n```' },
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.manifest.id).toBe('text-utils');
    });

    it('returns markdown when format=markdown and validation passes', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify(sampleManifest) },
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools', format: 'markdown' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.markdown).toBeDefined();
      expect(mockSerializeExtensionMarkdown).toHaveBeenCalled();
    });

    it('does not include markdown when format=markdown but validation fails', async () => {
      mockValidateManifest.mockReturnValue({ valid: false, errors: ['missing id'] });
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify(sampleManifest) },
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools', format: 'markdown' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.markdown).toBeUndefined();
      expect(json.data.validation.valid).toBe(false);
    });

    it('does not include markdown when format is not markdown', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify(sampleManifest) },
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools', format: 'json' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.markdown).toBeUndefined();
    });

    it('returns 400 when description is missing', async () => {
      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('description');
    });

    it('returns 400 for empty description', async () => {
      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: '   ' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for non-string description', async () => {
      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 123 }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when no AI provider is configured', async () => {
      mockResolveProviderAndModel.mockResolvedValueOnce({ provider: '', model: '' });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('provider');
    });

    it('returns 400 when API key not configured', async () => {
      mockGetApiKey.mockResolvedValueOnce(undefined as unknown as string);

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('API key');
    });

    it('returns 500 when AI call fails', async () => {
      mockComplete.mockResolvedValue({
        ok: false,
        error: { message: 'Rate limit exceeded' },
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('AI generation failed');
      expect(json.error.message).toContain('Rate limit');
    });

    it('returns 500 when AI returns no error message', async () => {
      mockComplete.mockResolvedValue({
        ok: false,
        error: {},
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('unknown error');
    });

    it('returns 500 when AI returns empty content', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: '' },
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('empty response');
    });

    it('returns 500 when AI returns null content', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: null },
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools' }),
      });

      expect(res.status).toBe(500);
    });

    it('returns 500 when AI returns invalid JSON', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: 'this is not json at all' },
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('invalid JSON');
    });

    it('returns 500 when provider.complete throws an exception', async () => {
      mockComplete.mockRejectedValue(new Error('Network error'));

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('EXECUTION_ERROR');
    });

    it('uses local provider API key when available', async () => {
      const { localProvidersRepo } = await import('../../db/repositories/index.js');
      vi.mocked(localProvidersRepo.getProvider).mockResolvedValueOnce({
        id: 'openai',
        name: 'OpenAI',
        apiKey: 'local-key',
        isEnabled: true,
        baseUrl: 'http://localhost:1234',
      } as never);

      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify(sampleManifest) },
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools' }),
      });

      expect(res.status).toBe(200);
    });

    it('uses "local-no-key" when local provider has no apiKey', async () => {
      const { localProvidersRepo } = await import('../../db/repositories/index.js');
      vi.mocked(localProvidersRepo.getProvider).mockResolvedValueOnce({
        id: 'openai',
        name: 'OpenAI',
        apiKey: '',
        isEnabled: true,
        baseUrl: 'http://localhost:1234',
      } as never);

      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: JSON.stringify(sampleManifest) },
      });

      const res = await app.request('/ext/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create tools' }),
      });

      // Should succeed because 'local-no-key' is truthy
      expect(res.status).toBe(200);
    });
  });

  // ========================================================================
  // POST /generate-skill - Generate SKILL.md content
  // ========================================================================

  describe('POST /ext/generate-skill', () => {
    it('generates skill markdown from description', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: sampleSkillMd },
      });

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a code review skill' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.content).toContain('Code Review Assistant');
      expect(json.data.name).toBe('Code Review Assistant');
      expect(json.data.validation.valid).toBe(true);
    });

    it('strips wrapping code blocks from skill response', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: '```markdown\n' + sampleSkillMd + '\n```' },
      });

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.content).not.toContain('```');
    });

    it('strips wrapping md code blocks', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: '```md\n' + sampleSkillMd + '\n```' },
      });

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(200);
    });

    it('strips wrapping yaml code blocks', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: '```yaml\n' + sampleSkillMd + '\n```' },
      });

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(200);
    });

    it('returns validation errors when skill parsing fails', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: 'Some invalid skill content without frontmatter' },
      });
      mockParseAgentSkillsMd.mockImplementation(() => {
        throw new Error('Missing required frontmatter');
      });

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.validation.valid).toBe(false);
      expect(json.data.validation.errors).toContain('Missing required frontmatter');
      expect(json.data.name).toBe('Generated Skill'); // fallback name
    });

    it('returns validation error string when non-Error is thrown', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: 'bad content' },
      });
      mockParseAgentSkillsMd.mockImplementation(() => {
        throw 'string error';
      });

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.validation.valid).toBe(false);
      expect(json.data.validation.errors).toContain('string error');
    });

    it('returns 400 when description is missing', async () => {
      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for empty description', async () => {
      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: '   ' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for non-string description', async () => {
      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 42 }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid JSON body', async () => {
      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json at all',
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 when no provider configured', async () => {
      mockResolveProviderAndModel.mockResolvedValueOnce({ provider: '', model: '' });

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain('provider');
    });

    it('returns 400 when API key not configured', async () => {
      mockGetApiKey.mockResolvedValueOnce(undefined as unknown as string);

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(400);
    });

    it('returns 500 when AI call fails', async () => {
      mockComplete.mockResolvedValue({
        ok: false,
        error: { message: 'Server error' },
      });

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('AI generation failed');
    });

    it('returns 500 when AI returns empty content', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: '' },
      });

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.message).toContain('empty response');
    });

    it('returns 500 when AI returns null content', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: null },
      });

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(500);
    });

    it('returns 500 when provider.complete throws', async () => {
      mockComplete.mockRejectedValue(new Error('Connection reset'));

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe('EXECUTION_ERROR');
    });

    it('uses parsed manifest name when available', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: sampleSkillMd },
      });
      mockParseAgentSkillsMd.mockReturnValue({ name: 'My Custom Skill' });

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.name).toBe('My Custom Skill');
    });

    it('uses fallback name when manifest has no name', async () => {
      mockComplete.mockResolvedValue({
        ok: true,
        value: { content: sampleSkillMd },
      });
      mockParseAgentSkillsMd.mockReturnValue({});

      const res = await app.request('/ext/generate-skill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'Create a skill' }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.name).toBe('Generated Skill');
    });
  });
});
