/**
 * Skill Package Markdown Parser & Serializer Tests
 */

import { describe, it, expect } from 'vitest';
import { parseSkillMarkdown, serializeSkillMarkdown } from './skill-package-markdown.js';
import { validateManifest, type SkillPackageManifest } from './skill-package-types.js';

// =============================================================================
// Fixtures
// =============================================================================

const MINIMAL_MD = `---
id: my-skill
name: My Skill
version: 1.0.0
description: A simple skill
---

## Tools

### my_tool

Does something useful.

\`\`\`javascript
return { content: { result: "ok" } };
\`\`\`
`;

const FULL_MD = `---
id: weather-tools
name: Weather Tools
version: 2.0.0
description: Get current weather and forecasts
category: utilities
icon: ⛅
author: OwnPilot Community
tags: [weather, forecast, temperature]
keywords: [weather, temp, rain]
docs: https://example.com/docs
---

# Weather Tools

Get current weather and forecasts for any city worldwide.

## System Prompt

You have weather tools. Use weather_current when the user asks about current weather conditions.
Use weather_forecast for multi-day forecasts. Always mention the data source.

## Required Services

### openweather
- **Display Name**: OpenWeatherMap
- **Description**: Free weather API
- **Category**: api
- **Docs URL**: https://openweathermap.org

| Field | Label | Type | Required | Description |
|-------|-------|------|----------|-------------|
| api_key | API Key | secret | yes | Your OpenWeatherMap API key |
| base_url | Base URL | url | no | Custom endpoint |

## Tools

### weather_current

Get current weather for a city. Returns temperature, conditions, humidity, and wind.

**Permissions**: network

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| city | string | yes | City name |
| units | string | no | metric or imperial |

\`\`\`javascript
const apiKey = await config.get('openweather', 'api_key');
if (!apiKey) return { content: { error: 'Not configured' } };

const url = \`https://api.example.com/weather?city=\${args.city}\`;
const res = await fetch(url);
return { content: await res.json() };
\`\`\`

### weather_forecast

Get 5-day weather forecast for a city.

**Permissions**: network
**Requires Approval**: yes

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| city | string | yes | City name |
| days | number | no | Number of days |

\`\`\`javascript
return { content: { forecast: [] } };
\`\`\`

## Triggers

### daily-weather
- **Type**: schedule
- **Description**: Daily weather check
- **Enabled**: true

\`\`\`json
{
  "config": { "cron": "0 8 * * *" },
  "action": { "type": "chat", "payload": { "prompt": "Weather today?" } }
}
\`\`\`

### weekly-report
- **Type**: schedule
- **Enabled**: false

\`\`\`json
{
  "config": { "cron": "0 9 * * 1" },
  "action": { "type": "chat", "payload": { "prompt": "Weekly weather" } }
}
\`\`\`
`;

// =============================================================================
// Tests: parseFrontmatter
// =============================================================================

