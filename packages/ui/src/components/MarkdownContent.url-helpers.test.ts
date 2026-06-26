import { describe, it, expect } from 'vitest';
import { isSafeUrl, resolveImageUrl, BLOCKED_IMG_PLACEHOLDER } from './MarkdownContent.url-helpers';

describe('isSafeUrl', () => {
  it('allows http/https/mailto', () => {
    expect(isSafeUrl('https://example.com')).toBe(true);
    expect(isSafeUrl('http://example.com')).toBe(true);
    expect(isSafeUrl('mailto:a@b.com')).toBe(true);
  });

  it('rejects javascript: and control-char smuggling', () => {
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('  javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('java\tscript:alert(1)')).toBe(false);
  });
});

describe('resolveImageUrl', () => {
  it('passes http/https through unchanged', () => {
    expect(resolveImageUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png');
    expect(resolveImageUrl('http://x/y.png')).toBe('http://x/y.png');
    expect(resolveImageUrl('//cdn.example.com/a.png')).toBe('//cdn.example.com/a.png');
  });

  it('blocks unsafe absolute image URL schemes', () => {
    expect(resolveImageUrl('data:image/svg+xml,<svg onload=alert(1)>')).toBe(
      BLOCKED_IMG_PLACEHOLDER
    );
    expect(resolveImageUrl('DATA:image/svg+xml,<svg onload=alert(1)>')).toBe(
      BLOCKED_IMG_PLACEHOLDER
    );
    expect(resolveImageUrl('javascript:alert(1)')).toBe(BLOCKED_IMG_PLACEHOLDER);
    expect(resolveImageUrl('file:///etc/passwd')).toBe(BLOCKED_IMG_PLACEHOLDER);
  });

  it('blocks image URL whitespace and control-character smuggling', () => {
    expect(resolveImageUrl(' https://cdn.example.com/a.png')).toBe(BLOCKED_IMG_PLACEHOLDER);
    expect(resolveImageUrl('java\tscript:alert(1)')).toBe(BLOCKED_IMG_PLACEHOLDER);
  });

  it('returns the raw url unchanged when there is no workspace', () => {
    expect(resolveImageUrl('relative/path.png')).toBe('relative/path.png');
  });

  it('blocks workspace path traversal', () => {
    expect(resolveImageUrl('../../../secrets.txt', 'ws1')).toBe(BLOCKED_IMG_PLACEHOLDER);
    expect(resolveImageUrl('a/../../b.png', 'ws1')).toBe(BLOCKED_IMG_PLACEHOLDER);
  });

  it('blocks Windows drive paths in a workspace', () => {
    expect(resolveImageUrl('C:\\Windows\\x.png', 'ws1')).toBe(BLOCKED_IMG_PLACEHOLDER);
  });

  it('neutralizes a UNC prefix by stripping leading separators (stays workspace-confined)', () => {
    // Leading separators are stripped first, so `\\server\share` collapses to the
    // relative path `server/share/...` and resolves inside the workspace — harmless.
    expect(resolveImageUrl('\\\\server\\share\\x.png', 'ws1')).toBe(
      '/api/v1/file-workspaces/ws1/file/server/share/x.png?raw=true'
    );
  });

  it('blocks null bytes', () => {
    expect(resolveImageUrl('a\0b.png', 'ws1')).toBe(BLOCKED_IMG_PLACEHOLDER);
  });

  it('builds an encoded workspace file URL for a safe relative path', () => {
    expect(resolveImageUrl('sub dir/a&b.png', 'ws-1')).toBe(
      '/api/v1/file-workspaces/ws-1/file/sub%20dir/a%26b.png?raw=true'
    );
  });

  it('strips leading slashes before resolving', () => {
    expect(resolveImageUrl('/leading.png', 'ws1')).toBe(
      '/api/v1/file-workspaces/ws1/file/leading.png?raw=true'
    );
  });
});
