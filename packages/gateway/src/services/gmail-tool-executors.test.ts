/**
 * Gmail Tool Executors Tests
 *
 * Tests the Gmail tool executors: send, list, read, delete, search,
 * reply, mark read, star, archive, get labels, get attachment.
 * Focuses on validation, error handling, and response formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGmailClient = {
  sendMessage: vi.fn(),
  listMessages: vi.fn(),
  getMessage: vi.fn(),
  markAsRead: vi.fn(),
  markAsUnread: vi.fn(),
  deleteMessagePermanently: vi.fn(),
  trashMessage: vi.fn(),
  searchMessages: vi.fn(),
  replyToMessage: vi.fn(),
  starMessage: vi.fn(),
  unstarMessage: vi.fn(),
  archiveMessage: vi.fn(),
  getLabels: vi.fn(),
  getAttachment: vi.fn(),
};

vi.mock('@ownpilot/core', () => ({
  GmailClient: vi.fn(),
  createGmailClient: vi.fn(() => mockGmailClient),
  buildGmailQuery: vi.fn((opts: any) => {
    const parts: string[] = [];
    if (opts.from) parts.push(`from:${opts.from}`);
    if (opts.subject) parts.push(`subject:${opts.subject}`);
    if (opts.isUnread) parts.push('is:unread');
    if (opts.in) parts.push(`in:${opts.in}`);
    return parts.join(' ');
  }),
}));

const mockOauthIntegrationsRepo = {
  getByUserProviderService: vi.fn(),
  isConnected: vi.fn(),
  getTokens: vi.fn(),
  updateTokens: vi.fn(),
};

const mockSettingsRepo = {
  get: vi.fn(),
};

vi.mock('../db/repositories/index.js', () => ({
  oauthIntegrationsRepo: {
    getByUserProviderService: (...args: unknown[]) => mockOauthIntegrationsRepo.getByUserProviderService(...args),
    isConnected: (...args: unknown[]) => mockOauthIntegrationsRepo.isConnected(...args),
    getTokens: (...args: unknown[]) => mockOauthIntegrationsRepo.getTokens(...args),
    updateTokens: (...args: unknown[]) => mockOauthIntegrationsRepo.updateTokens(...args),
  },
  settingsRepo: {
    get: (...args: unknown[]) => mockSettingsRepo.get(...args),
  },
}));

import {
  gmailSendEmailExecutor,
  gmailListEmailsExecutor,
  gmailReadEmailExecutor,
  gmailDeleteEmailExecutor,
  gmailSearchEmailsExecutor,
  gmailReplyEmailExecutor,
  gmailMarkReadExecutor,
  gmailStarExecutor,
  gmailArchiveExecutor,
  gmailGetLabelsExecutor,
  gmailGetAttachmentExecutor,
  GMAIL_TOOL_EXECUTORS,
  shouldUseGmailTools,
} from './gmail-tool-executors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupConnectedGmail() {
  mockOauthIntegrationsRepo.isConnected.mockResolvedValue(true);
  mockSettingsRepo.get.mockResolvedValue('client-id');
  mockOauthIntegrationsRepo.getByUserProviderService.mockResolvedValue({ id: 'int-1' });
  mockOauthIntegrationsRepo.getTokens.mockResolvedValue({
    accessToken: 'at-123',
    refreshToken: 'rt-123',
    expiresAt: Date.now() + 3600000,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Gmail Tool Executors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // GMAIL_TOOL_EXECUTORS registry
  // ========================================================================

  describe('GMAIL_TOOL_EXECUTORS', () => {
    it('exports 11 tool executors', () => {
      expect(Object.keys(GMAIL_TOOL_EXECUTORS)).toHaveLength(11);
    });

    it('contains expected tool names', () => {
      const names = Object.keys(GMAIL_TOOL_EXECUTORS);
      expect(names).toContain('send_email');
      expect(names).toContain('list_emails');
      expect(names).toContain('read_email');
      expect(names).toContain('delete_email');
      expect(names).toContain('search_emails');
      expect(names).toContain('reply_email');
      expect(names).toContain('mark_email_read');
      expect(names).toContain('star_email');
      expect(names).toContain('archive_email');
      expect(names).toContain('get_email_labels');
      expect(names).toContain('get_attachment');
    });
  });

  // ========================================================================
  // shouldUseGmailTools
  // ========================================================================

  describe('shouldUseGmailTools', () => {
    it('returns true when Gmail is connected', async () => {
      mockOauthIntegrationsRepo.isConnected.mockResolvedValue(true);

      expect(await shouldUseGmailTools('user-1')).toBe(true);
    });

    it('returns false when Gmail is not connected', async () => {
      mockOauthIntegrationsRepo.isConnected.mockResolvedValue(false);

      expect(await shouldUseGmailTools('user-1')).toBe(false);
    });

    it('defaults to userId "default"', async () => {
      mockOauthIntegrationsRepo.isConnected.mockResolvedValue(true);

      await shouldUseGmailTools();

      expect(mockOauthIntegrationsRepo.isConnected).toHaveBeenCalledWith('default', 'google', 'gmail');
    });
  });

  // ========================================================================
  // gmailSendEmailExecutor
  // ========================================================================

  describe('gmailSendEmailExecutor', () => {
    it('sends email successfully', async () => {
      setupConnectedGmail();
      mockGmailClient.sendMessage.mockResolvedValue({
        messageId: 'msg-1',
        threadId: 'thread-1',
      });

      const result = await gmailSendEmailExecutor({
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Hello',
      }, {} as any);

      expect(result.isError).toBe(false);
      expect((result.content as any).success).toBe(true);
      expect((result.content as any).messageId).toBe('msg-1');
    });

    it('returns error for empty recipients', async () => {
      const result = await gmailSendEmailExecutor({
        to: [],
        subject: 'Test',
        body: 'Hello',
      }, {} as any);

      expect(result.isError).toBe(true);
      expect((result.content as any).error).toContain('recipient is required');
    });

    it('validates email format', async () => {
      const result = await gmailSendEmailExecutor({
        to: ['invalid-email'],
        subject: 'Test',
        body: 'Hello',
      }, {} as any);

      expect(result.isError).toBe(true);
      expect((result.content as any).error).toContain('Invalid email address');
    });

    it('returns error when Gmail not connected', async () => {
      mockOauthIntegrationsRepo.isConnected.mockResolvedValue(false);

      const result = await gmailSendEmailExecutor({
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Hello',
      }, {} as any);

      expect(result.isError).toBe(true);
      expect((result.content as any).error).toContain('not connected');
    });

    it('handles Gmail API error', async () => {
      setupConnectedGmail();
      mockGmailClient.sendMessage.mockRejectedValue(new Error('Rate limited'));

      const result = await gmailSendEmailExecutor({
        to: ['test@example.com'],
        subject: 'Test',
        body: 'Hello',
      }, {} as any);

      expect(result.isError).toBe(true);
      expect((result.content as any).error).toContain('Rate limited');
    });
  });

  // ========================================================================
  // gmailListEmailsExecutor
  // ========================================================================

  describe('gmailListEmailsExecutor', () => {
    it('lists emails with default params', async () => {
      setupConnectedGmail();
      mockGmailClient.listMessages.mockResolvedValue({
        messages: [
          {
            id: 'msg-1',
            threadId: 'thread-1',
            from: 'sender@test.com',
            to: ['me@test.com'],
            subject: 'Hello',
            date: new Date('2025-01-01'),
            snippet: 'Hello world...',
            isUnread: true,
            hasAttachment: false,
            labelIds: ['INBOX'],
          },
        ],
        nextPageToken: null,
      });

      const result = await gmailListEmailsExecutor({}, {} as any);

      expect(result.isError).toBe(false);
      const content = result.content as any;
      expect(content.emails).toHaveLength(1);
      expect(content.emails[0].from).toBe('sender@test.com');
      expect(content.hasMore).toBe(false);
    });

    it('returns error when not connected', async () => {
      mockOauthIntegrationsRepo.isConnected.mockResolvedValue(false);

      const result = await gmailListEmailsExecutor({}, {} as any);

      expect(result.isError).toBe(true);
    });

    it('caps limit to 100', async () => {
      setupConnectedGmail();
      mockGmailClient.listMessages.mockResolvedValue({ messages: [], nextPageToken: null });

      await gmailListEmailsExecutor({ limit: 500 }, {} as any);

      expect(mockGmailClient.listMessages).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 100 }),
      );
    });
  });

  // ========================================================================
  // gmailReadEmailExecutor
  // ========================================================================

  describe('gmailReadEmailExecutor', () => {
    it('reads email and marks as read', async () => {
      setupConnectedGmail();
      mockGmailClient.getMessage.mockResolvedValue({
        id: 'msg-1',
        threadId: 'thread-1',
        from: 'sender@test.com',
        to: ['me@test.com'],
        cc: [],
        subject: 'Test',
        date: new Date('2025-01-01'),
        body: { text: 'Hello world', html: null },
        attachments: [],
        labelIds: ['INBOX'],
        isUnread: true,
      });

      const result = await gmailReadEmailExecutor({ id: 'msg-1' }, {} as any);

      expect(result.isError).toBe(false);
      expect((result.content as any).email.subject).toBe('Test');
      expect(mockGmailClient.markAsRead).toHaveBeenCalledWith('msg-1');
    });

    it('returns error when id is missing', async () => {
      const result = await gmailReadEmailExecutor({}, {} as any);

      expect(result.isError).toBe(true);
      expect((result.content as any).error).toContain('Email ID is required');
    });
  });

  // ========================================================================
  // gmailDeleteEmailExecutor
  // ========================================================================

  describe('gmailDeleteEmailExecutor', () => {
    it('moves to trash by default', async () => {
      setupConnectedGmail();
      mockGmailClient.trashMessage.mockResolvedValue(undefined);

      const result = await gmailDeleteEmailExecutor({ id: 'msg-1' }, {} as any);

      expect(result.isError).toBe(false);
      expect(mockGmailClient.trashMessage).toHaveBeenCalledWith('msg-1');
      expect((result.content as any).message).toContain('trash');
    });

    it('permanently deletes when requested', async () => {
      setupConnectedGmail();
      mockGmailClient.deleteMessagePermanently.mockResolvedValue(undefined);

      const result = await gmailDeleteEmailExecutor({ id: 'msg-1', permanent: true }, {} as any);

      expect(result.isError).toBe(false);
      expect(mockGmailClient.deleteMessagePermanently).toHaveBeenCalledWith('msg-1');
      expect((result.content as any).warning).toContain('cannot be undone');
    });

    it('returns error when id is missing', async () => {
      const result = await gmailDeleteEmailExecutor({}, {} as any);

      expect(result.isError).toBe(true);
    });
  });

  // ========================================================================
  // gmailSearchEmailsExecutor
  // ========================================================================

  describe('gmailSearchEmailsExecutor', () => {
    it('searches with query', async () => {
      setupConnectedGmail();
      mockGmailClient.searchMessages.mockResolvedValue({
        messages: [],
        nextPageToken: null,
      });

      const result = await gmailSearchEmailsExecutor({
        query: 'invoice',
        hasAttachment: true,
      }, {} as any);

      expect(result.isError).toBe(false);
      expect(mockGmailClient.searchMessages).toHaveBeenCalledWith(
        expect.objectContaining({ query: 'invoice has:attachment' }),
      );
    });

    it('returns error when query is missing', async () => {
      const result = await gmailSearchEmailsExecutor({}, {} as any);

      expect(result.isError).toBe(true);
      expect((result.content as any).error).toContain('Search query is required');
    });

    it('caps limit to 200', async () => {
      setupConnectedGmail();
      mockGmailClient.searchMessages.mockResolvedValue({ messages: [], nextPageToken: null });

      await gmailSearchEmailsExecutor({ query: 'test', limit: 1000 }, {} as any);

      expect(mockGmailClient.searchMessages).toHaveBeenCalledWith(
        expect.objectContaining({ maxResults: 200 }),
      );
    });
  });

  // ========================================================================
  // gmailReplyEmailExecutor
  // ========================================================================

  describe('gmailReplyEmailExecutor', () => {
    it('sends reply', async () => {
      setupConnectedGmail();
      mockGmailClient.replyToMessage.mockResolvedValue({
        messageId: 'reply-1',
        threadId: 'thread-1',
      });

      const result = await gmailReplyEmailExecutor({
        id: 'msg-1',
        body: 'Thanks!',
      }, {} as any);

      expect(result.isError).toBe(false);
      expect(mockGmailClient.replyToMessage).toHaveBeenCalledWith('msg-1', 'Thanks!', {
        isHtml: false,
        replyAll: false,
      });
    });

    it('returns error when email id missing', async () => {
      const result = await gmailReplyEmailExecutor({ body: 'Thanks!' }, {} as any);

      expect(result.isError).toBe(true);
    });

    it('returns error when body missing', async () => {
      const result = await gmailReplyEmailExecutor({ id: 'msg-1' }, {} as any);

      expect(result.isError).toBe(true);
    });
  });

  // ========================================================================
  // gmailMarkReadExecutor
  // ========================================================================

  describe('gmailMarkReadExecutor', () => {
    it('marks as read', async () => {
      setupConnectedGmail();

      const result = await gmailMarkReadExecutor({ id: 'msg-1', read: true }, {} as any);

      expect(result.isError).toBe(false);
      expect(mockGmailClient.markAsRead).toHaveBeenCalledWith('msg-1');
    });

    it('marks as unread', async () => {
      setupConnectedGmail();

      const result = await gmailMarkReadExecutor({ id: 'msg-1', read: false }, {} as any);

      expect(result.isError).toBe(false);
      expect(mockGmailClient.markAsUnread).toHaveBeenCalledWith('msg-1');
    });

    it('returns error when id is missing', async () => {
      const result = await gmailMarkReadExecutor({}, {} as any);
      expect(result.isError).toBe(true);
    });
  });

  // ========================================================================
  // gmailStarExecutor
  // ========================================================================

  describe('gmailStarExecutor', () => {
    it('stars email', async () => {
      setupConnectedGmail();

      const result = await gmailStarExecutor({ id: 'msg-1' }, {} as any);

      expect(result.isError).toBe(false);
      expect(mockGmailClient.starMessage).toHaveBeenCalledWith('msg-1');
    });

    it('unstars email', async () => {
      setupConnectedGmail();

      const result = await gmailStarExecutor({ id: 'msg-1', star: false }, {} as any);

      expect(result.isError).toBe(false);
      expect(mockGmailClient.unstarMessage).toHaveBeenCalledWith('msg-1');
    });
  });

  // ========================================================================
  // gmailArchiveExecutor
  // ========================================================================

  describe('gmailArchiveExecutor', () => {
    it('archives email', async () => {
      setupConnectedGmail();

      const result = await gmailArchiveExecutor({ id: 'msg-1' }, {} as any);

      expect(result.isError).toBe(false);
      expect(mockGmailClient.archiveMessage).toHaveBeenCalledWith('msg-1');
    });

    it('returns error when id is missing', async () => {
      const result = await gmailArchiveExecutor({}, {} as any);
      expect(result.isError).toBe(true);
    });
  });

  // ========================================================================
  // gmailGetLabelsExecutor
  // ========================================================================

  describe('gmailGetLabelsExecutor', () => {
    it('returns labels', async () => {
      setupConnectedGmail();
      mockGmailClient.getLabels.mockResolvedValue([
        { id: 'INBOX', name: 'INBOX', type: 'system', messagesTotal: 100, messagesUnread: 5 },
      ]);

      const result = await gmailGetLabelsExecutor({}, {} as any);

      expect(result.isError).toBe(false);
      const labels = (result.content as any).labels;
      expect(labels).toHaveLength(1);
      expect(labels[0].name).toBe('INBOX');
    });
  });

  // ========================================================================
  // gmailGetAttachmentExecutor
  // ========================================================================

  describe('gmailGetAttachmentExecutor', () => {
    it('returns attachment data as base64', async () => {
      setupConnectedGmail();
      mockGmailClient.getAttachment.mockResolvedValue(Buffer.from('file-content'));

      const result = await gmailGetAttachmentExecutor({
        messageId: 'msg-1',
        attachmentId: 'att-1',
      }, {} as any);

      expect(result.isError).toBe(false);
      const content = result.content as any;
      expect(content.encoding).toBe('base64');
      expect(content.size).toBeGreaterThan(0);
    });

    it('returns error when ids are missing', async () => {
      const result = await gmailGetAttachmentExecutor({}, {} as any);

      expect(result.isError).toBe(true);
      expect((result.content as any).error).toContain('required');
    });
  });
});