describe('parseSkillMarkdown', () => {
  describe('frontmatter', () => {
    it('parses required fields', () => {
      const manifest = parseSkillMarkdown(MINIMAL_MD);
      expect(manifest.id).toBe('my-skill');
      expect(manifest.name).toBe('My Skill');
      expect(manifest.version).toBe('1.0.0');
      expect(manifest.description).toBe('A simple skill');
    });

    it('parses all optional fields', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      expect(manifest.category).toBe('utilities');
      expect(manifest.icon).toBe('⛅');
      expect(manifest.author).toEqual({ name: 'OwnPilot Community' });
      expect(manifest.tags).toEqual(['weather', 'forecast', 'temperature']);
      expect(manifest.keywords).toEqual(['weather', 'temp', 'rain']);
      expect(manifest.docs).toBe('https://example.com/docs');
    });

    it('handles quoted string values', () => {
      const md = `---
id: "test-skill"
name: 'My Skill'
version: "1.0.0"
description: "A skill with quotes"
---

## Tools

### test_tool

Test tool.

\`\`\`javascript
return { content: {} };
\`\`\`
`;
      const manifest = parseSkillMarkdown(md);
      expect(manifest.id).toBe('test-skill');
      expect(manifest.name).toBe('My Skill');
    });

    it('handles inline YAML arrays with quotes', () => {
      const md = `---
id: test
name: Test
version: 1.0.0
description: Test
tags: ["one", 'two', three]
---

## Tools

### t

Test.

\`\`\`javascript
return { content: {} };
\`\`\`
`;
      const manifest = parseSkillMarkdown(md);
      expect(manifest.tags).toEqual(['one', 'two', 'three']);
    });

    it('throws on missing frontmatter start', () => {
      expect(() => parseSkillMarkdown('# No frontmatter')).toThrow('Missing YAML frontmatter');
    });

    it('throws on missing frontmatter end', () => {
      expect(() => parseSkillMarkdown('---\nid: test\n')).toThrow('Missing closing frontmatter');
    });

    it('leaves optional fields undefined when not present', () => {
      const manifest = parseSkillMarkdown(MINIMAL_MD);
      expect(manifest.category).toBeUndefined();
      expect(manifest.icon).toBeUndefined();
      expect(manifest.author).toBeUndefined();
      expect(manifest.tags).toBeUndefined();
      expect(manifest.keywords).toBeUndefined();
      expect(manifest.docs).toBeUndefined();
    });

    it('handles frontmatter with extra whitespace', () => {
      const md = `---
id:   spaced-skill
name:   Spaced Name
version:  1.0.0
description: Has spaces
---

## Tools

### t

Test.

\`\`\`javascript
return { content: {} };
\`\`\`
`;
      const manifest = parseSkillMarkdown(md);
      expect(manifest.id).toBe('spaced-skill');
      expect(manifest.name).toBe('Spaced Name');
    });

    it('handles description with colons', () => {
      const md = `---
id: test
name: Test
version: 1.0.0
description: Weather: current and forecast
---

## Tools

### t

Test.

\`\`\`javascript
return { content: {} };
\`\`\`
`;
      const manifest = parseSkillMarkdown(md);
      expect(manifest.description).toBe('Weather: current and forecast');
    });
  });

  // ===========================================================================
  // System prompt
  // ===========================================================================

  describe('system prompt', () => {
    it('extracts multiline system prompt', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      expect(manifest.system_prompt).toContain('weather_current');
      expect(manifest.system_prompt).toContain('weather_forecast');
      expect(manifest.system_prompt).toContain('\n');
    });

    it('trims whitespace', () => {
      const md = `---
id: test
name: Test
version: 1.0.0
description: Test
---

## System Prompt

   Some instructions.

## Tools

### t

Test.

\`\`\`javascript
return { content: {} };
\`\`\`
`;
      const manifest = parseSkillMarkdown(md);
      expect(manifest.system_prompt).toBe('Some instructions.');
    });

    it('returns undefined when no system prompt section', () => {
      const manifest = parseSkillMarkdown(MINIMAL_MD);
      expect(manifest.system_prompt).toBeUndefined();
    });
  });

  // ===========================================================================
  // Tools
  // ===========================================================================

  describe('tools', () => {
    it('parses a single tool with all fields', () => {
      const manifest = parseSkillMarkdown(MINIMAL_MD);
      expect(manifest.tools).toHaveLength(1);
      expect(manifest.tools[0]!.name).toBe('my_tool');
      expect(manifest.tools[0]!.description).toBe('Does something useful.');
      expect(manifest.tools[0]!.code).toBe('return { content: { result: "ok" } };');
    });

    it('parses multiple tools', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      expect(manifest.tools).toHaveLength(2);
      expect(manifest.tools[0]!.name).toBe('weather_current');
      expect(manifest.tools[1]!.name).toBe('weather_forecast');
    });

    it('extracts description as first paragraph', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      expect(manifest.tools[0]!.description).toBe(
        'Get current weather for a city. Returns temperature, conditions, humidity, and wind.',
      );
    });

    it('parses parameter table into JSON Schema', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      const params = manifest.tools[0]!.parameters;
      expect(params.type).toBe('object');
      expect(params.properties).toHaveProperty('city');
      expect(params.properties).toHaveProperty('units');
      expect((params.properties['city'] as Record<string, unknown>).type).toBe('string');
      expect(params.required).toEqual(['city']);
    });

    it('handles tool with no parameters table', () => {
      const md = `---
id: test
name: Test
version: 1.0.0
description: Test
---

## Tools

### no_params_tool

A tool with no params.

\`\`\`javascript
return { content: { result: "hello" } };
\`\`\`
`;
      const manifest = parseSkillMarkdown(md);
      expect(manifest.tools[0]!.parameters.type).toBe('object');
      expect(manifest.tools[0]!.parameters.properties).toEqual({});
    });

    it('extracts permissions', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      expect(manifest.tools[0]!.permissions).toEqual(['network']);
    });

    it('handles comma-separated permissions', () => {
      const md = `---
id: test
name: Test
version: 1.0.0
description: Test
---

## Tools

### multi_perm

A tool.

**Permissions**: network, filesystem

\`\`\`javascript
return { content: {} };
\`\`\`
`;
      const manifest = parseSkillMarkdown(md);
      expect(manifest.tools[0]!.permissions).toEqual(['network', 'filesystem']);
    });

    it('extracts requires_approval', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      expect(manifest.tools[0]!.requires_approval).toBeUndefined();
      expect(manifest.tools[1]!.requires_approval).toBe(true);
    });

    it('extracts multiline code from fenced block', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      const code = manifest.tools[0]!.code;
      expect(code).toContain("config.get('openweather', 'api_key')");
      expect(code).toContain('\n'); // multiline
      expect(code).toContain('await fetch(url)');
    });

    it('handles ```js language tag', () => {
      const md = `---
id: test
name: Test
version: 1.0.0
description: Test
---

## Tools

### js_tool

A tool.

\`\`\`js
return { content: { ok: true } };
\`\`\`
`;
      const manifest = parseSkillMarkdown(md);
      expect(manifest.tools[0]!.code).toBe('return { content: { ok: true } };');
    });

    it('does not treat ## or ### inside code blocks as sections', () => {
      const md = `---
id: test
name: Test
version: 1.0.0
description: Test
---

## Tools

### my_tool

Generates markdown.

\`\`\`javascript
// Generate a markdown doc
const md = "## Heading\\n### Subheading\\nContent";
return { content: { markdown: md } };
\`\`\`
`;
      const manifest = parseSkillMarkdown(md);
      expect(manifest.tools).toHaveLength(1);
      expect(manifest.tools[0]!.name).toBe('my_tool');
      expect(manifest.tools[0]!.code).toContain('## Heading');
    });
  });

  // ===========================================================================
  // Required services
  // ===========================================================================

  describe('required services', () => {
    it('parses service metadata', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      expect(manifest.required_services).toHaveLength(1);
      const svc = manifest.required_services![0]!;
      expect(svc.name).toBe('openweather');
      expect(svc.display_name).toBe('OpenWeatherMap');
      expect(svc.description).toBe('Free weather API');
      expect(svc.category).toBe('api');
      expect(svc.docs_url).toBe('https://openweathermap.org');
    });

    it('parses config schema table', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      const schema = manifest.required_services![0]!.config_schema!;
      expect(schema).toHaveLength(2);
      expect(schema[0]!.name).toBe('api_key');
      expect(schema[0]!.label).toBe('API Key');
      expect(schema[0]!.type).toBe('secret');
      expect(schema[0]!.required).toBe(true);
      expect(schema[1]!.name).toBe('base_url');
      expect(schema[1]!.required).toBe(false);
    });

    it('handles service with no config schema', () => {
      const md = `---
id: test
name: Test
version: 1.0.0
description: Test
---

## Required Services

### simple-api
- **Display Name**: Simple API
- **Description**: A simple API

## Tools

### t

Test.

\`\`\`javascript
return { content: {} };
\`\`\`
`;
      const manifest = parseSkillMarkdown(md);
      expect(manifest.required_services).toHaveLength(1);
      expect(manifest.required_services![0]!.config_schema).toBeUndefined();
    });

    it('returns undefined when no required services section', () => {
      const manifest = parseSkillMarkdown(MINIMAL_MD);
      expect(manifest.required_services).toBeUndefined();
    });
  });

  // ===========================================================================
  // Triggers
  // ===========================================================================

  describe('triggers', () => {
    it('parses trigger metadata', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      expect(manifest.triggers).toHaveLength(2);

      const t1 = manifest.triggers![0]!;
      expect(t1.name).toBe('daily-weather');
      expect(t1.type).toBe('schedule');
      expect(t1.description).toBe('Daily weather check');
      expect(t1.enabled).toBe(true);
    });

    it('parses config and action from JSON block', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      const t1 = manifest.triggers![0]!;
      expect(t1.config).toEqual({ cron: '0 8 * * *' });
      expect(t1.action).toEqual({ type: 'chat', payload: { prompt: 'Weather today?' } });
    });

    it('handles enabled: false', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      expect(manifest.triggers![1]!.enabled).toBe(false);
    });

    it('returns undefined when no triggers section', () => {
      const manifest = parseSkillMarkdown(MINIMAL_MD);
      expect(manifest.triggers).toBeUndefined();
    });
  });

  // ===========================================================================
  // Validation integration
  // ===========================================================================

  describe('validation integration', () => {
    it('minimal manifest passes validateManifest', () => {
      const manifest = parseSkillMarkdown(MINIMAL_MD);
      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('full manifest passes validateManifest', () => {
      const manifest = parseSkillMarkdown(FULL_MD);
      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('missing id fails validation', () => {
      const md = `---
name: Test
version: 1.0.0
description: Test
---

## Tools

### t

Test.

\`\`\`javascript
return { content: {} };
\`\`\`
`;
      const manifest = parseSkillMarkdown(md);
      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
    });
  });
});

// =============================================================================
// Serializer Tests
// =============================================================================

describe('serializeSkillMarkdown', () => {
  it('serializes minimal manifest', () => {
    const manifest: SkillPackageManifest = {
      id: 'test',
      name: 'Test',
      version: '1.0.0',
      description: 'A test',
      tools: [{
        name: 'my_tool',
        description: 'Does things',
        parameters: { type: 'object', properties: {} },
        code: 'return { content: {} };',
      }],
    };

    const md = serializeSkillMarkdown(manifest);
    expect(md).toContain('---');
    expect(md).toContain('id: test');
    expect(md).toContain('## Tools');
    expect(md).toContain('### my_tool');
    expect(md).toContain('```javascript');
  });

  it('serializes all optional fields', () => {
    const manifest: SkillPackageManifest = {
      id: 'full',
      name: 'Full Skill',
      version: '1.0.0',
      description: 'Full test',
      category: 'utilities',
      icon: '🔧',
      author: { name: 'Test Author' },
      tags: ['a', 'b'],
      keywords: ['x', 'y'],
      docs: 'https://example.com',
      system_prompt: 'Use this skill wisely.',
      tools: [{
        name: 'tool_a',
        description: 'Tool A',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string', description: 'Input text' },
          },
          required: ['input'],
        },
        code: 'return { content: { out: args.input } };',
        permissions: ['network'],
        requires_approval: true,
      }],
      required_services: [{
        name: 'my-api',
        display_name: 'My API',
        description: 'An API',
        category: 'api',
        config_schema: [{
          name: 'api_key',
          label: 'API Key',
          type: 'secret',
          required: true,
          description: 'The key',
        }],
      }],
      triggers: [{
        name: 'daily',
        type: 'schedule',
        description: 'Daily run',
        enabled: true,
        config: { cron: '0 9 * * *' },
        action: { type: 'chat', payload: { prompt: 'Do it' } },
      }],
    };

    const md = serializeSkillMarkdown(manifest);
    expect(md).toContain('category: utilities');
    expect(md).toContain('icon: 🔧');
    expect(md).toContain('author: Test Author');
    expect(md).toContain('tags: [a, b]');
    expect(md).toContain('## System Prompt');
    expect(md).toContain('Use this skill wisely.');
    expect(md).toContain('## Required Services');
    expect(md).toContain('### my-api');
    expect(md).toContain('**Permissions**: network');
    expect(md).toContain('**Requires Approval**: yes');
    expect(md).toContain('## Triggers');
    expect(md).toContain('### daily');
  });

  it('round-trip: parse(serialize(manifest)) preserves data', () => {
    const original: SkillPackageManifest = {
      id: 'roundtrip',
      name: 'Round Trip',
      version: '1.0.0',
      description: 'Test round-trip',
      category: 'developer',
      tags: ['test', 'roundtrip'],
      system_prompt: 'Use the tool.',
      tools: [{
        name: 'echo_tool',
        description: 'Echoes input back',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to echo' },
            count: { type: 'number', description: 'Repeat count' },
          },
          required: ['text'],
        },
        code: 'return { content: { result: args.text.repeat(args.count || 1) } };',
        permissions: ['network'],
      }],
      required_services: [{
        name: 'echo-api',
        display_name: 'Echo API',
        description: 'API for echoing',
        category: 'api',
        config_schema: [{
          name: 'url',
          label: 'URL',
          type: 'url',
          required: true,
          description: 'Echo endpoint',
        }],
      }],
      triggers: [{
        name: 'hourly',
        type: 'schedule',
        description: 'Every hour',
        enabled: true,
        config: { cron: '0 * * * *' },
        action: { type: 'chat', payload: { prompt: 'Echo check' } },
      }],
    };

    const md = serializeSkillMarkdown(original);
    const parsed = parseSkillMarkdown(md);

    // Core fields
    expect(parsed.id).toBe(original.id);
    expect(parsed.name).toBe(original.name);
    expect(parsed.version).toBe(original.version);
    expect(parsed.description).toBe(original.description);
    expect(parsed.category).toBe(original.category);
    expect(parsed.tags).toEqual(original.tags);
    expect(parsed.system_prompt).toBe(original.system_prompt);

    // Tools
    expect(parsed.tools).toHaveLength(1);
    expect(parsed.tools[0]!.name).toBe('echo_tool');
    expect(parsed.tools[0]!.description).toBe('Echoes input back');
    expect(parsed.tools[0]!.parameters.required).toEqual(['text']);
    expect(parsed.tools[0]!.code).toBe(original.tools[0]!.code);
    expect(parsed.tools[0]!.permissions).toEqual(['network']);

    // Required services
    expect(parsed.required_services).toHaveLength(1);
    expect(parsed.required_services![0]!.name).toBe('echo-api');
    expect(parsed.required_services![0]!.config_schema).toHaveLength(1);

    // Triggers
    expect(parsed.triggers).toHaveLength(1);
    expect(parsed.triggers![0]!.name).toBe('hourly');
    expect(parsed.triggers![0]!.config).toEqual({ cron: '0 * * * *' });

    // Passes validation
    const validation = validateManifest(parsed);
    expect(validation.valid).toBe(true);
  });
});
