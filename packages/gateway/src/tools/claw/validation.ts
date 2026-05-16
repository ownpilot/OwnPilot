/**
 * Claw Tool Validation Helpers
 *
 * Pure validators used by claw tool executors. Kept side-effect-free so they
 * can be unit-tested without spinning up the claw runtime.
 */

const PACKAGE_NAME_RE = /^[@a-z0-9][\w./-]*$/i;

export function validatePackageName(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (name.includes('&&') || name.includes('||') || name.includes(';') || name.includes('`'))
    return false;
  return PACKAGE_NAME_RE.test(name);
}

const TOOL_NAME_RE = /^[a-z][a-z0-9_]*$/;

export function validateToolName(name: string): boolean {
  return TOOL_NAME_RE.test(name) && name.length <= 64;
}

/**
 * Cap large script output so a single tool call doesn't blow the cycle's
 * conversation context. Returns the original string if under the cap, or a
 * head + truncation marker + tail slice. Default 32KB total (16KB each end).
 */
export function truncateScriptOutput(text: string, maxBytes = 32_768): string {
  if (!text) return text;
  if (Buffer.byteLength(text, 'utf-8') <= maxBytes) return text;
  const halfLen = Math.floor(maxBytes / 2);
  const head = text.slice(0, halfLen);
  const tail = text.slice(-halfLen);
  const droppedBytes = Buffer.byteLength(text, 'utf-8') - Buffer.byteLength(head + tail, 'utf-8');
  return `${head}\n... [truncated ${droppedBytes} bytes] ...\n${tail}`;
}
