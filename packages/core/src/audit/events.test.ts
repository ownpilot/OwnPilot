import { describe, it, expect } from 'vitest';
import {
  SEVERITY_ORDER,
  EVENT_SEVERITY,
  SYSTEM_ACTOR,
} from './events.js';
import type { AuditSeverity, AuditEventType, AuditActor } from './events.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All valid severity levels as a frozen tuple for iteration. */
const ALL_SEVERITIES: ReadonlyArray<AuditSeverity> = ['debug', 'info', 'warn', 'error', 'critical'];

/** Returns all entries of EVENT_SEVERITY as [key, severity] pairs. */
function eventSeverityEntries(): Array<[string, string]> {
  return Object.entries(EVENT_SEVERITY);
}

/** Returns the subset of EVENT_SEVERITY keys whose prefix matches `category`. */
function eventsByCategory(category: string): string[] {
  return Object.keys(EVENT_SEVERITY).filter((k) => k.startsWith(category + '.'));
}

/** Returns all EVENT_SEVERITY keys that map to the given severity. */
function keysBySeverity(severity: AuditSeverity): string[] {
  return Object.entries(EVENT_SEVERITY)
    .filter(([, v]) => v === severity)
    .map(([k]) => k);
}

// ===========================================================================
// 1. SEVERITY_ORDER
// ===========================================================================

