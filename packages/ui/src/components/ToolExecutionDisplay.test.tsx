import { describe, expect, it } from 'vitest';
import { resolveWorkspaceImageUrl } from './ToolExecutionDisplay';

describe('resolveWorkspaceImageUrl', () => {
  it('passes remote image URLs through', () => {
    expect(resolveWorkspaceImageUrl('https://cdn.example.com/a.png')).toBe(
      'https://cdn.example.com/a.png'
    );
    expect(resolveWorkspaceImageUrl('//cdn.example.com/a.png')).toBe('//cdn.example.com/a.png');
  });

  it('resolves safe workspace-relative image paths', () => {
    expect(resolveWorkspaceImageUrl('sub dir/a&b.png', 'ws-1')).toBe(
      '/api/v1/file-workspaces/ws-1/file/sub%20dir/a%26b.png?raw=true'
    );
  });

  it('blocks data URIs, scripts, traversal, and local paths without workspace context', () => {
    expect(resolveWorkspaceImageUrl('data:image/svg+xml,<svg onload=alert(1)>', 'ws-1')).toBeNull();
    expect(resolveWorkspaceImageUrl('javascript:alert(1)', 'ws-1')).toBeNull();
    expect(resolveWorkspaceImageUrl('../../../secret.png', 'ws-1')).toBeNull();
    expect(resolveWorkspaceImageUrl('relative.png')).toBeNull();
  });
});
