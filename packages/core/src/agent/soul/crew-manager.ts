/**
 * Crew Manager
 *
 * Deploys, pauses, resumes, and disbands agent crews.
 * Uses templates to create agents with souls and heartbeat triggers.
 */

import type {
  AgentSoul,
  AgentCrew,
  CrewMember,
  CrewStatusReport,
  CrewCoordinationPattern,
  CrewStatus,
} from './types.js';
import type { IAgentCommunicationBus } from './communication.js';
import type { ISoulRepository, IHeartbeatLogRepository } from './evolution.js';
import type { IAgentMessageRepository } from './communication-bus.js';
import type { BudgetTracker } from './budget-tracker.js';
import type { Result } from '../../types/result.js';
import { getCrewTemplate } from './templates/index.js';

// ============================================================
// External repository interfaces
// ============================================================

export interface ICrewRepository {
  create(data: {
    name: string;
    description?: string;
    templateId?: string;
    coordinationPattern: CrewCoordinationPattern;
    status: CrewStatus;
  }): Promise<AgentCrew>;
  getById(id: string): Promise<AgentCrew | null>;
  list(limit: number, offset: number): Promise<AgentCrew[]>;
  count(): Promise<number>;
  addMember(crewId: string, agentId: string, role: string): Promise<void>;
  getMembers(crewId: string): Promise<CrewMember[]>;
  updateStatus(crewId: string, status: CrewStatus): Promise<void>;
}

export interface IAgentRepository {
  create(data: {
    name: string;
    type: string;
    description: string;
    systemPrompt: string;
    isActive: boolean;
  }): Promise<{ id: string }>;
  deactivate(agentId: string): Promise<void>;
}

export interface ITriggerRepository {
  create(data: {
    name: string;
    type: string;
    config: Record<string, unknown>;
    action: Record<string, unknown>;
    enabled: boolean;
  }): Promise<void>;
  disableByAgent(agentId: string): Promise<void>;
  enableByAgent(agentId: string): Promise<void>;
  deleteByAgent(agentId: string): Promise<void>;
}

// ============================================================
// Crew Manager
// ============================================================

export class CrewManager {
  constructor(
    private crewRepo: ICrewRepository,
    private soulRepo: ISoulRepository,
    private agentRepo: IAgentRepository,
    private triggerRepo: ITriggerRepository,
    private communicationBus: IAgentCommunicationBus,
    private budgetTracker: BudgetTracker,
    private heartbeatLogRepo: IHeartbeatLogRepository,
    private messageRepo: IAgentMessageRepository
  ) {}

  /**
   * Deploy a crew from a template.
   */
  async deployCrew(
    templateId: string,
    customizations?: Record<string, Partial<AgentSoul>>
  ): Promise<Result<{ crewId: string; agents: string[] }, Error>> {
    const template = getCrewTemplate(templateId);
    if (!template) {
      return { ok: false, error: new Error(`Template not found: ${templateId}`) };
    }

    // 1. Create crew record
    const crew = await this.crewRepo.create({
      name: template.name,
      description: template.description,
      templateId,
      coordinationPattern: template.coordinationPattern,
      status: 'active',
    });

    const agentIds: string[] = [];

    // 2. Create each agent with soul and trigger
    for (const tmpl of template.agents) {
      const custom = customizations?.[tmpl.identity.name];

      // Create agent config
      const agent = await this.agentRepo.create({
        name: tmpl.identity.name,
        type: 'background',
        description: tmpl.purpose.mission,
        systemPrompt: '',
        isActive: true,
      });

      // Build soul
      const soulData: Omit<AgentSoul, 'id' | 'createdAt' | 'updatedAt'> = {
        agentId: agent.id,
        identity: { ...tmpl.identity, ...custom?.identity },
        purpose: { ...tmpl.purpose, ...custom?.purpose },
        autonomy: {
          level: 3,
          allowedActions: ['search_web', 'create_note', 'read_url', 'search_memories'],
          blockedActions: ['delete_data', 'execute_code'],
          requiresApproval: ['send_message_to_user', 'publish_post'],
          maxCostPerCycle: 0.5,
          maxCostPerDay: 5.0,
          maxCostPerMonth: 100.0,
          pauseOnConsecutiveErrors: 5,
          pauseOnBudgetExceeded: true,
          notifyUserOnPause: true,
          ...custom?.autonomy,
        },
        heartbeat: {
          ...tmpl.heartbeat,
          maxDurationMs: tmpl.heartbeat.maxDurationMs ?? 120000,
          selfHealingEnabled: tmpl.heartbeat.selfHealingEnabled ?? true,
          ...custom?.heartbeat,
        },
        relationships: {
          ...tmpl.relationships,
          crewId: crew.id,
        },
        evolution: {
          version: 1,
          evolutionMode: 'supervised',
          coreTraits: [tmpl.identity.personality],
          mutableTraits: [],
          learnings: [],
          feedbackLog: [],
        },
        bootSequence: {
          onStart: [],
          onHeartbeat: ['read_inbox'],
          onMessage: [],
        },
      };

      // Create soul in DB (soulRepo handles ID generation)
      await this.soulRepo.update(soulData as AgentSoul);
      await this.crewRepo.addMember(crew.id, agent.id, 'member');

      // Create heartbeat trigger
      if (soulData.heartbeat.enabled) {
        await this.triggerRepo.create({
          name: `${soulData.identity.name} Heartbeat`,
          type: 'cron',
          config: { expression: soulData.heartbeat.interval },
          action: { type: 'run_heartbeat', agentId: agent.id },
          enabled: true,
        });
      }

      agentIds.push(agent.id);
    }

    // 3. Resolve name-based relationships to IDs
    await this.resolveRelationships(crew.id);

    return { ok: true, value: { crewId: crew.id, agents: agentIds } };
  }

