/**
 * Real-filesystem tests for IsolatedStorage quota accounting.
 *
 * Kept in a separate file from storage.test.ts because that file globally
 * mocks node:fs; these tests exercise the REAL quota math on disk.
 *
 * Regression (2026-09 round 11): the quota check used to be
 * `usage.usedBytes + contentSize > quota` — double-counting the bytes of the
 * file being REPLACED, so an in-place rewrite was rejected once usage passed
 * half the quota even though net usage never increased. The quota bounds NET
 * usage: replaced bytes are credited back (writeFile and copyFile).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IsolatedStorage, StorageSecurityError } from './storage.js';

const KIB = 1024;

describe('IsolatedStorage quota accounting (net usage, real fs)', () => {
  let root: string;
  let storage: IsolatedStorage;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'ownpilot-storage-quota-'));
    storage = new IsolatedStorage(root, 1 / 1024); // 1 MiB quota
    await storage.createUserStorage('u1');
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('allows an in-place same-size overwrite (net usage unchanged)', async () => {
    await storage.writeFile('u1', 'big.bin', Buffer.alloc(800 * KIB, 7));
    // Used to throw StorageSecurityError: the check counted the new 800 KiB
    // on top of usage without crediting the bytes being replaced.
    await storage.writeFile('u1', 'big.bin', Buffer.alloc(800 * KIB, 9));
    const after = await storage.readBinaryFile('u1', 'big.bin');
    expect(after.length).toBe(800 * KIB);
    expect(after[0]).toBe(9);
  });

  it('still rejects a NEW file that would exceed the quota', async () => {
    await expect(storage.writeFile('u1', 'other.bin', Buffer.alloc(800 * KIB, 1))).rejects.toThrow(
      StorageSecurityError
    );
  });

  it('still rejects an overwrite that would exceed net quota', async () => {
    // 800 KiB existing + 1200 KiB new content > 1 MiB quota
    await expect(storage.writeFile('u1', 'big.bin', Buffer.alloc(1200 * KIB, 2))).rejects.toThrow(
      StorageSecurityError
    );
  });

  it('copyFile onto a larger existing destination succeeds when net usage drops', async () => {
    await storage.createUserStorage('u2');
    await storage.writeFile('u2', 'src.bin', Buffer.alloc(300 * KIB, 3));
    await storage.writeFile('u2', 'dest.bin', Buffer.alloc(700 * KIB, 4));
    // Net: ~1000 KiB − 700 KiB + 300 KiB = ~600 KiB ≤ 1 MiB → must succeed
    await storage.copyFile('u2', 'src.bin', 'dest.bin');
    const dest = await storage.readBinaryFile('u2', 'dest.bin');
    expect(dest.length).toBe(300 * KIB);
  });

  it('append still counts as new usage (appends genuinely add bytes)', async () => {
    await expect(storage.appendFile('u1', 'big.bin', 'x'.repeat(800 * KIB))).rejects.toThrow(
      StorageSecurityError
    );
  });
});
