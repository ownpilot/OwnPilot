import { describe, it, expect } from 'vitest';
import { parseCommand } from '../../src/commands/parser.ts';

describe('parseCommand', () => {
  // -------------------------------------------------------------------------
  // Valid commands
  // -------------------------------------------------------------------------
  describe('valid commands', () => {
    it.each([
      ['/help', 'help', ''],
      ['/rename foo', 'rename', 'foo'],
      ['/model opus', 'model', 'opus'],
      ['/gsd:health', 'gsd:health', ''],
      ['/gsd:plan-phase', 'gsd:plan-phase', ''],
      ['/add-dir /home/user/project', 'add-dir', '/home/user/project'],
      ['/compact fix the code please', 'compact', 'fix the code please'],
      ['/rename my cool session', 'rename', 'my cool session'],
      ['/effort high', 'effort', 'high'],
      ['/fast on', 'fast', 'on'],
      ['/plan', 'plan', ''],
    ])('parses "%s" → name="%s", args="%s"', (input, expectedName, expectedArgs) => {
      const result = parseCommand(input);
      expect(result).not.toBeNull();
      expect(result!.name).toBe(expectedName);
      expect(result!.args).toBe(expectedArgs);
    });
  });

  // -------------------------------------------------------------------------
  // Non-commands (should return null)
  // -------------------------------------------------------------------------
  describe('non-commands', () => {
    it.each([
      ['hello', 'plain text'],
      ['', 'empty string'],
      ['please /rename foo', 'mid-message slash'],
      ['I want to /help with this', 'slash in middle of sentence'],
      ['/', 'bare slash only'],
      ['/ help', 'space after slash'],
      ['// comment', 'double slash'],
      ['http://example.com', 'URL'],
    ])('returns null for "%s" (%s)', (input) => {
      expect(parseCommand(input)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------
  describe('edge cases', () => {
    it('trims leading whitespace', () => {
      const result = parseCommand('  /help');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('help');
    });

    it('trims trailing whitespace', () => {
      const result = parseCommand('/help   ');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('help');
      expect(result!.args).toBe('');
    });

    it('lowercases command name', () => {
      const result = parseCommand('/HELP');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('help');
    });

    it('lowercases mixed-case command name', () => {
      const result = parseCommand('/ReNaMe foo');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('rename');
      expect(result!.args).toBe('foo');
    });

    it('preserves internal whitespace in args', () => {
      const result = parseCommand('/rename  foo  bar  baz');
      expect(result).not.toBeNull();
      expect(result!.args).toBe('foo  bar  baz');
    });

    it('trims args', () => {
      const result = parseCommand('/rename   foo   ');
      expect(result).not.toBeNull();
      expect(result!.args).toBe('foo');
    });

    it('handles multiline args', () => {
      const result = parseCommand('/compact fix the code\nand also refactor');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('compact');
      expect(result!.args).toBe('fix the code\nand also refactor');
    });

    it('handles colon in command name (skill namespace)', () => {
      const result = parseCommand('/gsd:execute-phase');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('gsd:execute-phase');
    });

    it('handles underscore in command name', () => {
      const result = parseCommand('/my_command arg');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('my_command');
      expect(result!.args).toBe('arg');
    });

    it('handles command with only whitespace args', () => {
      const result = parseCommand('/help     ');
      expect(result).not.toBeNull();
      expect(result!.args).toBe('');
    });

    it('rejects slash followed by space then text', () => {
      expect(parseCommand('/ help')).toBeNull();
    });

    it('handles tab in message before slash', () => {
      const result = parseCommand('\t/help');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('help');
    });

    it('handles newline before slash', () => {
      const result = parseCommand('\n/help');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('help');
    });
  });
});
