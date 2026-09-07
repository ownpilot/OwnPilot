/**
 * Pre-fix proof: archiveMemory and restoreMemory skip ensureInitialized().
 *
 * Bug (committed source):
 *   archiveMemory(id) → this.memories.get(id) → false  [ensureInitialized skipped]
 *   restoreMemory(id) → this.memories.get(id) → false  [ensureInitialized skipped]
 *
 * Every other mutating method (addMemory, updateMemory, deleteMemory, getMemory)
 * calls await this.ensureInitialized() first. archiveMemory and restoreMemory are
 * the only two that skip it, accessing this.memories on an uninitialized map.
 *
 * Proof: subclass ConversationMemoryStore and override ensureInitialized() to
 * record whether it was called.  Call archiveMemory / restoreMemory and assert
 * the guard was reached.  BUG: ensureInitialized not called → test FAILS.
 * FIX: ensureInitialized called → test PASSES.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';

describe('archiveMemory / restoreMemory — ensureInitialized guard (BUG)', () => {
  it('archiveMemory must call ensureInitialized() before operating', async () => {
    const { ConversationMemoryStore } = await import('./conversation-store');
    const userId = `proof-${randomUUID().slice(0, 8)}`;

    // Track whether ensureInitialized is called using a subclass
    let ensureInitCalled = false;
    class TrackedStore extends ConversationMemoryStore {
      override async ensureInitialized() {
        ensureInitCalled = true;
        await super.ensureInitialized();
      }
    }

    const store = new TrackedStore(userId);
    await store.archiveMemory('non-existent-id');

    // BUG: ensureInitialized() never called → FAILS
    // FIX: await this.ensureInitialized() added → PASSES
    expect(ensureInitCalled, 'archiveMemory must call ensureInitialized()').toBe(true);
  });

  it('restoreMemory must call ensureInitialized() before operating', async () => {
    const { ConversationMemoryStore } = await import('./conversation-store');
    const userId = `proof-${randomUUID().slice(0, 8)}`;

    let ensureInitCalled = false;
    class TrackedStore extends ConversationMemoryStore {
      override async ensureInitialized() {
        ensureInitCalled = true;
        await super.ensureInitialized();
      }
    }

    const store = new TrackedStore(userId);
    await store.restoreMemory('non-existent-id');

    expect(ensureInitCalled, 'restoreMemory must call ensureInitialized()').toBe(true);
  });
});
