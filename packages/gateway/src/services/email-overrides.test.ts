/**
 * Email Overrides Tests
 *
 * Tests the email tool override executors (send, list, read, search, reply, delete),
 * config helpers (SMTP/IMAP resolution), internal helpers (formatAddress, formatAddressList,
 * extractTextFromRaw), and the registration function.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mockGetFieldValue = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());

const mockLogInfo = vi.hoisted(() => vi.fn());
const mockLogDebug = vi.hoisted(() => vi.fn());
const mockLogWarn = vi.hoisted(() => vi.fn());
const mockLogError = vi.hoisted(() => vi.fn());

// IMAP mock client
const mockImapConnect = vi.hoisted(() => vi.fn());
const mockImapGetMailboxLock = vi.hoisted(() => vi.fn());
const mockImapLogout = vi.hoisted(() => vi.fn());
const mockImapFetch = vi.hoisted(() => vi.fn());
const mockImapSearch = vi.hoisted(() => vi.fn());
const mockImapDownload = vi.hoisted(() => vi.fn());
const mockImapMessageFlagsAdd = vi.hoisted(() => vi.fn());
const mockImapMessageDelete = vi.hoisted(() => vi.fn());
const mockImapMessageMove = vi.hoisted(() => vi.fn());
const mockLockRelease = vi.hoisted(() => vi.fn());

const mockImapClient = vi.hoisted(() => ({
  connect: mockImapConnect,
  getMailboxLock: mockImapGetMailboxLock,
  logout: mockImapLogout,
  fetch: mockImapFetch,
  search: mockImapSearch,
  download: mockImapDownload,
  messageFlagsAdd: mockImapMessageFlagsAdd,
  messageDelete: mockImapMessageDelete,
  messageMove: mockImapMessageMove,
  mailbox: { exists: 10 },
}));

// Nodemailer mock
const mockSendMail = vi.hoisted(() => vi.fn());
const mockCreateTransport = vi.hoisted(() =>
  vi.fn(() => ({
    sendMail: mockSendMail,
  }))
);

// ImapFlow constructor args spy
const mockImapFlowConstructorArgs = vi.hoisted(() => vi.fn());

// fs mock
const mockFsAccess = vi.hoisted(() => vi.fn());

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../db/repositories/config-services.js', () => ({
  configServicesRepo: {
    getFieldValue: (...args: unknown[]) => mockGetFieldValue(...args),
    upsert: (...args: unknown[]) => mockUpsert(...args),
  },
}));

vi.mock('../routes/helpers.js', () => ({
  getErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('./log.js', () => ({
  getLog: () => ({
    info: mockLogInfo,
    debug: mockLogDebug,
    warn: mockLogWarn,
    error: mockLogError,
  }),
}));

vi.mock('imapflow', () => ({
  ImapFlow: function (config: unknown) {
    mockImapFlowConstructorArgs(config);
    return mockImapClient;
  },
}));

vi.mock('nodemailer', () => ({
  default: { createTransport: mockCreateTransport },
}));

vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockFsAccess(...args),
}));

vi.mock('node:path', () => ({
  basename: (p: string) => p.split('/').pop() ?? p,
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { registerEmailOverrides } from './email-overrides.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Executor = (params: Record<string, any>, context?: any) => Promise<any>;

/**
 * Capture all 6 email executors by calling registerEmailOverrides with a mock registry.
 */
async function captureExecutors(): Promise<Record<string, Executor>> {
  const captured: Record<string, Executor> = {};
  const mockRegistry = {
    updateExecutor: vi.fn((name: string, executor: Executor) => {
      captured[name] = executor;
      return true;
    }),
  };
  await registerEmailOverrides(mockRegistry as never);
  return captured;
}

function setupSmtpConfig(overrides: Record<string, string | undefined> = {}): void {
  mockGetFieldValue.mockImplementation((service: string, field: string) => {
    if (service === 'smtp') {
      const defaults: Record<string, string> = {
        host: 'smtp.example.com',
        user: 'user@example.com',
        pass: 'secret123',
        port: '587',
        from: 'sender@example.com',
        secure: 'true',
      };
      return overrides[field] !== undefined ? overrides[field] : defaults[field];
    }
    return undefined;
  });
}

function setupImapConfig(overrides: Record<string, string | undefined> = {}): void {
  mockGetFieldValue.mockImplementation((service: string, field: string) => {
    if (service === 'imap') {
      const defaults: Record<string, string> = {
        host: 'imap.example.com',
        user: 'user@example.com',
        pass: 'secret123',
        port: '993',
        tls: 'true',
      };
      return overrides[field] !== undefined ? overrides[field] : defaults[field];
    }
    return undefined;
  });
}

function setupBothConfigs(
  smtpOverrides: Record<string, string | undefined> = {},
  imapOverrides: Record<string, string | undefined> = {}
): void {
  mockGetFieldValue.mockImplementation((service: string, field: string) => {
    if (service === 'smtp') {
      const defaults: Record<string, string> = {
        host: 'smtp.example.com',
        user: 'user@example.com',
        pass: 'secret123',
        port: '587',
        from: 'sender@example.com',
        secure: 'true',
      };
      return smtpOverrides[field] !== undefined ? smtpOverrides[field] : defaults[field];
    }
    if (service === 'imap') {
      const defaults: Record<string, string> = {
        host: 'imap.example.com',
        user: 'user@example.com',
        pass: 'secret123',
        port: '993',
        tls: 'true',
      };
      return imapOverrides[field] !== undefined ? imapOverrides[field] : defaults[field];
    }
    return undefined;
  });
}

/** Create an async iterable that yields the given messages. */
function asyncIterable<T>(items: T[]): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const item of items) yield item;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let executors: Record<string, Executor>;

beforeEach(async () => {
  vi.clearAllMocks();
  mockImapGetMailboxLock.mockResolvedValue({ release: mockLockRelease });
  mockImapConnect.mockResolvedValue(undefined);
  mockImapLogout.mockResolvedValue(undefined);
  mockUpsert.mockResolvedValue(undefined);
  executors = await captureExecutors();
});

// ============================================================================
// Registration
// ============================================================================

describe('registerEmailOverrides', () => {
  it('should register all 6 email tool executors', () => {
    const names = Object.keys(executors);
    expect(names).toContain('send_email');
    expect(names).toContain('list_emails');
    expect(names).toContain('read_email');
    expect(names).toContain('search_emails');
    expect(names).toContain('reply_email');
    expect(names).toContain('delete_email');
    expect(names).toHaveLength(6);
  });

  it('should call updateExecutor for each tool name', async () => {
    const mockRegistry = {
      updateExecutor: vi.fn(() => true),
    };
    await registerEmailOverrides(mockRegistry as never);
    expect(mockRegistry.updateExecutor).toHaveBeenCalledTimes(6);
  });

  it('should try core. prefix when base name fails', async () => {
    const mockRegistry = {
      updateExecutor: vi.fn((name: string) => name.startsWith('core.')),
    };
    await registerEmailOverrides(mockRegistry as never);
    // Each tool: first call returns false, second call (core.X) returns true = 12 calls
    expect(mockRegistry.updateExecutor).toHaveBeenCalledTimes(12);
    expect(mockRegistry.updateExecutor).toHaveBeenCalledWith(
      'core.send_email',
      expect.any(Function)
    );
  });

  it('should call ensureEmailServices to upsert config center entries', async () => {
    mockUpsert.mockClear();
    const mockRegistry = { updateExecutor: vi.fn(() => true) };
    await registerEmailOverrides(mockRegistry as never);
    // Wait for async ensureEmailServices fire-and-forget
    await new Promise((r) => setTimeout(r, 10));
    expect(mockUpsert).toHaveBeenCalledTimes(2);
  });

  it('should not throw when ensureEmailServices fails', async () => {
    mockUpsert.mockRejectedValue(new Error('DB down'));
    const mockRegistry = { updateExecutor: vi.fn(() => true) };
    await expect(registerEmailOverrides(mockRegistry as never)).resolves.not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });
});

