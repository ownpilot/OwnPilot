import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import * as os from 'node:os';
import { searchFilesExecutor } from './file-system-executors.js';

// Real-fs coverage: the agent file tools' self-protection (isOwnPilotPath)
// denies anything under the OwnPilot installation — including this repo's
// own .temp_files — so fixtures live in a test-owned os.tmpdir() workspace
// (on the default allowlist). Removed in afterAll.
const wsDir = join(os.tmpdir(), 'ownpilot-bughunt-43-test-ws');

type ExecResult = { content: string; isError?: boolean };

async function search(query: string): Promise<ExecResult> {
  return (await searchFilesExecutor({ path: 'data', query }, {
    workspaceDir: wsDir,
  } as unknown as Parameters<typeof searchFilesExecutor>[1])) as ExecResult;
}

describe('searchFilesExecutor ReDoS guard (round 43 regression)', () => {
  beforeAll(async () => {
    await fs.rm(wsDir, { recursive: true, force: true });
    await fs.mkdir(join(wsDir, 'data'), { recursive: true });
    await fs.writeFile(join(wsDir, 'data', 'hello.txt'), 'hello world\nplain line\n');
  });

  afterAll(async () => {
    await fs.rm(wsDir, { recursive: true, force: true });
  });

  it('rejects catastrophic-backtracking queries up front (bridge contract)', async () => {
    for (const q of ['(a+)+', '(a|aa)+$', '(\\w|aa)+']) {
      const r = await search(q);
      expect(r.isError, q).toBe(true);
      expect(r.content, q).toMatch(/unsafe/i);
    }
  });

  it('still performs literal and safe-regex searches (anchors)', async () => {
    const lit = await search('hello');
    expect(lit.isError).toBeFalsy();
    expect(lit.content).toContain('hello.txt');

    const rx = await search('^plain');
    expect(rx.isError).toBeFalsy();
    expect(rx.content).toContain('plain line');
  });

  it('keeps the invalid-pattern error for compile failures', async () => {
    const r = await search('(');
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/invalid/i);
  });
});
