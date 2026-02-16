import { describe, it, expect } from 'vitest';
import {
  qualifyToolName,
  getBaseName,
  getNamespace,
  isQualifiedName,
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

    it('prefixes skill tools with skill.{id}.', () => {
      expect(qualifyToolName('search_web', 'skill', 'web_search')).toBe('skill.web_search.search_web');
    });

    it('does NOT prefix meta-tools', () => {
      expect(qualifyToolName('search_tools', 'core')).toBe('search_tools');
      expect(qualifyToolName('get_tool_help', 'core')).toBe('get_tool_help');
      expect(qualifyToolName('use_tool', 'core')).toBe('use_tool');
      expect(qualifyToolName('batch_use_tool', 'core')).toBe('batch_use_tool');
    });

    it('meta-tools stay unprefixed even with plugin/skill prefix', () => {
      expect(qualifyToolName('use_tool', 'plugin', 'some_plugin')).toBe('use_tool');
      expect(qualifyToolName('search_tools', 'skill', 'some_skill')).toBe('search_tools');
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
});
