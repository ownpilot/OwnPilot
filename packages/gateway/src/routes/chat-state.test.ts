import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@ownpilot/core', () => ({}));

const {
  boundedSetAdd,
  boundedMapSet,
  promptInitializedConversations,
  lastExecPermHash,
  execPermHash,
} = await import('./chat-state.js');

describe('chat-state', () => {
  beforeEach(() => {
    promptInitializedConversations.clear();
    lastExecPermHash.clear();
  });

  describe('boundedSetAdd', () => {
    it('adds value to empty set', () => {
      const set = new Set<string>();
      boundedSetAdd(set, 'a', 3);
      expect(set).toEqual(new Set(['a']));
    });

    it('adds multiple values without exceeding maxSize', () => {
      const set = new Set<string>();
      boundedSetAdd(set, 'a', 3);
      boundedSetAdd(set, 'b', 3);
      boundedSetAdd(set, 'c', 3);
      expect(set.size).toBe(3);
      expect(set).toEqual(new Set(['a', 'b', 'c']));
    });

    it('evicts oldest entry when at capacity', () => {
      const set = new Set<string>();
      boundedSetAdd(set, 'a', 3);
      boundedSetAdd(set, 'b', 3);
      boundedSetAdd(set, 'c', 3);
      // Now at capacity, adding 'd' should evict 'a' (oldest)
      boundedSetAdd(set, 'd', 3);
      expect(set.size).toBe(3);
      expect(set.has('a')).toBe(false);
      expect(set).toEqual(new Set(['b', 'c', 'd']));
    });

    it('does not evict when adding existing value (Set semantics)', () => {
      const set = new Set<string>();
      boundedSetAdd(set, 'a', 2);
      boundedSetAdd(set, 'b', 2);
      // Set is now full with ['a', 'b']. Adding existing 'a' again.
      boundedSetAdd(set, 'a', 2);
      // Should still have both, not evict anything
      expect(set.size).toBe(2);
      expect(set).toEqual(new Set(['a', 'b']));
    });

    it('works with maxSize=1', () => {
      const set = new Set<string>();
      boundedSetAdd(set, 'a', 1);
      expect(set).toEqual(new Set(['a']));
      boundedSetAdd(set, 'b', 1);
      expect(set).toEqual(new Set(['b']));
    });

    it('maintains insertion order (FIFO)', () => {
      const set = new Set<number>();
      boundedSetAdd(set, 1, 4);
      boundedSetAdd(set, 2, 4);
      boundedSetAdd(set, 3, 4);
      boundedSetAdd(set, 4, 4); // set is now [1, 2, 3, 4]
      boundedSetAdd(set, 5, 4); // evicts 1
      const values = Array.from(set);
      expect(values).toEqual([2, 3, 4, 5]);
    });

    it('evicts multiple entries when adding multiple values past capacity', () => {
      const set = new Set<string>();
      boundedSetAdd(set, 'a', 2);
      boundedSetAdd(set, 'b', 2);
      // At capacity. Adding 'c' evicts 'a'.
      boundedSetAdd(set, 'c', 2);
      expect(set).toEqual(new Set(['b', 'c']));
      // Adding 'd' evicts 'b'.
      boundedSetAdd(set, 'd', 2);
      expect(set).toEqual(new Set(['c', 'd']));
    });

    it('works with different types (numbers)', () => {
      const set = new Set<number>();
      boundedSetAdd(set, 10, 2);
      boundedSetAdd(set, 20, 2);
      boundedSetAdd(set, 30, 2);
      expect(set).toEqual(new Set([20, 30]));
    });

    it('works with objects', () => {
      const obj1 = { id: 1 };
      const obj2 = { id: 2 };
      const obj3 = { id: 3 };
      const obj4 = { id: 4 };
      const set = new Set<object>();
      boundedSetAdd(set, obj1, 3);
      boundedSetAdd(set, obj2, 3);
      boundedSetAdd(set, obj3, 3);
      boundedSetAdd(set, obj4, 3);
      expect(set.size).toBe(3);
      expect(set.has(obj1)).toBe(false);
      expect(set.has(obj2)).toBe(true);
      expect(set.has(obj3)).toBe(true);
      expect(set.has(obj4)).toBe(true);
    });
  });

  describe('boundedMapSet', () => {
    it('adds key-value pair to empty map', () => {
      const map = new Map<string, number>();
      boundedMapSet(map, 'a', 1, 3);
      expect(map).toEqual(new Map([['a', 1]]));
    });

    it('adds multiple key-value pairs without exceeding maxSize', () => {
      const map = new Map<string, number>();
      boundedMapSet(map, 'a', 1, 3);
      boundedMapSet(map, 'b', 2, 3);
      boundedMapSet(map, 'c', 3, 3);
      expect(map.size).toBe(3);
      expect(map).toEqual(
        new Map([
          ['a', 1],
          ['b', 2],
          ['c', 3],
        ])
      );
    });

    it('evicts oldest entry when at capacity', () => {
      const map = new Map<string, number>();
      boundedMapSet(map, 'a', 1, 3);
      boundedMapSet(map, 'b', 2, 3);
      boundedMapSet(map, 'c', 3, 3);
      // At capacity. Adding 'd' should evict 'a' (oldest).
      boundedMapSet(map, 'd', 4, 3);
      expect(map.size).toBe(3);
      expect(map.has('a')).toBe(false);
      expect(map).toEqual(
        new Map([
          ['b', 2],
          ['c', 3],
          ['d', 4],
        ])
      );
    });

    it('does not evict when updating existing key', () => {
      const map = new Map<string, number>();
      boundedMapSet(map, 'a', 1, 2);
      boundedMapSet(map, 'b', 2, 2);
      // Map is now full with ['a' => 1, 'b' => 2]. Updating 'a' to 10.
      boundedMapSet(map, 'a', 10, 2);
      // Should still have both keys, value updated.
      expect(map.size).toBe(2);
      expect(map).toEqual(
        new Map([
          ['a', 10],
          ['b', 2],
        ])
      );
    });

    it('works with maxSize=1', () => {
      const map = new Map<string, string>();
      boundedMapSet(map, 'key1', 'value1', 1);
      expect(map).toEqual(new Map([['key1', 'value1']]));
      boundedMapSet(map, 'key2', 'value2', 1);
      expect(map).toEqual(new Map([['key2', 'value2']]));
    });

    it('maintains insertion order (FIFO)', () => {
      const map = new Map<string, number>();
      boundedMapSet(map, 'a', 1, 4);
      boundedMapSet(map, 'b', 2, 4);
      boundedMapSet(map, 'c', 3, 4);
      boundedMapSet(map, 'd', 4, 4); // map is now [a, b, c, d]
      boundedMapSet(map, 'e', 5, 4); // evicts 'a'
      const keys = Array.from(map.keys());
      expect(keys).toEqual(['b', 'c', 'd', 'e']);
    });

    it('evicts multiple entries when adding multiple values past capacity', () => {
      const map = new Map<string, number>();
      boundedMapSet(map, 'a', 1, 2);
      boundedMapSet(map, 'b', 2, 2);
      // At capacity. Adding 'c' evicts 'a'.
      boundedMapSet(map, 'c', 3, 2);
      expect(map).toEqual(
        new Map([
          ['b', 2],
          ['c', 3],
        ])
      );
      // Adding 'd' evicts 'b'.
      boundedMapSet(map, 'd', 4, 2);
      expect(map).toEqual(
        new Map([
          ['c', 3],
          ['d', 4],
        ])
      );
    });

    it('works with different types (number keys)', () => {
      const map = new Map<number, string>();
      boundedMapSet(map, 1, 'one', 3);
      boundedMapSet(map, 2, 'two', 3);
      boundedMapSet(map, 3, 'three', 3);
      boundedMapSet(map, 4, 'four', 3);
      expect(map.size).toBe(3);
      expect(map.has(1)).toBe(false);
      expect(map).toEqual(
        new Map([
          [2, 'two'],
          [3, 'three'],
          [4, 'four'],
        ])
      );
    });

    it('works with objects as values', () => {
      interface Config {
        id: string;
        name: string;
      }
      const map = new Map<string, Config>();
      const config1: Config = { id: '1', name: 'Config 1' };
      const config2: Config = { id: '2', name: 'Config 2' };
      const config3: Config = { id: '3', name: 'Config 3' };
      boundedMapSet(map, 'cfg1', config1, 2);
      boundedMapSet(map, 'cfg2', config2, 2);
      boundedMapSet(map, 'cfg3', config3, 2);
      expect(map.size).toBe(2);
      expect(map.has('cfg1')).toBe(false);
      expect(map.get('cfg2')).toEqual(config2);
      expect(map.get('cfg3')).toEqual(config3);
    });
  });

  describe('execPermHash', () => {
    it('returns correct hash string with all fields', () => {
      const perms: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      const hash = execPermHash(perms);
      expect(hash).toBe('true|sandbox|true|false|true|false|true');
    });

    it('produces different hash when enabled differs', () => {
      const perms1: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      const perms2: Record<string, unknown> = {
        enabled: false,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      expect(execPermHash(perms1)).not.toBe(execPermHash(perms2));
    });

    it('produces different hash when mode differs', () => {
      const perms1: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      const perms2: Record<string, unknown> = {
        enabled: true,
        mode: 'approval',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      expect(execPermHash(perms1)).not.toBe(execPermHash(perms2));
    });

    it('produces different hash when execute_javascript differs', () => {
      const perms1: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      const perms2: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: false,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      expect(execPermHash(perms1)).not.toBe(execPermHash(perms2));
    });

    it('produces different hash when execute_python differs', () => {
      const perms1: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: true,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      const perms2: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      expect(execPermHash(perms1)).not.toBe(execPermHash(perms2));
    });

    it('produces different hash when execute_shell differs', () => {
      const perms1: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      const perms2: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: false,
        compile_code: false,
        package_manager: true,
      };
      expect(execPermHash(perms1)).not.toBe(execPermHash(perms2));
    });

    it('produces different hash when compile_code differs', () => {
      const perms1: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: true,
        package_manager: true,
      };
      const perms2: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      expect(execPermHash(perms1)).not.toBe(execPermHash(perms2));
    });

    it('produces different hash when package_manager differs', () => {
      const perms1: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: true,
      };
      const perms2: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: false,
        execute_shell: true,
        compile_code: false,
        package_manager: false,
      };
      expect(execPermHash(perms1)).not.toBe(execPermHash(perms2));
    });

    it('produces same hash for identical permissions (deterministic)', () => {
      const perms: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: true,
        execute_shell: false,
        compile_code: true,
        package_manager: false,
      };
      const hash1 = execPermHash(perms);
      const hash2 = execPermHash(perms);
      expect(hash1).toBe(hash2);
    });

    it('handles all false permissions', () => {
      const perms: Record<string, unknown> = {
        enabled: false,
        mode: 'disabled',
        execute_javascript: false,
        execute_python: false,
        execute_shell: false,
        compile_code: false,
        package_manager: false,
      };
      const hash = execPermHash(perms);
      expect(hash).toBe('false|disabled|false|false|false|false|false');
    });

    it('handles all true permissions', () => {
      const perms: Record<string, unknown> = {
        enabled: true,
        mode: 'sandbox',
        execute_javascript: true,
        execute_python: true,
        execute_shell: true,
        compile_code: true,
        package_manager: true,
      };
      const hash = execPermHash(perms);
      expect(hash).toBe('true|sandbox|true|true|true|true|true');
    });
  });

  describe('module-level state', () => {
    it('promptInitializedConversations is a Set', () => {
      expect(promptInitializedConversations).toBeInstanceOf(Set);
    });

    it('promptInitializedConversations is initially empty', () => {
      expect(promptInitializedConversations.size).toBe(0);
    });

    it('lastExecPermHash is a Map', () => {
      expect(lastExecPermHash).toBeInstanceOf(Map);
    });

    it('lastExecPermHash is initially empty', () => {
      expect(lastExecPermHash.size).toBe(0);
    });

    it('promptInitializedConversations can be populated', () => {
      promptInitializedConversations.add('conv-1');
      promptInitializedConversations.add('conv-2');
      expect(promptInitializedConversations.size).toBe(2);
      expect(promptInitializedConversations.has('conv-1')).toBe(true);
      expect(promptInitializedConversations.has('conv-2')).toBe(true);
    });

    it('lastExecPermHash can be populated', () => {
      lastExecPermHash.set('user-1', 'hash-abc');
      lastExecPermHash.set('user-2', 'hash-xyz');
      expect(lastExecPermHash.size).toBe(2);
      expect(lastExecPermHash.get('user-1')).toBe('hash-abc');
      expect(lastExecPermHash.get('user-2')).toBe('hash-xyz');
    });
  });
});
