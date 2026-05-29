/**
 * IPermissionGate — unified contract for "is this tool call allowed?"
 *
 * Before this capability, three semantically related checks lived in three
 * different shapes across the runtime stack:
 *
 *   1. Soul heartbeat's onBeforeToolCall filter (skillAccessAllowed,
 *      skillAccessBlocked, allowedTools) — fine-grained per-call check
 *   2. ApprovalManager + createApprovalCallback (action categories,
 *      human-in-the-loop approval) — interactive escalation
 *   3. Claw autonomyPolicy (destructiveActionPolicy, filesystemScopes,
 *      maxCostUsdBeforePause) — runtime-policy enforcement
 *
 * The gate unifies the per-call check into one named import. Every
 * runtime that wants to authorize a tool invocation asks the same
 * question:
 *
 *   const decision = await ctx.permissions.check({ actorId, tool, ... });
 *   if (decision.type === 'deny') return { approved: false, reason: decision.reason };
 *
 * Approval flows produce the same shape with `type: 'require_approval'`
 * — runtimes can then route through whatever UI/notification path they
 * already have, instead of each runtime growing its own approval
 * callback indirection.
 */

import type { ClawAutonomyPolicy } from './claw-types.js';

/** Where the request came from. Lets the gate apply different defaults per runtime. */
export type PermissionActorType = 'chat' | 'claw' | 'soul-heartbeat' | 'crew' | 'extension';

/** Sandbox tier the actor is running in. Stricter sandbox -> stricter defaults. */
export type PermissionSandbox = 'restricted' | 'safe' | 'open';

/** Optional context the gate uses to make a decision. */
export interface PermissionContext {
  /** What kind of runtime is asking. */
  actorType?: PermissionActorType;
  /** Sandbox tier (restricted / safe / open). */
  sandbox?: PermissionSandbox;
  /** Tool arguments at call time — gate can inspect for sensitive params. */
  args?: Record<string, unknown>;
  /**
   * Task-level / claw-level tool allowlist. When set and non-empty, ONLY
   * tools in this list are allowed.
   */
  allowedTools?: string[];
  /**
   * Soul-level extension allowlist. When set and non-empty, ext./skill.
   * tools must come from one of these extension IDs.
   */
  skillAccessAllowed?: string[];
  /** Soul-level extension blocklist. Always denied. */
  skillAccessBlocked?: string[];
  /**
   * Claw autonomy guardrails. When set (claw / soul-heartbeat clawMode actors),
   * the gate enforces `destructiveActionPolicy`, `filesystemScopes`,
   * `allowSelfModify`, and `allowSubclaws` against the tool + its args — turning
   * the declared policy into real per-call enforcement instead of prompt-only
   * guidance.
   */
  autonomyPolicy?: ClawAutonomyPolicy;
  /**
   * Workspace root for the actor. Used as the implicit filesystem scope when
   * `autonomyPolicy.filesystemScopes` is empty, and as a base for resolving
   * relative paths during scope-containment checks.
   */
  workspaceDir?: string;
}

/** A request to authorize a tool call. */
export interface PermissionRequest {
  /** Who's asking — agentId, userId, or 'system'. */
  actorId: string;
  /** The fully-qualified tool name being requested (e.g. 'core.send_email'). */
  tool: string;
  /** Optional decision-shaping context. */
  context?: PermissionContext;
}

/** Result of a permission check. */
export type PermissionDecision =
  | { type: 'allow' }
  | { type: 'deny'; reason: string }
  | { type: 'require_approval'; reason: string };

/**
 * The single capability contract for tool-call authorization. Implementations
 * combine policy sources (per-soul skill access, per-task allowlists, action
 * categories, sandbox tier) and return one shape. Runtimes don't need to
 * know which policy was the deciding one — they just see allow/deny/approval.
 */
export interface IPermissionGate {
  /** Check whether the actor is allowed to call the named tool. */
  check(request: PermissionRequest): Promise<PermissionDecision>;
}

// ============================================================================
// Singleton access — matches the IChannelService / ConfigCenter pattern
// ============================================================================

import { hasServiceRegistry, getServiceRegistry } from './registry.js';
import { ServiceToken } from './registry.js';

/**
 * Service registry token for the PermissionGate. Declared here rather than
 * in tokens.ts to keep the contract + accessors colocated; tokens.ts
 * re-exports `Services.Permission` for symmetry.
 */
export const PermissionToken = new ServiceToken<IPermissionGate>('permission');

let _permissionGate: IPermissionGate | null = null;

/**
 * Register the PermissionGate implementation. Called once at gateway
 * startup. Also mirrors into the service registry.
 */
export function setPermissionGate(gate: IPermissionGate): void {
  _permissionGate = gate;

  if (hasServiceRegistry()) {
    try {
      const registry = getServiceRegistry();
      if (!registry.has(PermissionToken)) {
        registry.register(PermissionToken, gate);
      }
    } catch {
      // Registry not ready
    }
  }
}

/**
 * Get the PermissionGate. Tries the service registry first, falls back
 * to the direct singleton. Throws if neither is initialized.
 */
export function getPermissionGate(): IPermissionGate {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().get(PermissionToken);
    } catch {
      // Not registered yet — fall through to direct singleton
    }
  }

  if (!_permissionGate) {
    throw new Error(
      'PermissionGate not initialized. Call setPermissionGate() during gateway startup.'
    );
  }
  return _permissionGate;
}

/** Check whether the PermissionGate has been initialized. */
export function hasPermissionGate(): boolean {
  if (hasServiceRegistry()) {
    try {
      return getServiceRegistry().has(PermissionToken);
    } catch {
      // fall through
    }
  }
  return _permissionGate !== null;
}
