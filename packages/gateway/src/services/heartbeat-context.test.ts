/**
 * HeartbeatContext Tests
 *
 * Tests the AsyncLocalStorage-based heartbeat execution context,
 * verifying context propagation and isolation.
 */

import { describe, it, expect } from 'vitest';
import { runInHeartbeatContext, getHeartbeatContext } from './heartbeat-context.js';

describe('HeartbeatContext', () => {
  describe('getHeartbeatContext', () => {
    it('returns undefined when called outside heartbeat context', () => {
      const ctx = getHeartbeatContext();
      expect(ctx).toBeUndefined();
    });
  });

  describe('runInHeartbeatContext', () => {
    it('makes context available within the execution block', async () => {
      const context = { agentId: 'agent-123' };

      await runInHeartbeatContext(context, async () => {
        const ctx = getHeartbeatContext();
        expect(ctx).toEqual(context);
        expect(ctx?.agentId).toBe('agent-123');
      });
    });

    it('makes context with crewId available', async () => {
      const context = { agentId: 'agent-456', crewId: 'crew-789' };

      await runInHeartbeatContext(context, async () => {
        const ctx = getHeartbeatContext();
        expect(ctx).toEqual(context);
        expect(ctx?.agentId).toBe('agent-456');
        expect(ctx?.crewId).toBe('crew-789');
      });
    });

    it('returns the result of the async function', async () => {
      const context = { agentId: 'agent-123' };

      const result = await runInHeartbeatContext(context, async () => {
        return 'success-result';
      });

      expect(result).toBe('success-result');
    });

    it('returns complex objects from the async function', async () => {
      const context = { agentId: 'agent-123' };

      const result = await runInHeartbeatContext(context, async () => {
        return { data: [1, 2, 3], count: 3 };
      });

      expect(result).toEqual({ data: [1, 2, 3], count: 3 });
    });

    it('context is not available after the execution block completes', async () => {
      const context = { agentId: 'agent-123' };

      await runInHeartbeatContext(context, async () => {
        expect(getHeartbeatContext()).toEqual(context);
      });

      // After the block, context should be undefined
      expect(getHeartbeatContext()).toBeUndefined();
    });

    it('nested contexts can access parent context', async () => {
      const outerContext = { agentId: 'outer-agent' };

      await runInHeartbeatContext(outerContext, async () => {
        expect(getHeartbeatContext()?.agentId).toBe('outer-agent');

        // Simulate nested call
        await Promise.resolve();
        expect(getHeartbeatContext()?.agentId).toBe('outer-agent');
      });
    });

    it('handles concurrent contexts independently', async () => {
      const contexts: { agentId: string }[] = [];

      const promise1 = runInHeartbeatContext({ agentId: 'agent-1' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        contexts.push(getHeartbeatContext()!);
        return 'result-1';
      });

      const promise2 = runInHeartbeatContext({ agentId: 'agent-2' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        contexts.push(getHeartbeatContext()!);
        return 'result-2';
      });

      const promise3 = runInHeartbeatContext({ agentId: 'agent-3' }, async () => {
        contexts.push(getHeartbeatContext()!);
        return 'result-3';
      });

      const [result1, result2, result3] = await Promise.all([promise1, promise2, promise3]);

      expect(result1).toBe('result-1');
      expect(result2).toBe('result-2');
      expect(result3).toBe('result-3');

      // Each context should be isolated
      const agentIds = contexts.map((c) => c.agentId);
      expect(agentIds).toContain('agent-1');
      expect(agentIds).toContain('agent-2');
      expect(agentIds).toContain('agent-3');
    });

    it('handles errors while maintaining context isolation', async () => {
      const context = { agentId: 'error-agent' };

      await expect(
        runInHeartbeatContext(context, async () => {
          expect(getHeartbeatContext()?.agentId).toBe('error-agent');
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Context should be cleaned up after error
      expect(getHeartbeatContext()).toBeUndefined();
    });

    it('handles synchronous exceptions in async wrapper', async () => {
      const context = { agentId: 'sync-error-agent' };

      await expect(
        runInHeartbeatContext(context, async () => {
          throw new Error('Sync error');
        })
      ).rejects.toThrow('Sync error');

      expect(getHeartbeatContext()).toBeUndefined();
    });

    it('propagates context through multiple async operations', async () => {
      const context = { agentId: 'multi-async-agent' };

      await runInHeartbeatContext(context, async () => {
        expect(getHeartbeatContext()?.agentId).toBe('multi-async-agent');

        await Promise.resolve();
        expect(getHeartbeatContext()?.agentId).toBe('multi-async-agent');

        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(getHeartbeatContext()?.agentId).toBe('multi-async-agent');

        await Promise.all([Promise.resolve(), Promise.resolve()]);
        expect(getHeartbeatContext()?.agentId).toBe('multi-async-agent');
      });
    });

    it('handles empty crewId correctly', async () => {
      const context = { agentId: 'agent-789', crewId: undefined };

      await runInHeartbeatContext(context, async () => {
        const ctx = getHeartbeatContext();
        expect(ctx?.agentId).toBe('agent-789');
        expect(ctx?.crewId).toBeUndefined();
      });
    });

    it('allows accessing context from nested function calls', async () => {
      const context = { agentId: 'nested-agent', crewId: 'crew-abc' };

      async function nestedFunction(): Promise<string> {
        const ctx = getHeartbeatContext();
        return `${ctx?.agentId}:${ctx?.crewId}`;
      }

      await runInHeartbeatContext(context, async () => {
        const result = await nestedFunction();
        expect(result).toBe('nested-agent:crew-abc');
      });
    });

    it('handles deeply nested async calls', async () => {
      const context = { agentId: 'deep-agent' };

      async function level3(): Promise<string> {
        return getHeartbeatContext()?.agentId ?? 'no-context';
      }

      async function level2(): Promise<string> {
        return level3();
      }

      async function level1(): Promise<string> {
        return level2();
      }

      await runInHeartbeatContext(context, async () => {
        const result = await level1();
        expect(result).toBe('deep-agent');
      });
    });
  });
});