// ============================================================================
// sendEmailOverride
// ============================================================================

describe('sendEmailOverride', () => {
  it('should return error when no recipients provided', async () => {
    const result = await executors.send_email!({ to: [], subject: 'Hi', body: 'test' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('At least one recipient');
  });

  it('should return error when to is undefined', async () => {
    const result = await executors.send_email!({ subject: 'Hi', body: 'test' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('At least one recipient');
  });

  it('should reject invalid email format', async () => {
    const result = await executors.send_email!({
      to: ['not-an-email'],
      subject: 'Hi',
      body: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Invalid email address');
  });

  it('should reject email with CRLF injection', async () => {
    const result = await executors.send_email!({
      to: ['evil@ex.com\r\nBcc:victim@ex.com'],
      subject: 'Hi',
      body: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Invalid email address');
  });

  it('should reject email with control characters', async () => {
    const result = await executors.send_email!({
      to: ['evil@ex.com\x00'],
      subject: 'Hi',
      body: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Invalid email address');
  });

  it('should validate cc addresses', async () => {
    const result = await executors.send_email!({
      to: ['ok@ex.com'],
      cc: ['bad-address'],
      subject: 'Hi',
      body: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Invalid email address: bad-address');
  });

  it('should validate bcc addresses', async () => {
    const result = await executors.send_email!({
      to: ['ok@ex.com'],
      bcc: ['bad-bcc'],
      subject: 'Hi',
      body: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Invalid email address: bad-bcc');
  });

  it('should return error when SMTP is not configured', async () => {
    mockGetFieldValue.mockReturnValue(undefined);
    const result = await executors.send_email!({ to: ['a@b.com'], subject: 'Hi', body: 'test' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('SMTP not configured');
  });

  it('should send email successfully with valid config', async () => {
    setupSmtpConfig();
    mockSendMail.mockResolvedValue({ messageId: '<msg123@example.com>' });

    const result = await executors.send_email!({
      to: ['recipient@example.com'],
      subject: 'Test Subject',
      body: 'Hello world',
    });

    expect(result.isError).toBe(false);
    expect(result.content.success).toBe(true);
    expect(result.content.messageId).toBe('<msg123@example.com>');
    expect(result.content.to).toEqual(['recipient@example.com']);
    expect(result.content.subject).toBe('Test Subject');
  });

  it('should use text body by default and html when specified', async () => {
    setupSmtpConfig();
    mockSendMail.mockResolvedValue({ messageId: '<msg@ex.com>' });

    // text mode (default)
    await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: '<b>hi</b>' });
    const textCall = mockSendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(textCall.text).toBe('<b>hi</b>');
    expect(textCall.html).toBeUndefined();

    mockSendMail.mockClear();

    // html mode
    await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: '<b>hi</b>', html: true });
    const htmlCall = mockSendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(htmlCall.html).toBe('<b>hi</b>');
    expect(htmlCall.text).toBeUndefined();
  });

  it('should set high priority headers', async () => {
    setupSmtpConfig();
    mockSendMail.mockResolvedValue({ messageId: '<msg@ex.com>' });

    await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B', priority: 'high' });
    const msg = mockSendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(msg.priority).toBe('high');
    expect(msg.headers).toEqual({ 'X-Priority': '1' });
  });

  it('should set low priority headers', async () => {
    setupSmtpConfig();
    mockSendMail.mockResolvedValue({ messageId: '<msg@ex.com>' });

    await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B', priority: 'low' });
    const msg = mockSendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(msg.priority).toBe('low');
    expect(msg.headers).toEqual({ 'X-Priority': '5' });
  });

  it('should not set priority headers for normal priority', async () => {
    setupSmtpConfig();
    mockSendMail.mockResolvedValue({ messageId: '<msg@ex.com>' });

    await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B', priority: 'normal' });
    const msg = mockSendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(msg.priority).toBeUndefined();
    expect(msg.headers).toBeUndefined();
  });

  it('should sanitize subject and replyTo (strip CR/LF)', async () => {
    setupSmtpConfig();
    mockSendMail.mockResolvedValue({ messageId: '<msg@ex.com>' });

    await executors.send_email!({
      to: ['a@b.com'],
      subject: 'Line1\r\nLine2',
      body: 'B',
      replyTo: 'reply@ex.com\ninjected',
    });

    const msg = mockSendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(msg.subject).toBe('Line1Line2');
    expect(msg.replyTo).toBe('reply@ex.cominjected');
  });

  it('should include cc and bcc in the sent message', async () => {
    setupSmtpConfig();
    mockSendMail.mockResolvedValue({ messageId: '<msg@ex.com>' });

    await executors.send_email!({
      to: ['a@b.com'],
      cc: ['cc1@b.com', 'cc2@b.com'],
      bcc: ['bcc@b.com'],
      subject: 'S',
      body: 'B',
    });

    const msg = mockSendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(msg.cc).toBe('cc1@b.com, cc2@b.com');
    expect(msg.bcc).toBe('bcc@b.com');
  });

  it('should return error when attachment file not found', async () => {
    setupSmtpConfig();
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await executors.send_email!({
      to: ['a@b.com'],
      subject: 'S',
      body: 'B',
      attachments: ['/tmp/missing.pdf'],
    });

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Attachment not found: /tmp/missing.pdf');
  });

  it('should include attachment count on success', async () => {
    setupSmtpConfig();
    mockFsAccess.mockResolvedValue(undefined);
    mockSendMail.mockResolvedValue({ messageId: '<msg@ex.com>' });

    const result = await executors.send_email!({
      to: ['a@b.com'],
      subject: 'S',
      body: 'B',
      attachments: ['/tmp/doc.pdf', '/tmp/img.png'],
    });

    expect(result.isError).toBe(false);
    expect(result.content.attachmentCount).toBe(2);
  });

  it('should return error when sendMail throws', async () => {
    setupSmtpConfig();
    mockSendMail.mockRejectedValue(new Error('Connection refused'));

    const result = await executors.send_email!({
      to: ['a@b.com'],
      subject: 'S',
      body: 'B',
    });

    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to send email');
    expect(result.content.error).toContain('Connection refused');
  });

  it('should default from to user when from not configured', async () => {
    setupSmtpConfig({ from: '' });
    mockSendMail.mockResolvedValue({ messageId: '<msg@ex.com>' });

    await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B' });
    const msg = mockSendMail.mock.calls[0]![0] as Record<string, unknown>;
    // When from is empty, should default to user
    expect(msg.from).toBe('user@example.com');
  });
});

// ============================================================================
// SMTP Config resolution (tested through sendEmailOverride)
// ============================================================================

describe('getSmtpConfig (via sendEmailOverride)', () => {
  it('should return null when host is missing', async () => {
    mockGetFieldValue.mockImplementation((svc: string, field: string) => {
      if (svc === 'smtp') {
        if (field === 'host') return undefined;
        if (field === 'user') return 'user@ex.com';
        if (field === 'pass') return 'pass';
      }
      return undefined;
    });
    const result = await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('SMTP not configured');
  });

  it('should return null when user is missing', async () => {
    mockGetFieldValue.mockImplementation((svc: string, field: string) => {
      if (svc === 'smtp') {
        if (field === 'host') return 'smtp.ex.com';
        if (field === 'user') return undefined;
        if (field === 'pass') return 'pass';
      }
      return undefined;
    });
    const result = await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('SMTP not configured');
  });

  it('should return null when pass is missing', async () => {
    mockGetFieldValue.mockImplementation((svc: string, field: string) => {
      if (svc === 'smtp') {
        if (field === 'host') return 'smtp.ex.com';
        if (field === 'user') return 'user@ex.com';
        if (field === 'pass') return undefined;
      }
      return undefined;
    });
    const result = await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('SMTP not configured');
  });

  it('should default port to 587', async () => {
    setupSmtpConfig({ port: undefined });
    mockSendMail.mockResolvedValue({ messageId: '<m@e>' });

    await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B' });
    const transportArgs = mockCreateTransport.mock.calls[0]![0] as Record<string, unknown>;
    expect(transportArgs.port).toBe(587);
  });

  it('should parse custom port', async () => {
    setupSmtpConfig({ port: '465' });
    mockSendMail.mockResolvedValue({ messageId: '<m@e>' });

    await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B' });
    const transportArgs = mockCreateTransport.mock.calls[0]![0] as Record<string, unknown>;
    expect(transportArgs.port).toBe(465);
  });

  it('should set secure=false when config says false', async () => {
    setupSmtpConfig({ secure: 'false' });
    mockSendMail.mockResolvedValue({ messageId: '<m@e>' });

    await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B' });
    const transportArgs = mockCreateTransport.mock.calls[0]![0] as Record<string, unknown>;
    expect(transportArgs.secure).toBe(false);
  });

  it('should set secure=true for any non-false value', async () => {
    setupSmtpConfig({ secure: 'yes' });
    mockSendMail.mockResolvedValue({ messageId: '<m@e>' });

    await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B' });
    const transportArgs = mockCreateTransport.mock.calls[0]![0] as Record<string, unknown>;
    expect(transportArgs.secure).toBe(true);
  });
});

// ============================================================================
// listEmailsOverride
// ============================================================================

describe('listEmailsOverride', () => {
  it('should return error when IMAP is not configured', async () => {
    mockGetFieldValue.mockReturnValue(undefined);
    const result = await executors.list_emails!({});
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('IMAP not configured');
  });

  it('should return empty list when mailbox is empty', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 0 };
    // Simulate: withImapClient runs fn, fn checks mailbox.exists=0 and returns early

    const result = await executors.list_emails!({});
    expect(result.isError).toBe(false);
    expect(result.content.emails).toEqual([]);
    expect(result.content.total).toBe(0);
  });

  it('should fetch recent emails with default limit', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 50 };
    const date = new Date('2025-01-15T10:00:00Z');
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 42,
          envelope: {
            from: [{ name: 'Sender', address: 'sender@ex.com' }],
            to: [{ address: 'me@ex.com' }],
            subject: 'Hello',
            date,
            messageId: '<msg42@ex.com>',
          },
          flags: new Set(['\\Seen']),
        },
      ])
    );

    const result = await executors.list_emails!({});
    expect(result.isError).toBe(false);
    expect(result.content.emails).toHaveLength(1);
    expect(result.content.emails[0].uid).toBe(42);
    expect(result.content.emails[0].from).toBe('Sender <sender@ex.com>');
    expect(result.content.emails[0].to).toBe('me@ex.com');
    expect(result.content.emails[0].subject).toBe('Hello');
    expect(result.content.emails[0].isRead).toBe(true);
    expect(result.content.emails[0].isFlagged).toBe(false);
  });

  it('should cap limit at 100', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 300 };
    mockImapFetch.mockReturnValue(asyncIterable([]));

    await executors.list_emails!({ limit: 500 });
    // The fetch range should use Math.max(1, 300 - 100 + 1) = 201
    const fetchArgs = mockImapFetch.mock.calls[0]!;
    expect(fetchArgs[0]).toBe('201:*');
  });

  it('should use default limit of 20', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 50 };
    mockImapFetch.mockReturnValue(asyncIterable([]));

    await executors.list_emails!({});
    const fetchArgs = mockImapFetch.mock.calls[0]!;
    // Math.max(1, 50 - 20 + 1) = 31
    expect(fetchArgs[0]).toBe('31:*');
  });

  it('should search by unread filter', async () => {
    setupImapConfig();
    mockImapSearch.mockResolvedValue([10, 20]);
    mockImapFetch.mockReturnValue(asyncIterable([]));

    await executors.list_emails!({ unreadOnly: true });
    expect(mockImapSearch).toHaveBeenCalledWith(expect.objectContaining({ unseen: true }), {
      uid: true,
    });
  });

  it('should return empty when search yields no results', async () => {
    setupImapConfig();
    mockImapSearch.mockResolvedValue([]);

    const result = await executors.list_emails!({ unreadOnly: true });
    expect(result.isError).toBe(false);
    expect(result.content.emails).toEqual([]);
    expect(result.content.total).toBe(0);
  });

  it('should search with from, subject, since, before filters', async () => {
    setupImapConfig();
    mockImapSearch.mockResolvedValue([5]);
    mockImapFetch.mockReturnValue(asyncIterable([]));

    await executors.list_emails!({
      from: 'alice@ex.com',
      subject: 'Invoice',
      since: '2025-01-01',
      before: '2025-02-01',
    });

    const criteria = mockImapSearch.mock.calls[0]![0] as Record<string, unknown>;
    expect(criteria.from).toBe('alice@ex.com');
    expect(criteria.subject).toBe('Invoice');
    expect(criteria.since).toEqual(new Date('2025-01-01'));
    expect(criteria.before).toEqual(new Date('2025-02-01'));
  });

  it('should use custom folder', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 5 };
    mockImapFetch.mockReturnValue(asyncIterable([]));

    await executors.list_emails!({ folder: 'Sent' });
    expect(mockImapGetMailboxLock).toHaveBeenCalledWith('Sent');
  });

  it('should handle missing envelope fields gracefully', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 5 };
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 1,
          envelope: {
            from: undefined,
            to: undefined,
            subject: undefined,
            date: undefined,
            messageId: undefined,
          },
          flags: undefined,
        },
      ])
    );

    const result = await executors.list_emails!({});
    expect(result.isError).toBe(false);
    const email = result.content.emails[0];
    expect(email.from).toBe('');
    expect(email.to).toBe('');
    expect(email.subject).toBe('(no subject)');
    expect(email.date).toBeNull();
    expect(email.isRead).toBe(false);
    expect(email.isFlagged).toBe(false);
    expect(email.messageId).toBeNull();
  });

  it('should sort results by date descending', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 5 };
    mockImapFetch.mockReturnValue(
      asyncIterable([
        { uid: 1, envelope: { date: new Date('2025-01-01') }, flags: new Set() },
        { uid: 2, envelope: { date: new Date('2025-03-01') }, flags: new Set() },
        { uid: 3, envelope: { date: new Date('2025-02-01') }, flags: new Set() },
      ])
    );

    const result = await executors.list_emails!({});
    expect(result.content.emails[0].uid).toBe(2);
    expect(result.content.emails[1].uid).toBe(3);
    expect(result.content.emails[2].uid).toBe(1);
  });

  it('should release lock and logout even on error', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 5 };
    mockImapFetch.mockImplementation(() => {
      throw new Error('Fetch failed');
    });

    const result = await executors.list_emails!({});
    expect(result.isError).toBe(true);
    expect(mockLockRelease).toHaveBeenCalled();
    expect(mockImapLogout).toHaveBeenCalled();
  });
});

