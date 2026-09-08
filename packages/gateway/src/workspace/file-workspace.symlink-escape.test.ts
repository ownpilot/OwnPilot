/**
 * Real-fs regression for the intermediate-symlink (junction) workspace
 * escape (round 70).
 *
 * SEPARATE FILE by design: file-workspace.test.ts globally mocks node:fs,
 * which would fake the very semantics under test — existsSync/readFileSync/
 * writeFileSync/rmSync FOLLOW a symlinked intermediate directory, while
 * lstat of the final component through the link reports a regular file.
 * (Same pattern as core's storage.quota.test.ts / conversation-store
 * .persistence.test.ts.)
 *
 * Data root is isolated via OWNPILOT_DATA_DIR (paths/index.ts honors it for
 * testing) — no real user app-data is touched. The module is imported
 * dynamically AFTER the env var is set so no call path can resolve the real
 * root first.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DATA_ROOT = mkdtempSync(join(tmpdir(), 'r70-ws-data-'));
const VICTIM_ROOT = mkdtempSync(join(tmpdir(), 'r70-ws-victim-'));

process.env.OWNPILOT_DATA_DIR = DATA_ROOT;

// Dynamic import AFTER the env pin.
const fw = await import('./file-workspace.js');

/** Plant a symlink directory; junctions need no elevation on Windows. */
function plantLeak(wsPath: string): void {
  symlinkSync(VICTIM_ROOT, join(wsPath, 'leak'), process.platform === 'win32' ? 'junction' : 'dir');
}

let ws: Awaited<ReturnType<typeof fw.createSessionWorkspace>>;

beforeAll(() => {
  fw.initializeFileWorkspace();
  ws = fw.createSessionWorkspace({ name: 'r70-symlink-escape-test' });
  writeFileSync(join(VICTIM_ROOT, 'secret.txt'), 'OUTSIDE-SECRET');
});

afterAll(() => {
  rmSync(DATA_ROOT, { recursive: true, force: true });
  rmSync(VICTIM_ROOT, { recursive: true, force: true });
});

describe('session workspace file ops refuse intermediate symlinks/junctions (round 70)', () => {
  it('readSessionWorkspaceFile does not read OUTSIDE the workspace through a linked directory', () => {
    plantLeak(ws.path);
    try {
      expect(() => fw.readSessionWorkspaceFile(ws.id, 'leak/secret.txt')).toThrow(
        /Symlinks are not permitted/
      );
      // The outside file is untouched (still readable from its real path).
      expect(existsSync(join(VICTIM_ROOT, 'secret.txt'))).toBe(true);
    } finally {
      rmSync(join(ws.path, 'leak'), { force: true, recursive: true });
    }
  });

  it('writeSessionWorkspaceFile does not create files OUTSIDE the workspace through a linked directory', () => {
    plantLeak(ws.path);
    try {
      expect(() => fw.writeSessionWorkspaceFile(ws.id, 'leak/pwned.txt', 'ESCAPED')).toThrow(
        /Symlinks are not permitted/
      );
      expect(existsSync(join(VICTIM_ROOT, 'pwned.txt'))).toBe(false);
    } finally {
      rmSync(join(ws.path, 'leak'), { force: true, recursive: true });
    }
  });

  it('deleteSessionWorkspaceFile does not remove files OUTSIDE the workspace through a linked directory', () => {
    writeFileSync(join(VICTIM_ROOT, 'kill.txt'), 'must-survive');
    plantLeak(ws.path);
    try {
      expect(() => fw.deleteSessionWorkspaceFile(ws.id, 'leak/kill.txt')).toThrow(
        /Symlinks are not permitted/
      );
      expect(existsSync(join(VICTIM_ROOT, 'kill.txt'))).toBe(true);
    } finally {
      rmSync(join(VICTIM_ROOT, 'kill.txt'), { force: true });
      rmSync(join(ws.path, 'leak'), { force: true, recursive: true });
    }
  });

  it('rejects the link itself as the FINAL path component (delete of the planted link)', () => {
    plantLeak(ws.path);
    try {
      // Deleting the junction through the API must refuse too — it is a
      // symlink component. (Pre-round-70 this op had no symlink check.)
      expect(() => fw.deleteSessionWorkspaceFile(ws.id, 'leak')).toThrow(
        /Symlinks are not permitted/
      );
      expect(existsSync(join(VICTIM_ROOT, 'secret.txt'))).toBe(true);
    } finally {
      rmSync(join(ws.path, 'leak'), { force: true, recursive: true });
    }
  });

  it('control: normal in-workspace read/write/delete keeps working (real fs)', () => {
    fw.writeSessionWorkspaceFile(ws.id, 'notes/plain.txt', 'in-workspace');
    expect(fw.readSessionWorkspaceFile(ws.id, 'notes/plain.txt')?.toString('utf-8')).toBe(
      'in-workspace'
    );
    expect(fw.deleteSessionWorkspaceFile(ws.id, 'notes/plain.txt')).toBe(true);
    expect(fw.readSessionWorkspaceFile(ws.id, 'notes/plain.txt')).toBeNull();
  });
});
