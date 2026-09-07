// @vitest-environment happy-dom
// Regression: MemoriesTab bulkDeleteMemories must call onLoadAllData when clearing
// a pending timer so the first batch's optimistically-removed memories are recovered
// from the server instead of silently vanishing.  Bug was at lines 79-83.

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('MemoriesTab bulkDeleteMemories — pending batch flush', () => {
  it('onLoadAllData is called after clearTimeout+null in the pending-delete block', () => {
    const source = readFileSync(resolve(__dirname, './MemoriesTab.tsx'), 'utf-8');

    // Bug: when a second bulk delete starts, lines 79-82 clear the pending timer
    // and null the ref, but the first batch's optimistically-removed memories
    // are never recovered from the server.  onLoadAllData() must appear in the
    // SAME if-block as the clearTimeout/null — not in a different function.
    //
    // Approach: check that onLoadAllData appears between the pending-delete
    // clearTimer/null and the next "const deletedIds" statement.
    // This is a tight bounded check that won't bleed into undoBulkDelete.
    const clearTimerSnippet = 'pendingDeleteRef.current = null';
    const nextSnippet = 'const deletedIds';
    const afterClearTimer = source.indexOf(clearTimerSnippet);
    const afterDeletedIds = source.indexOf(nextSnippet, afterClearTimer);
    // Grab everything after clearTimer/null up to (but not including) deletedIds
    const recoveryZone =
      afterClearTimer >= 0 && afterDeletedIds > afterClearTimer
        ? source.slice(afterClearTimer, afterDeletedIds)
        : '';
    const recoveryInPendingBlock = /\bonLoadAllData\s*\(/.test(recoveryZone);

    expect(
      recoveryInPendingBlock,
      'bulkDeleteMemories: onLoadAllData() must be called inside the if(pendingDeleteRef.current) block ' +
        "after clearTimeout+null. Without this, the first batch's optimistically-removed " +
        'memories are never recovered from the server — no API call, no toast, no restore.'
    ).toBe(true);
  });
});