// ============================================================================
// readEmailOverride
// ============================================================================

describe('readEmailOverride', () => {
  it('should return error when email ID is missing', async () => {
    const result = await executors.read_email!({});
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Email ID (uid) is required');
  });

  it('should return error when email ID is empty string', async () => {
    const result = await executors.read_email!({ id: '' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Email ID (uid) is required');
  });

  it('should return error when IMAP not configured', async () => {
    mockGetFieldValue.mockReturnValue(undefined);
    const result = await executors.read_email!({ id: '42' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('IMAP not configured');
  });

  it('should return error when email not found', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(asyncIterable([]));

    const result = await executors.read_email!({ id: '999' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Email not found: UID 999');
  });

  it('should read email with text body extraction', async () => {
    setupImapConfig();
    const date = new Date('2025-01-15T12:00:00Z');
    const envelope = {
      from: [{ name: 'Alice', address: 'alice@ex.com' }],
      to: [{ address: 'bob@ex.com' }],
      cc: [{ address: 'cc@ex.com' }],
      subject: 'Important',
      date,
      messageId: '<msg42@ex.com>',
      inReplyTo: '<msg41@ex.com>',
    };

    // First fetch for envelope
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 42, envelope, flags: new Set(['\\Seen']), bodyStructure: {} }])
    );

    // Download returns raw simple text email
    const rawEmail = 'From: alice@ex.com\r\nSubject: Important\r\n\r\nHello Bob, this is a test.';
    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from(rawEmail)]),
    });

    const result = await executors.read_email!({ id: '42' });
    expect(result.isError).toBe(false);
    expect(result.content.uid).toBe('42');
    expect(result.content.from).toBe('Alice <alice@ex.com>');
    expect(result.content.to).toBe('bob@ex.com');
    expect(result.content.cc).toBe('cc@ex.com');
    expect(result.content.subject).toBe('Important');
    expect(result.content.messageId).toBe('<msg42@ex.com>');
    expect(result.content.inReplyTo).toBe('<msg41@ex.com>');
    expect(result.content.isRead).toBe(true);
    expect(result.content.body).toBe('Hello Bob, this is a test.');
  });

  it('should mark email as read when markAsRead is not false', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 10, envelope: { subject: 'S' }, flags: new Set() }])
    );
    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from('H: V\r\n\r\nBody')]),
    });

    await executors.read_email!({ id: '10' });
    expect(mockImapMessageFlagsAdd).toHaveBeenCalledWith('10', ['\\Seen'], { uid: true });
  });

  it('should not mark as read when markAsRead is false', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 10, envelope: { subject: 'S' }, flags: new Set() }])
    );
    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from('H: V\r\n\r\nBody')]),
    });

    await executors.read_email!({ id: '10', markAsRead: false });
    expect(mockImapMessageFlagsAdd).not.toHaveBeenCalled();
  });

  it('should not mark as read when already seen', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 10, envelope: { subject: 'S' }, flags: new Set(['\\Seen']) }])
    );
    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from('H: V\r\n\r\nBody')]),
    });

    await executors.read_email!({ id: '10' });
    expect(mockImapMessageFlagsAdd).not.toHaveBeenCalled();
  });

  it('should handle multipart email with text/plain and text/html', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 5, envelope: { subject: 'Multi' }, flags: new Set() }])
    );

    const rawMultipart = [
      'Content-Type: multipart/alternative; boundary="BOUND123"',
      '',
      '--BOUND123',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Plain text body here.',
      '--BOUND123',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>HTML body here.</p>',
      '--BOUND123--',
    ].join('\r\n');

    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from(rawMultipart)]),
    });

    const result = await executors.read_email!({ id: '5' });
    expect(result.isError).toBe(false);
    expect(result.content.body).toBe('Plain text body here.');
    expect(result.content.html).toBe('<p>HTML body here.</p>');
  });

  it('should decode base64 content-transfer-encoding', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 6, envelope: { subject: 'B64' }, flags: new Set() }])
    );

    const b64Body = Buffer.from('Base64 decoded text').toString('base64');
    const rawMultipart = [
      'Content-Type: multipart/mixed; boundary="B64BOUND"',
      '',
      '--B64BOUND',
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: base64',
      '',
      b64Body,
      '--B64BOUND--',
    ].join('\r\n');

    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from(rawMultipart)]),
    });

    const result = await executors.read_email!({ id: '6' });
    expect(result.isError).toBe(false);
    expect(result.content.body).toBe('Base64 decoded text');
  });

  it('should decode quoted-printable encoding', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 7, envelope: { subject: 'QP' }, flags: new Set() }])
    );

    const rawMultipart = [
      'Content-Type: multipart/mixed; boundary="QPBOUND"',
      '',
      '--QPBOUND',
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Hello =C3=A9 world=\r\ncontinuation',
      '--QPBOUND--',
    ].join('\r\n');

    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from(rawMultipart)]),
    });

    const result = await executors.read_email!({ id: '7' });
    expect(result.isError).toBe(false);
    // =C3=A9 is the UTF-8 encoding of 'e with accent'
    // The soft line break =\r\n is removed and 'continuation' is joined
    expect(result.content.body).toContain('Hello');
    expect(result.content.body).toContain('continuation');
    // Verify the soft line break was removed (no literal '=\r\n')
    expect(result.content.body).not.toContain('=\r\n');
  });

  it('should fall back to HTML tag stripping when only html part exists', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 8, envelope: { subject: 'HtmlOnly' }, flags: new Set() }])
    );

    const rawMultipart = [
      'Content-Type: multipart/mixed; boundary="HTMLBOUND"',
      '',
      '--HTMLBOUND',
      'Content-Type: text/html',
      '',
      '<div><p>Hello World</p></div>',
      '--HTMLBOUND--',
    ].join('\r\n');

    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from(rawMultipart)]),
    });

    const result = await executors.read_email!({ id: '8' });
    expect(result.isError).toBe(false);
    // HTML tags stripped, whitespace collapsed
    expect(result.content.body).toBe('Hello World');
    expect(result.content.html).toBe('<div><p>Hello World</p></div>');
  });

  it('should handle simple non-multipart email', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 9, envelope: { subject: 'Simple' }, flags: new Set() }])
    );

    const rawSimple = 'Subject: Simple\r\nFrom: a@b.com\r\n\r\nJust a plain body.';
    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from(rawSimple)]),
    });

    const result = await executors.read_email!({ id: '9' });
    expect(result.isError).toBe(false);
    expect(result.content.body).toBe('Just a plain body.');
  });

  it('should use custom folder', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 1, envelope: { subject: 'S' }, flags: new Set() }])
    );
    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from('H: V\r\n\r\nBody')]),
    });

    await executors.read_email!({ id: '1', folder: 'Archive' });
    expect(mockImapGetMailboxLock).toHaveBeenCalledWith('Archive');
  });

  it('should not throw when messageFlagsAdd fails (non-fatal)', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 10, envelope: { subject: 'S' }, flags: new Set() }])
    );
    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from('H: V\r\n\r\nBody')]),
    });
    mockImapMessageFlagsAdd.mockRejectedValue(new Error('Read-only mailbox'));

    const result = await executors.read_email!({ id: '10' });
    // Should succeed despite flag error
    expect(result.isError).toBe(false);
    expect(result.content.body).toBe('Body');
  });
});

