/**
 * URL-safety helpers for rendered markdown — link gating and image URL
 * resolution (blocks data: URIs and workspace path-traversal). Extracted
 * from MarkdownContent.tsx so the security logic is independently testable.
 */
import { isSafeUrl as isSafeUrlShared } from '../utils/safe-url';

/**
 * Gate for markdown links. Delegates to the shared safe-url helper so we
 * pick up the same defenses as the rest of the app:
 *   - control-character smuggling (`java\tscript:`, `java\rscript:`)
 *   - leading/trailing whitespace bypass (`  javascript:...`)
 *   - non-string inputs
 *   - mailto: now allowed (markdown commonly uses `[contact](mailto:...)`)
 *
 * The previous hand-rolled helper accepted http/https only and was lenient
 * with whitespace/control characters; a single inconsistency between local
 * helpers like this is exactly the class of bug H6 is meant to eliminate.
 */
export function isSafeUrl(url: string): boolean {
  return isSafeUrlShared(url);
}

// =============================================================================
// Image URL helpers
// =============================================================================

/** 1x1 transparent GIF returned for blocked image URLs. */
export const BLOCKED_IMG_PLACEHOLDER =
  'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const CTRL_CHAR_RE = /[\u0000-\u001F\u007F]/;
const ABSOLUTE_SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:']);

function hasBlockedImageUrlSyntax(url: string): boolean {
  if (url.length === 0 || url !== url.trim() || CTRL_CHAR_RE.test(url)) return true;

  if (url.startsWith('//')) {
    try {
      const parsed = new URL(url, 'https://ownpilot.local');
      return !SAFE_IMAGE_PROTOCOLS.has(parsed.protocol);
    } catch {
      return true;
    }
  }

  if (!ABSOLUTE_SCHEME_RE.test(url)) return false;

  try {
    const parsed = new URL(url);
    return !SAFE_IMAGE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return true;
  }
}

function isRemoteImageUrl(url: string): boolean {
  if (url.startsWith('//')) return true;
  if (!ABSOLUTE_SCHEME_RE.test(url)) return false;

  try {
    const parsed = new URL(url);
    return SAFE_IMAGE_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

export function resolveImageUrl(url: string, workspaceId?: string | null): string {
  if (hasBlockedImageUrlSyntax(url)) return BLOCKED_IMG_PLACEHOLDER;
  if (isRemoteImageUrl(url)) return url;

  if (workspaceId) {
    // Reject path-traversal segments and absolute Windows drive paths.
    // Without this, an LLM-generated `![](../../../secrets.txt)` would be
    // rendered as `<img src="/api/v1/file-workspaces/.../file/../../../secrets.txt">`
    // — the browser fetches it with the user's session cookie, exposing
    // arbitrary workspace files (and any cross-workspace data the gateway
    // route doesn't separately re-validate).
    const cleanPath = url.replace(/^[/\\]+/, '');
    const isUnsafe =
      cleanPath.includes('\0') ||
      /(^|[/\\])\.\.([/\\]|$)/.test(cleanPath) ||
      /^[a-zA-Z]:[/\\]/.test(cleanPath) || // Windows drive: C:\, D:/
      cleanPath.startsWith('\\\\'); // UNC: \\server\share
    if (isUnsafe) return BLOCKED_IMG_PLACEHOLDER;
    // Encode each path segment so `?`/`#`/`%` cannot reshape the URL.
    const safePath = cleanPath.split(/[/\\]/).filter(Boolean).map(encodeURIComponent).join('/');
    return `/api/v1/file-workspaces/${encodeURIComponent(workspaceId)}/file/${safePath}?raw=true`;
  }
  return url;
}
