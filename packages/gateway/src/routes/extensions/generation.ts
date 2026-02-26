/**
 * Extensions Generation Routes
 *
 * POST /generate, POST /generate-skill
 */

import { Hono } from 'hono';
import {
  createProvider,
  getProviderConfig as coreGetProviderConfig,
  type AIProvider,
} from '@ownpilot/core';
import { validateManifest, type ExtensionManifest } from '../../services/extension-types.js';
import { serializeExtensionMarkdown } from '../../services/extension-markdown.js';
import { parseAgentSkillsMd } from '../../services/agentskills-parser.js';
import { apiResponse, apiError, ERROR_CODES, getErrorMessage, parseJsonBody } from '../helpers.js';
import { resolveProviderAndModel, getApiKey } from '../settings.js';
import { localProvidersRepo } from '../../db/repositories/index.js';

export const generationRoutes = new Hono();

/** Providers with native SDK support (others use OpenAI-compatible) */
const NATIVE_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'groq',
  'mistral',
  'xai',
  'together',
  'fireworks',
  'perplexity',
]);

// ============================================================================
// AI Generation Prompt
// ============================================================================

const EXTENSION_GENERATION_PROMPT = `You are an expert at generating OwnPilot User Extension manifests.

An extension is a JSON file (extension.json) that bundles tools, system prompts, and metadata into a shareable package.

## extension.json Schema

\`\`\`
{
  "id": string,           // REQUIRED. Lowercase + hyphens only (e.g. "weather-tools"). Pattern: /^[a-z0-9][a-z0-9-]*$/
  "name": string,         // REQUIRED. Human-readable name (e.g. "Weather Tools")
  "version": string,      // REQUIRED. Semver (e.g. "1.0.0")
  "description": string,  // REQUIRED. What this extension does
  "category": string,     // One of: developer, productivity, communication, data, utilities, integrations, media, lifestyle, other
  "icon": string,         // Optional emoji (e.g. "🌤️")
  "author": { "name": string },  // Optional
  "tags": string[],       // Optional search tags
  "keywords": string[],   // Optional tool-selection hint words
  "docs": string,         // Optional documentation URL

  "system_prompt": string, // Optional. Instructions injected when this extension is active. Guides the AI on WHEN and HOW to use the tools.

  "tools": [              // REQUIRED. At least 1 tool.
    {
      "name": string,         // REQUIRED. Lowercase + underscores only (e.g. "get_weather"). Pattern: /^[a-z0-9_]+$/
      "description": string,  // REQUIRED. Clear description of what this tool does
      "parameters": {         // REQUIRED. JSON Schema object
        "type": "object",
        "properties": {
          "param_name": { "type": "string|number|boolean|array|object", "description": "..." }
        },
        "required": ["param_name"]
      },
      "code": string,         // REQUIRED. JavaScript code (runs in sandbox)
      "permissions": string[],  // Optional: "network", "filesystem", "database", "system"
      "requires_approval": boolean  // Optional: require user approval before execution
    }
  ],

  "required_services": [   // Optional. External services needed (registered in Config Center)
    {
      "name": string,          // Config Center service name
      "display_name": string,  // Human-readable name
      "description": string,   // What this service is for
      "category": string,      // e.g. "search", "api", "database"
      "config_schema": [       // Fields the user needs to configure
        { "name": string, "label": string, "type": "string|secret|url|number|boolean", "required": boolean, "description": string }
      ]
    }
  ]
}
\`\`\`

## Tool Code Environment

Tool code runs in a sandboxed JavaScript environment with access to:
- \`args\` — The arguments passed to the tool (matches parameters schema)
- \`config.get(serviceName, fieldName)\` — Read config from Config Center (async, for required_services)
- \`fetch(url, options)\` — Standard fetch API (when "network" permission is granted)
- \`crypto.randomUUID()\` — Generate UUID
- \`crypto.createHash(algorithm)\` — Create hash (sha256, md5, etc.)
- \`crypto.randomBytes(size)\` — Generate random bytes
- \`utils.hash(text, algorithm)\` — Quick hash helper
- \`utils.uuid()\` — Quick UUID helper
- \`utils.base64Encode(text)\` / \`utils.base64Decode(text)\` — Base64 encoding
- \`console.log()\` — Logging (for debugging)
- Standard JavaScript (Math, Date, JSON, RegExp, URL, URLSearchParams, etc.)

NOTE: \`require()\` is NOT available. Use the built-in \`crypto\`, \`utils\`, and \`config\` objects instead.

Tool code MUST return an object: \`{ content: { ... } }\`
On error: \`{ content: { error: "message" } }\`

## Examples

### Simple utility extension (no external services):
{
  "id": "text-utilities",
  "name": "Text Utilities",
  "version": "1.0.0",
  "description": "Text manipulation tools - word count, case conversion, encoding",
  "category": "utilities",
  "icon": "📝",
  "tags": ["text", "string", "encode"],
  "system_prompt": "You have text utility tools. Use them for text manipulation tasks.",
  "tools": [
    {
      "name": "text_word_count",
      "description": "Count words, characters, and lines in text",
      "parameters": {
        "type": "object",
        "properties": {
          "text": { "type": "string", "description": "The text to analyze" }
        },
        "required": ["text"]
      },
      "code": "const text = args.text || ''; const words = text.trim().split(/\\\\s+/).filter(w => w.length > 0).length; return { content: { words, characters: text.length, lines: text.split(/\\\\n/).length } };"
    }
  ],
  "keywords": ["text", "word count", "character count"]
}

### Extension with external service:
{
  "id": "web-search",
  "name": "Web Search",
  "version": "1.0.0",
  "description": "Web search using SearXNG",
  "category": "integrations",
  "icon": "🔍",
  "tags": ["search", "web"],
  "system_prompt": "Use web_search when the user asks about current events or facts.",
  "required_services": [
    {
      "name": "searxng",
      "display_name": "SearXNG",
      "description": "SearXNG instance URL for web search",
      "category": "search",
      "config_schema": [
        { "name": "base_url", "label": "Instance URL", "type": "url", "required": true, "description": "SearXNG URL" }
      ]
    }
  ],
  "tools": [
    {
      "name": "web_search",
      "description": "Search the web. Returns results with titles, URLs, snippets.",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search query" },
          "max_results": { "type": "number", "description": "Max results (default 5)" }
        },
        "required": ["query"]
      },
      "permissions": ["network"],
      "code": "const baseUrl = await config.get('searxng', 'base_url'); if (!baseUrl) return { content: { error: 'SearXNG not configured' } }; const res = await fetch(baseUrl + '/search?q=' + encodeURIComponent(args.query) + '&format=json'); const data = await res.json(); return { content: { results: data.results.slice(0, args.max_results || 5).map(r => ({ title: r.title, url: r.url, snippet: r.content })) } };"
    }
  ],
  "keywords": ["search", "web", "google", "browse"]
}

## Rules
1. Return ONLY valid JSON. No markdown code blocks. No explanation text.
2. Every tool must have name, description, parameters, and code.
3. Tool names: lowercase with underscores only.
4. Extension ID: lowercase with hyphens only.
5. Code must be a single string (escaped properly for JSON).
6. Always include a helpful system_prompt.
7. Add relevant tags and keywords for discoverability.
8. If the extension needs an external API, define it in required_services with config_schema.
9. Include "network" in permissions for tools that make HTTP requests.
10. Make tool descriptions clear and specific — the AI uses them to decide which tool to call.`;