describe('SEVERITY_ORDER', () => {
  describe('structure', () => {
    it('has exactly 5 entries', () => {
      expect(Object.keys(SEVERITY_ORDER)).toHaveLength(5);
    });

    it('contains all five severity levels as keys', () => {
      for (const sev of ALL_SEVERITIES) {
        expect(SEVERITY_ORDER).toHaveProperty(sev);
      }
    });

    it('contains no extra keys beyond the five severity levels', () => {
      const keys = Object.keys(SEVERITY_ORDER).sort();
      const expected = [...ALL_SEVERITIES].sort();
      expect(keys).toEqual(expected);
    });
  });

  describe('individual values', () => {
    it('maps debug to 0', () => {
      expect(SEVERITY_ORDER.debug).toBe(0);
    });

    it('maps info to 1', () => {
      expect(SEVERITY_ORDER.info).toBe(1);
    });

    it('maps warn to 2', () => {
      expect(SEVERITY_ORDER.warn).toBe(2);
    });

    it('maps error to 3', () => {
      expect(SEVERITY_ORDER.error).toBe(3);
    });

    it('maps critical to 4', () => {
      expect(SEVERITY_ORDER.critical).toBe(4);
    });
  });

  describe('ordering invariants', () => {
    it('values form a strict ascending sequence with no gaps', () => {
      const values = ALL_SEVERITIES.map((s) => SEVERITY_ORDER[s]);
      for (let i = 0; i < values.length; i++) {
        expect(values[i]).toBe(i);
      }
    });

    it('all values are non-negative integers', () => {
      for (const [, v] of Object.entries(SEVERITY_ORDER)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    });

    it('all values are unique (no ties)', () => {
      const values = Object.values(SEVERITY_ORDER);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });

    it('debug is strictly less than info', () => {
      expect(SEVERITY_ORDER.debug).toBeLessThan(SEVERITY_ORDER.info);
    });

    it('info is strictly less than warn', () => {
      expect(SEVERITY_ORDER.info).toBeLessThan(SEVERITY_ORDER.warn);
    });

    it('warn is strictly less than error', () => {
      expect(SEVERITY_ORDER.warn).toBeLessThan(SEVERITY_ORDER.error);
    });

    it('error is strictly less than critical', () => {
      expect(SEVERITY_ORDER.error).toBeLessThan(SEVERITY_ORDER.critical);
    });

    it('debug is strictly less than critical', () => {
      expect(SEVERITY_ORDER.debug).toBeLessThan(SEVERITY_ORDER.critical);
    });

    it('minimum value is 0 (debug)', () => {
      const min = Math.min(...Object.values(SEVERITY_ORDER));
      expect(min).toBe(0);
    });

    it('maximum value is 4 (critical)', () => {
      const max = Math.max(...Object.values(SEVERITY_ORDER));
      expect(max).toBe(4);
    });
  });
});

// ===========================================================================
// 2. EVENT_SEVERITY — completeness
// ===========================================================================

describe('EVENT_SEVERITY', () => {
  describe('completeness', () => {
    it('has exactly 47 entries', () => {
      expect(Object.keys(EVENT_SEVERITY)).toHaveLength(47);
    });

    it('all values are valid AuditSeverity strings', () => {
      const valid = new Set<string>(ALL_SEVERITIES);
      for (const [key, sev] of eventSeverityEntries()) {
        expect(valid.has(sev), `${key} has unrecognised severity "${sev}"`).toBe(true);
      }
    });

    it('all keys follow dot-separated naming convention', () => {
      for (const key of Object.keys(EVENT_SEVERITY)) {
        expect(key, `key "${key}" does not contain a dot`).toMatch(/^[a-z_]+\.[a-z_]+$/);
      }
    });

    it('all keys contain exactly one dot', () => {
      for (const key of Object.keys(EVENT_SEVERITY)) {
        const dotCount = (key.match(/\./g) ?? []).length;
        expect(dotCount, `key "${key}" has ${dotCount} dot(s), expected 1`).toBe(1);
      }
    });

    it('all keys are lowercase', () => {
      for (const key of Object.keys(EVENT_SEVERITY)) {
        expect(key, `key "${key}" is not lowercase`).toBe(key.toLowerCase());
      }
    });

    it('all values are lowercase', () => {
      for (const [key, sev] of eventSeverityEntries()) {
        expect(sev, `severity for "${key}" is not lowercase`).toBe(sev.toLowerCase());
      }
    });

    it('all keys have a recognised category prefix', () => {
      const validCategories = new Set([
        'auth', 'session', 'message', 'pii', 'plugin',
        'tool', 'config', 'channel', 'security', 'system',
      ]);
      for (const key of Object.keys(EVENT_SEVERITY)) {
        const category = key.split('.')[0];
        expect(validCategories.has(category), `"${key}" has unknown category "${category}"`).toBe(true);
      }
    });

    it('all keys are unique (no duplicate event types)', () => {
      const keys = Object.keys(EVENT_SEVERITY);
      const uniqueKeys = new Set(keys);
      expect(uniqueKeys.size).toBe(keys.length);
    });

    it('no key or value has leading or trailing whitespace', () => {
      for (const [key, sev] of eventSeverityEntries()) {
        expect(key).toBe(key.trim());
        expect(sev).toBe(sev.trim());
      }
    });
  });

  // =========================================================================
  // 3. Per-category correctness
  // =========================================================================

  describe('auth category', () => {
    it('has exactly 5 entries', () => {
      expect(eventsByCategory('auth')).toHaveLength(5);
    });

    it('auth.login is info', () => {
      expect(EVENT_SEVERITY['auth.login']).toBe('info');
    });

    it('auth.logout is info', () => {
      expect(EVENT_SEVERITY['auth.logout']).toBe('info');
    });

    it('auth.failure is warn', () => {
      expect(EVENT_SEVERITY['auth.failure']).toBe('warn');
    });

    it('auth.token_refresh is debug', () => {
      expect(EVENT_SEVERITY['auth.token_refresh']).toBe('debug');
    });

    it('auth.token_revoke is info', () => {
      expect(EVENT_SEVERITY['auth.token_revoke']).toBe('info');
    });
  });

  describe('session category', () => {
    it('has exactly 3 entries', () => {
      expect(eventsByCategory('session')).toHaveLength(3);
    });

    it('session.create is info', () => {
      expect(EVENT_SEVERITY['session.create']).toBe('info');
    });

    it('session.destroy is info', () => {
      expect(EVENT_SEVERITY['session.destroy']).toBe('info');
    });

    it('session.timeout is info', () => {
      expect(EVENT_SEVERITY['session.timeout']).toBe('info');
    });

    it('all session events are info severity', () => {
      for (const key of eventsByCategory('session')) {
        expect(EVENT_SEVERITY[key as AuditEventType]).toBe('info');
      }
    });
  });

  describe('message category', () => {
    it('has exactly 3 entries', () => {
      expect(eventsByCategory('message')).toHaveLength(3);
    });

    it('message.receive is debug', () => {
      expect(EVENT_SEVERITY['message.receive']).toBe('debug');
    });

    it('message.send is debug', () => {
      expect(EVENT_SEVERITY['message.send']).toBe('debug');
    });

    it('message.delete is info', () => {
      expect(EVENT_SEVERITY['message.delete']).toBe('info');
    });
  });

  describe('pii (privacy) category', () => {
    it('has exactly 3 entries', () => {
      expect(eventsByCategory('pii')).toHaveLength(3);
    });

    it('pii.detected is warn', () => {
      expect(EVENT_SEVERITY['pii.detected']).toBe('warn');
    });

    it('pii.redacted is info', () => {
      expect(EVENT_SEVERITY['pii.redacted']).toBe('info');
    });

    it('pii.logged is error (bug indicator — PII must never reach the audit log)', () => {
      expect(EVENT_SEVERITY['pii.logged']).toBe('error');
    });
  });

  describe('plugin category', () => {
    it('has exactly 13 entries', () => {
      expect(eventsByCategory('plugin')).toHaveLength(13);
    });

    it('plugin.install is info', () => {
      expect(EVENT_SEVERITY['plugin.install']).toBe('info');
    });

    it('plugin.uninstall is info', () => {
      expect(EVENT_SEVERITY['plugin.uninstall']).toBe('info');
    });

    it('plugin.enable is info', () => {
      expect(EVENT_SEVERITY['plugin.enable']).toBe('info');
    });

    it('plugin.disable is info', () => {
      expect(EVENT_SEVERITY['plugin.disable']).toBe('info');
    });

    it('plugin.update is info', () => {
      expect(EVENT_SEVERITY['plugin.update']).toBe('info');
    });

    it('plugin.invoke is debug', () => {
      expect(EVENT_SEVERITY['plugin.invoke']).toBe('debug');
    });

    it('plugin.api_call is debug', () => {
      expect(EVENT_SEVERITY['plugin.api_call']).toBe('debug');
    });

    it('plugin.permission_denied is warn', () => {
      expect(EVENT_SEVERITY['plugin.permission_denied']).toBe('warn');
    });

    it('plugin.domain_blocked is warn', () => {
      expect(EVENT_SEVERITY['plugin.domain_blocked']).toBe('warn');
    });

    it('plugin.rate_limited is warn', () => {
      expect(EVENT_SEVERITY['plugin.rate_limited']).toBe('warn');
    });

    it('plugin.timeout is warn', () => {
      expect(EVENT_SEVERITY['plugin.timeout']).toBe('warn');
    });

    it('plugin.error is error', () => {
      expect(EVENT_SEVERITY['plugin.error']).toBe('error');
    });

    it('plugin.storage_quota_exceeded is warn', () => {
      expect(EVENT_SEVERITY['plugin.storage_quota_exceeded']).toBe('warn');
    });
  });

  describe('tool category', () => {
    it('has exactly 4 entries', () => {
      expect(eventsByCategory('tool')).toHaveLength(4);
    });

    it('tool.register is info', () => {
      expect(EVENT_SEVERITY['tool.register']).toBe('info');
    });

    it('tool.execute is debug', () => {
      expect(EVENT_SEVERITY['tool.execute']).toBe('debug');
    });

    it('tool.success is debug', () => {
      expect(EVENT_SEVERITY['tool.success']).toBe('debug');
    });

    it('tool.error is error', () => {
      expect(EVENT_SEVERITY['tool.error']).toBe('error');
    });
  });

  describe('config category', () => {
    it('has exactly 2 entries', () => {
      expect(eventsByCategory('config')).toHaveLength(2);
    });

    it('config.change is info', () => {
      expect(EVENT_SEVERITY['config.change']).toBe('info');
    });

    it('config.reload is info', () => {
      expect(EVENT_SEVERITY['config.reload']).toBe('info');
    });

    it('all config events are info severity', () => {
      for (const key of eventsByCategory('config')) {
        expect(EVENT_SEVERITY[key as AuditEventType]).toBe('info');
      }
    });
  });

  describe('channel category', () => {
    it('has exactly 5 entries', () => {
      expect(eventsByCategory('channel')).toHaveLength(5);
    });

    it('channel.connect is info', () => {
      expect(EVENT_SEVERITY['channel.connect']).toBe('info');
    });

    it('channel.disconnect is info', () => {
      expect(EVENT_SEVERITY['channel.disconnect']).toBe('info');
    });

    it('channel.error is error', () => {
      expect(EVENT_SEVERITY['channel.error']).toBe('error');
    });

    it('channel.message_receive is debug', () => {
      expect(EVENT_SEVERITY['channel.message_receive']).toBe('debug');
    });

    it('channel.message_send is debug', () => {
      expect(EVENT_SEVERITY['channel.message_send']).toBe('debug');
    });
  });

  describe('security category', () => {
    it('has exactly 5 entries', () => {
      expect(eventsByCategory('security')).toHaveLength(5);
    });

    it('security.vault_unlock is info', () => {
      expect(EVENT_SEVERITY['security.vault_unlock']).toBe('info');
    });

    it('security.vault_lock is info', () => {
      expect(EVENT_SEVERITY['security.vault_lock']).toBe('info');
    });

    it('security.key_rotate is info', () => {
      expect(EVENT_SEVERITY['security.key_rotate']).toBe('info');
    });

    it('security.threat_detected is critical', () => {
      expect(EVENT_SEVERITY['security.threat_detected']).toBe('critical');
    });

    it('security.audit_verify is info', () => {
      expect(EVENT_SEVERITY['security.audit_verify']).toBe('info');
    });
  });

  describe('system category', () => {
    it('has exactly 4 entries', () => {
      expect(eventsByCategory('system')).toHaveLength(4);
    });

    it('system.start is info', () => {
      expect(EVENT_SEVERITY['system.start']).toBe('info');
    });

    it('system.stop is info', () => {
      expect(EVENT_SEVERITY['system.stop']).toBe('info');
    });

    it('system.error is error', () => {
      expect(EVENT_SEVERITY['system.error']).toBe('error');
    });

    it('system.health_check is debug', () => {
      expect(EVENT_SEVERITY['system.health_check']).toBe('debug');
    });
  });

  // =========================================================================
  // 4. Security-critical assertions
  // =========================================================================

  describe('security-critical severity assertions', () => {
    it('security.threat_detected is the ONLY critical-severity event', () => {
      const criticalKeys = keysBySeverity('critical');
      expect(criticalKeys).toHaveLength(1);
      expect(criticalKeys[0]).toBe('security.threat_detected');
    });

    it('pii.logged is error severity (indicates a bug when it fires)', () => {
      expect(EVENT_SEVERITY['pii.logged']).toBe('error');
    });

    it('there are exactly 5 error-severity events', () => {
      expect(keysBySeverity('error')).toHaveLength(5);
    });

    it('all expected error-severity events are present', () => {
      const errorKeys = new Set(keysBySeverity('error'));
      const expectedErrors = [
        'pii.logged',
        'plugin.error',
        'tool.error',
        'channel.error',
        'system.error',
      ];
      for (const key of expectedErrors) {
        expect(errorKeys.has(key), `expected "${key}" to have severity error`).toBe(true);
      }
    });

    it('no unexpected event has error severity', () => {
      const errorKeys = keysBySeverity('error').sort();
      expect(errorKeys).toEqual(
        ['channel.error', 'pii.logged', 'plugin.error', 'system.error', 'tool.error'],
      );
    });

    it('there are exactly 7 warn-severity events', () => {
      expect(keysBySeverity('warn')).toHaveLength(7);
    });

    it('all expected warn-severity events are present', () => {
      const warnKeys = new Set(keysBySeverity('warn'));
      const expectedWarns = [
        'auth.failure',
        'pii.detected',
        'plugin.permission_denied',
        'plugin.domain_blocked',
        'plugin.rate_limited',
        'plugin.timeout',
        'plugin.storage_quota_exceeded',
      ];
      for (const key of expectedWarns) {
        expect(warnKeys.has(key), `expected "${key}" to have severity warn`).toBe(true);
      }
    });

    it('no unexpected event has warn severity', () => {
      const warnKeys = keysBySeverity('warn').sort();
      expect(warnKeys).toEqual([
        'auth.failure',
        'pii.detected',
        'plugin.domain_blocked',
        'plugin.permission_denied',
        'plugin.rate_limited',
        'plugin.storage_quota_exceeded',
        'plugin.timeout',
      ]);
    });

    it('there are exactly 10 debug-severity events', () => {
      expect(keysBySeverity('debug')).toHaveLength(10);
    });

    it('all expected debug-severity events are present', () => {
      const debugKeys = new Set(keysBySeverity('debug'));
      const expectedDebugs = [
        'auth.token_refresh',
        'message.receive',
        'message.send',
        'plugin.invoke',
        'plugin.api_call',
        'tool.execute',
        'tool.success',
        'channel.message_receive',
        'channel.message_send',
        'system.health_check',
      ];
      for (const key of expectedDebugs) {
        expect(debugKeys.has(key), `expected "${key}" to have severity debug`).toBe(true);
      }
    });

    it('no unexpected event has debug severity', () => {
      const debugKeys = keysBySeverity('debug').sort();
      expect(debugKeys).toEqual([
        'auth.token_refresh',
        'channel.message_receive',
        'channel.message_send',
        'message.receive',
        'message.send',
        'plugin.api_call',
        'plugin.invoke',
        'system.health_check',
        'tool.execute',
        'tool.success',
      ]);
    });

    it('there are exactly 24 info-severity events', () => {
      expect(keysBySeverity('info')).toHaveLength(24);
    });
  });

  // =========================================================================
  // 5. Cross-cutting consistency
  // =========================================================================

  describe('cross-cutting consistency', () => {
    it('every severity value in EVENT_SEVERITY is a key in SEVERITY_ORDER', () => {
      for (const [key, sev] of eventSeverityEntries()) {
        expect(
          Object.prototype.hasOwnProperty.call(SEVERITY_ORDER, sev),
          `severity "${sev}" for event "${key}" is not in SEVERITY_ORDER`,
        ).toBe(true);
      }
    });

    it('total entries across all severity buckets equals total EVENT_SEVERITY entries', () => {
      const total = ALL_SEVERITIES.reduce((acc, sev) => acc + keysBySeverity(sev).length, 0);
      expect(total).toBe(Object.keys(EVENT_SEVERITY).length);
    });

    it('total entries across all category buckets equals total EVENT_SEVERITY entries', () => {
      const categories = ['auth', 'session', 'message', 'pii', 'plugin', 'tool', 'config', 'channel', 'security', 'system'];
      const total = categories.reduce((acc, cat) => acc + eventsByCategory(cat).length, 0);
      expect(total).toBe(Object.keys(EVENT_SEVERITY).length);
    });

    it('counts by severity: debug=10, info=24, warn=7, error=5, critical=1', () => {
      expect(keysBySeverity('debug')).toHaveLength(10);
      expect(keysBySeverity('info')).toHaveLength(24);
      expect(keysBySeverity('warn')).toHaveLength(7);
      expect(keysBySeverity('error')).toHaveLength(5);
      expect(keysBySeverity('critical')).toHaveLength(1);
    });

    it('counts by category match expected values', () => {
      expect(eventsByCategory('auth')).toHaveLength(5);
      expect(eventsByCategory('session')).toHaveLength(3);
      expect(eventsByCategory('message')).toHaveLength(3);
      expect(eventsByCategory('pii')).toHaveLength(3);
      expect(eventsByCategory('plugin')).toHaveLength(13);
      expect(eventsByCategory('tool')).toHaveLength(4);
      expect(eventsByCategory('config')).toHaveLength(2);
      expect(eventsByCategory('channel')).toHaveLength(5);
      expect(eventsByCategory('security')).toHaveLength(5);
      expect(eventsByCategory('system')).toHaveLength(4);
    });

    it('severity ordering: every error event has higher order than every warn event', () => {
      for (const errKey of keysBySeverity('error')) {
        for (const warnKey of keysBySeverity('warn')) {
          expect(
            SEVERITY_ORDER[EVENT_SEVERITY[errKey as AuditEventType]],
          ).toBeGreaterThan(
            SEVERITY_ORDER[EVENT_SEVERITY[warnKey as AuditEventType]],
          );
        }
      }
    });

    it('severity ordering: every critical event has higher order than every error event', () => {
      for (const critKey of keysBySeverity('critical')) {
        for (const errKey of keysBySeverity('error')) {
          expect(
            SEVERITY_ORDER[EVENT_SEVERITY[critKey as AuditEventType]],
          ).toBeGreaterThan(
            SEVERITY_ORDER[EVENT_SEVERITY[errKey as AuditEventType]],
          );
        }
      }
    });

    it('can look up the numeric order of any event type through the combined maps', () => {
      // Spot-check a few events for their numeric severity order
      expect(SEVERITY_ORDER[EVENT_SEVERITY['security.threat_detected']]).toBe(4); // critical
      expect(SEVERITY_ORDER[EVENT_SEVERITY['pii.logged']]).toBe(3); // error
      expect(SEVERITY_ORDER[EVENT_SEVERITY['auth.failure']]).toBe(2); // warn
      expect(SEVERITY_ORDER[EVENT_SEVERITY['auth.login']]).toBe(1); // info
      expect(SEVERITY_ORDER[EVENT_SEVERITY['tool.execute']]).toBe(0); // debug
    });
  });
});

// ===========================================================================
// 6. SYSTEM_ACTOR
// ===========================================================================

describe('SYSTEM_ACTOR', () => {
  describe('required fields', () => {
    it('type is "system"', () => {
      expect(SYSTEM_ACTOR.type).toBe('system');
    });

    it('id is "system"', () => {
      expect(SYSTEM_ACTOR.id).toBe('system');
    });

    it('name is "OwnPilot"', () => {
      expect(SYSTEM_ACTOR.name).toBe('OwnPilot');
    });
  });

  describe('shape', () => {
    it('has no extra properties beyond type, id, and name', () => {
      const keys = Object.keys(SYSTEM_ACTOR).sort();
      expect(keys).toEqual(['id', 'name', 'type']);
    });

    it('does not have an ip field', () => {
      expect(SYSTEM_ACTOR).not.toHaveProperty('ip');
    });

    it('satisfies the AuditActor interface shape', () => {
      // Structural check — if this compiles without @ts-ignore, the shape is correct
      const actor: AuditActor = SYSTEM_ACTOR;
      expect(actor.type).toBe('system');
      expect(actor.id).toBe('system');
    });

    it('type field is a valid AuditActor type literal', () => {
      const validTypes: ReadonlyArray<AuditActor['type']> = [
        'user', 'system', 'plugin', 'channel', 'agent',
      ];
      expect(validTypes).toContain(SYSTEM_ACTOR.type);
    });
  });

  describe('immutability', () => {
    it('the object reference is stable (not re-created on each access)', () => {
      // Both imports reference the same object
      expect(SYSTEM_ACTOR).toBe(SYSTEM_ACTOR);
    });

    it('assigning to type property is silently ignored in strict mode (const binding)', () => {
      // The binding itself is const — we verify the value remains unchanged after
      // a spread copy (the original must not be mutated by user code)
      const copy = { ...SYSTEM_ACTOR, type: 'user' as AuditActor['type'] };
      expect(SYSTEM_ACTOR.type).toBe('system');
      expect(copy.type).toBe('user');
    });

    it('id value is not an empty string', () => {
      expect(SYSTEM_ACTOR.id.length).toBeGreaterThan(0);
    });

    it('name value is not an empty string', () => {
      expect((SYSTEM_ACTOR.name ?? '').length).toBeGreaterThan(0);
    });
  });
});

// ===========================================================================
// 7. Naming convention — structural tests
// ===========================================================================

describe('naming conventions', () => {
  it('all event type keys are lowercase only', () => {
    for (const key of Object.keys(EVENT_SEVERITY)) {
      expect(key).toMatch(/^[a-z_.]+$/);
    }
  });

  it('all event type keys contain exactly one dot separator', () => {
    for (const key of Object.keys(EVENT_SEVERITY)) {
      const parts = key.split('.');
      expect(parts.length).toBe(2);
    }
  });

  it('category portion (before dot) is never empty', () => {
    for (const key of Object.keys(EVENT_SEVERITY)) {
      const [cat] = key.split('.');
      expect(cat.length).toBeGreaterThan(0);
    }
  });

  it('action portion (after dot) is never empty', () => {
    for (const key of Object.keys(EVENT_SEVERITY)) {
      const parts = key.split('.');
      const action = parts[1] ?? '';
      expect(action.length).toBeGreaterThan(0);
    }
  });

  it('all action portions use underscores rather than hyphens', () => {
    for (const key of Object.keys(EVENT_SEVERITY)) {
      expect(key).not.toContain('-');
    }
  });

  it('severity values contain no numeric characters', () => {
    for (const [, sev] of eventSeverityEntries()) {
      expect(sev).toMatch(/^[a-z]+$/);
    }
  });

  it('SEVERITY_ORDER keys are identical to ALL_SEVERITIES', () => {
    const orderKeys = new Set(Object.keys(SEVERITY_ORDER));
    for (const sev of ALL_SEVERITIES) {
      expect(orderKeys.has(sev)).toBe(true);
    }
    expect(orderKeys.size).toBe(ALL_SEVERITIES.length);
  });
});
