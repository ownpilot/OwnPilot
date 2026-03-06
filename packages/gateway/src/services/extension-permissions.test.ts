/**
 * Extension Permission Checker Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));

vi.mock('./log.js', () => ({
  getLog: vi.fn(() => ({ warn: mockWarn, info: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import {
  getRequiredPermission,
  checkPermission,
  getPermissionDescription,
  getPermissionSensitivity,
  getAllPermissions,
  logPermissionDenied,
} from './extension-permissions.js';

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// getRequiredPermission
// ============================================================================

describe('getRequiredPermission', () => {
  it('returns null for unknown tool', () => {
    expect(getRequiredPermission('completely_unknown_tool')).toBeNull();
  });

  it('returns tasks permission for create_task', () => {
    expect(getRequiredPermission('create_task')).toBe('tasks');
  });

  it('returns tasks permission for update_task', () => {
    expect(getRequiredPermission('update_task')).toBe('tasks');
  });

  it('returns tasks permission for delete_task', () => {
    expect(getRequiredPermission('delete_task')).toBe('tasks');
  });

  it('returns tasks permission for list_tasks', () => {
    expect(getRequiredPermission('list_tasks')).toBe('tasks');
  });

  it('returns tasks permission for complete_task', () => {
    expect(getRequiredPermission('complete_task')).toBe('tasks');
  });

  it('strips namespace prefix before lookup', () => {
    expect(getRequiredPermission('core.create_task')).toBe('tasks');
  });

  it('strips deep namespace prefix', () => {
    expect(getRequiredPermission('skill.abc123.add_memory')).toBe('memories');
  });

  it('returns memories for add_memory', () => {
    expect(getRequiredPermission('add_memory')).toBe('memories');
  });

  it('returns memories for search_memories', () => {
    expect(getRequiredPermission('search_memories')).toBe('memories');
  });

  it('returns goals for create_goal', () => {
    expect(getRequiredPermission('create_goal')).toBe('goals');
  });

  it('returns contacts for create_contact', () => {
    expect(getRequiredPermission('create_contact')).toBe('contacts');
  });

  it('returns calendar for create_event', () => {
    expect(getRequiredPermission('create_event')).toBe('calendar');
  });

  it('returns notes for create_note', () => {
    expect(getRequiredPermission('create_note')).toBe('notes');
  });

  it('returns custom-data for create_table', () => {
    expect(getRequiredPermission('create_table')).toBe('custom-data');
  });

  it('returns custom-data for add_record', () => {
    expect(getRequiredPermission('add_record')).toBe('custom-data');
  });

  it('returns triggers for create_trigger', () => {
    expect(getRequiredPermission('create_trigger')).toBe('triggers');
  });

  it('returns plans for create_plan', () => {
    expect(getRequiredPermission('create_plan')).toBe('plans');
  });

  it('returns network for http_request', () => {
    expect(getRequiredPermission('http_request')).toBe('network');
  });

  it('returns network for fetch_web_page', () => {
    expect(getRequiredPermission('fetch_web_page')).toBe('network');
  });

  it('returns network for search_web', () => {
    expect(getRequiredPermission('search_web')).toBe('network');
  });

  it('returns browser for browse_web', () => {
    expect(getRequiredPermission('browse_web')).toBe('browser');
  });

  it('returns browser for browser_screenshot', () => {
    expect(getRequiredPermission('browser_screenshot')).toBe('browser');
  });

  it('returns config for get_config', () => {
    expect(getRequiredPermission('get_config')).toBe('config');
  });

  it('returns expenses for create_expense', () => {
    expect(getRequiredPermission('create_expense')).toBe('expenses');
  });

  it('returns bookmarks for create_bookmark', () => {
    expect(getRequiredPermission('create_bookmark')).toBe('bookmarks');
  });

  it('returns null for tool with no dot but unknown', () => {
    expect(getRequiredPermission('send_message')).toBeNull();
  });
});

// ============================================================================
// checkPermission
// ============================================================================

describe('checkPermission', () => {
  it('returns true when permissions is undefined (legacy)', () => {
    expect(checkPermission('create_task', undefined)).toBe(true);
  });

  it('returns true when tool requires no permission', () => {
    expect(checkPermission('send_message', ['tasks'])).toBe(true);
  });

  it('returns true when granted permissions include required', () => {
    expect(checkPermission('create_task', ['tasks', 'memories'])).toBe(true);
  });

  it('returns false when required permission not in granted list', () => {
    expect(checkPermission('create_task', ['memories', 'network'])).toBe(false);
  });

  it('returns false for empty permissions array when tool needs permission', () => {
    expect(checkPermission('add_memory', [])).toBe(false);
  });

  it('returns true for unknown tool even with empty permissions', () => {
    expect(checkPermission('unknown_tool', [])).toBe(true);
  });

  it('strips namespace before checking', () => {
    expect(checkPermission('core.create_task', ['tasks'])).toBe(true);
  });

  it('returns false for namespaced tool when permission not granted', () => {
    expect(checkPermission('core.create_task', ['memories'])).toBe(false);
  });

  it('returns true for network tool with network permission', () => {
    expect(checkPermission('http_request', ['network'])).toBe(true);
  });

  it('returns false for network tool without network permission', () => {
    expect(checkPermission('http_request', ['tasks', 'memories'])).toBe(false);
  });
});

// ============================================================================
// getPermissionDescription
// ============================================================================

describe('getPermissionDescription', () => {
  it('returns description for memories', () => {
    expect(getPermissionDescription('memories')).toBe('Access and modify AI memories');
  });

  it('returns description for goals', () => {
    expect(getPermissionDescription('goals')).toBe('Create and manage goals');
  });

  it('returns description for tasks', () => {
    expect(getPermissionDescription('tasks')).toBe('Create and manage tasks');
  });

  it('returns description for contacts', () => {
    expect(getPermissionDescription('contacts')).toBe('Access and modify contacts');
  });

  it('returns description for calendar', () => {
    expect(getPermissionDescription('calendar')).toBe('Access and modify calendar events');
  });

  it('returns description for notes', () => {
    expect(getPermissionDescription('notes')).toBe('Create and manage notes');
  });

  it('returns description for custom-data', () => {
    expect(getPermissionDescription('custom-data')).toBe('Create and manage custom data tables');
  });

  it('returns description for triggers', () => {
    expect(getPermissionDescription('triggers')).toBe('Create and manage automation triggers');
  });

  it('returns description for plans', () => {
    expect(getPermissionDescription('plans')).toBe('Create and manage plans');
  });

  it('returns description for network', () => {
    expect(getPermissionDescription('network')).toBe('Make HTTP requests to external services');
  });

  it('returns description for browser', () => {
    expect(getPermissionDescription('browser')).toBe('Control headless browser for web automation');
  });

  it('returns description for config', () => {
    expect(getPermissionDescription('config')).toBe('Access configuration settings');
  });

  it('returns description for expenses', () => {
    expect(getPermissionDescription('expenses')).toBe('Create and manage expense records');
  });

  it('returns description for bookmarks', () => {
    expect(getPermissionDescription('bookmarks')).toBe('Create and manage bookmarks');
  });
});

// ============================================================================
// getPermissionSensitivity
// ============================================================================

describe('getPermissionSensitivity', () => {
  it('returns high for network', () => {
    expect(getPermissionSensitivity('network')).toBe('high');
  });

  it('returns high for browser', () => {
    expect(getPermissionSensitivity('browser')).toBe('high');
  });

  it('returns high for config', () => {
    expect(getPermissionSensitivity('config')).toBe('high');
  });

  it('returns medium for contacts', () => {
    expect(getPermissionSensitivity('contacts')).toBe('medium');
  });

  it('returns medium for calendar', () => {
    expect(getPermissionSensitivity('calendar')).toBe('medium');
  });

  it('returns medium for expenses', () => {
    expect(getPermissionSensitivity('expenses')).toBe('medium');
  });

  it('returns medium for custom-data', () => {
    expect(getPermissionSensitivity('custom-data')).toBe('medium');
  });

  it('returns medium for triggers', () => {
    expect(getPermissionSensitivity('triggers')).toBe('medium');
  });

  it('returns low for memories', () => {
    expect(getPermissionSensitivity('memories')).toBe('low');
  });

  it('returns low for goals', () => {
    expect(getPermissionSensitivity('goals')).toBe('low');
  });

  it('returns low for tasks', () => {
    expect(getPermissionSensitivity('tasks')).toBe('low');
  });

  it('returns low for notes', () => {
    expect(getPermissionSensitivity('notes')).toBe('low');
  });

  it('returns low for plans', () => {
    expect(getPermissionSensitivity('plans')).toBe('low');
  });

  it('returns low for bookmarks', () => {
    expect(getPermissionSensitivity('bookmarks')).toBe('low');
  });
});

// ============================================================================
// getAllPermissions
// ============================================================================

describe('getAllPermissions', () => {
  it('returns an array of all permissions', () => {
    const perms = getAllPermissions();
    expect(Array.isArray(perms)).toBe(true);
    expect(perms.length).toBe(14);
  });

  it('includes all expected permission categories', () => {
    const perms = getAllPermissions();
    const expected = [
      'memories',
      'goals',
      'tasks',
      'contacts',
      'calendar',
      'notes',
      'custom-data',
      'triggers',
      'plans',
      'network',
      'browser',
      'config',
      'expenses',
      'bookmarks',
    ];
    for (const perm of expected) {
      expect(perms).toContain(perm);
    }
  });
});

// ============================================================================
// logPermissionDenied
// ============================================================================

describe('logPermissionDenied', () => {
  it('calls log.warn with extension id, tool name, and permission', () => {
    logPermissionDenied('ext-123', 'create_task', 'tasks');
    expect(mockWarn).toHaveBeenCalledOnce();
    const msg = mockWarn.mock.calls[0]![0] as string;
    expect(msg).toContain('ext-123');
    expect(msg).toContain('create_task');
    expect(msg).toContain('tasks');
  });

  it('mentions "Permission denied" in warning', () => {
    logPermissionDenied('ext-456', 'http_request', 'network');
    const msg = mockWarn.mock.calls[0]![0] as string;
    expect(msg).toContain('Permission denied');
  });

  it('can be called for any valid permission', () => {
    expect(() => {
      logPermissionDenied('ext-789', 'browse_web', 'browser');
    }).not.toThrow();
  });
});
