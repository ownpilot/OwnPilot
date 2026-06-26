import { describe, it, expect } from 'vitest';
import { isSafeUrl, safeHref, safeDownloadHref, safeExternalHref } from './safe-url';

describe('isSafeUrl', () => {
  it('accepts http and https URLs', () => {
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('https://example.com/path?q=1#frag')).toBe(true);
  });

  it('accepts mailto links', () => {
    expect(isSafeUrl('mailto:alice@example.com')).toBe(true);
  });

  it('rejects javascript: URLs (case + whitespace variants)', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('JavaScript:alert(1)')).toBe(false);
    expect(isSafeUrl('  javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('\tjavascript:alert(1)')).toBe(false);
    // Control-char smuggling — `java\tscript:` is interpreted by some
    // browsers as `javascript:` after stripping the tab.
    expect(isSafeUrl('java\tscript:alert(1)')).toBe(false);
    expect(isSafeUrl('java\nscript:alert(1)')).toBe(false);
  });

  it('rejects data:, vbscript:, file:, blob: URLs', () => {
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeUrl('vbscript:msgbox')).toBe(false);
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeUrl('blob:https://example.com/abc')).toBe(false);
  });

  it('rejects relative and protocol-less inputs', () => {
    expect(isSafeUrl('/relative')).toBe(false);
    expect(isSafeUrl('example.com')).toBe(false);
    expect(isSafeUrl('//attacker.com')).toBe(false);
  });

  it('rejects empty / non-string / unparseable input', () => {
    expect(isSafeUrl('')).toBe(false);
    expect(isSafeUrl(null)).toBe(false);
    expect(isSafeUrl(undefined)).toBe(false);
    expect(isSafeUrl(123)).toBe(false);
    expect(isSafeUrl('http://')).toBe(false);
  });
});

describe('safeHref', () => {
  it('returns the URL when safe', () => {
    expect(safeHref('https://example.com')).toBe('https://example.com');
  });

  it('returns undefined when unsafe', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('')).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });
});

describe('safeExternalHref', () => {
  it('accepts only http(s) URLs for external browser flows', () => {
    expect(safeExternalHref('https://example.com/oauth')).toBe('https://example.com/oauth');
    expect(safeExternalHref('http://localhost:3000/callback')).toBe(
      'http://localhost:3000/callback'
    );
  });

  it('rejects mailto, relative, script, control-char, and whitespace-padded URLs', () => {
    expect(safeExternalHref('mailto:alice@example.com')).toBeUndefined();
    expect(safeExternalHref('/relative')).toBeUndefined();
    expect(safeExternalHref('javascript:alert(1)')).toBeUndefined();
    expect(safeExternalHref('java\tscript:alert(1)')).toBeUndefined();
    expect(safeExternalHref(' https://example.com')).toBeUndefined();
  });
});

describe('safeDownloadHref', () => {
  it('accepts http(s) URLs', () => {
    expect(safeDownloadHref('https://cdn.example.com/file.pdf')).toBe(
      'https://cdn.example.com/file.pdf'
    );
    expect(safeDownloadHref('http://example.com/x')).toBe('http://example.com/x');
  });

  it('accepts blob: object URLs', () => {
    expect(safeDownloadHref('blob:https://example.com/abc')).toBe('blob:https://example.com/abc');
  });

  it('accepts same-origin relative paths (resolved against the app origin)', () => {
    // jsdom origin is http://localhost:3000 by default.
    expect(safeDownloadHref('/api/v1/files/report.csv')).toBe('/api/v1/files/report.csv');
  });

  it('rejects javascript:, data:, vbscript:, file: URLs', () => {
    expect(safeDownloadHref('javascript:alert(1)')).toBeUndefined();
    expect(safeDownloadHref('JavaScript:alert(1)')).toBeUndefined();
    expect(safeDownloadHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeDownloadHref('vbscript:msgbox')).toBeUndefined();
    expect(safeDownloadHref('file:///etc/passwd')).toBeUndefined();
  });

  it('rejects control-char smuggling and whitespace-padded input', () => {
    expect(safeDownloadHref('java\tscript:alert(1)')).toBeUndefined();
    expect(safeDownloadHref('  javascript:alert(1)')).toBeUndefined();
  });

  it('rejects empty / non-string input', () => {
    expect(safeDownloadHref('')).toBeUndefined();
    expect(safeDownloadHref(null)).toBeUndefined();
    expect(safeDownloadHref(undefined)).toBeUndefined();
    expect(safeDownloadHref(123)).toBeUndefined();
  });
});
