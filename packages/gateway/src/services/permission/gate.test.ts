/**
 * DefaultPermissionGate tests — pin the three filters this Phase A
 * implementation absorbs from the old soul-heartbeat onBeforeToolCall
 * callback: skillAccessBlocked, skillAccessAllowed, allowedTools.
 */

import { describe, it, expect } from 'vitest';
import type { ClawAutonomyPolicy } from '@ownpilot/core';
import { DefaultPermissionGate, evaluateAutonomyPolicy } from './gate.js';

function policy(overrides: Partial<ClawAutonomyPolicy> = {}): ClawAutonomyPolicy {
  return {
    allowSelfModify: true,
    allowSubclaws: true,
    requireEvidence: false,
    destructiveActionPolicy: 'allow',
    filesystemScopes: [],
    ...overrides,
  };
}

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

  describe('autonomyPolicy enforcement (via check)', () => {
    it('denies a destructive tool when destructiveActionPolicy is block', async () => {
      const decision = await gate.check({
        actorId: 'claw-1',
        tool: 'core.delete_file',
        context: {
          actorType: 'claw',
          autonomyPolicy: policy({ destructiveActionPolicy: 'block' }),
          args: { path: '/ws/notes.txt' },
          workspaceDir: '/ws',
        },
      });
      expect(decision.type).toBe('deny');
    });

    it('requires approval for a destructive tool when policy is ask', async () => {
      const decision = await gate.check({
        actorId: 'claw-1',
        tool: 'send_email',
        context: { actorType: 'claw', autonomyPolicy: policy({ destructiveActionPolicy: 'ask' }) },
      });
      expect(decision.type).toBe('require_approval');
    });

    it('allows a destructive tool when policy is allow', async () => {
      const decision = await gate.check({
        actorId: 'claw-1',
        tool: 'send_email',
        context: {
          actorType: 'claw',
          autonomyPolicy: policy({ destructiveActionPolicy: 'allow' }),
        },
      });
      expect(decision.type).toBe('allow');
    });

    it('does nothing when no autonomyPolicy is present (back-compat)', async () => {
      const decision = await gate.check({
        actorId: 'claw-1',
        tool: 'core.delete_file',
        context: { actorType: 'claw', args: { path: '/etc/passwd' } },
      });
      expect(decision.type).toBe('allow');
    });
  });
});

describe('evaluateAutonomyPolicy (pure)', () => {
  it('denies claw_update_config when allowSelfModify is false', () => {
    const d = evaluateAutonomyPolicy('claw_update_config', {}, policy({ allowSelfModify: false }));
    expect(d.type).toBe('deny');
  });

  it('allows claw_update_config when allowSelfModify is true', () => {
    const d = evaluateAutonomyPolicy('claw_update_config', {}, policy({ allowSelfModify: true }));
    expect(d.type).toBe('allow');
  });

  it('denies claw_spawn_subclaw when allowSubclaws is false', () => {
    const d = evaluateAutonomyPolicy('claw_spawn_subclaw', {}, policy({ allowSubclaws: false }));
    expect(d.type).toBe('deny');
  });

  it('denies a file path outside the workspace + scopes', () => {
    const d = evaluateAutonomyPolicy(
      'core.write_file',
      { file_path: '/etc/shadow' },
      policy(),
      '/ws'
    );
    expect(d.type).toBe('deny');
    if (d.type === 'deny') expect(d.reason).toContain('filesystem scope');
  });

  it('allows a file path inside the workspace', () => {
    const d = evaluateAutonomyPolicy(
      'core.write_file',
      { file_path: 'sub/out.txt' },
      policy(),
      '/ws'
    );
    expect(d.type).toBe('allow');
  });

  it('allows a file path inside an extra granted scope', () => {
    const d = evaluateAutonomyPolicy(
      'core.write_file',
      { file_path: '/srv/data/x.json' },
      policy({ filesystemScopes: ['/srv/data'] }),
      '/ws'
    );
    expect(d.type).toBe('allow');
  });

  it('blocks a path-traversal escape from the workspace', () => {
    const d = evaluateAutonomyPolicy(
      'core.read_file',
      { path: '../../etc/passwd' },
      policy(),
      '/ws'
    );
    expect(d.type).toBe('deny');
  });

  it('treats a shell script with rm -rf as destructive', () => {
    const d = evaluateAutonomyPolicy(
      'claw_run_script',
      { language: 'shell', script: 'rm -rf /' },
      policy({ destructiveActionPolicy: 'block' })
    );
    expect(d.type).toBe('deny');
  });

  it('treats a benign shell script as non-destructive', () => {
    const d = evaluateAutonomyPolicy(
      'claw_run_script',
      { language: 'shell', script: 'echo hello && ls' },
      policy({ destructiveActionPolicy: 'block' })
    );
    expect(d.type).toBe('allow');
  });

  it('flags git push --force as destructive', () => {
    const d = evaluateAutonomyPolicy(
      'claw_run_script',
      { script: 'git push --force origin main' },
      policy({ destructiveActionPolicy: 'block' })
    );
    expect(d.type).toBe('deny');
  });
});