// ============================================================================
// searchEmailsOverride
// ============================================================================

describe('searchEmailsOverride', () => {
  it('should return error when query is empty', async () => {
    const result = await executors.search_emails!({ query: '' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Search query is required');
  });

  it('should return error when query is whitespace only', async () => {
    const result = await executors.search_emails!({ query: '   ' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Search query is required');
  });

  it('should return error when query is undefined', async () => {
    const result = await executors.search_emails!({});
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Search query is required');
  });

  it('should return error when IMAP is not configured', async () => {
    mockGetFieldValue.mockReturnValue(undefined);
    const result = await executors.search_emails!({ query: 'hello' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('IMAP not configured');
  });

  it('should return empty results when no matching UIDs', async () => {
    setupImapConfig();
    mockImapSearch.mockResolvedValue([]);

    const result = await executors.search_emails!({ query: 'nonexistent' });
    expect(result.isError).toBe(false);
    expect(result.content.results).toEqual([]);
    expect(result.content.total).toBe(0);
    expect(result.content.query).toBe('nonexistent');
  });

  it('should search and return matching emails', async () => {
    setupImapConfig();
    mockImapSearch.mockResolvedValue([10, 20]);
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 20,
          envelope: {
            from: [{ address: 'alice@ex.com' }],
            to: [{ address: 'me@ex.com' }],
            subject: 'Invoice #123',
            date: new Date('2025-02-01'),
          },
          flags: new Set(['\\Flagged']),
        },
      ])
    );

    const result = await executors.search_emails!({ query: 'invoice' });
    expect(result.isError).toBe(false);
    expect(result.content.results).toHaveLength(1);
    expect(result.content.results[0].subject).toBe('Invoice #123');
    expect(result.content.results[0].isFlagged).toBe(true);
    expect(result.content.total).toBe(2);
    expect(result.content.folder).toBe('INBOX');
  });

  it('should cap limit at 200', async () => {
    setupImapConfig();
    const uids = Array.from({ length: 300 }, (_, i) => i + 1);
    mockImapSearch.mockResolvedValue(uids);
    mockImapFetch.mockReturnValue(asyncIterable([]));

    await executors.search_emails!({ query: 'test', limit: 999 });
    // The fetch call should receive at most 200 UIDs
    const fetchCall = mockImapFetch.mock.calls[0]![0] as string;
    const uidCount = fetchCall.split(',').length;
    expect(uidCount).toBeLessThanOrEqual(200);
  });

  it('should use default limit of 50', async () => {
    setupImapConfig();
    const uids = Array.from({ length: 100 }, (_, i) => i + 1);
    mockImapSearch.mockResolvedValue(uids);
    mockImapFetch.mockReturnValue(asyncIterable([]));

    await executors.search_emails!({ query: 'test' });
    const fetchCall = mockImapFetch.mock.calls[0]![0] as string;
    const uidCount = fetchCall.split(',').length;
    expect(uidCount).toBeLessThanOrEqual(50);
  });

  it('should include flagged filter when isStarred is true', async () => {
    setupImapConfig();
    mockImapSearch.mockResolvedValue([]);

    await executors.search_emails!({ query: 'test', isStarred: true });
    const criteria = mockImapSearch.mock.calls[0]![0] as Record<string, unknown>;
    expect(criteria.text).toBe('test');
    expect(criteria.flagged).toBe(true);
  });

  it('should use custom folder for search', async () => {
    setupImapConfig();
    mockImapSearch.mockResolvedValue([]);

    await executors.search_emails!({ query: 'test', folder: 'Sent' });
    expect(mockImapGetMailboxLock).toHaveBeenCalledWith('Sent');
  });
});

// ============================================================================
// replyEmailOverride
// ============================================================================

describe('replyEmailOverride', () => {
  it('should return error when both id and body missing', async () => {
    const result = await executors.reply_email!({});
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Email ID and reply body are required');
  });

  it('should return error when id is missing', async () => {
    const result = await executors.reply_email!({ body: 'Reply text' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Email ID and reply body are required');
  });

  it('should return error when body is missing', async () => {
    const result = await executors.reply_email!({ id: '42' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Email ID and reply body are required');
  });

  it('should return error when SMTP is not configured', async () => {
    mockGetFieldValue.mockReturnValue(undefined);
    const result = await executors.reply_email!({ id: '42', body: 'Reply' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('SMTP not configured');
  });

  it('should return error when original email not found', async () => {
    setupBothConfigs();
    mockImapFetch.mockReturnValue(asyncIterable([]));

    const result = await executors.reply_email!({ id: '999', body: 'Reply' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Original email not found: UID 999');
  });

  it('should reply to sender only by default', async () => {
    setupBothConfigs();
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 42,
          envelope: {
            from: [{ address: 'alice@ex.com' }],
            to: [{ address: 'sender@example.com' }],
            cc: [{ address: 'cc@ex.com' }],
            subject: 'Original Subject',
            messageId: '<orig42@ex.com>',
          },
        },
      ])
    );
    mockSendMail.mockResolvedValue({ messageId: '<reply42@ex.com>' });

    const result = await executors.reply_email!({ id: '42', body: 'Thanks!' });
    expect(result.isError).toBe(false);
    expect(result.content.success).toBe(true);
    expect(result.content.to).toEqual(['alice@ex.com']);
    expect(result.content.subject).toBe('Re: Original Subject');
    expect(result.content.replyAll).toBe(false);
    expect(result.content.originalId).toBe('42');
  });

  it('should add Re: prefix only when not already present', async () => {
    setupBothConfigs();
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 43,
          envelope: {
            from: [{ address: 'alice@ex.com' }],
            subject: 'Re: Already replied',
            messageId: '<orig43@ex.com>',
          },
        },
      ])
    );
    mockSendMail.mockResolvedValue({ messageId: '<reply43@ex.com>' });

    const result = await executors.reply_email!({ id: '43', body: 'Again!' });
    expect(result.content.subject).toBe('Re: Already replied');
  });

  it('should reply all when replyAll is true', async () => {
    setupBothConfigs();
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 44,
          envelope: {
            from: [{ address: 'alice@ex.com' }],
            to: [{ address: 'me@ex.com' }, { address: 'bob@ex.com' }],
            cc: [{ address: 'charlie@ex.com' }],
            subject: 'Group thread',
            messageId: '<orig44@ex.com>',
          },
        },
      ])
    );
    mockSendMail.mockResolvedValue({ messageId: '<reply44@ex.com>' });

    const result = await executors.reply_email!({ id: '44', body: 'Reply to all', replyAll: true });
    expect(result.isError).toBe(false);
    expect(result.content.to).toContain('alice@ex.com');
    expect(result.content.to).toContain('bob@ex.com');
    expect(result.content.to).toContain('charlie@ex.com');
    expect(result.content.replyAll).toBe(true);
  });

  it('should exclude own address from replyAll recipients', async () => {
    setupBothConfigs();
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 45,
          envelope: {
            from: [{ address: 'alice@ex.com' }],
            to: [{ address: 'sender@example.com' }, { address: 'user@example.com' }],
            cc: [],
            subject: 'Thread',
            messageId: '<orig45@ex.com>',
          },
        },
      ])
    );
    mockSendMail.mockResolvedValue({ messageId: '<reply45@ex.com>' });

    const result = await executors.reply_email!({ id: '45', body: 'Reply', replyAll: true });
    // The from and user (sender@example.com and user@example.com) should be excluded
    expect(result.content.to).not.toContain('sender@example.com');
    expect(result.content.to).not.toContain('user@example.com');
    expect(result.content.to).toContain('alice@ex.com');
  });

  it('should set inReplyTo and references headers', async () => {
    setupBothConfigs();
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 46,
          envelope: {
            from: [{ address: 'alice@ex.com' }],
            subject: 'Thread',
            messageId: '<orig46@ex.com>',
          },
        },
      ])
    );
    mockSendMail.mockResolvedValue({ messageId: '<reply46@ex.com>' });

    await executors.reply_email!({ id: '46', body: 'Reply' });
    const msg = mockSendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(msg.inReplyTo).toBe('<orig46@ex.com>');
    expect(msg.references).toBe('<orig46@ex.com>');
  });

  it('should send html reply when html flag is true', async () => {
    setupBothConfigs();
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 47,
          envelope: {
            from: [{ address: 'alice@ex.com' }],
            subject: 'Thread',
            messageId: '<orig47@ex.com>',
          },
        },
      ])
    );
    mockSendMail.mockResolvedValue({ messageId: '<r@ex.com>' });

    await executors.reply_email!({ id: '47', body: '<b>Bold reply</b>', html: true });
    const msg = mockSendMail.mock.calls[0]![0] as Record<string, unknown>;
    expect(msg.html).toBe('<b>Bold reply</b>');
    expect(msg.text).toBeUndefined();
  });

  it('should return error when reply attachment not found', async () => {
    setupBothConfigs();
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 48,
          envelope: {
            from: [{ address: 'alice@ex.com' }],
            subject: 'Thread',
            messageId: '<orig48@ex.com>',
          },
        },
      ])
    );
    mockFsAccess.mockRejectedValue(new Error('ENOENT'));

    const result = await executors.reply_email!({
      id: '48',
      body: 'With attachment',
      attachments: ['/tmp/missing.pdf'],
    });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Attachment not found: /tmp/missing.pdf');
  });

  it('should handle null original subject gracefully', async () => {
    setupBothConfigs();
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 49,
          envelope: {
            from: [{ address: 'alice@ex.com' }],
            subject: null,
            messageId: '<orig49@ex.com>',
          },
        },
      ])
    );
    mockSendMail.mockResolvedValue({ messageId: '<r@ex.com>' });

    const result = await executors.reply_email!({ id: '49', body: 'Reply' });
    expect(result.isError).toBe(false);
    expect(result.content.subject).toBe('Re: ');
  });
});

