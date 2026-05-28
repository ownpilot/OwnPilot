import { describe, it, expect } from 'vitest';
import { runInExecContext, getExecContext } from './exec-context.js';

describe('ExecContext (AsyncLocalStorage)', () => {
  it('returns undefined outside of runInExecContext', () => {
    expect(getExecContext()).toBeUndefined();
  });

  it('exposes the context inside the run function', async () => {
    await runInExecContext({ workspaceDir: '/data/a' }, async () => {
      expect(getExecContext()?.workspaceDir).toBe('/data/a');
    });
  });

  it('isolates context to its frame — outer scope sees nothing', async () => {
    let observed: string | undefined;
    await runInExecContext({ workspaceDir: '/data/inner' }, async () => {
      observed = getExecContext()?.workspaceDir;
    });
    expect(observed).toBe('/data/inner');
    expect(getExecContext()).toBeUndefined();
  });

  it('nested contexts fully shadow the outer one (no merging)', async () => {
    await runInExecContext({ workspaceDir: '/outer' }, async () => {
      expect(getExecContext()?.workspaceDir).toBe('/outer');
      await runInExecContext({}, async () => {
        // Inner ctx is empty, so workspaceDir comes back undefined — proving
        // the inner ctx shadows rather than inherits.
        expect(getExecContext()?.workspaceDir).toBeUndefined();
      });
      // Back in outer scope, value is restored.
      expect(getExecContext()?.workspaceDir).toBe('/outer');
    });
  });

  it('survives await boundaries (microtasks + macrotasks)', async () => {
    await runInExecContext({ workspaceDir: '/persist' }, async () => {
      await Promise.resolve();
      expect(getExecContext()?.workspaceDir).toBe('/persist');
      await new Promise((r) => setTimeout(r, 5));
      expect(getExecContext()?.workspaceDir).toBe('/persist');
    });
  });

  it('isolates concurrent runs from each other', async () => {
    const results = await Promise.all([
      runInExecContext({ workspaceDir: '/one' }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        return getExecContext()?.workspaceDir;
      }),
      runInExecContext({ workspaceDir: '/two' }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getExecContext()?.workspaceDir;
      }),
      runInExecContext({ workspaceDir: '/three' }, async () => {
        return getExecContext()?.workspaceDir;
      }),
    ]);
    expect(results).toEqual(['/one', '/two', '/three']);
  });

  it('forwards the function return value', async () => {
    const value = await runInExecContext({ workspaceDir: '/x' }, () => 42);
    expect(value).toBe(42);
  });
});
