# Skill Package Development Guide

This guide covers everything you need to create, test, and distribute OwnPilot skill packages. It is designed to be read by both humans and LLMs to generate valid `skill.json` manifests.

## What is a Skill Package?

A skill package is a self-contained bundle that adds capabilities to OwnPilot. Each package is defined by a single `skill.json` manifest file containing:

- **Tools** — Functions the AI can call (e.g., search the web, convert units, fetch data)
- **System Prompt** — Instructions that guide the AI on when and how to use the tools
- **Metadata** — Name, description, version, tags for discoverability
- **Required Services** — External API keys or service URLs needed (configured via Config Center)

Skill packages live in the `skill-packages/` directory (default: `%LOCALAPPDATA%/OwnPilot/skill-packages/` on Windows, `~/.local/share/OwnPilot/skill-packages/` on Linux/macOS). Each package gets its own subdirectory.

---

## skill.json Schema Reference

```jsonc
{
  // ── Required Fields ──────────────────────────────────────────────
  "id": "my-skill",              // Unique identifier. Lowercase + hyphens only.
                                  // Pattern: /^[a-z0-9][a-z0-9-]*$/
  "name": "My Skill",            // Human-readable display name
  "version": "1.0.0",            // Semantic version (major.minor.patch)
  "description": "What this skill does in one sentence",
  "tools": [ /* ... */ ],         // At least one tool definition (see below)

  // ── Optional Fields ──────────────────────────────────────────────
  "category": "utilities",        // One of: developer, productivity, communication,
                                  //         data, utilities, integrations, media,
                                  //         lifestyle, other
  "icon": "🔧",                  // Single emoji for visual identification
  "author": {
    "name": "Your Name",
    "email": "you@example.com"    // Optional
  },
  "tags": ["search", "web"],      // Searchable tags for discovery
  "keywords": ["google", "browse"], // Hint words for AI tool-selection prioritization
  "docs": "https://...",          // Link to external documentation
  "system_prompt": "...",         // Instructions injected when this skill is active

  "required_services": [ /* ... */ ],  // External services needed (see below)
  "triggers": [ /* ... */ ]            // Scheduled triggers (see below)
}
```

### Field Details

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique package ID. Lowercase letters, numbers, hyphens. Must start with letter or number. |
| `name` | string | Yes | Human-readable name shown in the UI. |
| `version` | string | Yes | Semantic version string (e.g., `"1.0.0"`). |
| `description` | string | Yes | Clear, concise description of what the skill does. |
| `tools` | array | Yes | At least one tool definition. |
| `category` | string | No | Categorization for filtering. See allowed values above. |
| `icon` | string | No | Single emoji character. |
| `author` | object | No | `{ name: string, email?: string }` |
| `tags` | string[] | No | Short words for search/filtering. |
| `keywords` | string[] | No | Words the AI uses to match user intent to this skill's tools. |
| `docs` | string | No | URL to documentation page. |
| `system_prompt` | string | No | Injected into the AI system prompt when the skill is enabled. |
| `required_services` | array | No | External services the skill depends on. |
| `triggers` | array | No | Scheduled or event-based triggers. |

---

## Tool Definitions

Each tool in the `tools` array has this structure:

```jsonc
{
  "name": "tool_name",              // Lowercase + underscores only: /^[a-z0-9_]+$/
  "description": "Clear description of what this tool does and when to use it",
  "parameters": {                   // JSON Schema (type: "object")
    "type": "object",
    "properties": {
      "param_name": {
        "type": "string",           // string | number | boolean | array | object
        "description": "What this parameter is for"
      }
    },
    "required": ["param_name"]      // Which parameters are mandatory
  },
  "code": "...",                    // JavaScript code (runs in sandbox)
  "permissions": ["network"],       // Optional: required sandbox permissions
  "requires_approval": false        // Optional: require user approval before execution
}
```

### Tool Name Rules

- Must match: `/^[a-z0-9_]+$/`
- Use descriptive, prefixed names: `weather_current`, `weather_forecast`
- Prefix with skill context to avoid collisions across packages

### Parameter Schema

