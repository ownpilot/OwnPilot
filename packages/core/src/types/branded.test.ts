import { describe, it, expect } from 'vitest';
import {
  createUserId,
  createSessionId,
  createPluginId,
  createChannelId,
  createMessageId,
  createAuditEventId,
  createToolId,
  createConversationId,
  unsafeUserId,
  unsafeSessionId,
  unsafePluginId,
  unsafeChannelId,
  unsafeMessageId,
  unsafeAuditEventId,
  unsafeToolId,
  unsafeConversationId,
} from './branded.js';

describe('Branded Types', () => {
  describe('createUserId', () => {
    it('creates valid UserId from UUID', () => {
      const id = createUserId('550e8400-e29b-41d4-a716-446655440000');
      expect(id).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
    it('throws for invalid UUID', () => {
      expect(() => createUserId('not-a-uuid')).toThrow('Invalid UserId format');
    });
    it('throws for empty string', () => {
      expect(() => createUserId('')).toThrow('Invalid UserId format');
    });
    it('accepts uppercase hex in UUID', () => {
      const id = createUserId('550E8400-E29B-41D4-A716-446655440000');
      expect(id).toBe('550E8400-E29B-41D4-A716-446655440000');
    });
  });

  describe('createSessionId', () => {
    it('creates valid SessionId from UUID', () => {
      const id = createSessionId('123e4567-e89b-12d3-a456-426614174000');
      expect(id).toBe('123e4567-e89b-12d3-a456-426614174000');
    });
    it('throws for invalid format', () => {
      expect(() => createSessionId('invalid')).toThrow('Invalid SessionId format');
    });
  });

  describe('createPluginId', () => {
    it('creates valid PluginId', () => {
      expect(createPluginId('my-plugin')).toBe('my-plugin');
    });
    it('allows single character', () => {
      expect(createPluginId('a')).toBe('a');
    });
    it('throws for uppercase', () => {
      expect(() => createPluginId('My-Plugin')).toThrow('Invalid PluginId format');
    });
    it('throws for starting with hyphen', () => {
      expect(() => createPluginId('-plugin')).toThrow('Invalid PluginId format');
    });
    it('throws for ending with hyphen', () => {
      expect(() => createPluginId('plugin-')).toThrow('Invalid PluginId format');
    });
    it('throws for too long id', () => {
      expect(() => createPluginId('a'.repeat(51))).toThrow('Invalid PluginId format');
    });
    it('allows exactly 50 characters', () => {
      const id = 'a'.repeat(50);
      expect(createPluginId(id)).toBe(id);
    });
    it('allows numeric only', () => {
      expect(createPluginId('123')).toBe('123');
    });
    it('throws for empty string', () => {
      expect(() => createPluginId('')).toThrow('Invalid PluginId format');
    });
  });

  describe('createChannelId', () => {
    it('creates valid ChannelId', () => {
      expect(createChannelId('telegram:123456')).toBe('telegram:123456');
    });
    it('throws for missing colon', () => {
      expect(() => createChannelId('telegramid')).toThrow('Invalid ChannelId format');
    });
    it('throws for too short', () => {
      expect(() => createChannelId('a:')).toThrow('Invalid ChannelId format');
    });
    it('accepts minimum valid format', () => {
      expect(createChannelId('a:b')).toBe('a:b');
    });
  });

  describe('createMessageId', () => {
    it('creates valid MessageId', () => {
      expect(createMessageId('msg-123')).toBe('msg-123');
    });
    it('throws for empty string', () => {
      expect(() => createMessageId('')).toThrow('MessageId cannot be empty');
    });
    it('accepts single character', () => {
      expect(createMessageId('x')).toBe('x');
    });
  });

  describe('createAuditEventId', () => {
    it('creates valid AuditEventId from UUID', () => {
      expect(createAuditEventId('01903e4c-7a8b-7c9d-8e0f-123456789abc')).toBe(
        '01903e4c-7a8b-7c9d-8e0f-123456789abc'
      );
    });
    it('throws for invalid format', () => {
      expect(() => createAuditEventId('not-uuid')).toThrow('Invalid AuditEventId format');
    });
  });

  describe('createToolId', () => {
    it('creates valid ToolId', () => {
      expect(createToolId('web_fetch')).toBe('web_fetch');
    });
    it('throws for empty string', () => {
      expect(() => createToolId('')).toThrow('ToolId must be 1-100 characters');
    });
    it('throws for too long', () => {
      expect(() => createToolId('a'.repeat(101))).toThrow('ToolId must be 1-100 characters');
    });
    it('accepts exactly 100 characters', () => {
      const id = 'a'.repeat(100);
      expect(createToolId(id)).toBe(id);
    });
    it('accepts single character', () => {
      expect(createToolId('x')).toBe('x');
    });
  });

  describe('createConversationId', () => {
    it('creates valid ConversationId from UUID', () => {
      expect(createConversationId('550e8400-e29b-41d4-a716-446655440000')).toBe(
        '550e8400-e29b-41d4-a716-446655440000'
      );
    });
    it('throws for invalid format', () => {
      expect(() => createConversationId('not-a-uuid')).toThrow('Invalid ConversationId format');
    });
    it('throws for empty string', () => {
      expect(() => createConversationId('')).toThrow('Invalid ConversationId format');
    });
    it('accepts uppercase hex', () => {
      expect(createConversationId('AABBCCDD-1122-3344-5566-778899AABBCC')).toBe(
        'AABBCCDD-1122-3344-5566-778899AABBCC'
      );
    });
  });

  describe('unsafe constructors', () => {
    it('unsafeUserId skips validation', () => {
      expect(unsafeUserId('anything')).toBe('anything');
    });
    it('unsafeSessionId skips validation', () => {
      expect(unsafeSessionId('not-uuid')).toBe('not-uuid');
    });
    it('unsafePluginId skips validation', () => {
      expect(unsafePluginId('UPPERCASE')).toBe('UPPERCASE');
    });
    it('unsafeChannelId skips validation', () => {
      expect(unsafeChannelId('no-colon')).toBe('no-colon');
    });
    it('unsafeMessageId skips validation', () => {
      expect(unsafeMessageId('')).toBe('');
    });
    it('unsafeAuditEventId skips validation', () => {
      expect(unsafeAuditEventId('bad')).toBe('bad');
    });
    it('unsafeToolId skips validation', () => {
      expect(unsafeToolId('')).toBe('');
    });
    it('unsafeConversationId skips validation', () => {
      expect(unsafeConversationId('arbitrary')).toBe('arbitrary');
    });
  });

  describe('type safety', () => {
    it('prevents mixing branded types at compile time', () => {
      const userId = createUserId('550e8400-e29b-41d4-a716-446655440000');
      const sessionId = createSessionId('550e8400-e29b-41d4-a716-446655440000');
      expect(userId === sessionId).toBe(true);
    });
  });
});
