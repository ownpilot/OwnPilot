/**
 * Email Tools Tests
 * Comprehensive test suite for all 6 email tool executors, definitions, and exports.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================================
// Hoisted mocks (available before dynamic import)
// ============================================================================

const mockTryImport = vi.hoisted(() => vi.fn());
const mockAccess = vi.hoisted(() => vi.fn());
const mockBasename = vi.hoisted(() => vi.fn((p: string) => p.split('/').pop() || p));

vi.mock('./module-resolver.js', () => ({
  tryImport: (...args: unknown[]) => mockTryImport(...args),
}));

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}));

vi.mock('node:path', () => ({
  basename: (...args: unknown[]) => mockBasename(...args),
}));

// ============================================================================
// Dynamic import after mocks
// ============================================================================

const {
  sendEmailTool,
  sendEmailExecutor,
  listEmailsTool,
  listEmailsExecutor,
  readEmailTool,
  readEmailExecutor,
  deleteEmailTool,
  deleteEmailExecutor,
  searchEmailsTool,
  searchEmailsExecutor,
  replyEmailTool,
  replyEmailExecutor,
  EMAIL_TOOLS,
  EMAIL_TOOL_NAMES,
} = await import('./email-tools.js');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = {} as any;

// ============================================================================
// sendEmailExecutor
// ============================================================================

describe('sendEmailExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTryImport.mockResolvedValue({});
    mockAccess.mockResolvedValue(undefined);
  });

  // ---------- recipient validation ----------

  it('returns error when to array is empty', async () => {
    const result = await sendEmailExecutor({ to: [], subject: 'Hi', body: 'Hello' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'At least one recipient is required'
    );
  });

  it('returns error when to is undefined', async () => {
    const result = await sendEmailExecutor({ to: undefined, subject: 'Hi', body: 'Hello' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'At least one recipient is required'
    );
  });

  // ---------- email format validation ----------

  it('rejects email without @ sign', async () => {
    const result = await sendEmailExecutor({ to: ['invalidemail'], subject: 'S', body: 'B' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'Invalid email address: invalidemail'
    );
  });

  it('rejects email with spaces', async () => {
    const result = await sendEmailExecutor(
      { to: ['user @example.com'], subject: 'S', body: 'B' },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toContain('Invalid email address');
  });

  it('rejects email with CRLF injection', async () => {
    const result = await sendEmailExecutor(
      { to: ['user@example.com\r\nBcc:evil@evil.com'], subject: 'S', body: 'B' },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toContain('Invalid email address');
  });

  it('rejects email with control characters (tab)', async () => {
    const result = await sendEmailExecutor(
      { to: ['user\t@example.com'], subject: 'S', body: 'B' },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toContain('Invalid email address');
  });

  it('rejects email with null byte', async () => {
    const result = await sendEmailExecutor(
      { to: ['user\x00@example.com'], subject: 'S', body: 'B' },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toContain('Invalid email address');
  });

  it('rejects empty string as email', async () => {
    const result = await sendEmailExecutor({ to: [''], subject: 'S', body: 'B' }, ctx);
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe('Invalid email address: ');
  });

  it('rejects email missing domain part', async () => {
    const result = await sendEmailExecutor({ to: ['user@'], subject: 'S', body: 'B' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('rejects email missing local part', async () => {
    const result = await sendEmailExecutor({ to: ['@example.com'], subject: 'S', body: 'B' }, ctx);
    expect(result.isError).toBe(true);
  });

  it('accepts valid email addresses', async () => {
    const result = await sendEmailExecutor(
      { to: ['user@example.com'], subject: 'S', body: 'B' },
      ctx
    );
    expect(result.isError).toBe(false);
  });

  it('accepts email with subdomains', async () => {
    const result = await sendEmailExecutor(
      { to: ['user@mail.example.co.uk'], subject: 'S', body: 'B' },
      ctx
    );
    expect(result.isError).toBe(false);
  });

  it('accepts email with plus addressing', async () => {
    const result = await sendEmailExecutor(
      { to: ['user+tag@example.com'], subject: 'S', body: 'B' },
      ctx
    );
    expect(result.isError).toBe(false);
  });

  // ---------- CC/BCC validation ----------

  it('validates invalid email in CC list', async () => {
    const result = await sendEmailExecutor(
      { to: ['ok@example.com'], cc: ['bad email'], subject: 'S', body: 'B' },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'Invalid email address: bad email'
    );
  });

  it('validates invalid email in BCC list', async () => {
    const result = await sendEmailExecutor(
      { to: ['ok@example.com'], bcc: ['nope'], subject: 'S', body: 'B' },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe('Invalid email address: nope');
  });

  it('validates all recipients combined (first invalid in BCC)', async () => {
    const result = await sendEmailExecutor(
      {
        to: ['a@b.com'],
        cc: ['c@d.com'],
        bcc: ['e@f.com', 'INVALID'],
        subject: 'S',
        body: 'B',
      },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'Invalid email address: INVALID'
    );
  });

  // ---------- replyTo validation ----------

  it('rejects invalid replyTo address', async () => {
    const result = await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'S', body: 'B', replyTo: 'not-valid' },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'Invalid replyTo address: not-valid'
    );
  });

  it('rejects replyTo with CRLF injection', async () => {
    const result = await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'S', body: 'B', replyTo: 'ok@example.com\r\nBcc:evil@evil.com' },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toContain('Invalid replyTo address');
  });

  it('accepts valid replyTo address', async () => {
    const result = await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'S', body: 'B', replyTo: 'reply@example.com' },
      ctx
    );
    expect(result.isError).toBe(false);
    expect((result.content as Record<string, unknown>).status).toBe('prepared');
  });

  // ---------- nodemailer import failure ----------

  it('returns error when nodemailer is not installed', async () => {
    mockTryImport.mockRejectedValueOnce(new Error('not found'));

    const result = await sendEmailExecutor(
      { to: ['user@example.com'], subject: 'Hi', body: 'Hello world' },
      ctx
    );
    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(content.error).toBe('nodemailer library not installed');
    expect(content.suggestion).toContain('pnpm add nodemailer');
  });

  it('includes email details in nodemailer failure response', async () => {
    mockTryImport.mockRejectedValueOnce(new Error('missing'));

    const result = await sendEmailExecutor(
      {
        to: ['a@b.com', 'c@d.com'],
        subject: 'Test',
        body: 'Body here',
        cc: ['e@f.com'],
        bcc: ['g@h.com'],
        attachments: ['/tmp/file.txt'],
      },
      ctx
    );
    const content = result.content as Record<string, unknown>;
    const details = content.emailDetails as Record<string, unknown>;
    expect(details.to).toEqual(['a@b.com', 'c@d.com']);
    expect(details.subject).toBe('Test');
    expect(details.cc).toEqual(['e@f.com']);
    expect(details.bcc).toEqual(['g@h.com']);
    expect(details.hasAttachments).toBe(true);
  });

  it('body preview is truncated at 100 chars in nodemailer failure', async () => {
    mockTryImport.mockRejectedValueOnce(new Error('missing'));

    const longBody = 'A'.repeat(150);
    const result = await sendEmailExecutor({ to: ['a@b.com'], subject: 'S', body: longBody }, ctx);
    const content = result.content as Record<string, unknown>;
    const details = content.emailDetails as Record<string, unknown>;
    expect(details.body).toBe('A'.repeat(100) + '...');
  });

  it('body preview has no ellipsis when body is exactly 100 chars (nodemailer failure)', async () => {
    mockTryImport.mockRejectedValueOnce(new Error('missing'));

    const body = 'B'.repeat(100);
    const result = await sendEmailExecutor({ to: ['a@b.com'], subject: 'S', body }, ctx);
    const details = (result.content as Record<string, unknown>).emailDetails as Record<
      string,
      unknown
    >;
    expect(details.body).toBe('B'.repeat(100));
  });

  // ---------- priority ----------

  it('sets high priority headers', async () => {
    const result = await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'Urgent', body: 'Now', priority: 'high' },
      ctx
    );
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.priority).toBe('high');
  });

  it('sets low priority headers', async () => {
    const result = await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'Low', body: 'Later', priority: 'low' },
      ctx
    );
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.priority).toBe('low');
  });

  it('uses normal priority by default', async () => {
    const result = await sendEmailExecutor({ to: ['a@b.com'], subject: 'S', body: 'B' }, ctx);
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.priority).toBe('normal');
  });

  // ---------- HTML vs text ----------

  it('marks body as HTML when html=true', async () => {
    const result = await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'S', body: '<p>Hi</p>', html: true },
      ctx
    );
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.isHtml).toBe(true);
  });

  it('marks body as text when html is false', async () => {
    const result = await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'S', body: 'Plain text', html: false },
      ctx
    );
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.isHtml).toBe(false);
  });

  it('defaults html to false when not specified', async () => {
    const result = await sendEmailExecutor({ to: ['a@b.com'], subject: 'S', body: 'Text' }, ctx);
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.isHtml).toBe(false);
  });

  // ---------- attachments ----------

  it('returns error when attachment file not found', async () => {
    mockAccess.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'S', body: 'B', attachments: ['/tmp/missing.txt'] },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'Attachment not found: /tmp/missing.txt'
    );
  });

  it('stops at first missing attachment in the list', async () => {
    mockAccess.mockResolvedValueOnce(undefined); // first OK
    mockAccess.mockRejectedValueOnce(new Error('ENOENT')); // second missing

    const result = await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'S', body: 'B', attachments: ['/tmp/ok.txt', '/tmp/bad.txt'] },
      ctx
    );
    expect(result.isError).toBe(true);
    expect((result.content as Record<string, unknown>).error).toBe(
      'Attachment not found: /tmp/bad.txt'
    );
  });

  it('includes attachment count in success result', async () => {
    const result = await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'S', body: 'B', attachments: ['/tmp/a.pdf', '/tmp/b.pdf'] },
      ctx
    );
    expect(result.isError).toBe(false);
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.attachmentCount).toBe(2);
  });

  it('reports attachmentCount 0 when no attachments', async () => {
    const result = await sendEmailExecutor({ to: ['a@b.com'], subject: 'S', body: 'B' }, ctx);
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.attachmentCount).toBe(0);
  });

  it('calls path.basename for each attachment filename', async () => {
    await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'S', body: 'B', attachments: ['/home/user/doc.pdf'] },
      ctx
    );
    expect(mockBasename).toHaveBeenCalledWith('/home/user/doc.pdf');
  });

  // ---------- success response shape ----------

  it('returns prepared status with requiresSMTPConfig on success', async () => {
    const result = await sendEmailExecutor(
      { to: ['a@b.com'], subject: 'Test subject', body: 'Test body' },
      ctx
    );
    expect(result.isError).toBe(false);
    const content = result.content as Record<string, unknown>;
    expect(content.status).toBe('prepared');
    expect(content.requiresSMTPConfig).toBe(true);
    expect(content.note).toContain('SMTP');
  });

  it('truncates body preview at 100 characters in success response', async () => {
    const longBody = 'X'.repeat(200);
    const result = await sendEmailExecutor({ to: ['a@b.com'], subject: 'S', body: longBody }, ctx);
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.bodyPreview).toBe('X'.repeat(100) + '...');
  });

  it('does not add ellipsis when body is short', async () => {
    const result = await sendEmailExecutor({ to: ['a@b.com'], subject: 'S', body: 'Short' }, ctx);
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.bodyPreview).toBe('Short');
  });

  it('includes CC and BCC in success message', async () => {
    const result = await sendEmailExecutor(
      { to: ['a@b.com'], cc: ['c@d.com', 'e@f.com'], bcc: ['g@h.com'], subject: 'S', body: 'B' },
      ctx
    );
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.cc).toEqual(['c@d.com', 'e@f.com']);
    expect(msg.bcc).toEqual(['g@h.com']);
  });

  it('includes to list in success message', async () => {
    const result = await sendEmailExecutor(
      { to: ['a@b.com', 'x@y.com'], subject: 'S', body: 'B' },
      ctx
    );
    const msg = (result.content as Record<string, unknown>).message as Record<string, unknown>;
    expect(msg.to).toEqual(['a@b.com', 'x@y.com']);
  });

  it('calls tryImport with "nodemailer"', async () => {
    await sendEmailExecutor({ to: ['a@b.com'], subject: 'S', body: 'B' }, ctx);
    expect(mockTryImport).toHaveBeenCalledWith('nodemailer');
  });
});

// ============================================================================
// listEmailsExecutor
// ============================================================================

describe('listEmailsExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTryImport.mockResolvedValue({});
  });

  it('uses default folder INBOX when not specified', async () => {
    const result = await listEmailsExecutor({}, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.folder).toBe('INBOX');
  });

  it('uses custom folder when specified', async () => {
    const result = await listEmailsExecutor({ folder: 'Sent' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.folder).toBe('Sent');
  });

  it('defaults limit to 20', async () => {
    const result = await listEmailsExecutor({}, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.limit).toBe(20);
  });

  it('caps limit at 100', async () => {
    const result = await listEmailsExecutor({ limit: 999 }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.limit).toBe(100);
  });

  it('allows limit below 100', async () => {
    const result = await listEmailsExecutor({ limit: 50 }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.limit).toBe(50);
  });

  it('handles limit of 0 by using default 20', async () => {
    const result = await listEmailsExecutor({ limit: 0 }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    // 0 is falsy, so (0 || 20) = 20, then min(20,100) = 20
    expect(query.limit).toBe(20);
  });

  it('defaults unreadOnly to false', async () => {
    const result = await listEmailsExecutor({}, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.unreadOnly).toBe(false);
  });

  it('sets unreadOnly true when specified', async () => {
    const result = await listEmailsExecutor({ unreadOnly: true }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.unreadOnly).toBe(true);
  });

  it('includes filter params in success response', async () => {
    const result = await listEmailsExecutor(
      {
        from: 'alice@example.com',
        subject: 'Invoice',
        since: '2025-01-01',
        before: '2025-12-31',
      },
      ctx
    );
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.from).toBe('alice@example.com');
    expect(query.subject).toBe('Invoice');
    expect(query.since).toBe('2025-01-01');
    expect(query.before).toBe('2025-12-31');
  });

  it('returns prepared status with requiresIMAPConfig', async () => {
    const result = await listEmailsExecutor({}, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.status).toBe('prepared');
    expect(content.requiresIMAPConfig).toBe(true);
    expect(result.isError).toBe(false);
  });

  it('returns error when imapflow is not installed', async () => {
    mockTryImport.mockRejectedValueOnce(new Error('not found'));

    const result = await listEmailsExecutor({ limit: 10 }, ctx);
    expect(result.isError).toBe(true);
    const content = result.content as Record<string, unknown>;
    expect(content.error).toBe('imapflow library not installed');
    expect(content.suggestion).toContain('pnpm add imapflow');
  });

  it('includes query params in imapflow failure response', async () => {
    mockTryImport.mockRejectedValueOnce(new Error('not found'));

    const result = await listEmailsExecutor({ folder: 'Drafts', limit: 5, unreadOnly: true }, ctx);
    const content = result.content as Record<string, unknown>;
    const query = content.query as Record<string, unknown>;
    expect(query.folder).toBe('Drafts');
    expect(query.limit).toBe(5);
    expect(query.unreadOnly).toBe(true);
  });

  it('calls tryImport with "imapflow"', async () => {
    await listEmailsExecutor({}, ctx);
    expect(mockTryImport).toHaveBeenCalledWith('imapflow');
  });
});

// ============================================================================
// readEmailExecutor
// ============================================================================

describe('readEmailExecutor', () => {
  it('returns prepared status with email query', async () => {
    const result = await readEmailExecutor({ id: 'msg-123' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.status).toBe('prepared');
    expect(content.requiresIMAPConfig).toBe(true);
    expect(result.isError).toBe(false);
  });

  it('defaults folder to INBOX', async () => {
    const result = await readEmailExecutor({ id: 'msg-1' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.folder).toBe('INBOX');
  });

  it('uses custom folder when specified', async () => {
    const result = await readEmailExecutor({ id: 'msg-1', folder: 'Archive' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.folder).toBe('Archive');
  });

  it('defaults markAsRead to true', async () => {
    const result = await readEmailExecutor({ id: 'msg-1' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.markAsRead).toBe(true);
  });

  it('keeps markAsRead true when explicitly set true', async () => {
    const result = await readEmailExecutor({ id: 'msg-1', markAsRead: true }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.markAsRead).toBe(true);
  });

  it('sets markAsRead false when explicitly set false', async () => {
    const result = await readEmailExecutor({ id: 'msg-1', markAsRead: false }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.markAsRead).toBe(false);
  });

  it('defaults downloadAttachments to false', async () => {
    const result = await readEmailExecutor({ id: 'msg-1' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.downloadAttachments).toBe(false);
  });

  it('sets downloadAttachments true when specified', async () => {
    const result = await readEmailExecutor({ id: 'msg-1', downloadAttachments: true }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.downloadAttachments).toBe(true);
  });

  it('includes attachmentDir in query when provided', async () => {
    const result = await readEmailExecutor({ id: 'msg-1', attachmentDir: '/tmp/downloads' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.attachmentDir).toBe('/tmp/downloads');
  });

  it('includes the email id in query', async () => {
    const result = await readEmailExecutor({ id: 'unique-msg-id-42' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.id).toBe('unique-msg-id-42');
  });
});

// ============================================================================
// deleteEmailExecutor
// ============================================================================

describe('deleteEmailExecutor', () => {
  it('returns prepared status with move_to_trash by default', async () => {
    const result = await deleteEmailExecutor({ id: 'msg-1' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.status).toBe('prepared');
    expect(content.action).toBe('move_to_trash');
    expect(content.requiresIMAPConfig).toBe(true);
    expect(result.isError).toBe(false);
  });

  it('sets action to permanent_delete when permanent=true', async () => {
    const result = await deleteEmailExecutor({ id: 'msg-1', permanent: true }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.action).toBe('permanent_delete');
  });

  it('keeps move_to_trash when permanent=false', async () => {
    const result = await deleteEmailExecutor({ id: 'msg-1', permanent: false }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.action).toBe('move_to_trash');
  });

  it('defaults folder to INBOX', async () => {
    const result = await deleteEmailExecutor({ id: 'msg-1' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.folder).toBe('INBOX');
  });

  it('uses custom folder when specified', async () => {
    const result = await deleteEmailExecutor({ id: 'msg-1', folder: 'Spam' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.folder).toBe('Spam');
  });

  it('includes email id in query', async () => {
    const result = await deleteEmailExecutor({ id: 'del-42' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.id).toBe('del-42');
  });

  it('includes permanent flag in query', async () => {
    const result = await deleteEmailExecutor({ id: 'msg-1', permanent: true }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.permanent).toBe(true);
  });
});

// ============================================================================
// searchEmailsExecutor
// ============================================================================

describe('searchEmailsExecutor', () => {
  it('returns prepared status with search query', async () => {
    const result = await searchEmailsExecutor({ query: 'invoice' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.status).toBe('prepared');
    expect(content.requiresIMAPConfig).toBe(true);
    expect(result.isError).toBe(false);
  });

  it('defaults folder to "all" when not specified', async () => {
    const result = await searchEmailsExecutor({ query: 'test' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.folder).toBe('all');
  });

  it('uses custom folder when specified', async () => {
    const result = await searchEmailsExecutor({ query: 'test', folder: 'Sent' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.folder).toBe('Sent');
  });

  it('defaults limit to 50', async () => {
    const result = await searchEmailsExecutor({ query: 'test' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.limit).toBe(50);
  });

  it('caps limit at 200', async () => {
    const result = await searchEmailsExecutor({ query: 'test', limit: 500 }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.limit).toBe(200);
  });

  it('allows limit below 200', async () => {
    const result = await searchEmailsExecutor({ query: 'test', limit: 75 }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.limit).toBe(75);
  });

  it('handles limit=0 by using default 50', async () => {
    const result = await searchEmailsExecutor({ query: 'test', limit: 0 }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    // (0 || 50) = 50, min(50, 200) = 50
    expect(query.limit).toBe(50);
  });

  it('maps query param to searchText in response', async () => {
    const result = await searchEmailsExecutor({ query: 'financial report Q4' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.searchText).toBe('financial report Q4');
  });

  it('includes hasAttachment filter when specified', async () => {
    const result = await searchEmailsExecutor({ query: 'test', hasAttachment: true }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.hasAttachment).toBe(true);
  });

  it('includes isStarred filter when specified', async () => {
    const result = await searchEmailsExecutor({ query: 'test', isStarred: true }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.isStarred).toBe(true);
  });

  it('leaves hasAttachment and isStarred undefined when not provided', async () => {
    const result = await searchEmailsExecutor({ query: 'test' }, ctx);
    const query = (result.content as Record<string, unknown>).query as Record<string, unknown>;
    expect(query.hasAttachment).toBeUndefined();
    expect(query.isStarred).toBeUndefined();
  });
});

// ============================================================================
// replyEmailExecutor
// ============================================================================

describe('replyEmailExecutor', () => {
  it('returns prepared status with reply action by default', async () => {
    const result = await replyEmailExecutor({ id: 'msg-1', body: 'Thanks!' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.status).toBe('prepared');
    expect(content.action).toBe('reply');
    expect(content.requiresSMTPConfig).toBe(true);
    expect(content.requiresIMAPConfig).toBe(true);
    expect(result.isError).toBe(false);
  });

  it('sets action to reply_all when replyAll=true', async () => {
    const result = await replyEmailExecutor({ id: 'msg-1', body: 'Thanks!', replyAll: true }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.action).toBe('reply_all');
  });

  it('defaults replyAll to false', async () => {
    const result = await replyEmailExecutor({ id: 'msg-1', body: 'Hi' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.action).toBe('reply');
  });

  it('truncates body preview at 100 chars', async () => {
    const longBody = 'Z'.repeat(200);
    const result = await replyEmailExecutor({ id: 'msg-1', body: longBody }, ctx);
    const details = (result.content as Record<string, unknown>).details as Record<string, unknown>;
    expect(details.bodyPreview).toBe('Z'.repeat(100) + '...');
  });

  it('does not add ellipsis for short body', async () => {
    const result = await replyEmailExecutor({ id: 'msg-1', body: 'Short reply' }, ctx);
    const details = (result.content as Record<string, unknown>).details as Record<string, unknown>;
    expect(details.bodyPreview).toBe('Short reply');
  });

  it('does not add ellipsis for body exactly 100 chars', async () => {
    const body = 'M'.repeat(100);
    const result = await replyEmailExecutor({ id: 'msg-1', body }, ctx);
    const details = (result.content as Record<string, unknown>).details as Record<string, unknown>;
    expect(details.bodyPreview).toBe('M'.repeat(100));
  });

  it('defaults isHtml to false', async () => {
    const result = await replyEmailExecutor({ id: 'msg-1', body: 'Hi' }, ctx);
    const details = (result.content as Record<string, unknown>).details as Record<string, unknown>;
    expect(details.isHtml).toBe(false);
  });

  it('sets isHtml to true when html=true', async () => {
    const result = await replyEmailExecutor({ id: 'msg-1', body: '<p>Hi</p>', html: true }, ctx);
    const details = (result.content as Record<string, unknown>).details as Record<string, unknown>;
    expect(details.isHtml).toBe(true);
  });

  it('reports attachment count', async () => {
    const result = await replyEmailExecutor(
      { id: 'msg-1', body: 'Hi', attachments: ['/a.txt', '/b.txt', '/c.txt'] },
      ctx
    );
    const details = (result.content as Record<string, unknown>).details as Record<string, unknown>;
    expect(details.attachmentCount).toBe(3);
  });

  it('reports attachment count 0 when no attachments', async () => {
    const result = await replyEmailExecutor({ id: 'msg-1', body: 'Hi' }, ctx);
    const details = (result.content as Record<string, unknown>).details as Record<string, unknown>;
    expect(details.attachmentCount).toBe(0);
  });

  it('includes originalId in details', async () => {
    const result = await replyEmailExecutor({ id: 'original-42', body: 'Reply' }, ctx);
    const details = (result.content as Record<string, unknown>).details as Record<string, unknown>;
    expect(details.originalId).toBe('original-42');
  });

  it('includes note about both SMTP and IMAP configuration', async () => {
    const result = await replyEmailExecutor({ id: 'msg-1', body: 'Hi' }, ctx);
    const content = result.content as Record<string, unknown>;
    expect(content.note).toContain('SMTP');
    expect(content.note).toContain('IMAP');
  });
});

// ============================================================================
// Tool definitions
// ============================================================================

describe('tool definitions', () => {
  describe('sendEmailTool', () => {
    it('has correct name', () => {
      expect(sendEmailTool.name).toBe('send_email');
    });

    it('requires to, subject, and body', () => {
      expect(sendEmailTool.parameters.required).toEqual(['to', 'subject', 'body']);
    });

    it('has SMTP config requirement', () => {
      expect(sendEmailTool.configRequirements).toHaveLength(1);
      expect(sendEmailTool.configRequirements![0].name).toBe('smtp');
    });

    it('has brief description', () => {
      expect(sendEmailTool.brief).toBeDefined();
      expect(sendEmailTool.brief!.length).toBeGreaterThan(0);
    });

    it('defines priority enum', () => {
      const priorityProp = sendEmailTool.parameters.properties.priority as Record<string, unknown>;
      expect(priorityProp.enum).toEqual(['high', 'normal', 'low']);
    });
  });

  describe('listEmailsTool', () => {
    it('has correct name', () => {
      expect(listEmailsTool.name).toBe('list_emails');
    });

    it('has no required fields', () => {
      expect(listEmailsTool.parameters.required).toEqual([]);
    });

    it('has IMAP config requirement', () => {
      expect(listEmailsTool.configRequirements).toHaveLength(1);
      expect(listEmailsTool.configRequirements![0].name).toBe('imap');
    });
  });

  describe('readEmailTool', () => {
    it('has correct name', () => {
      expect(readEmailTool.name).toBe('read_email');
    });

    it('requires only id', () => {
      expect(readEmailTool.parameters.required).toEqual(['id']);
    });

    it('has IMAP config requirement', () => {
      expect(readEmailTool.configRequirements![0].name).toBe('imap');
    });
  });

  describe('deleteEmailTool', () => {
    it('has correct name', () => {
      expect(deleteEmailTool.name).toBe('delete_email');
    });

    it('requires only id', () => {
      expect(deleteEmailTool.parameters.required).toEqual(['id']);
    });

    it('has IMAP config requirement', () => {
      expect(deleteEmailTool.configRequirements![0].name).toBe('imap');
    });
  });

  describe('searchEmailsTool', () => {
    it('has correct name', () => {
      expect(searchEmailsTool.name).toBe('search_emails');
    });

    it('requires only query', () => {
      expect(searchEmailsTool.parameters.required).toEqual(['query']);
    });

    it('has IMAP config requirement', () => {
      expect(searchEmailsTool.configRequirements![0].name).toBe('imap');
    });
  });

  describe('replyEmailTool', () => {
    it('has correct name', () => {
      expect(replyEmailTool.name).toBe('reply_email');
    });

    it('requires id and body', () => {
      expect(replyEmailTool.parameters.required).toEqual(['id', 'body']);
    });

    it('has both SMTP and IMAP config requirements', () => {
      expect(replyEmailTool.configRequirements).toHaveLength(2);
      const names = replyEmailTool.configRequirements!.map((c: { name: string }) => c.name);
      expect(names).toContain('smtp');
      expect(names).toContain('imap');
    });
  });
});

// ============================================================================
// EMAIL_TOOLS and EMAIL_TOOL_NAMES exports
// ============================================================================

describe('EMAIL_TOOLS', () => {
  it('contains exactly 6 tool entries', () => {
    expect(EMAIL_TOOLS).toHaveLength(6);
  });

  it('each entry has definition and executor', () => {
    for (const tool of EMAIL_TOOLS) {
      expect(tool.definition).toBeDefined();
      expect(tool.definition.name).toBeTruthy();
      expect(typeof tool.executor).toBe('function');
    }
  });

  it('includes all expected tool names', () => {
    const names = EMAIL_TOOLS.map((t: { definition: { name: string } }) => t.definition.name);
    expect(names).toEqual([
      'send_email',
      'list_emails',
      'read_email',
      'delete_email',
      'search_emails',
      'reply_email',
    ]);
  });
});

describe('EMAIL_TOOL_NAMES', () => {
  it('contains exactly 6 names', () => {
    expect(EMAIL_TOOL_NAMES).toHaveLength(6);
  });

  it('matches EMAIL_TOOLS definitions in order', () => {
    expect(EMAIL_TOOL_NAMES).toEqual([
      'send_email',
      'list_emails',
      'read_email',
      'delete_email',
      'search_emails',
      'reply_email',
    ]);
  });

  it('is derived from EMAIL_TOOLS', () => {
    const expected = EMAIL_TOOLS.map((t: { definition: { name: string } }) => t.definition.name);
    expect(EMAIL_TOOL_NAMES).toEqual(expected);
  });
});

// ============================================================================
// Config requirements shape
// ============================================================================

describe('config requirements', () => {
  it('SMTP config has correct schema fields', () => {
    const smtp = sendEmailTool.configRequirements![0];
    expect(smtp.category).toBe('email');
    expect(smtp.multiEntry).toBe(true);
    const fieldNames = smtp.configSchema.map((f: { name: string }) => f.name);
    expect(fieldNames).toEqual(['host', 'port', 'user', 'pass', 'from', 'secure']);
  });

  it('SMTP port defaults to 587', () => {
    const smtp = sendEmailTool.configRequirements![0];
    const portField = smtp.configSchema.find((f: { name: string }) => f.name === 'port');
    expect(portField.defaultValue).toBe('587');
  });

  it('SMTP pass is a secret type', () => {
    const smtp = sendEmailTool.configRequirements![0];
    const passField = smtp.configSchema.find((f: { name: string }) => f.name === 'pass');
    expect(passField.type).toBe('secret');
  });

  it('IMAP config has correct schema fields', () => {
    const imap = listEmailsTool.configRequirements![0];
    expect(imap.category).toBe('email');
    expect(imap.multiEntry).toBe(true);
    const fieldNames = imap.configSchema.map((f: { name: string }) => f.name);
    expect(fieldNames).toEqual(['host', 'port', 'user', 'pass', 'tls']);
  });

  it('IMAP port defaults to 993', () => {
    const imap = listEmailsTool.configRequirements![0];
    const portField = imap.configSchema.find((f: { name: string }) => f.name === 'port');
    expect(portField.defaultValue).toBe('993');
  });

  it('IMAP pass is a secret type', () => {
    const imap = listEmailsTool.configRequirements![0];
    const passField = imap.configSchema.find((f: { name: string }) => f.name === 'pass');
    expect(passField.type).toBe('secret');
  });
});
