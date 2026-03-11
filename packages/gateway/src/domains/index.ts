/**
 * Domain Boundary Index
 *
 * This file documents the 6 bounded contexts in the gateway package.
 * Each domain groups related routes, services, repositories, and tools.
 * Cross-domain dependencies should go through the public API exports
 * defined in each domain's index file.
 *
 * Domains:
 *   1. agent-system   — Agent lifecycle, souls, crews, background agents, subagents, orchestra
 *   2. personal-data  — Tasks, bookmarks, notes, calendar, contacts, memories, goals, custom data
 *   3. automation      — Triggers, plans, workflows, autonomy, execution permissions
 *   4. tools-extensions — Tool executor, custom tools, extensions, skills, plugins
 *   5. channels        — Channels, bridges, edge devices, MCP, composio, browser, voice
 *   6. platform        — Settings, providers, models, config, security, workspaces, costs, dashboard
 */

// Re-export domain public APIs for cross-domain use
export { agentSystemDomain } from './agent-system.js';
export { personalDataDomain } from './personal-data.js';
export { automationDomain } from './automation.js';
export { toolsExtensionsDomain } from './tools-extensions.js';
export { channelsDomain } from './channels.js';
export { platformDomain } from './platform.js';
