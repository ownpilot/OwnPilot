/**
 * Claw Execution Context Tests
 *
 * Verifies the AsyncLocalStorage-based ambient context behaves correctly
 * under sync, async, nested, and concurrent flows.
 */

import { describe, it, expect } from 'vitest';
import { runInClawContext, getClawContext, type ClawExecutionContext } from './claw-context.js';

function makeCtx(overrides: Partial<ClawExecutionContext> = {}): ClawExecutionContext {
  return {
    clawId: 'claw-1',
    userId: 'user-1',
    depth: 0,
    ...overrides,
  };
}

describe('claw execution context', () => {
  it('returns undefined when called outside of a runInClawContext', () => {
    expect(getClawContext()).toBeUndefined();
  });

  it('propagates context through synchronous code inside runInClawContext', async () => {
    const ctx = makeCtx({ clawId: 'claw-sync' });
    const seen = await runInClawContext(ctx, async () => getClawContext());
    expect(seen).toEqual(ctx);
  });

  it('propagates context across awaits', async () => {
    const ctx = makeCtx({ clawId: 'claw-await' });
    const seen = await runInClawContext(ctx, async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return getClawContext();
    });
    expect(seen?.clawId).toBe('claw-await');
  });

  it('nested runInClawContext overrides the outer context for its scope', async () => {
    const outer = makeCtx({ clawId: 'outer', depth: 0 });
    const inner = makeCtx({ clawId: 'inner', depth: 1 });

    const result = await runInClawContext(outer, async () => {
      const beforeInner = getClawContext()?.clawId;
      const insideInner = await runInClawContext(inner, async () => getClawContext()?.clawId);
      const afterInner = getClawContext()?.clawId;
      return { beforeInner, insideInner, afterInner };
    });

    expect(result).toEqual({
      beforeInner: 'outer',
      insideInner: 'inner',
      afterInner: 'outer',
    });
  });

  it('concurrent runInClawContext calls keep their own context — no cross-contamination', async () => {
    async function observe(label: string, delayMs: number): Promise<string | undefined> {
      return runInClawContext(makeCtx({ clawId: label }), async () => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return getClawContext()?.clawId;
      });
    }

    const results = await Promise.all([observe('a', 10), observe('b', 5), observe('c', 1)]);

    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('context disappears after runInClawContext resolves', async () => {
    await runInClawContext(makeCtx(), async () => {
      expect(getClawContext()).toBeDefined();
    });
    expect(getClawContext()).toBeUndefined();
  });

  it('context is available inside a throwing callback, and disappears after', async () => {
    let seenInsideThrow: string | undefined;
    await expect(
      runInClawContext(makeCtx({ clawId: 'claw-throws' }), async () => {
        seenInsideThrow = getClawContext()?.clawId;
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    expect(seenInsideThrow).toBe('claw-throws');
    expect(getClawContext()).toBeUndefined();
  });

  it('passes through return values verbatim', async () => {
    const result = await runInClawContext(makeCtx(), async () => ({ answer: 42, ok: true }));
    expect(result).toEqual({ answer: 42, ok: true });
  });

  it('optional workspaceId is preserved when provided', async () => {
    const ctx = makeCtx({ workspaceId: 'ws-123' });
    const seen = await runInClawContext(ctx, async () => getClawContext()?.workspaceId);
    expect(seen).toBe('ws-123');
  });
});
