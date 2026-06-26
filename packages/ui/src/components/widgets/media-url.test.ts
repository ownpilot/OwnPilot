import { describe, expect, it } from 'vitest';
import { safeAudioSrc, safeEmbedSrc, safeImageSrc, safeVideoSrc } from './media-url';

describe('widget media URL safety', () => {
  it('allows remote media URLs and safe image data URLs', () => {
    expect(safeImageSrc('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(safeImageSrc('//cdn.example.com/a.png')).toBe('//cdn.example.com/a.png');
    expect(safeImageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
  });

  it('blocks script schemes, SVG data images, relative paths, and smuggled control chars', () => {
    expect(safeImageSrc('javascript:alert(1)')).toBeUndefined();
    expect(safeImageSrc('data:image/svg+xml,<svg onload=alert(1)>')).toBeUndefined();
    expect(safeImageSrc('relative.png')).toBeUndefined();
    expect(safeImageSrc('java\tscript:alert(1)')).toBeUndefined();
    expect(safeImageSrc(' https://example.com/a.png')).toBeUndefined();
  });

  it('allows only media data MIME families for audio and video', () => {
    expect(safeAudioSrc('data:audio/mpeg;base64,AAAA')).toBe('data:audio/mpeg;base64,AAAA');
    expect(safeVideoSrc('data:video/mp4;base64,AAAA')).toBe('data:video/mp4;base64,AAAA');
    expect(safeAudioSrc('data:text/html;base64,AAAA')).toBeUndefined();
    expect(safeVideoSrc('data:text/html;base64,AAAA')).toBeUndefined();
  });

  it('allows only external web URLs for embeds', () => {
    expect(safeEmbedSrc('https://example.com/embed')).toBe('https://example.com/embed');
    expect(safeEmbedSrc('mailto:alice@example.com')).toBeUndefined();
    expect(safeEmbedSrc('javascript:alert(1)')).toBeUndefined();
  });
});