// ============================================================================
// deleteEmailOverride
// ============================================================================

describe('deleteEmailOverride', () => {
  it('should return error when email ID is missing', async () => {
    const result = await executors.delete_email!({});
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Email ID (uid) is required');
  });

  it('should return error when email ID is empty string', async () => {
    const result = await executors.delete_email!({ id: '' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Email ID (uid) is required');
  });

  it('should return error when IMAP not configured', async () => {
    mockGetFieldValue.mockReturnValue(undefined);
    const result = await executors.delete_email!({ id: '42' });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('IMAP not configured');
  });

  it('should permanently delete when permanent=true', async () => {
    setupImapConfig();
    mockImapMessageDelete.mockResolvedValue(undefined);

    const result = await executors.delete_email!({ id: '42', permanent: true });
    expect(result.isError).toBe(false);
    expect(result.content.success).toBe(true);
    expect(result.content.action).toBe('permanently_deleted');
    expect(result.content.uid).toBe('42');
    expect(mockImapMessageDelete).toHaveBeenCalledWith('42', { uid: true });
  });

  it('should move to trash by default (non-permanent)', async () => {
    setupImapConfig();
    mockImapMessageMove.mockResolvedValue(undefined);

    const result = await executors.delete_email!({ id: '42' });
    expect(result.isError).toBe(false);
    expect(result.content.action).toBe('moved_to_trash');
    expect(mockImapMessageMove).toHaveBeenCalled();
  });

  it('should try multiple trash folder names', async () => {
    setupImapConfig();
    // First three attempts fail, fourth succeeds
    mockImapMessageMove
      .mockRejectedValueOnce(new Error('No such folder'))
      .mockRejectedValueOnce(new Error('No such folder'))
      .mockRejectedValueOnce(new Error('No such folder'))
      .mockResolvedValueOnce(undefined);

    const result = await executors.delete_email!({ id: '42' });
    expect(result.isError).toBe(false);
    expect(result.content.action).toBe('moved_to_trash');
    expect(mockImapMessageMove).toHaveBeenCalledTimes(4);
    // Verify it tried: 'Trash', '[Gmail]/Trash', 'Deleted Items', 'Deleted Messages'
    expect(mockImapMessageMove).toHaveBeenNthCalledWith(1, '42', 'Trash', { uid: true });
    expect(mockImapMessageMove).toHaveBeenNthCalledWith(2, '42', '[Gmail]/Trash', { uid: true });
    expect(mockImapMessageMove).toHaveBeenNthCalledWith(3, '42', 'Deleted Items', { uid: true });
    expect(mockImapMessageMove).toHaveBeenNthCalledWith(4, '42', 'Deleted Messages', { uid: true });
  });

  it('should fall back to Deleted flag when all trash folders fail', async () => {
    setupImapConfig();
    mockImapMessageMove.mockRejectedValue(new Error('No such folder'));
    mockImapMessageFlagsAdd.mockResolvedValue(undefined);

    const result = await executors.delete_email!({ id: '42' });
    expect(result.isError).toBe(false);
    expect(result.content.action).toBe('moved_to_trash');
    expect(mockImapMessageFlagsAdd).toHaveBeenCalledWith('42', ['\\Deleted'], { uid: true });
  });

  it('should use custom folder', async () => {
    setupImapConfig();
    mockImapMessageMove.mockResolvedValue(undefined);

    await executors.delete_email!({ id: '42', folder: 'Spam' });
    expect(mockImapGetMailboxLock).toHaveBeenCalledWith('Spam');
  });

  it('should return error when delete operation fails', async () => {
    setupImapConfig();
    mockImapMessageDelete.mockRejectedValue(new Error('Permission denied'));

    const result = await executors.delete_email!({ id: '42', permanent: true });
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('Failed to delete email');
    expect(result.content.error).toContain('Permission denied');
  });
});

// ============================================================================
// IMAP Config resolution (tested through listEmailsOverride)
// ============================================================================

describe('getImapConfig (via listEmailsOverride)', () => {
  it('should return null when host is missing', async () => {
    mockGetFieldValue.mockImplementation((svc: string, field: string) => {
      if (svc === 'imap') {
        if (field === 'host') return undefined;
        if (field === 'user') return 'u';
        if (field === 'pass') return 'p';
      }
      return undefined;
    });
    const result = await executors.list_emails!({});
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('IMAP not configured');
  });

  it('should return null when user is missing', async () => {
    mockGetFieldValue.mockImplementation((svc: string, field: string) => {
      if (svc === 'imap') {
        if (field === 'host') return 'imap.ex.com';
        if (field === 'user') return '';
        if (field === 'pass') return 'p';
      }
      return undefined;
    });
    const result = await executors.list_emails!({});
    expect(result.isError).toBe(true);
    expect(result.content.error).toContain('IMAP not configured');
  });

  it('should default port to 993', async () => {
    setupImapConfig({ port: undefined });
    mockImapClient.mailbox = { exists: 0 };
    mockImapFlowConstructorArgs.mockClear();

    await executors.list_emails!({});
    const lastCall = mockImapFlowConstructorArgs.mock.calls[0]![0] as Record<string, unknown>;
    expect(lastCall.port).toBe(993);
  });

  it('should set tls=false when config says false', async () => {
    setupImapConfig({ tls: 'false' });
    mockImapClient.mailbox = { exists: 0 };
    mockImapFlowConstructorArgs.mockClear();

    await executors.list_emails!({});
    const lastCall = mockImapFlowConstructorArgs.mock.calls[0]![0] as Record<string, unknown>;
    expect(lastCall.secure).toBe(false);
  });

  it('should set tls=true by default', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 0 };
    mockImapFlowConstructorArgs.mockClear();

    await executors.list_emails!({});
    const lastCall = mockImapFlowConstructorArgs.mock.calls[0]![0] as Record<string, unknown>;
    expect(lastCall.secure).toBe(true);
  });
});

