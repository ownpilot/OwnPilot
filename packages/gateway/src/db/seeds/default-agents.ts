/**
 * Default agents loader
 *
 * Loads agent configurations from JSON file.
 * Data is separated from code for easy modification.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { getLog } from '../../services/log.js';

const log = getLog('AgentSeed');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to JSON data file
const DATA_FILE = path.join(__dirname, '..', '..', '..', 'data', 'seeds', 'default-agents.json');

export interface AgentSeed {
  id: string;
  name: string;
  systemPrompt: string;
  provider: string;
  model: string;
  config: {
    maxTokens: number;
    temperature: number;
    maxTurns: number;
    maxToolCalls: number;
    tools?: string[];
    toolGroups?: string[];
  };
}

interface AgentJsonData {
  id: string;
  name: string;
  emoji?: string;
  category: string;
  systemPrompt: string;
  tools?: string[];
  toolGroups?: string[];
  dataAccess?: string[];
  triggers?: {
    keywords: string[];
    description: string;
  };
  config: {
    maxTokens: number;
    temperature: number;
    maxTurns: number;
    maxToolCalls: number;
  };
}

interface AgentsJson {
  version: string;
  agents: AgentJsonData[];
}

/**
 * Load default agents from JSON file
 */
export function loadDefaultAgents(): AgentSeed[] {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      log.warn(`Default agents file not found: ${DATA_FILE}`);
      return [];
    }

    const content = fs.readFileSync(DATA_FILE, 'utf-8');
    const data: AgentsJson = JSON.parse(content);

    return data.agents.map((agent) => ({
      id: agent.id,
      name: agent.emoji ? `${agent.emoji} ${agent.name}` : agent.name,
      systemPrompt: agent.systemPrompt,
      provider: 'default', // Always use default - resolved at runtime
      model: 'default', // Always use default - resolved at runtime
      config: {
        ...agent.config,
        tools: agent.tools,
        toolGroups: agent.toolGroups,
      },
    }));
  } catch (error) {
    log.error('Failed to load default agents:', error);
    return [];
  }
}

// Lazy-loaded default agents
let _cachedAgents: AgentSeed[] | null = null;

/**
 * Get default agents (cached)
 */
export function getDefaultAgents(): AgentSeed[] {
  if (_cachedAgents === null) {
    _cachedAgents = loadDefaultAgents();
  }
  return _cachedAgents;
}

// Export as DEFAULT_AGENTS for backward compatibility
// This getter ensures lazy loading
export const DEFAULT_AGENTS: AgentSeed[] = new Proxy([] as AgentSeed[], {
  get(_target, prop) {
    const agents = getDefaultAgents();
    if (prop === 'length') return agents.length;
    if (prop === Symbol.iterator) return agents[Symbol.iterator].bind(agents);
    if (typeof prop === 'string' && !Number.isNaN(Number(prop))) {
      return agents[Number(prop)];
    }
    // @ts-expect-error - proxy handler
    return agents[prop]?.bind?.(agents) ?? agents[prop];
  },
});
