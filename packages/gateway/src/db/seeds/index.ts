/**
 * Database seeding
 *
 * Seeds default data on first startup
 */

import { agentsRepo } from '../repositories/index.js';
import { getDefaultAgents } from './default-agents.js';

/**
 * Seed default agents if none exist
 */
export function seedDefaultAgents(): number {
  // Check if any agents exist
  const existingAgents = agentsRepo.getAll();
  if (existingAgents.length > 0) {
    return 0; // Don't seed if agents already exist
  }

  // Load agents from JSON file
  const defaultAgents = getDefaultAgents();
  if (defaultAgents.length === 0) {
    console.warn('No default agents found in JSON file');
    return 0;
  }

  let seeded = 0;
  for (const agent of defaultAgents) {
    try {
      agentsRepo.create({
        id: agent.id,
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        provider: agent.provider,
        model: agent.model,
        config: agent.config,
      });
      seeded++;
    } catch (error) {
      console.error(`Failed to seed agent ${agent.id}:`, error);
    }
  }

  if (seeded > 0) {
    console.log(`Seeded ${seeded} default agents`);
  }

  return seeded;
}

/**
 * Run all seeds
 */
export function runSeeds(): void {
  seedDefaultAgents();
}