// ============================================================================
// formatAddress / formatAddressList (tested through listEmailsOverride)
// ============================================================================

describe('formatAddress (via list/read results)', () => {
  it('should format name + address', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 1 };
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 1,
          envelope: {
            from: [{ name: 'John Doe', address: 'john@ex.com' }],
            to: [{ address: 'me@ex.com' }],
            subject: 'Test',
            date: new Date(),
          },
          flags: new Set(),
        },
      ])
    );

    const result = await executors.list_emails!({});
    expect(result.content.emails[0].from).toBe('John Doe <john@ex.com>');
  });

  it('should format address only (no name)', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 1 };
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 1,
          envelope: {
            from: [{ address: 'john@ex.com' }],
            to: [{ address: 'me@ex.com' }],
            subject: 'Test',
            date: new Date(),
          },
          flags: new Set(),
        },
      ])
    );

    const result = await executors.list_emails!({});
    expect(result.content.emails[0].from).toBe('john@ex.com');
  });

  it('should format multiple addresses comma-separated', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 1 };
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 1,
          envelope: {
            from: [{ address: 'a@ex.com' }],
            to: [{ name: 'Alice', address: 'alice@ex.com' }, { address: 'bob@ex.com' }],
            subject: 'Test',
            date: new Date(),
          },
          flags: new Set(),
        },
      ])
    );

    const result = await executors.list_emails!({});
    expect(result.content.emails[0].to).toBe('Alice <alice@ex.com>, bob@ex.com');
  });

  it('should handle undefined from/to as empty string', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 1 };
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 1,
          envelope: { from: undefined, to: undefined, subject: 'Test', date: new Date() },
          flags: new Set(),
        },
      ])
    );

    const result = await executors.list_emails!({});
    expect(result.content.emails[0].from).toBe('');
    expect(result.content.emails[0].to).toBe('');
  });

  it('should handle address with name but no address field', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 1 };
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 1,
          envelope: {
            from: [{ name: 'NoAddr' }],
            to: [{ address: 'me@ex.com' }],
            subject: 'Test',
            date: new Date(),
          },
          flags: new Set(),
        },
      ])
    );

    const result = await executors.list_emails!({});
    // name is truthy so it formats as "NoAddr <undefined>" — the formatAddress logic
    // outputs `${a.name} <${a.address}>` where a.address is undefined
    expect(result.content.emails[0].from).toBe('NoAddr <undefined>');
  });
});

