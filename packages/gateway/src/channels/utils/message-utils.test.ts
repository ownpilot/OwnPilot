import { describe, it, expect } from 'vitest';
import { splitMessage, PLATFORM_MESSAGE_LIMITS } from './message-utils.js';

describe('message-utils', () => {
  describe('PLATFORM_MESSAGE_LIMITS', () => {
    it('should have telegram limit of 4096', () => {
      expect(PLATFORM_MESSAGE_LIMITS.telegram).toBe(4096);
    });
  });

  describe('splitMessage', () => {
    it('should return single part for short messages', () => {
      expect(splitMessage('Hello', 100)).toEqual(['Hello']);
    });

    it('should return single part when exactly at limit', () => {
      const msg = 'a'.repeat(100);
      expect(splitMessage(msg, 100)).toEqual([msg]);
    });

    it('should split at newline when available', () => {
      const msg = 'Line one\nLine two\nLine three';
      const parts = splitMessage(msg, 18);
      expect(parts[0]).toBe('Line one\nLine two');
      expect(parts[1]).toBe('Line three');
    });

    it('should split at space when no newline in range', () => {
      const msg = 'word1 word2 word3 word4 word5';
      const parts = splitMessage(msg, 17);
      expect(parts[0]).toBe('word1 word2 word3');
      expect(parts[1]).toBe('word4 word5');
    });

    it('should hard-cut when no suitable break point', () => {
      const msg = 'a'.repeat(200);
      const parts = splitMessage(msg, 100);
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe('a'.repeat(100));
      expect(parts[1]).toBe('a'.repeat(100));
    });

    it('should handle multiple splits', () => {
      const msg = 'a'.repeat(300);
      const parts = splitMessage(msg, 100);
      expect(parts).toHaveLength(3);
      parts.forEach(p => expect(p.length).toBeLessThanOrEqual(100));
    });

    it('should trim leading whitespace on continuation parts', () => {
      const msg = 'Hello world this is a test';
      const parts = splitMessage(msg, 12);
      for (let i = 1; i < parts.length; i++) {
        expect(parts[i]![0]).not.toBe(' ');
      }
    });

    it('should handle empty string', () => {
      expect(splitMessage('', 100)).toEqual(['']);
    });

    it('should prefer newline over space for splitting', () => {
      const msg = 'aaaa bbbb\ncccc dddd';
      // maxLength = 14: newline is at index 9, space at 4
      const parts = splitMessage(msg, 14);
      expect(parts[0]).toBe('aaaa bbbb');
      expect(parts[1]).toBe('cccc dddd');
    });
  });
});
