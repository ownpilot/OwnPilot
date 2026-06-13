/**
 * Artifact Service (Gateway Implementation)
 *
 * Implements IArtifactService using ArtifactsRepository for CRUD
 * and ArtifactDataResolver for data binding refresh.
 * Broadcasts data:changed events via WS on mutations.
 */

import { getLog } from '@ownpilot/core/services';
import type {
  IArtifactService,
  Artifact,
  ArtifactVersion,
  CreateArtifactInput,
  UpdateArtifactInput,
  ArtifactQuery,
} from '@ownpilot/core';
import { ArtifactsRepository } from '../../db/repositories/artifacts.js';
import { resolveAllBindings } from './data-resolver.js';
import { wsGateway } from '../../ws/server.js';

const log = getLog('ArtifactService');

class ArtifactServiceImpl implements IArtifactService {
  private getRepo(userId: string): ArtifactsRepository {
    return new ArtifactsRepository(userId);
  }

  async createArtifact(userId: string, input: CreateArtifactInput): Promise<Artifact> {
    const repo = this.getRepo(userId);
    const artifact = await repo.create(input);
    log.info(`Created artifact ${artifact.id} (${artifact.type}) for user ${userId}`);
    this.broadcast('created', artifact.id);
    return artifact;
  }

  async getArtifact(userId: string, id: string): Promise<Artifact | null> {
    return this.getRepo(userId).getById(id);
  }

  async updateArtifact(
    userId: string,
    id: string,
    input: UpdateArtifactInput
  ): Promise<Artifact | null> {
    const repo = this.getRepo(userId);
    const artifact = await repo.update(id, input);
    if (artifact) {
      log.info(`Updated artifact ${id} (v${artifact.version})`);
      this.broadcast('updated', id);
    }
    return artifact;
  }

  async deleteArtifact(userId: string, id: string): Promise<boolean> {
    const deleted = await this.getRepo(userId).delete(id);
    if (deleted) {
      log.info(`Deleted artifact ${id}`);
      this.broadcast('deleted', id);
    }
    return deleted;
  }

  async listArtifacts(
    userId: string,
    query?: ArtifactQuery
  ): Promise<{ artifacts: Artifact[]; total: number }> {
    return this.getRepo(userId).list(query);
  }

  async togglePin(userId: string, id: string): Promise<Artifact | null> {
    const artifact = await this.getRepo(userId).togglePin(id);
    if (artifact) {
      log.info(`Toggled pin for artifact ${id} -> ${artifact.pinned}`);
      this.broadcast('updated', id);
    }
    return artifact;
  }

  async refreshBindings(userId: string, id: string): Promise<Artifact | null> {
    const repo = this.getRepo(userId);
    const artifact = await repo.getById(id);
    if (!artifact) return null;

    if (artifact.dataBindings.length === 0) return artifact;

    const updatedBindings = await resolveAllBindings(userId, artifact.dataBindings);
    await repo.updateBindings(id, updatedBindings);

    return repo.getById(id);
  }

  async getVersions(userId: string, artifactId: string): Promise<ArtifactVersion[]> {
    return this.getRepo(userId).getVersions(artifactId);
  }

  private broadcast(action: 'created' | 'updated' | 'deleted', id: string): void {
    try {
      wsGateway.broadcast('data:changed', { entity: 'artifact', action, id });
    } catch {
      // WS not initialized yet (e.g. during tests)
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let _service: ArtifactServiceImpl | null = null;

export function getArtifactService(): ArtifactServiceImpl {
  if (!_service) {
    _service = new ArtifactServiceImpl();
  }
  return _service;
}
