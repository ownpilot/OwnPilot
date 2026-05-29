/**
 * DefaultPermissionGate — initial gateway implementation of IPermissionGate.
 *
 * Phase A scope: this gate encapsulates the per-call tool authorization logic
 * that previously lived inline in soul-heartbeat's onBeforeToolCall callback:
 *
 *   1. skillAccessBlocked — hard-deny any tool from a blocked extension/skill
 *   2. skillAccessAllowed — if set, ext./skill. tools must come from an
 *      allowed extension ID
 *   3. allowedTools — task-level / claw-level explicit allowlist
 *
 * Phase B will absorb approval-middleware (action categories +
 * human-in-the-loop) and claw autonomyPolicy (destructive-action defaults
 * per sandbox tier).  For now those continue to live in their existing
 * call sites; this gate is the canonical replacement for *fine-grained
 * per-call filters* across runtimes.
 */

import { getLog } from '@ownpilot/core';
import type {
  IPermissionGate,
  PermissionRequest,
  PermissionDecision,
  ClawAutonomyPolicy,
} from '@ownpilot/core';
import { setPermissionGate } from '@ownpilot/core';

const log = getLog('PermissionGate');

// ============================================================================
// Autonomy-policy enforcement (PermissionGate "Phase B")
//
// Turns the declared `ClawAutonomyPolicy` into real per-tool-call enforcement.
// Before this, destructiveActionPolicy / filesystemScopes / allowSelfModify /
// allowSubclaws were only *described* to the model in the claw system prompt —
// nothing intercepted a tool call to enforce them. These pure helpers inspect
// the tool name + arguments and are exported for direct unit testing.
// ============================================================================

/** Base (un-namespaced) name of a tool id, e.g. `core.delete_file` -> `delete_file`. */
function toolBaseName(tool: string): string {
  const idx = tool.lastIndexOf('.');
  return idx >= 0 ? tool.slice(idx + 1) : tool;
}

/** Tools whose effect is always irreversible / outbound regardless of args. */
const ALWAYS_DESTRUCTIVE_TOOLS = new Set<string>([
  'delete_file',
  'remove_file',
  'move_file',
  'rename_file',
  'send_email',
  'send_channel_message',
  'broadcast_channel_message',
  'broadcast_to_crew',
  'git_push',
  'git_reset',
  'git_clean',
  'publish_package',
  'deploy',
]);

/** Tools that execute arbitrary code — destructive only if their args match a pattern. */
const SHELL_TOOLS = new Set<string>([
  'claw_run_script',
  'run_script',
  'execute_command',
  'run_command',
  'execute_code',
  'bash',
  'shell',
]);

/** File tools whose path args are subject to `filesystemScopes` containment. */
const FILE_TOOLS = new Set<string>([
  'read_file',
  'write_file',
  'edit_file',
  'append_file',
  'create_file',
  'delete_file',
  'remove_file',
  'move_file',
  'rename_file',
  'copy_file',
]);

/** Tools gated by `allowSelfModify`. */
const SELF_MODIFY_TOOLS = new Set<string>(['claw_update_config', 'update_config']);

/** Tools gated by `allowSubclaws`. */
const SUBCLAW_TOOLS = new Set<string>(['claw_spawn_subclaw', 'spawn_subclaw', 'start_claw']);

/** Irreversible / dangerous shell-command signatures. */
const DESTRUCTIVE_ARG_PATTERNS: readonly RegExp[] = [
  /\brm\s+-[a-z]*r/i, // rm -r / -rf
  /\brmdir\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /:\(\)\s*\{/, // fork bomb
  /\bgit\s+push\b[^\n]*(--force|\s-f\b)/i,
  /\bgit\s+reset\s+--hard/i,
  /\bdrop\s+(table|database)\b/i,
  /\btruncate\s+table\b/i,
  />\s*\/dev\/(sd|nvme|disk)/i,
  /\b(shutdown|reboot|halt|poweroff)\b/i,
  /\bcurl\b[^\n|]*\|\s*(sh|bash|zsh)\b/i,
  /\bwget\b[^\n|]*\|\s*(sh|bash|zsh)\b/i,
];

const PATH_ARG_KEYS = [
  'path',
  'file_path',
  'filepath',
  'target_path',
  'target',
  'destination',
  'dest',
  'source',
  'src',
  'dir',
  'directory',
];

/** Normalize a path: forward slashes, collapse `.`/`..`, drop trailing slash. */
function normalizePath(p: string): string {
  const unified = p.replace(/\\/g, '/');
  const isAbs = unified.startsWith('/') || /^[a-zA-Z]:/.test(unified);
  const segs: string[] = [];
  for (const seg of unified.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (segs.length && segs[segs.length - 1] !== '..') segs.pop();
      else if (!isAbs) segs.push('..');
    } else {
      segs.push(seg);
    }
  }
  const joined = segs.join('/');
  return unified.startsWith('/') ? `/${joined}` : joined;
}

/** Resolve `p` against `base` when `p` is relative. */
function resolveAgainst(base: string, p: string): string {
  const unified = p.replace(/\\/g, '/');
  if (unified.startsWith('/') || /^[a-zA-Z]:/.test(unified)) return normalizePath(unified);
  return normalizePath(base ? `${base.replace(/\\/g, '/')}/${unified}` : unified);
}

/** True when `child` is `parent` or nested under it. */
function isWithin(child: string, parent: string): boolean {
  if (!parent) return false;
  const c = normalizePath(child);
  const par = normalizePath(parent);
  return c === par || c.startsWith(par.endsWith('/') ? par : `${par}/`);
}

