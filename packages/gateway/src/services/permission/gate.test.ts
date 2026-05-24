/**
 * DefaultPermissionGate tests — pin the three filters this Phase A
 * implementation absorbs from the old soul-heartbeat onBeforeToolCall
 * callback: skillAccessBlocked, skillAccessAllowed, allowedTools.
 */

import { describe, it, expect } from 'vitest';
import { DefaultPermissionGate } from './gate.js';

describe('DefaultPermissionGate', () => {
  const gate = new DefaultPermissionGate();

  it('allows when no context is provided', async () => {
    const decision = await gate.check({ actorId: 'a', tool: 'core.foo' });
    expect(decision.type).toBe('allow');
  });

  it('allows when context is empty', async () => {
    const decision = await gate.check({ actorId: 'a', tool: 'core.foo', context: {} });
    expect(decision.type).toBe('allow');
  });

  describe('skillAccessBlocked', () => {
    it('denies a tool from a blocked extension (ext.{id}.*)', async () => {
      const decision = await gate.check({
        actorId: 'a',
        tool: 'ext.untrusted.do_something',
        context: { skillAccessBlocked: ['untrusted'] },
      });
      expect(decision.type).toBe('deny');
      if (decision.type === 'deny') {
        expect(decision.reason).toContain('blocked');
      }
    });

    it('denies a tool from a blocked skill (skill.{id}.*)', async () => {
      const decision = await gate.check({
        actorId: 'a',
        tool: 'skill.malware.exec',
        context: { skillAccessBlocked: ['malware'] },
      });
      expect(decision.type).toBe('deny');
    });

    it('allows a tool not in the block list', async () => {
      const decision = await gate.check({
        actorId: 'a',
        tool: 'ext.trusted.do_something',
        context: { skillAccessBlocked: ['untrusted'] },
      });
      expect(decision.type).toBe('allow');
    });
  });

  describe('skillAccessAllowed', () => {
    it('allows an extension tool from an allowed extension', async () => {
      const decision = await gate.check({
        actorId: 'a',
        tool: 'ext.foo.run',
        context: { skillAccessAllowed: ['foo', 'bar'] },
      });
      expect(decision.type).toBe('allow');
    });

    it('denies an extension tool not from an allowed extension', async () => {
      const decision = await gate.check({
        actorId: 'a',
        tool: 'ext.bad.run',
        context: { skillAccessAllowed: ['foo'] },
      });
      expect(decision.type).toBe('deny');
    });

    it('ignores non-extension tools when skillAccessAllowed is set', async () => {
      const decision = await gate.check({
        actorId: 'a',
        tool: 'core.read_file',
        context: { skillAccessAllowed: ['foo'] },
      });
      expect(decision.type).toBe('allow');
    });
  });

  describe('allowedTools', () => {
    it('allows when the tool matches by exact name', async () => {
      const decision = await gate.check({
        actorId: 'a',
        tool: 'add_task',
        context: { allowedTools: ['add_task', 'list_tasks'] },
      });
      expect(decision.type).toBe('allow');
    });

    it('allows when the tool matches by base name (namespaced)', async () => {
      const decision = await gate.check({
        actorId: 'a',
        tool: 'core.add_task',
        context: { allowedTools: ['add_task'] },
      });
      expect(decision.type).toBe('allow');
    });

    it('denies when the tool is not in allowedTools', async () => {
      const decision = await gate.check({
        actorId: 'a',
        tool: 'core.delete_everything',
        context: { allowedTools: ['add_task'] },
      });
      expect(decision.type).toBe('deny');
      if (decision.type === 'deny') {
        expect(decision.reason).toContain('not in actor');
      }
    });
  });

  describe('layered policy', () => {
    it('blocked takes precedence over allowed', async () => {
      const decision = await gate.check({
        actorId: 'a',
        tool: 'ext.foo.run',
        context: {
          skillAccessBlocked: ['foo'],
          skillAccessAllowed: ['foo'],
        },
      });
      expect(decision.type).toBe('deny');
    });

    it('passes all three filters when policies are consistent', async () => {
      const decision = await gate.check({
        actorId: 'a',
        tool: 'ext.foo.run',
        context: {
          skillAccessBlocked: ['bar'],
          skillAccessAllowed: ['foo'],
          allowedTools: ['run'],
        },
      });
      expect(decision.type).toBe('allow');
    });
  });
});