// ============================================================================
// formatAddressList (tested through replyEmailOverride)
// ============================================================================

describe('formatAddressList (via reply)', () => {
  it('should extract address strings for reply recipients', async () => {
    setupBothConfigs();
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 50,
          envelope: {
            from: [{ name: 'Alice', address: 'alice@ex.com' }],
            to: [{ address: 'me@ex.com' }],
            subject: 'Thread',
            messageId: '<orig@ex.com>',
          },
        },
      ])
    );
    mockSendMail.mockResolvedValue({ messageId: '<r@ex.com>' });

    const result = await executors.reply_email!({ id: '50', body: 'Reply' });
    // formatAddressList extracts address strings, reply goes to from addresses
    expect(result.content.to).toEqual(['alice@ex.com']);
  });

  it('should filter out empty addresses in replyAll', async () => {
    setupBothConfigs();
    mockImapFetch.mockReturnValue(
      asyncIterable([
        {
          uid: 51,
          envelope: {
            from: [{ address: 'alice@ex.com' }],
            to: [{ name: 'NoAddr' }, { address: 'bob@ex.com' }],
            cc: undefined,
            subject: 'Thread',
            messageId: '<orig@ex.com>',
          },
        },
      ])
    );
    mockSendMail.mockResolvedValue({ messageId: '<r@ex.com>' });

    const result = await executors.reply_email!({ id: '51', body: 'Reply', replyAll: true });
    // NoAddr has no address, should be filtered out
    expect(result.content.to).not.toContain('');
    expect(result.content.to).toContain('alice@ex.com');
    expect(result.content.to).toContain('bob@ex.com');
  });
});

// ============================================================================
// withImapClient behavior (lock release and logout)
// ============================================================================

describe('withImapClient lifecycle', () => {
  it('should connect, get lock, run fn, release lock, logout on success', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 0 };

    await executors.list_emails!({});

    expect(mockImapConnect).toHaveBeenCalled();
    expect(mockImapGetMailboxLock).toHaveBeenCalled();
    expect(mockLockRelease).toHaveBeenCalled();
    expect(mockImapLogout).toHaveBeenCalled();
  });

  it('should release lock and logout even when fn throws', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 5 };
    mockImapFetch.mockImplementation(() => {
      throw new Error('inner error');
    });

    await executors.list_emails!({});

    expect(mockLockRelease).toHaveBeenCalled();
    expect(mockImapLogout).toHaveBeenCalled();
  });
});