// ============================================================================
// Skill Generation Prompt (AgentSkills.io SKILL.md format)
// ============================================================================

const SKILL_GENERATION_PROMPT = `You are an expert at creating AgentSkills.io SKILL.md files.

A SKILL.md is a structured markdown file with YAML frontmatter that teaches an AI agent how to perform a specific task or follow a specialized workflow. Skills are instruction-based (not executable code) — they guide the agent's behavior.

## SKILL.md Structure

\`\`\`
---
name: Skill Name
description: One-line description of what this skill does
version: 1.0.0
category: developer|productivity|communication|data|utilities|integrations|media|other
tags: [tag1, tag2]
license: MIT
compatibility: Requirements or constraints (optional)
metadata:
  author: Author Name
  difficulty: beginner|intermediate|advanced
allowed-tools: [tool1, tool2]  # Optional: tools the skill is pre-approved to use
---

# Skill Name

## Overview
Brief explanation of what this skill does and when to use it.

## Instructions
Step-by-step instructions the AI should follow.

## Examples
Concrete examples showing input/output or usage patterns.

## Best Practices
Guidelines and tips for optimal results.
\`\`\`

## Example 1: Code Review Skill

\`\`\`
---
name: Code Review Assistant
description: Systematic code review with security, performance, and maintainability checks
version: 1.0.0
category: developer
tags: [code-review, quality, security]
metadata:
  difficulty: intermediate
allowed-tools: [read_file, list_files, search_web]
---

# Code Review Assistant

## Overview
Performs thorough code reviews focusing on security vulnerabilities, performance issues, and code quality.

## Instructions

### 1. Understand Context
- Read the file(s) to review
- Identify the language, framework, and patterns used

### 2. Security Check
- [ ] No hardcoded secrets or credentials
- [ ] Input validation on all user-facing inputs
- [ ] SQL queries use parameterized statements

### 3. Code Quality
- [ ] Functions are focused and under 50 lines
- [ ] Variable names are descriptive
- [ ] Error handling is comprehensive

### 4. Report Format
Provide findings as:
- **Critical**: Security vulnerabilities, data loss risks
- **Warning**: Performance issues, potential bugs
- **Info**: Style improvements, refactoring suggestions
\`\`\`

## Example 2: Writing Assistant Skill

\`\`\`
---
name: Writing Assistant
description: Helps improve written content with grammar, clarity, and tone adjustments
version: 1.0.0
category: productivity
tags: [writing, editing, grammar]
metadata:
  difficulty: beginner
---

# Writing Assistant

## Overview
Helps users improve their written content by checking grammar, enhancing clarity, and adjusting tone.

## Instructions

### 1. Analyze the Text
- Read the provided text carefully
- Identify the intended audience and purpose

### 2. Grammar & Mechanics
- Fix spelling and punctuation errors
- Ensure subject-verb agreement

### 3. Clarity & Flow
- Simplify complex sentences
- Remove redundant phrases

### 4. Present Changes
Show changes as a diff or highlight modifications clearly.
Always explain WHY a change was suggested.
\`\`\`

## Rules
1. Return ONLY the raw SKILL.md content (frontmatter + markdown body). No wrapping code blocks. No explanation text before or after.
2. The \`name\` and \`description\` fields in frontmatter are REQUIRED.
3. Use a descriptive, specific name (not generic like "My Skill").
4. Write actionable, specific instructions — not vague guidance.
5. Include checklists where verification steps are needed.
6. Add practical examples showing expected input/output patterns.
7. Choose an appropriate category from: developer, productivity, communication, data, utilities, integrations, media, other.
8. Add relevant tags for discoverability.
9. Keep instructions focused — one skill per file, not a general-purpose guide.
10. Use standard markdown formatting (headings, lists, code blocks, emphasis).`;

