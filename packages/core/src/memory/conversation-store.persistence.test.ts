import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationMemoryStore } from './conversation-store.js';

/**
 * Real-filesystem persistence coverage for access stats.
 *
 * Kept SEPARATE from conversation.test.ts because that file globally mocks
 * `node:fs/promises` (no-op writeFile) — a mocked write would fake the
 * persistence semantics under test. This follows the storage.quota.test.ts
 * precedent (round 11).
 */

const roots: string[] = [];

async function makeStore(): Promise<{ store: ConversationMemoryStore; storageDir: string }> {
  const storageDir = await mkdtemp(join(tmpdir(), 'ownpilot-mem-persist-'));
  roots.push(storageDir);
  return {
    store: new ConversationMemoryStore('persist-user', { storageDir }),
    storageDir,
  };
}

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

function makeInput(content: string) {
  return {
    content,
    category: 'fact' as const,
    importance: 'high' as const,
    confidence: 0.9,
    source: 'user_stated' as const,
    tags: ['persistence'],
  };
}

describe('ConversationMemoryStore access-stat persistence (real fs)', () => {
  it('getMemory writes accessCount/lastAccessed through to disk', async () => {
    const { store: store1, storageDir } = await makeStore();
    const created = await store1.addMemory(makeInput('persisted access stats'));
    // Three reads: getMemory must persist the mutated stats, like every
    // other mutating method does.
    await store1.getMemory(created.id);
    await store1.getMemory(created.id);
    await store1.getMemory(created.id);

    // Fresh instance on the same storageDir simulates a restart.
    // queryMemories is a pure read (never mutates access stats), so it shows
    // exactly what was persisted.
    const store2 = new ConversationMemoryStore('persist-user', { storageDir });
    const persisted = (await store2.queryMemories({ category: 'fact' })).find(
      (m) => m.id === created.id
    );

    // Regression: accessCount used to revert to its creation-time value
    // (0) after restart because getMemory never called saveMemories().
    expect(persisted?.accessCount).toBe(3);
    // Retention auto-archive (lastAccessDays) depends on this being durable.
    expect(persisted?.lastAccessed).toBeTypeOf('string');
  });

  it('unknown-id reads still return null without side effects (boundary)', async () => {
    const { store } = await makeStore();
    await store.addMemory(makeInput('boundary'));
    expect(await store.getMemory('mem_does_not_exist')).toBeNull();
  });
});
