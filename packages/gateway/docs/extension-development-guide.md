# User Extension Development Guide

Create, test, and distribute OwnPilot User Extensions — shareable bundles of tools, prompts, and triggers.

## What is a User Extension?

A User Extension is a self-contained bundle that adds capabilities to OwnPilot:

- **Tools** — JavaScript functions the AI can call (sandboxed)
- **System Prompt** — Instructions guiding the AI
- **Triggers** — Scheduled/event-driven automation
- **Required Services** — External API keys (Config Center)

Extensions live in `extensions/` directory (default: `%LOCALAPPDATA%/OwnPilot/extensions/`).

## extension.json Schema

```jsonc
{
  "id": "my-extension", // REQUIRED. lowercase + hyphens
  "name": "My Extension", // REQUIRED. Human-readable
  "version": "1.0.0", // REQUIRED. Semver
  "description": "What it does", // REQUIRED.
  "category": "utilities", // developer|productivity|communication|data|utilities|integrations|media|lifestyle|other
  "icon": "🔧",
  "tags": ["tag1", "tag2"],
  "system_prompt": "Instructions for the AI...",
  "tools": [
    {
      "name": "my_tool",
      "description": "What this tool does",
      "parameters": {
        "type": "object",
        "properties": { "input": { "type": "string" } },
        "required": ["input"],
      },
      "code": "return { content: { result: args.input.toUpperCase() } };",
      "permissions": ["network"],
      "requires_approval": false,
    },
  ],
  "required_services": [
    {
      "name": "my_api",
      "display_name": "My API",
      "config_schema": [
        { "name": "api_key", "label": "API Key", "type": "secret", "required": true },
      ],
    },
  ],
}
```

## Tool Code Environment

```javascript
args; // Arguments from caller
config.get(serviceName, field); // Read Config Center (async)
fetch(url, options); // HTTP (needs "network" permission)
crypto.randomUUID(); // UUID
utils.hash(text, algo); // Hash helper
console.log(); // Debug logging
// Return: { content: { ... } }
// Error:  { content: { error: "message" } }
```

## API Endpoints

```
GET    /api/v1/extensions              List all
POST   /api/v1/extensions              Install from JSON
POST   /api/v1/extensions/install      Install from file path
POST   /api/v1/extensions/scan         Scan directory
POST   /api/v1/extensions/generate     AI-generate manifest
GET    /api/v1/extensions/:id          Get details
DELETE /api/v1/extensions/:id          Uninstall
POST   /api/v1/extensions/:id/enable   Enable
POST   /api/v1/extensions/:id/disable  Disable
POST   /api/v1/extensions/:id/reload   Reload from disk
```

## AI Tool Names

- `list_extensions` — List installed extensions
- `toggle_extension` — Enable/disable
- `get_extension_info` — View details

---

# AgentSkills.io Skills

OwnPilot also supports the AgentSkills.io open standard — instruction-based knowledge packages.

## SKILL.md Format

```markdown
---
name: my-skill
description: What this skill does and when to use it.
license: MIT
---

# My Skill

Instructions for the AI agent...
```

Skills use `SKILL.md` (uppercase) and are stored in `skills/` directory.

## Differences

|           | User Extensions     | Skills (AgentSkills.io)       |
| --------- | ------------------- | ----------------------------- |
| Format    | extension.json      | SKILL.md                      |
| Content   | Executable JS tools | Instructions + knowledge      |
| Execution | Sandbox JS code     | Agent uses existing tools     |
| Standard  | OwnPilot native     | Open standard (25+ platforms) |