  /** Pause all agents in a crew. */
  async pauseCrew(crewId: string): Promise<void> {
    const members = await this.crewRepo.getMembers(crewId);
    for (const m of members) {
      await this.soulRepo.setHeartbeatEnabled(m.agentId, false);
      await this.triggerRepo.disableByAgent(m.agentId);
    }
    await this.crewRepo.updateStatus(crewId, 'paused');
  }

  /** Resume all agents in a crew. */
  async resumeCrew(crewId: string): Promise<void> {
    const members = await this.crewRepo.getMembers(crewId);
    for (const m of members) {
      await this.soulRepo.setHeartbeatEnabled(m.agentId, true);
      await this.triggerRepo.enableByAgent(m.agentId);
    }
    await this.crewRepo.updateStatus(crewId, 'active');
  }

  /** Disband a crew: disable triggers and deactivate agents. */
  async disbandCrew(crewId: string): Promise<void> {
    const members = await this.crewRepo.getMembers(crewId);
    for (const m of members) {
      await this.triggerRepo.deleteByAgent(m.agentId);
      await this.agentRepo.deactivate(m.agentId);
    }
    await this.crewRepo.updateStatus(crewId, 'disbanded');
  }

  /** Get detailed crew status with per-agent health. */
  async getCrewStatus(crewId: string): Promise<CrewStatusReport> {
    const crew = await this.crewRepo.getById(crewId);
    if (!crew) throw new Error(`Crew not found: ${crewId}`);

    const members = await this.crewRepo.getMembers(crewId);
    const agentStatuses = await Promise.all(
      members.map(async (m) => {
        const soul = await this.soulRepo.getByAgentId(m.agentId);
        const lastHB = await this.heartbeatLogRepo.getLatest(m.agentId);
        const dailyCost = await this.budgetTracker.getDailySpend(m.agentId);
        const unread = await this.communicationBus.getUnreadCount(m.agentId);
        return {
          agentId: m.agentId,
          name: soul?.identity.name || 'Unknown',
          emoji: soul?.identity.emoji || '?',
          role: soul?.identity.role || '',
          status: soul?.heartbeat.enabled ? 'active' : 'paused',
          lastHeartbeat: lastHB?.createdAt || null,
          lastHeartbeatStatus: lastHB
            ? lastHB.tasksFailed.length > 0
              ? ('has_errors' as const)
              : ('healthy' as const)
            : ('never_run' as const),
          errorCount: lastHB?.tasksFailed.length || 0,
          costToday: dailyCost,
          unreadMessages: unread,
          soulVersion: soul?.evolution.version || 0,
        };
      })
    );

    const messagesToday = await this.messageRepo.countToday(crewId);

    return {
      crew: {
        id: crew.id,
        name: crew.name,
        status: crew.status,
        coordinationPattern: crew.coordinationPattern,
        createdAt: crew.createdAt,
      },
      agents: agentStatuses,
      messagesToday,
      totalCostToday: agentStatuses.reduce((s, a) => s + a.costToday, 0),
      totalCostMonth: await this.getCrewMonthlyCost(crewId),
    };
  }

  private async getCrewMonthlyCost(crewId: string): Promise<number> {
    const members = await this.crewRepo.getMembers(crewId);
    let total = 0;
    for (const m of members) {
      total += await this.budgetTracker.getMonthlySpend(m.agentId);
    }
    return total;
  }

  /** Resolve name-based relationship references to actual agent IDs. */
  private async resolveRelationships(crewId: string): Promise<void> {
    const members = await this.crewRepo.getMembers(crewId);
    const nameToId = new Map<string, string>();

    for (const m of members) {
      const soul = await this.soulRepo.getByAgentId(m.agentId);
      if (soul) {
        nameToId.set(soul.identity.name.toLowerCase(), m.agentId);
      }
    }

    for (const m of members) {
      const soul = await this.soulRepo.getByAgentId(m.agentId);
      if (!soul) continue;

      soul.relationships.peers = soul.relationships.peers
        .map((n) => nameToId.get(n.toLowerCase()) || n)
        .filter(Boolean);
      soul.relationships.delegates = soul.relationships.delegates
        .map((n) => nameToId.get(n.toLowerCase()) || n)
        .filter(Boolean);
      if (soul.relationships.reportsTo) {
        soul.relationships.reportsTo =
          nameToId.get(soul.relationships.reportsTo.toLowerCase()) || soul.relationships.reportsTo;
      }
      await this.soulRepo.update(soul);
    }
  }
}
