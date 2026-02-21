import { describe, it, expect } from 'vitest';
import { TOOL_TEMPLATES } from './tool-templates.js';
import type { ToolTemplate } from './tool-templates.js';

const KNOWN_CATEGORIES = ['Network', 'Data', 'Text', 'Math', 'Utilities', 'Config'];

const EXPECTED_IDS = [
  'api_fetcher',
  'data_transformer',
  'text_formatter',
  'calculator',
  'api_with_key',
  'json_schema_validator',
  'cron_parser',
  'markdown_to_html',
  'url_parser',
  'string_template',
  'data_aggregator',
  'regex_tester',
  'date_range',
  'hash_checksum',
  'env_config',
  'csv_processor',
];

describe('tool-templates', () => {
  it('exports a non-empty array', () => {
    expect(Array.isArray(TOOL_TEMPLATES)).toBe(true);
    expect(TOOL_TEMPLATES.length).toBeGreaterThan(0);
  });

  it('contains exactly 16 templates', () => {
    expect(TOOL_TEMPLATES).toHaveLength(16);
  });

  it('contains all expected template IDs', () => {
    const ids = TOOL_TEMPLATES.map((t) => t.id);
    for (const expectedId of EXPECTED_IDS) {
      expect(ids).toContain(expectedId);
    }
  });

  it('has all unique IDs', () => {
    const ids = TOOL_TEMPLATES.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('has all unique names', () => {
    const names = TOOL_TEMPLATES.map((t) => t.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  describe('required fields', () => {
    it.each(TOOL_TEMPLATES.map((t) => [t.id, t] as const))(
      'template "%s" has all required fields',
      (_id, template) => {
        expect(template.id).toBeTruthy();
        expect(typeof template.id).toBe('string');
        expect(template.name).toBeTruthy();
        expect(typeof template.name).toBe('string');
        expect(template.displayName).toBeTruthy();
        expect(typeof template.displayName).toBe('string');
        expect(template.description).toBeTruthy();
        expect(typeof template.description).toBe('string');
        expect(template.category).toBeTruthy();
        expect(typeof template.category).toBe('string');
        expect(Array.isArray(template.permissions)).toBe(true);
        expect(template.parameters).toBeDefined();
        expect(template.code).toBeTruthy();
        expect(typeof template.code).toBe('string');
      },
    );
  });

  describe('parameters structure', () => {
    it.each(TOOL_TEMPLATES.map((t) => [t.id, t] as const))(
      'template "%s" has parameters.type = "object"',
      (_id, template) => {
        expect(template.parameters.type).toBe('object');
      },
    );

    it.each(TOOL_TEMPLATES.map((t) => [t.id, t] as const))(
      'template "%s" has non-empty parameters.properties',
      (_id, template) => {
        expect(typeof template.parameters.properties).toBe('object');
        expect(template.parameters.properties).not.toBeNull();
        expect(Object.keys(template.parameters.properties).length).toBeGreaterThan(0);
      },
    );

    it.each(
      TOOL_TEMPLATES.filter((t) => t.parameters.required && t.parameters.required.length > 0).map(
        (t) => [t.id, t] as const,
      ),
    )('template "%s" required fields are listed in properties', (_id, template) => {
      const propertyKeys = Object.keys(template.parameters.properties);
      for (const requiredField of template.parameters.required!) {
        expect(propertyKeys).toContain(requiredField);
      }
    });
  });

  describe('code field', () => {
    it.each(TOOL_TEMPLATES.map((t) => [t.id, t] as const))(
      'template "%s" has non-empty code',
      (_id, template) => {
        expect(template.code.trim().length).toBeGreaterThan(0);
      },
    );
  });

  describe('permissions field', () => {
    it.each(TOOL_TEMPLATES.map((t) => [t.id, t] as const))(
      'template "%s" has permissions as an array',
      (_id, template) => {
        expect(Array.isArray(template.permissions)).toBe(true);
      },
    );

    it.each(TOOL_TEMPLATES.map((t) => [t.id, t] as const))(
      'template "%s" permissions contains only strings',
      (_id, template) => {
        for (const perm of template.permissions) {
          expect(typeof perm).toBe('string');
        }
      },
    );
  });

  describe('categories', () => {
    it.each(TOOL_TEMPLATES.map((t) => [t.id, t] as const))(
      'template "%s" has a known category',
      (_id, template) => {
        expect(KNOWN_CATEGORIES).toContain(template.category);
      },
    );

    it('covers multiple categories', () => {
      const categories = new Set(TOOL_TEMPLATES.map((t) => t.category));
      expect(categories.size).toBeGreaterThanOrEqual(3);
    });
  });

  describe('requiredApiKeys', () => {
    const templatesWithApiKeys = TOOL_TEMPLATES.filter(
      (t) => t.requiredApiKeys && t.requiredApiKeys.length > 0,
    );

    it('at least one template has requiredApiKeys', () => {
      expect(templatesWithApiKeys.length).toBeGreaterThan(0);
    });

    it.each(templatesWithApiKeys.map((t) => [t.id, t] as const))(
      'template "%s" has valid requiredApiKeys structure',
      (_id, template) => {
        expect(Array.isArray(template.requiredApiKeys)).toBe(true);
        for (const key of template.requiredApiKeys!) {
          expect(key.name).toBeTruthy();
          expect(typeof key.name).toBe('string');
          if (key.displayName !== undefined) {
            expect(typeof key.displayName).toBe('string');
          }
          if (key.description !== undefined) {
            expect(typeof key.description).toBe('string');
          }
          if (key.category !== undefined) {
            expect(typeof key.category).toBe('string');
          }
          if (key.docsUrl !== undefined) {
            expect(typeof key.docsUrl).toBe('string');
          }
        }
      },
    );
  });

  it('no template has an empty id', () => {
    for (const template of TOOL_TEMPLATES) {
      expect(template.id.trim()).not.toBe('');
    }
  });

  it('no template has an empty name', () => {
    for (const template of TOOL_TEMPLATES) {
      expect(template.name.trim()).not.toBe('');
    }
  });
});
