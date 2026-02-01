/**
 * Database seeding
 *
 * Seeds default data on first startup
 */

import { agentsRepo } from '../repositories/index.js';
import { getDefaultAgents } from './default-agents.js';
import { getLog } from '../../services/log.js';

const log = getLog('DbSeeds');

/**
 * Seed default agents if none exist
 */
export async function seedDefaultAgents(): Promise<number> {
  // Check if any agents exist
  const existingAgents = await agentsRepo.getAll();
  if (existingAgents.length > 0) {
    return 0; // Don't seed if agents already exist
  }

  // Load agents from JSON file
  const defaultAgents = getDefaultAgents();
  if (defaultAgents.length === 0) {
    log.warn('No default agents found in JSON file');
    return 0;
  }

  let seeded = 0;
  for (const agent of defaultAgents) {
    try {
      await agentsRepo.create({
        id: agent.id,
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        provider: agent.provider,
        model: agent.model,
        config: agent.config,
      });
      seeded++;
    } catch (error) {
      log.error(`Failed to seed agent ${agent.id}:`, error);
    }
  }

  if (seeded > 0) {
    log.info(`Seeded ${seeded} default agents`);
  }

  return seeded;
}

/**
 * Run all seeds
 */
export function runSeeds(): void {
  seedDefaultAgents();
}
