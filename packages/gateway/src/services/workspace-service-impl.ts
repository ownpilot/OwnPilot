/**
 * WorkspaceService Implementation
 *
 * Wraps the existing WorkspaceManager to provide IWorkspaceService interface.
 * Maps gateway Workspace to core WorkspaceInfo DTO.
 *
 * Usage:
 *   const workspaces = registry.get(Services.Workspace);
 *   const ws = workspaces.create({ name: 'My Workspace' });
 *   workspaces.associateChannel(ws.id, 'channel-1');
 */

import type {
  IWorkspaceService,
  WorkspaceInfo,
  CreateWorkspaceInput,
  WorkspaceAgentInput,
} from '@ownpilot/core';
import type { Workspace } from '../workspace/types.js';
import { workspaceManager } from '../workspace/manager.js';

// ============================================================================
// Type Mapping
// ============================================================================

function toWorkspaceInfo(ws: Workspace): WorkspaceInfo {
  return {
    id: ws.config.id,
    name: ws.config.name,
    description: ws.config.description,
    userId: ws.config.userId,
    channels: [...(ws.config.channels ?? [])],
    state: ws.state,
    conversationId: ws.conversationId,
    createdAt: ws.createdAt,
    lastActivityAt: ws.lastActivityAt,
  };
}

// ============================================================================
// WorkspaceServiceImpl Adapter
// ============================================================================

export class WorkspaceServiceImpl implements IWorkspaceService {
  private get manager() {
    return workspaceManager;
  }

  create(config: CreateWorkspaceInput): WorkspaceInfo {
    const ws = this.manager.create({
      name: config.name,
      id: config.id,
      description: config.description,
      userId: config.userId,
      channels: config.channels,
      agent: config.agent
        ? {
            provider: config.agent.provider ?? 'openai',
            model: config.agent.model ?? 'gpt-4.1',
            systemPrompt: config.agent.systemPrompt,
            temperature: config.agent.temperature,
            maxTokens: config.agent.maxTokens,
            tools: config.agent.tools,
          }
        : undefined,
      settings: config.settings,
    });
    return toWorkspaceInfo(ws);
  }

  get(id: string): WorkspaceInfo | undefined {
    const ws = this.manager.get(id);
    return ws ? toWorkspaceInfo(ws) : undefined;
  }

  getByChannel(channelId: string): WorkspaceInfo | undefined {
    const ws = this.manager.getByChannel(channelId);
    return ws ? toWorkspaceInfo(ws) : undefined;
  }

  getDefault(): WorkspaceInfo | undefined {
    const ws = this.manager.getDefault();
    return ws ? toWorkspaceInfo(ws) : undefined;
  }

  getOrCreateDefault(): WorkspaceInfo {
    const ws = this.manager.getOrCreateDefault();
    return toWorkspaceInfo(ws);
  }

  setDefault(id: string): void {
    this.manager.setDefault(id);
  }

  delete(id: string): boolean {
    return this.manager.delete(id);
  }

  getAll(): WorkspaceInfo[] {
    return this.manager.getAll().map(toWorkspaceInfo);
  }

  associateChannel(workspaceId: string, channelId: string): void {
    this.manager.associateChannel(workspaceId, channelId);
  }

  disassociateChannel(channelId: string): void {
    this.manager.disassociateChannel(channelId);
  }

  updateAgentConfig(workspaceId: string, agentConfig: WorkspaceAgentInput): void {
    this.manager.updateAgentConfig(workspaceId, agentConfig);
  }

  getCount(): number {
    return this.manager.count;
  }
}

/**
 * Create a new WorkspaceServiceImpl instance.
 */
export function createWorkspaceServiceImpl(): IWorkspaceService {
  return new WorkspaceServiceImpl();
}
