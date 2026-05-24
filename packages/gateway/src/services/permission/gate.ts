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
import type { IPermissionGate, PermissionRequest, PermissionDecision } from '@ownpilot/core';
import { setPermissionGate } from '@ownpilot/core';

const log = getLog('PermissionGate');

export class DefaultPermissionGate implements IPermissionGate {
  async check(request: PermissionRequest): Promise<PermissionDecision> {
    const { tool, context } = request;

    // No context = nothing to enforce. Allow by default; sandbox/approval
    // layers (Phase B) will tighten this when they migrate.
    if (!context) {
      return { type: 'allow' };
    }

    const { skillAccessBlocked, skillAccessAllowed, allowedTools } = context;

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