// ============================================================================
// extractTextFromRaw edge cases (tested through readEmailOverride)
// ============================================================================

describe('extractTextFromRaw edge cases (via readEmailOverride)', () => {
  function setupReadWithRaw(rawContent: string) {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 100, envelope: { subject: 'Test' }, flags: new Set(['\\Seen']) }])
    );
    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from(rawContent)]),
    });
  }

  it('should handle email with no headers separator', async () => {
    setupReadWithRaw('Just raw body text with no CRLFCRLF separator');
    const result = await executors.read_email!({ id: '100' });
    expect(result.isError).toBe(false);
    // No \r\n\r\n separator, so entire content becomes body
    expect(result.content.body).toBe('Just raw body text with no CRLFCRLF separator');
  });

  it('should handle boundary with quotes', async () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary="QUOTED_BOUNDARY"',
      '',
      '--QUOTED_BOUNDARY',
      'Content-Type: text/plain',
      '',
      'Text from quoted boundary.',
      '--QUOTED_BOUNDARY--',
    ].join('\r\n');

    setupReadWithRaw(raw);
    const result = await executors.read_email!({ id: '100' });
    expect(result.isError).toBe(false);
    expect(result.content.body).toBe('Text from quoted boundary.');
  });

  it('should handle boundary without quotes', async () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary=UNQUOTED_BOUNDARY',
      '',
      '--UNQUOTED_BOUNDARY',
      'Content-Type: text/plain',
      '',
      'Text from unquoted boundary.',
      '--UNQUOTED_BOUNDARY--',
    ].join('\r\n');

    setupReadWithRaw(raw);
    const result = await executors.read_email!({ id: '100' });
    expect(result.isError).toBe(false);
    expect(result.content.body).toBe('Text from unquoted boundary.');
  });

  it('should prefer text/plain over text/html', async () => {
    const raw = [
      'Content-Type: multipart/alternative; boundary="PREF"',
      '',
      '--PREF',
      'Content-Type: text/html',
      '',
      '<p>HTML first</p>',
      '--PREF',
      'Content-Type: text/plain',
      '',
      'Plain text second',
      '--PREF--',
    ].join('\r\n');

    setupReadWithRaw(raw);
    const result = await executors.read_email!({ id: '100' });
    expect(result.content.body).toBe('Plain text second');
    expect(result.content.html).toBe('<p>HTML first</p>');
  });

  it('should handle multipart with only text/html (strip tags for body)', async () => {
    const raw = [
      'Content-Type: multipart/alternative; boundary="ONLYHTML"',
      '',
      '--ONLYHTML',
      'Content-Type: text/html',
      '',
      '<div><h1>Title</h1><p>Paragraph</p></div>',
      '--ONLYHTML--',
    ].join('\r\n');

    setupReadWithRaw(raw);
    const result = await executors.read_email!({ id: '100' });
    expect(result.content.html).toBe('<div><h1>Title</h1><p>Paragraph</p></div>');
    // Tags stripped, whitespace collapsed
    expect(result.content.body).toBe('Title Paragraph');
  });

  it('should handle multipart part with no body after headers', async () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary="NOBODY"',
      '',
      '--NOBODY',
      'Content-Type: text/plain',
      '',
      '',
      '--NOBODY--',
    ].join('\r\n');

    setupReadWithRaw(raw);
    const result = await executors.read_email!({ id: '100' });
    // Empty text part
    expect(result.isError).toBe(false);
  });

  it('should handle invalid base64 gracefully', async () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary="BADB64"',
      '',
      '--BADB64',
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: base64',
      '',
      '!!!not-valid-base64!!!',
      '--BADB64--',
    ].join('\r\n');

    setupReadWithRaw(raw);
    const result = await executors.read_email!({ id: '100' });
    // Should not throw, keeps body as-is or decoded partially
    expect(result.isError).toBe(false);
    expect(typeof result.content.body).toBe('string');
  });

  it('should decode quoted-printable =XX sequences correctly', async () => {
    const raw = [
      'Content-Type: multipart/mixed; boundary="QPTEST"',
      '',
      '--QPTEST',
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'caf=C3=A9 na=C3=AFve',
      '--QPTEST--',
    ].join('\r\n');

    setupReadWithRaw(raw);
    const result = await executors.read_email!({ id: '100' });
    expect(result.isError).toBe(false);
    // =C3=A9 is UTF-8 for e-acute but decoded char by char (not full UTF-8)
    // The implementation does String.fromCharCode(parseInt(hex, 16)) which gives
    // individual bytes, not proper UTF-8. We just verify the = sequences are gone.
    expect(result.content.body).not.toContain('=C3');
    expect(result.content.body).not.toContain('=A9');
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe('edge cases', () => {
  it('should handle empty attachments array in send_email', async () => {
    setupSmtpConfig();
    mockSendMail.mockResolvedValue({ messageId: '<m@e>' });

    const result = await executors.send_email!({
      to: ['a@b.com'],
      subject: 'S',
      body: 'B',
      attachments: [],
    });
    expect(result.isError).toBe(false);
    expect(result.content.attachmentCount).toBe(0);
    // fs.access should not have been called
    expect(mockFsAccess).not.toHaveBeenCalled();
  });

  it('should return 0 attachment count when no attachments param', async () => {
    setupSmtpConfig();
    mockSendMail.mockResolvedValue({ messageId: '<m@e>' });

    const result = await executors.send_email!({ to: ['a@b.com'], subject: 'S', body: 'B' });
    expect(result.content.attachmentCount).toBe(0);
  });

  it('should default folder to INBOX for list_emails', async () => {
    setupImapConfig();
    mockImapClient.mailbox = { exists: 0 };

    const result = await executors.list_emails!({});
    expect(mockImapGetMailboxLock).toHaveBeenCalledWith('INBOX');
    expect(result.content.folder).toBe('INBOX');
  });

  it('should default folder to INBOX for read_email', async () => {
    setupImapConfig();
    mockImapFetch.mockReturnValue(
      asyncIterable([{ uid: 1, envelope: { subject: 'S' }, flags: new Set() }])
    );
    mockImapDownload.mockResolvedValue({
      content: asyncIterable([Buffer.from('H: V\r\n\r\nBody')]),
    });

    await executors.read_email!({ id: '1' });
    expect(mockImapGetMailboxLock).toHaveBeenCalledWith('INBOX');
  });

  it('should default folder to INBOX for delete_email', async () => {
    setupImapConfig();
    mockImapMessageMove.mockResolvedValue(undefined);

    await executors.delete_email!({ id: '1' });
    expect(mockImapGetMailboxLock).toHaveBeenCalledWith('INBOX');
  });

  it('should default search folder to INBOX', async () => {
    setupImapConfig();
    mockImapSearch.mockResolvedValue([]);

    const result = await executors.search_emails!({ query: 'test' });
    expect(mockImapGetMailboxLock).toHaveBeenCalledWith('INBOX');
    expect(result.content.folder).toBe('INBOX');
  });
});