// ============================================================================
// Routes
// ============================================================================

/**
 * POST /generate - Generate extension manifest from description using AI
 */
generationRoutes.post('/generate', async (c) => {
  const body = (await parseJsonBody(c)) as {
    description?: string;
    format?: 'json' | 'markdown';
  } | null;

  if (
    !body?.description ||
    typeof body.description !== 'string' ||
    body.description.trim().length === 0
  ) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'description field is required' },
      400
    );
  }

  // 1. Resolve default provider/model
  const { provider, model } = await resolveProviderAndModel('default', 'default');
  if (!provider || !model) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: 'No AI provider configured. Please set up a provider in Settings.',
      },
      400
    );
  }

  // 2. Get API key
  const localProv = await localProvidersRepo.getProvider(provider);
  const apiKey = localProv ? localProv.apiKey || 'local-no-key' : await getApiKey(provider);
  if (!apiKey) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `API key not configured for provider: ${provider}`,
      },
      400
    );
  }

  // 3. Create provider
  const providerConfig = coreGetProviderConfig(provider);
  const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';

  const providerInstance = createProvider({
    provider: providerType as AIProvider,
    apiKey,
    baseUrl: providerConfig?.baseUrl,
    headers: providerConfig?.headers,
  });

  try {
    // 4. Call AI
    const result = await providerInstance.complete({
      model: { model, maxTokens: 4096, temperature: 0.7 },
      messages: [
        { role: 'system' as const, content: EXTENSION_GENERATION_PROMPT },
        { role: 'user' as const, content: body.description.trim() },
      ],
    });

    if (!result.ok) {
      return apiError(
        c,
        {
          code: ERROR_CODES.EXECUTION_ERROR,
          message: 'AI generation failed: ' + (result.error?.message || 'unknown error'),
        },
        500
      );
    }

    // 5. Parse JSON from response (handle markdown code blocks)
    const text = result.value.content;
    if (!text) {
      return apiError(
        c,
        { code: ERROR_CODES.EXECUTION_ERROR, message: 'AI returned empty response' },
        500
      );
    }

    let jsonText = text;
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1]!;
    }

    let manifest: unknown;
    try {
      manifest = JSON.parse(jsonText.trim());
    } catch {
      return apiError(
        c,
        {
          code: ERROR_CODES.EXECUTION_ERROR,
          message: 'AI returned invalid JSON. Try rephrasing your description.',
        },
        500
      );
    }

    // 6. Validate
    const validation = validateManifest(manifest);

    // 7. Optionally serialize to markdown
    if (body?.format === 'markdown' && validation.valid) {
      const markdown = serializeExtensionMarkdown(manifest as ExtensionManifest);
      return apiResponse(c, { manifest, validation, markdown });
    }

    return apiResponse(c, { manifest, validation });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.EXECUTION_ERROR,
        message: getErrorMessage(error, 'AI generation failed'),
      },
      500
    );
  }
});