/** Collect path-like argument values from a tool-call args object. */
function extractPaths(args: Record<string, unknown> | undefined): string[] {
  if (!args) return [];
  const out: string[] = [];
  for (const key of PATH_ARG_KEYS) {
    const v = args[key];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
  }
  return out;
}

/** Concatenated string-valued args — the surface a destructive-pattern scan runs over. */
function argText(args: Record<string, unknown> | undefined): string {
  if (!args) return '';
  const parts: string[] = [];
  for (const v of Object.values(args)) {
    if (typeof v === 'string') parts.push(v);
  }
  return parts.join('\n');
}

/**
 * Evaluate a single tool call against a claw autonomy policy. Pure — returns
 * the decision without side effects so it can be unit-tested directly.
 */
export function evaluateAutonomyPolicy(
  tool: string,
  args: Record<string, unknown> | undefined,
  policy: ClawAutonomyPolicy,
  workspaceDir?: string
): PermissionDecision {
  const base = toolBaseName(tool);

  // 1. Self-modification — hard deny when disabled.
  if (policy.allowSelfModify === false && SELF_MODIFY_TOOLS.has(base)) {
    return { type: 'deny', reason: 'Self-modification is disabled by autonomy policy' };
  }

  // 2. Sub-claw spawning — hard deny when disabled.
  if (policy.allowSubclaws === false && SUBCLAW_TOOLS.has(base)) {
    return { type: 'deny', reason: 'Sub-claws are disabled by autonomy policy' };
  }

  // 3. Filesystem scope containment for file tools.
  const scopes = policy.filesystemScopes ?? [];
  if (FILE_TOOLS.has(base) && (scopes.length > 0 || workspaceDir)) {
    const roots: string[] = [];
    if (workspaceDir) roots.push(resolveAgainst('', workspaceDir));
    for (const s of scopes) roots.push(resolveAgainst(workspaceDir ?? '', s));
    if (roots.length > 0) {
      for (const p of extractPaths(args)) {
        const resolved = resolveAgainst(workspaceDir ?? '', p);
        if (!roots.some((r) => isWithin(resolved, r))) {
          return {
            type: 'deny',
            reason: `Path "${p}" is outside the allowed filesystem scope`,
          };
        }
      }
    }
  }

  // 4. Destructive-action policy.
  const isDestructive =
    ALWAYS_DESTRUCTIVE_TOOLS.has(base) ||
    (SHELL_TOOLS.has(base) && DESTRUCTIVE_ARG_PATTERNS.some((re) => re.test(argText(args))));

  if (isDestructive) {
    switch (policy.destructiveActionPolicy) {
      case 'block':
        return { type: 'deny', reason: `Destructive action "${base}" blocked by autonomy policy` };
      case 'ask':
        return {
          type: 'require_approval',
          reason: `Destructive action "${base}" requires approval`,
        };
      // 'allow' (or undefined) falls through to allow.
    }
  }

  return { type: 'allow' };
}

export class DefaultPermissionGate implements IPermissionGate {
  async check(request: PermissionRequest): Promise<PermissionDecision> {
    const { tool, context } = request;

    // No context = nothing to enforce. Allow by default; sandbox/approval
    // layers (Phase B) will tighten this when they migrate.
    if (!context) {
      return { type: 'allow' };
    }

    const { skillAccessBlocked, skillAccessAllowed, allowedTools, autonomyPolicy, workspaceDir } =
      context;

    // 1. Blocked extension/skill — hard deny.
    if (skillAccessBlocked && skillAccessBlocked.length > 0) {
      const isBlocked = skillAccessBlocked.some(
        (id) => tool.startsWith(`ext.${id}.`) || tool.startsWith(`skill.${id}.`)
      );
      if (isBlocked) {
        return {
          type: 'deny',
          reason: `Extension ${tool} is blocked for this actor`,
        };
      }
    }

    // 2. Allowed extensions — if set, ext./skill. tools must match one.
    if (skillAccessAllowed && skillAccessAllowed.length > 0) {
      const isExtTool = tool.startsWith('ext.') || tool.startsWith('skill.');
      if (isExtTool) {
        const isAllowed = skillAccessAllowed.some(
          (id) => tool.startsWith(`ext.${id}.`) || tool.startsWith(`skill.${id}.`)
        );
        if (!isAllowed) {
          return {
            type: 'deny',
            reason: `Extension ${tool} not in actor's allowed skills`,
          };
        }
      }
    }

    // 3. Task-level allowedTools — if set, the tool must match exactly or by
    //    base name (suffix match handles namespaced variants like core.X / custom.X).
    if (allowedTools && allowedTools.length > 0) {
      const allowed = allowedTools.some((t) => tool === t || tool.endsWith(`.${t}`));
      if (!allowed) {
        return {
          type: 'deny',
          reason: `Tool ${tool} not in actor's allowed tools`,
        };
      }
    }

    // 4. Claw autonomy policy — destructive actions, filesystem scope, and
    //    self-modify / subclaw gates. Enforced for claw / soul-heartbeat actors
    //    that carry an autonomyPolicy in context.
    if (autonomyPolicy) {
      const decision = evaluateAutonomyPolicy(tool, context.args, autonomyPolicy, workspaceDir);
      if (decision.type !== 'allow') return decision;
    }

    return { type: 'allow' };
  }
}

let _defaultGate: DefaultPermissionGate | null = null;

/**
 * Install the default permission gate on the core singleton.  Idempotent —
 * safe to call multiple times at startup.
 */
export function installPermissionGate(): DefaultPermissionGate {
  if (!_defaultGate) {
    _defaultGate = new DefaultPermissionGate();
    setPermissionGate(_defaultGate);
    log.info('PermissionGate installed');
  }
  return _defaultGate;
}
