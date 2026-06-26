import { describe, it, expect } from 'vitest';
import { approximateTokenCount } from './shared.js';
import type { Message } from '../types.js';

describe('approximateTokenCount', () => {
  it('estimates string content as chars/4', () => {
    const messages: Message[] = [{ role: 'user', content: 'a'.repeat(40) }];
    expect(approximateTokenCount(messages)).toBe(10);
  });

  it('sums text parts of structured content', () => {
    const messages: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a'.repeat(20) },
          { type: 'text', text: 'b'.repeat(20) },
        ],
      },
    ];
    expect(approximateTokenCount(messages)).toBe(10);
  });

  it('ignores non-text parts (images/files), counting only text', () => {
    const mixed: Message[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'a'.repeat(40) },
          { type: 'image', data: 'base64data', mediaType: 'image/png' },
          { type: 'file', name: 'a.txt', data: 'x'.repeat(40), mimeType: 'text/plain' },
        ],
      },
    ];
    // Only the 40 text chars count → 10 tokens; image/file parts are ignored
    // (matches the documented countTokens behavior across providers).
    expect(approximateTokenCount(mixed)).toBe(10);
  });

  it('returns 0 for empty input', () => {
    expect(approximateTokenCount([])).toBe(0);
  });
});
