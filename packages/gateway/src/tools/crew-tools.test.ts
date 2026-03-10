/**
 * Crew Tools Tests
 *
 * Tests the crew coordination tools for agent communication:
 * - get_crew_members: list crew members with roles
 * - delegate_task: send structured task to another agent
 * - broadcast_to_crew: message all crew members
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock heartbeat context
const mockGetHeartbeatContext = vi.fn();
vi.mock('../services/heartbeat-context.js', () => ({
  getHeartbeatContext: mockGetHeartbeatContext,
}));

// Mock repositories
const mockCrewRepo = {
  getById: vi.fn(),
  getMembers: vi.fn(),
};

const mockSoulsRepo = {
  getByAgentId: vi.fn(),
};

const mockMessagesRepo = {
  create: vi.fn(),
};

vi.mock('../db/repositories/crews.js', () => ({
  getCrewsRepository: vi.fn().mockReturnValue(mockCrewRepo),
}));

vi.mock('../db/repositories/souls.js', () => ({
  getSoulsRepository: vi.fn().mockReturnValue(mockSoulsRepo),
}));

vi.mock('../db/repositories/agent-messages.js', () => ({
  getAgentMessagesRepository: vi.fn().mockReturnValue(mockMessagesRepo),
}));

// Mock core functions
vi.mock('@ownpilot/core', async () => {
  const actual = await vi.importActual<typeof import('@ownpilot/core')>('@ownpilot/core');
  return {
    ...actual,
    generateId: vi.fn().mockReturnValue('test-id-123'),
  };
});

// Mock soul-heartbeat-service
const mockBroadcast = vi.fn();
const mockGetCommunicationBus = vi.fn().mockReturnValue({
  broadcast: mockBroadcast,
});

vi.mock('../services/soul-heartbeat-service.js', () => ({
  getCommunicationBus: mockGetCommunicationBus,
}));

// Import after mocks
const { CREW_TOOLS, CREW_TOOL_NAMES, executeCrewTool } = await import('./crew-tools.js');

describe('crew-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetHeartbeatContext.mockReturnValue({
      agentId: 'agent_test_abc',
      crewId: 'crew_123',
    });
  });

  describe('CREW_TOOLS definitions', () => {
    it('exports three crew tools', () => {
      expect(CREW_TOOLS).toHaveLength(3);
      expect(CREW_TOOL_NAMES).toEqual(['get_crew_members', 'delegate_task', 'broadcast_to_crew']);
    });

    it('defines get_crew_members tool', () => {
      const tool = CREW_TOOLS.find((t) => t.name === 'get_crew_members');
      expect(tool).toBeDefined();
      expect(tool?.category).toBe('agent_communication');
      expect(tool?.parameters.required).toEqual([]);
    });

    it('defines delegate_task tool with all parameters', () => {
      const tool = CREW_TOOLS.find((t) => t.name === 'delegate_task');
      expect(tool).toBeDefined();
      expect(tool?.category).toBe('agent_communication');
      expect(tool?.parameters.required).toEqual(['to_agent', 'task_name', 'task_description']);
      expect(tool?.parameters.properties).toHaveProperty('to_agent');
      expect(tool?.parameters.properties).toHaveProperty('task_name');
      expect(tool?.parameters.properties).toHaveProperty('task_description');
      expect(tool?.parameters.properties).toHaveProperty('context');
      expect(tool?.parameters.properties).toHaveProperty('expected_output');
      expect(tool?.parameters.properties).toHaveProperty('priority');
      expect(tool?.parameters.properties).toHaveProperty('deadline_hours');
    });

    it('defines broadcast_to_crew tool with message types', () => {
      const tool = CREW_TOOLS.find((t) => t.name === 'broadcast_to_crew');
      expect(tool).toBeDefined();
      expect(tool?.category).toBe('agent_communication');
      expect(tool?.parameters.required).toEqual(['type', 'subject', 'content']);
      expect(tool?.parameters.properties.type?.enum).toEqual([
        'knowledge_share',
        'alert',
        'status_update',
        'coordination',
      ]);
    });
  });

  describe('get_crew_members', () => {
    it('returns error when not in a crew', async () => {
      mockGetHeartbeatContext.mockReturnValue({ agentId: 'agent_123' });

      const result = await executeCrewTool('get_crew_members', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('not currently part of a crew');
    });

    it('returns error when crew not found', async () => {
      mockCrewRepo.getById.mockResolvedValue(null);
      mockCrewRepo.getMembers.mockResolvedValue([]);

      const result = await executeCrewTool('get_crew_members', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Crew not found');
    });

    it('returns crew info with member details', async () => {
      const mockCrew = {
        id: 'crew_123',
        name: 'Test Crew',
        coordinationPattern: 'hierarchical',
        status: 'active',
      };
      const mockMembers = [
        { agentId: 'agent_1', role: 'leader' },
        { agentId: 'agent_2', role: 'worker' },
      ];

      mockCrewRepo.getById.mockResolvedValue(mockCrew);
      mockCrewRepo.getMembers.mockResolvedValue(mockMembers);
      mockSoulsRepo.getByAgentId
        .mockResolvedValueOnce({
          identity: { name: 'Alpha', emoji: '🚀' },
          heartbeat: { enabled: true },
        })
        .mockResolvedValueOnce({
          identity: { name: 'Beta', emoji: '🔧' },
          heartbeat: { enabled: false },
        });

      const result = await executeCrewTool('get_crew_members', {});

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        crew: {
          id: 'crew_123',
          name: 'Test Crew',
          coordinationPattern: 'hierarchical',
          status: 'active',
        },
        members: [
          {
            agentId: 'agent_1',
            name: 'Alpha',
            emoji: '🚀',
            role: 'leader',
            heartbeatEnabled: true,
            isCurrentAgent: false,
          },
          {
            agentId: 'agent_2',
            name: 'Beta',
            emoji: '🔧',
            role: 'worker',
            heartbeatEnabled: false,
            isCurrentAgent: false,
          },
        ],
      });
    });

    it('marks current agent correctly', async () => {
      mockGetHeartbeatContext.mockReturnValue({
        agentId: 'agent_1',
        crewId: 'crew_123',
      });

      mockCrewRepo.getById.mockResolvedValue({
        id: 'crew_123',
        name: 'Test Crew',
        coordinationPattern: 'flat',
        status: 'active',
      });
      mockCrewRepo.getMembers.mockResolvedValue([{ agentId: 'agent_1', role: 'leader' }]);
      mockSoulsRepo.getByAgentId.mockResolvedValue({
        identity: { name: 'Current', emoji: '🤖' },
        heartbeat: { enabled: true },
      });

      const result = await executeCrewTool('get_crew_members', {});

      expect(result.result.members[0].isCurrentAgent).toBe(true);
    });

    it('handles missing soul data gracefully', async () => {
      mockCrewRepo.getById.mockResolvedValue({
        id: 'crew_123',
        name: 'Test Crew',
        coordinationPattern: 'flat',
        status: 'active',
      });
      mockCrewRepo.getMembers.mockResolvedValue([{ agentId: 'agent_unknown', role: 'worker' }]);
      mockSoulsRepo.getByAgentId.mockResolvedValue(null);

      const result = await executeCrewTool('get_crew_members', {});

      expect(result.result.members[0]).toMatchObject({
        agentId: 'agent_unknown',
        name: 'agent_unknown',
        emoji: '🤖',
        role: 'worker',
        heartbeatEnabled: false,
      });
    });

    it('uses userId fallback when heartbeat context unavailable', async () => {
      // When heartbeat context is null, uses userId as agentId but crewId will be undefined
      mockGetHeartbeatContext.mockReturnValue(null);

      // Without crewId, the function should return error about not being in a crew
      const result = await executeCrewTool('get_crew_members', {}, 'fallback_agent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not currently part of a crew');
    });
  });

  describe('delegate_task', () => {
    it('returns error when required fields missing', async () => {
      const result = await executeCrewTool('delegate_task', {
        to_agent: '',
        task_name: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('to_agent, task_name, and task_description are required');
    });

    it('creates task delegation message', async () => {
      mockMessagesRepo.create.mockResolvedValue({ id: 'msg_123' });

      const result = await executeCrewTool('delegate_task', {
        to_agent: 'agent_target',
        task_name: 'Test Task',
        task_description: 'Do something important',
      });

      expect(result.success).toBe(true);
      expect(result.result).toMatchObject({
        messageId: 'test-id-123',
        threadId: 'test-id-123',
        delegatedTo: 'agent_target',
        taskName: 'Test Task',
        status: 'delegated',
      });

      expect(mockMessagesRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'agent_test_abc',
          to: 'agent_target',
          type: 'task_delegation',
          subject: '[Task] Test Task',
          content: expect.stringContaining('## Task: Test Task'),
        })
      );
    });

    it('includes optional fields in task content', async () => {
      mockMessagesRepo.create.mockResolvedValue({ id: 'msg_123' });

      await executeCrewTool('delegate_task', {
        to_agent: 'agent_target',
        task_name: 'Complex Task',
        task_description: 'Do something',
        context: 'Some background info',
        expected_output: 'A completed report',
        priority: 'high',
        deadline_hours: 24,
      });

      const createdMessage = mockMessagesRepo.create.mock.calls[0][0];
      expect(createdMessage.content).toContain('## Context');
      expect(createdMessage.content).toContain('Some background info');
      expect(createdMessage.content).toContain('## Expected Output');
      expect(createdMessage.content).toContain('A completed report');
      expect(createdMessage.content).toContain('## Deadline');
      expect(createdMessage.content).toContain('24h from now');
      expect(createdMessage.priority).toBe('high');
    });

    it('resolves agent name to ID via crew lookup', async () => {
      mockCrewRepo.getMembers.mockResolvedValue([
        { agentId: 'agent_abc123', role: 'worker' },
      ]);
      mockSoulsRepo.getByAgentId.mockResolvedValue({
        identity: { name: 'TargetAgent' },
      });
      mockMessagesRepo.create.mockResolvedValue({ id: 'msg_123' });

      mockGetHeartbeatContext.mockReturnValue({
        agentId: 'agent_self',
        crewId: 'crew_123',
      });

      const result = await executeCrewTool('delegate_task', {
        to_agent: 'TargetAgent',
        task_name: 'Named Task',
        task_description: 'Do it',
      });

      expect(result.result.delegatedTo).toBe('agent_abc123');
    });

    it('skips name resolution for ID-like inputs', async () => {
      mockMessagesRepo.create.mockResolvedValue({ id: 'msg_123' });

      // IDs like 'agent_abc123' should not trigger crew lookup
      const result = await executeCrewTool('delegate_task', {
        to_agent: 'agent_direct_id',
        task_name: 'Direct Task',
        task_description: 'Do it',
      });

      expect(result.result.delegatedTo).toBe('agent_direct_id');
      expect(mockCrewRepo.getMembers).not.toHaveBeenCalled();
    });
  });

  describe('broadcast_to_crew', () => {
    it('returns error when not in a crew', async () => {
      mockGetHeartbeatContext.mockReturnValue({ agentId: 'agent_123' });

      const result = await executeCrewTool('broadcast_to_crew', {
        type: 'status_update',
        subject: 'Test',
        content: 'Hello crew',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not currently part of a crew');
    });

    it('returns error when subject or content missing', async () => {
      const result = await executeCrewTool('broadcast_to_crew', {
        type: 'alert',
        subject: '',
        content: '',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('subject and content are required');
    });

    it('broadcasts message to crew members', async () => {
      mockBroadcast.mockResolvedValue({
        delivered: ['agent_1', 'agent_2'],
        failed: [],
      });

      const result = await executeCrewTool('broadcast_to_crew', {
        type: 'knowledge_share',
        subject: 'Important Update',
        content: 'New information for the team',
      });

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        delivered: ['agent_1', 'agent_2'],
        failed: [],
        deliveredCount: 2,
      });

      expect(mockBroadcast).toHaveBeenCalledWith('crew_123', {
        from: 'agent_test_abc',
        type: 'knowledge_share',
        subject: 'Important Update',
        content: 'New information for the team',
        attachments: [],
        priority: 'normal',
        requiresResponse: false,
      });
    });

    it('handles partial delivery failures', async () => {
      mockBroadcast.mockResolvedValue({
        delivered: ['agent_1'],
        failed: [{ agentId: 'agent_2', error: 'offline' }],
      });

      const result = await executeCrewTool('broadcast_to_crew', {
        type: 'alert',
        subject: 'Urgent',
        content: 'Critical issue',
      });

      expect(result.success).toBe(true);
      expect(result.result.deliveredCount).toBe(1);
      expect(result.result.failed).toHaveLength(1);
    });

    it('defaults type to coordination when not specified', async () => {
      mockBroadcast.mockResolvedValue({ delivered: [], failed: [] });

      await executeCrewTool(
        'broadcast_to_crew',
        {
          subject: 'Test',
          content: 'Test content',
        },
        'user_123'
      );

      expect(mockBroadcast).toHaveBeenCalledWith(
        'crew_123',
        expect.objectContaining({
          type: 'coordination',
        })
      );
    });
  });

  describe('unknown tool', () => {
    it('returns error for unknown tool name', async () => {
      const result = await executeCrewTool('unknown_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown crew tool');
    });
  });

  describe('error handling', () => {
    it('catches and returns repository errors', async () => {
      mockCrewRepo.getById.mockRejectedValue(new Error('Database connection failed'));
      mockCrewRepo.getMembers.mockResolvedValue([]);

      const result = await executeCrewTool('get_crew_members', {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });

    it('catches and returns broadcast errors', async () => {
      mockBroadcast.mockRejectedValue(new Error('Communication bus error'));

      const result = await executeCrewTool('broadcast_to_crew', {
        type: 'alert',
        subject: 'Test',
        content: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Communication bus error');
    });
  });
});
