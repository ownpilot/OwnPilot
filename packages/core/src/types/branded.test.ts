import { describe, it, expect } from 'vitest';
import {
  createUserId,
  createSessionId,
  createPluginId,
  createChannelId,
  createMessageId,
  createAuditEventId,
  createToolId,
  unsafeUserId,
  unsafePluginId,
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
    it('creates valid PluginId from lowercase alphanumeric', () => {
      const id = createPluginId('my-plugin');
      expect(id).toBe('my-plugin');
    });

    it('allows single character', () => {
      const id = createPluginId('a');
      expect(id).toBe('a');
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
      const longId = 'a'.repeat(51);
      expect(() => createPluginId(longId)).toThrow('Invalid PluginId format');
    });
  });

  describe('createChannelId', () => {
    it('creates valid ChannelId with type:id format', () => {
      const id = createChannelId('telegram:123456');
      expect(id).toBe('telegram:123456');
    });

    it('throws for missing colon', () => {
      expect(() => createChannelId('telegramid')).toThrow('Invalid ChannelId format');
    });

    it('throws for too short', () => {
      expect(() => createChannelId('a:')).toThrow('Invalid ChannelId format');
    });
  });

  describe('createMessageId', () => {
    it('creates valid MessageId', () => {
      const id = createMessageId('msg-123');
      expect(id).toBe('msg-123');
    });

    it('throws for empty string', () => {
      expect(() => createMessageId('')).toThrow('MessageId cannot be empty');
    });
  });

  describe('createAuditEventId', () => {
    it('creates valid AuditEventId from UUID', () => {
      const id = createAuditEventId('01903e4c-7a8b-7c9d-8e0f-123456789abc');
      expect(id).toBe('01903e4c-7a8b-7c9d-8e0f-123456789abc');
    });

    it('throws for invalid format', () => {
      expect(() => createAuditEventId('not-uuid')).toThrow('Invalid AuditEventId format');
    });
  });

  describe('createToolId', () => {
    it('creates valid ToolId', () => {
      const id = createToolId('web_fetch');
      expect(id).toBe('web_fetch');
    });

    it('throws for empty string', () => {
      expect(() => createToolId('')).toThrow('ToolId must be 1-100 characters');
    });

    it('throws for too long', () => {
      const longId = 'a'.repeat(101);
      expect(() => createToolId(longId)).toThrow('ToolId must be 1-100 characters');
    });
  });

  describe('unsafe constructors', () => {
    it('unsafeUserId skips validation', () => {
      const id = unsafeUserId('anything');
      expect(id).toBe('anything');
    });

    it('unsafePluginId skips validation', () => {
      const id = unsafePluginId('UPPERCASE');
      expect(id).toBe('UPPERCASE');
    });
  });

  describe('type safety', () => {
    it('prevents mixing branded types at compile time', () => {
      // This is a compile-time check, not a runtime test
      // The following would cause a TypeScript error:
      // const userId: UserId = createSessionId('550e8400-e29b-41d4-a716-446655440000');

      // We can only verify runtime behavior
      const userId = createUserId('550e8400-e29b-41d4-a716-446655440000');
      const sessionId = createSessionId('550e8400-e29b-41d4-a716-446655440000');

      // At runtime, they're the same string, but TypeScript prevents mixing
      expect(userId === sessionId).toBe(true);
    });
  });
});