/**
 * POST /generate-skill - Generate SKILL.md content from description using AI
 */
generationRoutes.post('/generate-skill', async (c) => {
  const body = (await parseJsonBody(c)) as {
    description?: string;
  } | null;

  if (
    !body?.description ||
    typeof body.description !== 'string' ||
    body.description.trim().length === 0
  ) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'description field is required' },
      400
    );
  }

  // 1. Resolve default provider/model
  const { provider, model } = await resolveProviderAndModel('default', 'default');
  if (!provider || !model) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: 'No AI provider configured. Please set up a provider in Settings.',
      },
      400
    );
  }

  // 2. Get API key
  const localProv = await localProvidersRepo.getProvider(provider);
  const apiKey = localProv ? localProv.apiKey || 'local-no-key' : await getApiKey(provider);
  if (!apiKey) {
    return apiError(
      c,
      {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `API key not configured for provider: ${provider}`,
      },
      400
    );
  }

  // 3. Create provider
  const providerConfig = coreGetProviderConfig(provider);
  const providerType = NATIVE_PROVIDERS.has(provider) ? provider : 'openai';

  const providerInstance = createProvider({
    provider: providerType as AIProvider,
    apiKey,
    baseUrl: providerConfig?.baseUrl,
    headers: providerConfig?.headers,
  });

  try {
    // 4. Call AI
    const result = await providerInstance.complete({
      model: { model, maxTokens: 4096, temperature: 0.7 },
      messages: [
        { role: 'system' as const, content: SKILL_GENERATION_PROMPT },
        { role: 'user' as const, content: body.description.trim() },
      ],
    });

    if (!result.ok) {
      return apiError(
        c,
        {
          code: ERROR_CODES.EXECUTION_ERROR,
          message: 'AI generation failed: ' + (result.error?.message || 'unknown error'),
        },
        500
      );
    }

    // 5. Extract content
    let content = result.value.content;
    if (!content) {
      return apiError(
        c,
        { code: ERROR_CODES.EXECUTION_ERROR, message: 'AI returned empty response' },
        500
      );
    }

    // Strip wrapping code blocks if AI added them
    const codeBlockMatch = content.match(/^```(?:markdown|md|yaml)?\s*\n([\s\S]*?)\n```$/);
    if (codeBlockMatch) {
      content = codeBlockMatch[1]!;
    }

    // 6. Validate by parsing
    let name = 'Generated Skill';
    const validation: { valid: boolean; errors: string[] } = { valid: true, errors: [] };

    try {
      const manifest = parseAgentSkillsMd(content);
      name = manifest.name || name;
    } catch (e) {
      validation.valid = false;
      validation.errors.push(e instanceof Error ? e.message : String(e));
    }

    return apiResponse(c, { content, name, validation });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.EXECUTION_ERROR,
        message: getErrorMessage(error, 'AI skill generation failed'),
      },
      500
    );
  }
});