Uses standard [JSON Schema](https://json-schema.org/) for the `"object"` type:

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query text"
    },
    "max_results": {
      "type": "number",
      "description": "Maximum results to return (default: 5)"
    },
    "include_images": {
      "type": "boolean",
      "description": "Whether to include image results"
    },
    "categories": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Filter categories"
    }
  },
  "required": ["query"]
}
```

Supported types: `string`, `number`, `integer`, `boolean`, `array`, `object`

You can use `enum` for fixed choices:
```json
{
  "operation": {
    "type": "string",
    "enum": ["add", "subtract", "multiply", "divide"],
    "description": "Math operation to perform"
  }
}
```

### Tool Description Best Practices

The AI reads tool descriptions to decide which tool to call. Write them to be:

1. **Specific** — "Search the web using SearXNG and return results with titles, URLs, and snippets" (not "Search stuff")
2. **Action-oriented** — Start with a verb: "Convert", "Fetch", "Calculate", "Generate"
3. **Include capabilities** — "Convert between length (km/mi/m/ft), weight (kg/lb), temperature (C/F/K), and data units (KB/MB/GB)"
4. **Mention trigger words** — Include words users might say: "Search the web, browse, look up, find information"

---

## Tool Code Environment

Tool code runs in a sandboxed JavaScript (Node.js) environment. The code string is the body of an async function.

### Available Globals

| Global | Description |
|--------|-------------|
| `args` | Object containing the tool arguments (matching the parameters schema) |
| `config.get(serviceName, fieldName)` | Read configuration from Config Center (async, for `required_services`) |
| `fetch(url, options)` | Standard Fetch API (requires `"network"` permission) |
| `crypto.randomUUID()` | Generate UUID |
| `crypto.createHash(algorithm)` | Create hash (sha256, md5, etc.) |
| `crypto.randomBytes(size)` | Generate random bytes |
| `utils.hash(text, algorithm?)` | Quick hash helper (default: sha256) |
| `utils.uuid()` | Quick UUID helper |
| `utils.base64Encode(text)` / `utils.base64Decode(text)` | Base64 encoding/decoding |
| `utils.slugify(text)`, `utils.camelCase(text)`, etc. | Text transform helpers |
| `utils.isEmail(v)`, `utils.isUrl(v)`, `utils.isJson(v)` | Validation helpers |
| `utils.parseJson(text)`, `utils.parseCsv(text)` | Data parsing helpers |
| `utils.callTool(name, args)` | Call a built-in tool (async, restricted) |
| `Math`, `Date`, `JSON`, `RegExp`, `Array`, `Object`, `String`, `Number`, `Boolean` | Standard JavaScript globals |
| `URLSearchParams`, `URL` | URL utilities |
| `console.log()` | Logging (for debugging) |

**Not available:** `require()`, `process`, `eval`, `Function`, `setTimeout` (blocked in sandbox)

### Return Format

Tool code **must** return an object with a `content` property:

```javascript
// Success
return { content: { result: "value", data: [...] } };

// Error
return { content: { error: "Something went wrong: reason" } };
```

The `content` object is serialized to JSON and returned to the AI. Keep responses concise and structured.

### Code Examples

**Simple computation:**
```javascript
const { x, y, operation } = args;
let result;
switch (operation) {
  case 'add': result = x + y; break;
  case 'subtract': result = x - y; break;
  case 'multiply': result = x * y; break;
  case 'divide':
    if (y === 0) return { content: { error: 'Division by zero' } };
    result = x / y;
    break;
  default:
    return { content: { error: 'Unknown operation: ' + operation } };
}
return { content: { operation, x, y, result } };
```

**Fetch from API:**
```javascript
const apiKey = await config.get('weather-api', 'api_key');
if (!apiKey) return { content: { error: 'Weather API not configured. Add your API key in Config Center.' } };

const url = `https://api.weather.com/v1/current?city=${encodeURIComponent(args.city)}&key=${apiKey}`;
try {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return { content: { error: `API error: ${res.status} ${res.statusText}` } };
  const data = await res.json();
  return {
    content: {
      city: args.city,
      temperature: data.temp,
      condition: data.condition,
      humidity: data.humidity
    }
  };
} catch (e) {
  return { content: { error: 'Request failed: ' + e.message } };
}
```

**Generate UUID:**
```javascript
const count = Math.min(args.count || 1, 100);
const uuids = [];
for (let i = 0; i < count; i++) {
  uuids.push(crypto.randomUUID());
}
return { content: { uuids, count: uuids.length } };
```

### Code as a JSON String

Since `code` is a JSON string field, you must properly escape special characters:

- Newlines: use `\n` (or write as a single line)
- Quotes: use `\"` for double quotes, or use single quotes in code
- Backslashes: use `\\`
- Template literals: use `\`` (backtick)

Single-line style (common for simpler tools):
```json
"code": "const result = args.x + args.y; return { content: { sum: result } };"
```

Multi-line style (use `\n` for readability in the JSON):
```json
"code": "const { query } = args;\nconst res = await fetch('https://api.example.com/search?q=' + encodeURIComponent(query));\nconst data = await res.json();\nreturn { content: { results: data.items } };"
```

---

## Permissions

Permissions control what sandbox capabilities are available to tool code:

| Permission | Grants Access To |
|-----------|-----------------|
| `network` | `fetch()` for HTTP requests |
| `filesystem` | File system operations |
| `database` | Database queries |
| `system` | System-level operations |

