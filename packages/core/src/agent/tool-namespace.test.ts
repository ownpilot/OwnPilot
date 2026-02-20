import { describe, it, expect } from 'vitest';
import {
  qualifyToolName,
  getBaseName,
  getNamespace,
  isQualifiedName,
  sanitizeToolName,
  desanitizeToolName,
  UNPREFIXED_META_TOOLS,
} from './tool-namespace.js';

describe('tool-namespace', () => {
  describe('qualifyToolName', () => {
    it('prefixes core tools with core.', () => {
      expect(qualifyToolName('read_file', 'core')).toBe('core.read_file');
      expect(qualifyToolName('send_email', 'core')).toBe('core.send_email');
    });

    it('prefixes custom tools with custom.', () => {
      expect(qualifyToolName('my_parser', 'custom')).toBe('custom.my_parser');
    });

    it('prefixes plugin tools with plugin.{id}.', () => {
      expect(qualifyToolName('send_message', 'plugin', 'telegram')).toBe('plugin.telegram.send_message');
      expect(qualifyToolName('email_send', 'plugin', 'email')).toBe('plugin.email.email_send');
    });

    it('prefixes extension tools with ext.{id}.', () => {
      expect(qualifyToolName('search_web', 'ext', 'web_search')).toBe('ext.web_search.search_web');
    });

    it('does NOT prefix meta-tools', () => {
      expect(qualifyToolName('search_tools', 'core')).toBe('search_tools');
      expect(qualifyToolName('get_tool_help', 'core')).toBe('get_tool_help');
      expect(qualifyToolName('use_tool', 'core')).toBe('use_tool');
      expect(qualifyToolName('batch_use_tool', 'core')).toBe('batch_use_tool');
    });

    it('meta-tools stay unprefixed even with plugin/ext prefix', () => {
      expect(qualifyToolName('use_tool', 'plugin', 'some_plugin')).toBe('use_tool');
      expect(qualifyToolName('search_tools', 'ext', 'some_ext')).toBe('search_tools');
    });
  });

  describe('getBaseName', () => {
    it('extracts base name from qualified name', () => {
      expect(getBaseName('core.read_file')).toBe('read_file');
      expect(getBaseName('custom.my_parser')).toBe('my_parser');
      expect(getBaseName('plugin.telegram.send_message')).toBe('send_message');
      expect(getBaseName('skill.web_search.search_web')).toBe('search_web');
    });

    it('returns the name as-is if no prefix', () => {
      expect(getBaseName('read_file')).toBe('read_file');
      expect(getBaseName('search_tools')).toBe('search_tools');
    });

    it('handles deeply nested names', () => {
      expect(getBaseName('a.b.c.d')).toBe('d');
    });
  });

  describe('getNamespace', () => {
    it('extracts namespace prefix', () => {
      expect(getNamespace('core.read_file')).toBe('core');
      expect(getNamespace('custom.my_tool')).toBe('custom');
      expect(getNamespace('plugin.telegram.send_message')).toBe('plugin');
      expect(getNamespace('skill.web_search.search_web')).toBe('skill');
    });

    it('returns undefined for unprefixed names', () => {
      expect(getNamespace('search_tools')).toBeUndefined();
      expect(getNamespace('read_file')).toBeUndefined();
    });
  });

  describe('isQualifiedName', () => {
    it('returns true for qualified names', () => {
      expect(isQualifiedName('core.read_file')).toBe(true);
      expect(isQualifiedName('plugin.telegram.send')).toBe(true);
    });

    it('returns false for base names', () => {
      expect(isQualifiedName('read_file')).toBe(false);
      expect(isQualifiedName('search_tools')).toBe(false);
    });
  });

  describe('UNPREFIXED_META_TOOLS', () => {
    it('contains exactly 4 meta-tools', () => {
      expect(UNPREFIXED_META_TOOLS.size).toBe(4);
      expect(UNPREFIXED_META_TOOLS.has('search_tools')).toBe(true);
      expect(UNPREFIXED_META_TOOLS.has('get_tool_help')).toBe(true);
      expect(UNPREFIXED_META_TOOLS.has('use_tool')).toBe(true);
      expect(UNPREFIXED_META_TOOLS.has('batch_use_tool')).toBe(true);
    });

    it('does not contain other tools', () => {
      expect(UNPREFIXED_META_TOOLS.has('read_file')).toBe(false);
      expect(UNPREFIXED_META_TOOLS.has('inspect_tool_source')).toBe(false);
    });
  });

  describe('sanitizeToolName', () => {
    it('replaces dots with double underscores', () => {
      expect(sanitizeToolName('core.add_task')).toBe('core__add_task');
      expect(sanitizeToolName('plugin.telegram.send_message')).toBe('plugin__telegram__send_message');
      expect(sanitizeToolName('ext.web_search.search_web')).toBe('ext__web_search__search_web');
    });

    it('leaves names without dots unchanged', () => {
      expect(sanitizeToolName('search_tools')).toBe('search_tools');
      expect(sanitizeToolName('use_tool')).toBe('use_tool');
      expect(sanitizeToolName('read_file')).toBe('read_file');
    });

    it('handles empty string', () => {
      expect(sanitizeToolName('')).toBe('');
    });
  });

  describe('desanitizeToolName', () => {
    it('replaces double underscores with dots', () => {
      expect(desanitizeToolName('core__add_task')).toBe('core.add_task');
      expect(desanitizeToolName('plugin__telegram__send_message')).toBe('plugin.telegram.send_message');
      expect(desanitizeToolName('ext__web_search__search_web')).toBe('ext.web_search.search_web');
    });

    it('leaves names without double underscores unchanged', () => {
      expect(desanitizeToolName('search_tools')).toBe('search_tools');
      expect(desanitizeToolName('use_tool')).toBe('use_tool');
      expect(desanitizeToolName('read_file')).toBe('read_file');
    });

    it('handles empty string', () => {
      expect(desanitizeToolName('')).toBe('');
    });

    it('preserves single underscores', () => {
      expect(desanitizeToolName('add_task')).toBe('add_task');
      expect(desanitizeToolName('list_calendar_events')).toBe('list_calendar_events');
    });
  });

  describe('sanitize/desanitize roundtrip', () => {
    const names = [
      'core.read_file',
      'custom.my_parser',
      'plugin.telegram.send_message',
      'ext.web_search.search_web',
      'search_tools',
      'use_tool',
      'batch_use_tool',
      'get_tool_help',
    ];

    it.each(names)('roundtrips %s correctly', (name) => {
      expect(desanitizeToolName(sanitizeToolName(name))).toBe(name);
    });
  });

  describe('sanitize edge cases', () => {
    it('handles name that is just a dot', () => {
      expect(sanitizeToolName('.')).toBe('__');
      expect(desanitizeToolName('__')).toBe('.');
    });

    it('handles multiple consecutive dots', () => {
      expect(sanitizeToolName('a..b')).toBe('a____b');
    });

    it('does not corrupt triple underscores (single underscore is NOT a separator)', () => {
      // A name with ___ should stay ___ after sanitize (no dots to replace)
      expect(sanitizeToolName('foo___bar')).toBe('foo___bar');
    });

    it('handles names starting or ending with dot', () => {
      expect(sanitizeToolName('.leading')).toBe('__leading');
      expect(sanitizeToolName('trailing.')).toBe('trailing__');
    });
  });
});
