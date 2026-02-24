/**
 * Contacts Repository Tests
 *
 * Unit tests for ContactsRepository CRUD, search, tag/relationship/company
 * filtering, favorites, and pagination.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockAdapter } from '../../test-helpers.js';

// ---------------------------------------------------------------------------
// Mock the database adapter
// ---------------------------------------------------------------------------

const mockAdapter = createMockAdapter();

vi.mock('../adapters/index.js', () => ({
  getAdapter: async () => mockAdapter,
  getAdapterSync: () => mockAdapter,
}));

import { ContactsRepository } from './contacts.js';

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const NOW = '2025-01-15T12:00:00.000Z';

function makeContactRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ct-1',
    user_id: 'user-1',
    name: 'Alice Smith',
    nickname: null,
    email: null,
    phone: null,
    company: null,
    job_title: null,
    avatar: null,
    birthday: null,
    address: null,
    notes: null,
    relationship: null,
    tags: '[]',
    is_favorite: false,
    external_id: null,
    external_source: null,
    social_links: '{}',
    custom_fields: '{}',
    last_contacted_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContactsRepository', () => {
  let repo: ContactsRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ContactsRepository('user-1');
  });

  // =========================================================================
  // create
  // =========================================================================

  describe('create', () => {
    it('should insert a contact and return it', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow());

      const result = await repo.create({ name: 'Alice Smith' });

      expect(mockAdapter.execute).toHaveBeenCalledOnce();
      expect(result.name).toBe('Alice Smith');
      expect(result.tags).toEqual([]);
      expect(result.socialLinks).toEqual({});
      expect(result.customFields).toEqual({});
      expect(result.isFavorite).toBe(false);
    });

    it('should store all optional fields', async () => {
      const row = makeContactRow({
        nickname: 'Ali',
        email: 'alice@example.com',
        phone: '+1234567890',
        company: 'ACME',
        job_title: 'Engineer',
        birthday: '1990-06-15',
        relationship: 'friend',
        tags: '["colleague"]',
        is_favorite: true,
        social_links: '{"twitter":"@alice"}',
        custom_fields: '{"dept":"engineering"}',
      });
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(row);

      const result = await repo.create({
        name: 'Alice Smith',
        nickname: 'Ali',
        email: 'alice@example.com',
        phone: '+1234567890',
        company: 'ACME',
        jobTitle: 'Engineer',
        birthday: '1990-06-15',
        relationship: 'friend',
        tags: ['colleague'],
        isFavorite: true,
        socialLinks: { twitter: '@alice' },
        customFields: { dept: 'engineering' },
      });

      expect(result.nickname).toBe('Ali');
      expect(result.email).toBe('alice@example.com');
      expect(result.company).toBe('ACME');
      expect(result.socialLinks).toEqual({ twitter: '@alice' });
      expect(result.customFields).toEqual({ dept: 'engineering' });
    });

    it('should throw when get returns null after insert', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      await expect(repo.create({ name: 'Test' })).rejects.toThrow('Failed to create contact');
    });

    it('should serialize tags, socialLinks, and customFields as JSON', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow());

      await repo.create({
        name: 'Bob',
        tags: ['a', 'b'],
        socialLinks: { gh: 'bob' },
        customFields: { x: 'y' },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[13]).toBe('["a","b"]');
      expect(params[17]).toBe('{"gh":"bob"}');
      expect(params[18]).toBe('{"x":"y"}');
    });
  });

  // =========================================================================
  // get
  // =========================================================================

  describe('get', () => {
    it('should return a contact when found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow());

      const result = await repo.get('ct-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('ct-1');
      expect(result!.userId).toBe('user-1');
    });

    it('should return null when not found', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.get('missing')).toBeNull();
    });

    it('should parse dates', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow({ last_contacted_at: NOW }));

      const result = await repo.get('ct-1');

      expect(result!.createdAt).toBeInstanceOf(Date);
      expect(result!.lastContactedAt).toBeInstanceOf(Date);
    });

    it('should convert null optional fields to undefined', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow());

      const result = await repo.get('ct-1');

      expect(result!.nickname).toBeUndefined();
      expect(result!.email).toBeUndefined();
      expect(result!.phone).toBeUndefined();
      expect(result!.birthday).toBeUndefined();
      expect(result!.lastContactedAt).toBeUndefined();
    });
  });

  // =========================================================================
  // getByEmail / getByPhone
  // =========================================================================

  describe('getByEmail', () => {
    it('should query by email and user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow({ email: 'alice@example.com' }));

      const result = await repo.getByEmail('alice@example.com');

      expect(result!.email).toBe('alice@example.com');
      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('email = $1');
      expect(sql).toContain('user_id = $2');
    });

    it('should return null for unknown email', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.getByEmail('unknown@example.com')).toBeNull();
    });
  });

  describe('getByPhone', () => {
    it('should query by phone and user_id', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow({ phone: '+1234567890' }));

      const result = await repo.getByPhone('+1234567890');

      expect(result).not.toBeNull();
      const sql = mockAdapter.queryOne.mock.calls[0]![0] as string;
      expect(sql).toContain('phone = $1');
    });
  });

  // =========================================================================
  // update
  // =========================================================================

  describe('update', () => {
    it('should update fields and return the updated contact', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow({ name: 'Updated' }));

      const result = await repo.update('ct-1', { name: 'Updated' });

      expect(result!.name).toBe('Updated');
      expect(mockAdapter.execute).toHaveBeenCalledOnce();
    });

    it('should return null if contact does not exist', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.update('missing', { name: 'x' })).toBeNull();
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should return existing when no changes provided', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow());

      const result = await repo.update('ct-1', {});

      expect(result!.id).toBe('ct-1');
      expect(mockAdapter.execute).not.toHaveBeenCalled();
    });

    it('should serialize tags, socialLinks, customFields on update', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow());

      await repo.update('ct-1', {
        tags: ['vip'],
        socialLinks: { linkedin: 'alice' },
        customFields: { tier: 'gold' },
      });

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params[0]).toBe('["vip"]');
      expect(params[1]).toBe('{"linkedin":"alice"}');
      expect(params[2]).toBe('{"tier":"gold"}');
    });

    it('should update multiple fields at once', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow());
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(
        makeContactRow({ name: 'Bob', email: 'bob@example.com', company: 'NewCo' })
      );

      const result = await repo.update('ct-1', {
        name: 'Bob',
        email: 'bob@example.com',
        company: 'NewCo',
      });

      expect(result!.name).toBe('Bob');
      expect(result!.email).toBe('bob@example.com');
      expect(result!.company).toBe('NewCo');
    });
  });

  // =========================================================================
  // delete
  // =========================================================================

  describe('delete', () => {
    it('should return true when deletion succeeds', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      expect(await repo.delete('ct-1')).toBe(true);
    });

    it('should return false when contact not found', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 0 });

      expect(await repo.delete('missing')).toBe(false);
    });

    it('should scope to user_id', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });

      await repo.delete('ct-1');

      const params = mockAdapter.execute.mock.calls[0]![1] as unknown[];
      expect(params).toEqual(['ct-1', 'user-1']);
    });
  });

  // =========================================================================
  // recordContact / toggleFavorite
  // =========================================================================

  describe('recordContact', () => {
    it('should update last_contacted_at and return the contact', async () => {
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow({ last_contacted_at: NOW }));

      const result = await repo.recordContact('ct-1');

      expect(result).not.toBeNull();
      const sql = mockAdapter.execute.mock.calls[0]![0] as string;
      expect(sql).toContain('last_contacted_at = NOW()');
    });
  });

  describe('toggleFavorite', () => {
    it('should toggle from false to true', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow({ is_favorite: false }));
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow({ is_favorite: false }));
      mockAdapter.execute.mockResolvedValueOnce({ changes: 1 });
      mockAdapter.queryOne.mockResolvedValueOnce(makeContactRow({ is_favorite: true }));

      const result = await repo.toggleFavorite('ct-1');

      expect(result).not.toBeNull();
    });

    it('should return null for nonexistent contact', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.toggleFavorite('missing')).toBeNull();
    });
  });

  // =========================================================================
  // list
  // =========================================================================

  describe('list', () => {
    it('should return empty array when no contacts', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.list()).toEqual([]);
    });

    it('should return mapped contacts', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        makeContactRow({ id: 'ct-1' }),
        makeContactRow({ id: 'ct-2', name: 'Bob' }),
      ]);

      const result = await repo.list();

      expect(result).toHaveLength(2);
    });

    it('should filter by relationship', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ relationship: 'friend' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('relationship = $');
    });

    it('should filter by company', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ company: 'ACME' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('company = $');
    });

    it('should filter by isFavorite', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ isFavorite: true });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_favorite = $');
    });

    it('should filter by tags', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ tags: ['vip', 'client'] });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('tags::text LIKE');
      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('%"vip"%');
      expect(params).toContain('%"client"%');
    });

    it('should search by name, nickname, email, phone, and company', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: 'alice' });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('name ILIKE');
      expect(sql).toContain('nickname ILIKE');
      expect(sql).toContain('email ILIKE');
      expect(sql).toContain('phone ILIKE');
      expect(sql).toContain('company ILIKE');
    });

    it('should apply pagination', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ limit: 20, offset: 40 });

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('LIMIT');
      expect(sql).toContain('OFFSET');
    });

    it('should order by is_favorite DESC, name ASC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ORDER BY is_favorite DESC, name ASC');
    });

    it('should escape LIKE wildcards in search', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.list({ search: 'O_Brien' });

      const params = mockAdapter.query.mock.calls[0]![1] as unknown[];
      expect(params).toContain('%O\\_Brien%');
    });
  });

  // =========================================================================
  // Convenience methods
  // =========================================================================

  describe('getFavorites', () => {
    it('should delegate to list with isFavorite=true', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getFavorites();

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('is_favorite = $');
    });
  });

  describe('getByRelationship', () => {
    it('should delegate to list with relationship', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByRelationship('colleague');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('relationship = $');
    });
  });

  describe('getByCompany', () => {
    it('should delegate to list with company', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getByCompany('ACME');

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('company = $');
    });
  });

  describe('getRecentlyContacted', () => {
    it('should order by last_contacted_at DESC', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.getRecentlyContacted(5);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('last_contacted_at IS NOT NULL');
      expect(sql).toContain('ORDER BY last_contacted_at DESC');
    });
  });

  describe('getUpcomingBirthdays', () => {
    it('should return contacts with birthdays in the next N days', async () => {
      // Create a birthday that is coming up
      const today = new Date();
      const upcoming = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 5);
      const birthdayStr = `1990-${String(upcoming.getMonth() + 1).padStart(2, '0')}-${String(upcoming.getDate()).padStart(2, '0')}`;

      mockAdapter.query.mockResolvedValueOnce([makeContactRow({ birthday: birthdayStr })]);

      const result = await repo.getUpcomingBirthdays(30);

      expect(result).toHaveLength(1);
    });

    it('should exclude contacts without birthdays', async () => {
      mockAdapter.query.mockResolvedValueOnce([makeContactRow({ birthday: null })]);

      const result = await repo.getUpcomingBirthdays(30);

      expect(result).toHaveLength(0);
    });

    it('should return empty for no matching contacts', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      const result = await repo.getUpcomingBirthdays(30);

      expect(result).toEqual([]);
    });
  });

  describe('getRelationships', () => {
    it('should return distinct relationships', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { relationship: 'colleague' },
        { relationship: 'friend' },
      ]);

      expect(await repo.getRelationships()).toEqual(['colleague', 'friend']);
    });
  });

  describe('getCompanies', () => {
    it('should return distinct companies', async () => {
      mockAdapter.query.mockResolvedValueOnce([{ company: 'ACME' }, { company: 'Globex' }]);

      expect(await repo.getCompanies()).toEqual(['ACME', 'Globex']);
    });
  });

  describe('getTags', () => {
    it('should aggregate unique tags', async () => {
      mockAdapter.query.mockResolvedValueOnce([
        { tags: '["vip","client"]' },
        { tags: '["client","partner"]' },
      ]);

      const result = await repo.getTags();

      expect(result).toEqual(['client', 'partner', 'vip']);
    });

    it('should return empty array when no contacts', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      expect(await repo.getTags()).toEqual([]);
    });
  });

  describe('count', () => {
    it('should return count', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce({ count: '30' });

      expect(await repo.count()).toBe(30);
    });

    it('should return 0 when null', async () => {
      mockAdapter.queryOne.mockResolvedValueOnce(null);

      expect(await repo.count()).toBe(0);
    });
  });

  describe('search', () => {
    it('should delegate to list with search and limit', async () => {
      mockAdapter.query.mockResolvedValueOnce([]);

      await repo.search('alice', 10);

      const sql = mockAdapter.query.mock.calls[0]![0] as string;
      expect(sql).toContain('ILIKE');
    });
  });

  // =========================================================================
  // Factory
  // =========================================================================

  describe('createContactsRepository', () => {
    it('should be importable', async () => {
      const { createContactsRepository } = await import('./contacts.js');
      const r = createContactsRepository('u1');
      expect(r).toBeInstanceOf(ContactsRepository);
    });
  });
});