Only request permissions your tool actually needs. Tools without `"network"` permission cannot make HTTP requests. Most utility tools (text manipulation, math) need no permissions at all.

---

## System Prompt Guidelines

The `system_prompt` field is injected into the AI's system prompt when the skill is enabled. It should:

1. **Tell the AI what tools are available** and when to use them
2. **Provide usage guidance** — e.g., "Use web_search for current events, web_fetch to read specific pages"
3. **Set expectations** — e.g., "Always cite sources from search results"
4. **Be concise** — Keep it under 200 words

Example:
```
You have web search tools available. Use web_search when the user asks about current events, recent information, or facts you're not confident about. Use web_fetch to retrieve and read the content of specific URLs. Always include source URLs in your responses when using search results.
```

---

## Required Services (Config Center Integration)

If your skill needs external API keys or service URLs, declare them in `required_services`. Users configure these in the Config Center UI.

```json
"required_services": [
  {
    "name": "my-api",                    // Config Center service name (unique)
    "display_name": "My API Service",    // Human-readable name
    "description": "API key for the My API service",
    "category": "api",                   // Category in Config Center
    "config_schema": [
      {
        "name": "api_key",              // Field name used in config.get()
        "label": "API Key",             // Label shown in UI
        "type": "secret",              // Input type (see below)
        "required": true,
        "description": "Your API key from dashboard.myapi.com"
      },
      {
        "name": "base_url",
        "label": "Base URL",
        "type": "url",
        "required": false,
        "description": "Custom API endpoint (default: https://api.myapi.com)"
      }
    ]
  }
]
```

### Config Schema Field Types

| Type | UI Input | Use For |
|------|----------|---------|
| `string` | Text input | General text values |
| `secret` | Password input (masked) | API keys, tokens, passwords |
| `url` | URL input | Service endpoints |
| `number` | Number input | Numeric settings |
| `boolean` | Checkbox/toggle | Feature flags |

### Reading Config in Tool Code

```javascript
const apiKey = await config.get('my-api', 'api_key');
if (!apiKey) {
  return { content: { error: 'My API not configured. Add your API key in Settings > Config Center.' } };
}
// Use apiKey in fetch calls...
```

The first argument is the service `name`, the second is the field `name` from `config_schema`.

---

## Triggers (Optional)

Triggers let skills run actions on a schedule or in response to events:

```json
"triggers": [
  {
    "name": "daily-report",
    "type": "cron",
    "config": {
      "cron": "0 9 * * *"       // Every day at 9 AM
    },
    "action": {
      "type": "prompt",
      "prompt": "Generate today's summary report using the report_generate tool"
    },
    "enabled": true
  }
]
```

Trigger types:
- `cron` — Standard cron expression schedule
- `interval` — Run every N minutes/hours
- `event` — React to system events

---

## Complete Example: Weather Skill

Here's a complete `skill.json` for a weather skill:

```json
{
  "id": "weather-tools",
  "name": "Weather Tools",
  "version": "1.0.0",
  "description": "Get current weather and forecasts for any city worldwide",
  "category": "utilities",
  "icon": "\u26c5",
  "author": { "name": "OwnPilot Community" },
  "tags": ["weather", "forecast", "temperature"],

  "system_prompt": "You have weather tools. Use weather_current when the user asks about current weather conditions. Use weather_forecast for multi-day forecasts. Always mention the data source.",

  "required_services": [
    {
      "name": "openweather",
      "display_name": "OpenWeatherMap",
      "description": "Free weather API (get key at openweathermap.org)",
      "category": "api",
      "config_schema": [
        {
          "name": "api_key",
          "label": "API Key",
          "type": "secret",
          "required": true,
          "description": "Your OpenWeatherMap API key"
        }
      ]
    }
  ],

  "tools": [
    {
      "name": "weather_current",
      "description": "Get current weather for a city. Returns temperature, conditions, humidity, and wind.",
      "parameters": {
        "type": "object",
        "properties": {
          "city": {
            "type": "string",
            "description": "City name (e.g., 'London', 'Istanbul', 'New York')"
          },
          "units": {
            "type": "string",
            "enum": ["metric", "imperial"],
            "description": "Temperature units: metric (Celsius) or imperial (Fahrenheit). Default: metric"
          }
        },
        "required": ["city"]
      },
      "permissions": ["network"],
      "code": "const apiKey = await config.get('openweather', 'api_key'); if (!apiKey) return { content: { error: 'OpenWeatherMap not configured. Add your API key in Config Center.' } }; const units = args.units || 'metric'; const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(args.city)}&units=${units}&appid=${apiKey}`; try { const res = await fetch(url); if (!res.ok) return { content: { error: `Weather API error: ${res.status}` } }; const d = await res.json(); return { content: { city: d.name, country: d.sys.country, temperature: d.main.temp, feels_like: d.main.feels_like, condition: d.weather[0].description, humidity: d.main.humidity, wind_speed: d.wind.speed, units } }; } catch (e) { return { content: { error: 'Request failed: ' + e.message } }; }"
    },
    {
      "name": "weather_forecast",
      "description": "Get 5-day weather forecast for a city. Returns daily temperature highs/lows and conditions.",
      "parameters": {
        "type": "object",
        "properties": {
          "city": {
            "type": "string",
            "description": "City name"
          },
          "days": {
            "type": "number",
            "description": "Number of days (1-5, default: 3)"
          }
        },
        "required": ["city"]
      },
      "permissions": ["network"],
      "code": "const apiKey = await config.get('openweather', 'api_key'); if (!apiKey) return { content: { error: 'OpenWeatherMap not configured.' } }; const url = `https://api.openweathermap.org/data/2.5/forecast?q=${encodeURIComponent(args.city)}&units=metric&appid=${apiKey}`; try { const res = await fetch(url); if (!res.ok) return { content: { error: `API error: ${res.status}` } }; const d = await res.json(); const days = Math.min(args.days || 3, 5); const daily = {}; d.list.forEach(item => { const date = item.dt_txt.split(' ')[0]; if (!daily[date]) daily[date] = { temps: [], conditions: [] }; daily[date].temps.push(item.main.temp); daily[date].conditions.push(item.weather[0].description); }); const forecast = Object.entries(daily).slice(0, days).map(([date, data]) => ({ date, high: Math.round(Math.max(...data.temps)), low: Math.round(Math.min(...data.temps)), condition: data.conditions[Math.floor(data.conditions.length / 2)] })); return { content: { city: d.city.name, country: d.city.country, forecast } }; } catch (e) { return { content: { error: 'Request failed: ' + e.message } }; }"
    }
  ],

  "keywords": ["weather", "temperature", "forecast", "rain", "sunny", "cloudy", "wind", "humidity"]
}
```

---

## Directory Structure

```
skill-packages/
  weather-tools/
    skill.json          ← The manifest file
  web-search/
    skill.json
  math-helper/
    skill.json
```

Each package gets its own directory named after its `id`. The manifest must be named `skill.json`.

---

## Installation Methods

1. **UI Wizard**: Settings > Skill Packages > Create — describe what you want and let AI generate it, or fill in the form manually
2. **JSON Install**: Settings > Skill Packages > Install > paste `skill.json` content
3. **File Path Install**: Settings > Skill Packages > Install > enter path to `skill.json` on server
4. **Directory Scan**: Settings > Skill Packages > Scan — discovers all `skill.json` files in the skill-packages directory
5. **API**:
   - `POST /api/v1/skill-packages` — Install from inline JSON manifest
   - `POST /api/v1/skill-packages/install` — Install from file path
   - `POST /api/v1/skill-packages/scan` — Scan directory

---

## Validation Rules

The following rules are enforced when installing a skill package:

1. `id` must match `/^[a-z0-9][a-z0-9-]*$/`
2. `name` must be a non-empty string
3. `version` must be a non-empty string (semver recommended)
4. `description` must be a non-empty string
5. `tools` must be an array with at least one entry
6. Each tool must have `name`, `description`, `parameters`, and `code`
7. Tool `name` must match `/^[a-z0-9_]+$/`
8. Tool `parameters` must have `type: "object"`
9. `category` (if provided) must be one of the allowed values
10. `required_services` config_schema entries need `name`, `label`, `type`

---

## Tips for LLMs Generating skill.json

If you are an LLM generating a skill.json manifest:

1. **Return ONLY valid JSON** — no markdown code blocks, no explanation text, just the raw JSON object
2. **Every tool must have**: `name`, `description`, `parameters`, and `code`
3. **Tool names**: lowercase with underscores only (`get_weather`, not `getWeather`)
4. **Skill ID**: lowercase with hyphens only (`weather-tools`, not `WeatherTools`)
5. **Code must be a single JSON string** — escape all special characters properly
6. **Always include a `system_prompt`** — guide the AI on when/how to use the tools
7. **Add relevant `tags` and `keywords`** — helps with discoverability and tool selection
8. **If the skill needs an external API**, define it in `required_services` with `config_schema`
9. **Include `"network"` in `permissions`** for any tool that makes HTTP requests
10. **Make tool descriptions clear and specific** — the AI uses them to decide which tool to call
11. **Handle errors gracefully** — always return `{ content: { error: "message" } }` on failure
12. **Use `config.get()` for secrets** — never hardcode API keys in tool code
13. **Set timeouts on fetch calls** — use `AbortSignal.timeout(10000)` to prevent hanging
14. **Validate inputs** — check for missing or invalid arguments before processing
