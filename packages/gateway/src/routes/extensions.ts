/**
 * Extensions Routes
 *
 * API for installing, managing, and inspecting extensions.
 */

import { Hono } from 'hono';
import {
  createProvider,
  getProviderConfig as coreGetProviderConfig,
  type AIProvider,
} from '@ownpilot/core';
import { getExtensionService, ExtensionError } from '../services/extension-service.js';
import { validateManifest, type ExtensionManifest } from '../services/extension-types.js';
import { serializeExtensionMarkdown } from '../services/extension-markdown.js';
import {
  getUserId,
  apiResponse,
  apiError,
  ERROR_CODES,
  notFoundError,
  getErrorMessage,
} from './helpers.js';
import { resolveProviderAndModel, getApiKey } from './settings.js';
import { localProvidersRepo } from '../db/repositories/index.js';
import { wsGateway } from '../ws/server.js';

export const extensionsRoutes = new Hono();

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
// Routes
// ============================================================================

/**
 * GET / - List extensions
 */
extensionsRoutes.get('/', async (c) => {
  const userId = getUserId(c);
  const status = c.req.query('status');
  const category = c.req.query('category');
  const format = c.req.query('format'); // 'ownpilot' | 'agentskills'

  const service = getExtensionService();
  let packages = service.getAll().filter((p) => p.userId === userId);

  if (format) {
    packages = packages.filter((p) => (p.manifest.format ?? 'ownpilot') === format);
  }
  if (status) {
    packages = packages.filter((p) => p.status === status);
  }
  if (category) {
    packages = packages.filter((p) => p.category === category);
  }

  return apiResponse(c, { packages, total: packages.length });
});

/**
 * POST / - Install from inline manifest
 */
extensionsRoutes.post('/', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body || !(body as { manifest?: unknown }).manifest) {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'manifest field is required' },
      400
    );
  }

  try {
    const service = getExtensionService();
    const record = await service.installFromManifest(
      (body as { manifest: unknown }).manifest as never,
      userId
    );
    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'created', id: record.id });
    return apiResponse(c, { package: record, message: 'Extension installed successfully.' }, 201);
  } catch (error) {
    if (error instanceof ExtensionError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(
      c,
      {
        code: ERROR_CODES.CREATE_FAILED,
        message: getErrorMessage(error, 'Failed to install extension'),
      },
      500
    );
  }
});

/**
 * POST /install - Install from file path
 */
extensionsRoutes.post('/install', async (c) => {
  const userId = getUserId(c);
  const body = await c.req.json().catch(() => null);

  if (!body || typeof (body as { path?: string }).path !== 'string') {
    return apiError(
      c,
      { code: ERROR_CODES.VALIDATION_ERROR, message: 'path field is required (string)' },
      400
    );
  }

  try {
    const service = getExtensionService();
    const record = await service.install((body as { path: string }).path, userId);
    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'created', id: record.id });
    return apiResponse(c, { package: record, message: 'Extension installed successfully.' }, 201);
  } catch (error) {
    if (error instanceof ExtensionError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(
      c,
      {
        code: ERROR_CODES.CREATE_FAILED,
        message: getErrorMessage(error, 'Failed to install extension'),
      },
      500
    );
  }
});

/**
 * POST /scan - Scan directory for packages
 */
extensionsRoutes.post('/scan', async (c) => {
  const userId = getUserId(c);
  const body = (await c.req.json().catch(() => ({}))) as { directory?: string };

  try {
    const service = getExtensionService();
    const result = await service.scanDirectory(body.directory, userId);
    return apiResponse(c, result);
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.EXECUTION_ERROR,
        message: getErrorMessage(error, 'Failed to scan directory'),
      },
      500
    );
  }
});

/**
 * POST /generate - Generate extension manifest from description using AI
 */
extensionsRoutes.post('/generate', async (c) => {
  const body = (await c.req.json().catch(() => null)) as {
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
 * GET /:id - Get package details
 */
extensionsRoutes.get('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getExtensionService();
  const pkg = service.getById(id);

  if (!pkg || pkg.userId !== userId) {
    return notFoundError(c, 'Extension', id);
  }

  return apiResponse(c, { package: pkg });
});

/**
 * DELETE /:id - Uninstall package
 */
extensionsRoutes.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getExtensionService();
  const deleted = await service.uninstall(id, userId);

  if (!deleted) {
    return notFoundError(c, 'Extension', id);
  }

  wsGateway.broadcast('data:changed', { entity: 'extension', action: 'deleted', id });
  return apiResponse(c, { message: 'Extension uninstalled successfully.' });
});

/**
 * POST /:id/enable - Enable package + triggers
 */
extensionsRoutes.post('/:id/enable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const service = getExtensionService();
    const pkg = await service.enable(id, userId);

    if (!pkg) {
      return notFoundError(c, 'Extension', id);
    }

    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'updated', id });
    return apiResponse(c, { package: pkg, message: 'Extension enabled.' });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.UPDATE_FAILED,
        message: getErrorMessage(error, 'Failed to enable extension'),
      },
      500
    );
  }
});

/**
 * POST /:id/disable - Disable package + triggers
 */
extensionsRoutes.post('/:id/disable', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const service = getExtensionService();
    const pkg = await service.disable(id, userId);

    if (!pkg) {
      return notFoundError(c, 'Extension', id);
    }

    wsGateway.broadcast('data:changed', { entity: 'extension', action: 'updated', id });
    return apiResponse(c, { package: pkg, message: 'Extension disabled.' });
  } catch (error) {
    return apiError(
      c,
      {
        code: ERROR_CODES.UPDATE_FAILED,
        message: getErrorMessage(error, 'Failed to disable extension'),
      },
      500
    );
  }
});

/**
 * POST /:id/reload - Reload manifest from disk
 */
extensionsRoutes.post('/:id/reload', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  try {
    const service = getExtensionService();
    const pkg = await service.reload(id, userId);

    if (!pkg) {
      return notFoundError(c, 'Extension', id);
    }

    return apiResponse(c, { package: pkg, message: 'Extension reloaded.' });
  } catch (error) {
    if (error instanceof ExtensionError) {
      return apiError(c, { code: error.code, message: error.message }, 400);
    }
    return apiError(
      c,
      {
        code: ERROR_CODES.UPDATE_FAILED,
        message: getErrorMessage(error, 'Failed to reload extension'),
      },
      500
    );
  }
});
