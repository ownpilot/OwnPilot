/**
 * Gmail API Client
 *
 * Real Gmail API implementation using googleapis library.
 * Handles OAuth token management, message operations, and MIME building.
 */

import { google, type gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { getLog } from '../services/get-log.js';

const log = getLog('Gmail');

// =============================================================================
// Types
// =============================================================================

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

export interface GmailTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}

export interface GmailMessageHeader {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  from?: string;
  to?: string[];
  subject?: string;
  date?: Date;
  isUnread: boolean;
  hasAttachment: boolean;
}

export interface GmailMessageFull {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  date: Date;
  body: {
    text?: string;
    html?: string;
  };
  attachments: GmailAttachment[];
  isUnread: boolean;
  headers: Record<string, string>;
}

export interface GmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailLabel {
  id: string;
  name: string;
  type: 'system' | 'user';
  messagesTotal?: number;
  messagesUnread?: number;
}

export interface GmailSendOptions {
  to: string[];
  subject: string;
  body: string;
  isHtml?: boolean;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  inReplyTo?: string;
  threadId?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer | string;
    mimeType: string;
  }>;
}

export interface GmailListOptions {
  maxResults?: number;
  pageToken?: string;
  query?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
}

export interface GmailListResult {
  messages: GmailMessageHeader[];
  nextPageToken?: string;
  resultSizeEstimate: number;
}

export interface GmailSearchOptions {
  query: string;
  maxResults?: number;
  pageToken?: string;
}

// =============================================================================
// Token Refresh Callback
// =============================================================================

export type TokenRefreshCallback = (tokens: {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
}) => Promise<void>;

// =============================================================================
// Gmail Client
// =============================================================================

export class GmailClient {
  private oauth2Client: OAuth2Client;
  private gmail: gmail_v1.Gmail;
  private userEmail: string = 'me';
  private onTokenRefresh?: TokenRefreshCallback;

  constructor(
    credentials: GmailCredentials,
    tokens: GmailTokens,
    onTokenRefresh?: TokenRefreshCallback
  ) {
    this.oauth2Client = new OAuth2Client(
      credentials.clientId,
      credentials.clientSecret,
      credentials.redirectUri
    );

    this.oauth2Client.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
      expiry_date: tokens.expiresAt?.getTime(),
    });

    // Handle automatic token refresh
    this.onTokenRefresh = onTokenRefresh;
    this.oauth2Client.on('tokens', async (newTokens) => {
      if (this.onTokenRefresh && newTokens.access_token) {
        await this.onTokenRefresh({
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token || tokens.refreshToken,
          expiresAt: newTokens.expiry_date ? new Date(newTokens.expiry_date) : undefined,
        });
      }
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  // ===========================================================================
  // Profile
  // ===========================================================================

  /**
   * Get user's email profile
   */
  async getProfile(): Promise<{ email: string; messagesTotal: number; threadsTotal: number }> {
    const response = await this.gmail.users.getProfile({ userId: this.userEmail });
    return {
      email: response.data.emailAddress || '',
      messagesTotal: response.data.messagesTotal || 0,
      threadsTotal: response.data.threadsTotal || 0,
    };
  }

  // ===========================================================================
  // Labels
  // ===========================================================================

  /**
   * Get all labels
   */
  async getLabels(): Promise<GmailLabel[]> {
    const response = await this.gmail.users.labels.list({ userId: this.userEmail });
    const labels = response.data.labels || [];

    return labels.map((label) => ({
      id: label.id || '',
      name: label.name || '',
      type: label.type === 'system' ? 'system' : 'user',
      messagesTotal: label.messagesTotal ?? undefined,
      messagesUnread: label.messagesUnread ?? undefined,
    }));
  }

  /**
   * Get label by ID
   */
  async getLabel(labelId: string): Promise<GmailLabel> {
    const response = await this.gmail.users.labels.get({
      userId: this.userEmail,
      id: labelId,
    });

    return {
      id: response.data.id || '',
      name: response.data.name || '',
      type: response.data.type === 'system' ? 'system' : 'user',
      messagesTotal: response.data.messagesTotal ?? undefined,
      messagesUnread: response.data.messagesUnread ?? undefined,
    };
  }

  // ===========================================================================
  // List Messages
  // ===========================================================================

  /**
   * List messages with optional filters
   */
  async listMessages(options: GmailListOptions = {}): Promise<GmailListResult> {
    const {
      maxResults = 20,
      pageToken,
      query,
      labelIds,
      includeSpamTrash = false,
    } = options;

    const response = await this.gmail.users.messages.list({
      userId: this.userEmail,
      maxResults,
      pageToken,
      q: query,
      labelIds,
      includeSpamTrash,
    });

    const messages = response.data.messages || [];
    const headers: GmailMessageHeader[] = [];

    // Fetch headers for each message
    for (const msg of messages) {
      if (msg.id) {
        try {
          const header = await this.getMessageHeader(msg.id);
          headers.push(header);
        } catch (error) {
          // Skip messages we can't fetch
          log.warn(`Failed to fetch message ${msg.id}:`, error);
        }
      }
    }

    return {
      messages: headers,
      nextPageToken: response.data.nextPageToken || undefined,
      resultSizeEstimate: response.data.resultSizeEstimate || 0,
    };
  }

  /**
   * Get message header (metadata only, fast)
   */
  async getMessageHeader(messageId: string): Promise<GmailMessageHeader> {
    const response = await this.gmail.users.messages.get({
      userId: this.userEmail,
      id: messageId,
      format: 'metadata',
      metadataHeaders: ['From', 'To', 'Subject', 'Date'],
    });

    const headers = response.data.payload?.headers || [];
    const getHeader = (name: string): string | undefined =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? undefined;

    const labelIds = response.data.labelIds || [];
    const hasAttachment = response.data.payload?.parts?.some((part) => part.filename) || false;

    const dateHeader = getHeader('Date');
    return {
      id: response.data.id || '',
      threadId: response.data.threadId || '',
      labelIds,
      snippet: response.data.snippet || '',
      from: getHeader('From'),
      to: getHeader('To')?.split(',').map((e) => e.trim()),
      subject: getHeader('Subject'),
      date: dateHeader ? new Date(dateHeader) : undefined,
      isUnread: labelIds.includes('UNREAD'),
      hasAttachment,
    };
  }

  // ===========================================================================
  // Get Message (Full)
  // ===========================================================================

  /**
   * Get full message with body and attachments
   */
  async getMessage(messageId: string): Promise<GmailMessageFull> {
    const response = await this.gmail.users.messages.get({
      userId: this.userEmail,
      id: messageId,
      format: 'full',
    });

    const headers = response.data.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const labelIds = response.data.labelIds || [];

    // Parse body
    const body = this.parseMessageBody(response.data.payload);

    // Parse attachments
    const attachments = this.parseAttachments(response.data.payload);

    // Build headers map
    const headersMap: Record<string, string> = {};
    headers.forEach((h) => {
      if (h.name && h.value) {
        headersMap[h.name] = h.value;
      }
    });

    return {
      id: response.data.id || '',
      threadId: response.data.threadId || '',
      labelIds,
      snippet: response.data.snippet || '',
      from: getHeader('From'),
      to: getHeader('To').split(',').map((e) => e.trim()).filter(Boolean),
      cc: getHeader('Cc') ? getHeader('Cc').split(',').map((e) => e.trim()).filter(Boolean) : undefined,
      bcc: getHeader('Bcc') ? getHeader('Bcc').split(',').map((e) => e.trim()).filter(Boolean) : undefined,
      subject: getHeader('Subject'),
      date: new Date(getHeader('Date') || Date.now()),
      body,
      attachments,
      isUnread: labelIds.includes('UNREAD'),
      headers: headersMap,
    };
  }

  /**
   * Parse message body from payload
   */
  private parseMessageBody(
    payload?: gmail_v1.Schema$MessagePart
  ): { text?: string; html?: string } {
    if (!payload) return {};

    const result: { text?: string; html?: string } = {};

    // Check if this part has the body
    if (payload.body?.data) {
      const decoded = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      if (payload.mimeType === 'text/plain') {
        result.text = decoded;
      } else if (payload.mimeType === 'text/html') {
        result.html = decoded;
      }
    }

    // Check nested parts
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data && !result.text) {
          result.text = Buffer.from(part.body.data, 'base64').toString('utf-8');
        } else if (part.mimeType === 'text/html' && part.body?.data && !result.html) {
          result.html = Buffer.from(part.body.data, 'base64').toString('utf-8');
        } else if (part.mimeType?.startsWith('multipart/')) {
          // Recursively parse multipart
          const nested = this.parseMessageBody(part);
          if (nested.text && !result.text) result.text = nested.text;
          if (nested.html && !result.html) result.html = nested.html;
        }
      }
    }

    return result;
  }

  /**
   * Parse attachments from payload
   */
  private parseAttachments(payload?: gmail_v1.Schema$MessagePart): GmailAttachment[] {
    const attachments: GmailAttachment[] = [];

    if (!payload) return attachments;

    const collectAttachments = (part: gmail_v1.Schema$MessagePart) => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
        });
      }

      if (part.parts) {
        for (const subpart of part.parts) {
          collectAttachments(subpart);
        }
      }
    };

    collectAttachments(payload);
    return attachments;
  }

  // ===========================================================================
  // Get Attachment
  // ===========================================================================

  /**
   * Download an attachment
   */
  async getAttachment(messageId: string, attachmentId: string): Promise<Buffer> {
    const response = await this.gmail.users.messages.attachments.get({
      userId: this.userEmail,
      messageId,
      id: attachmentId,
    });

    if (!response.data.data) {
      throw new Error('Attachment data not found');
    }

    return Buffer.from(response.data.data, 'base64');
  }

  // ===========================================================================
  // Send Message
  // ===========================================================================

  /**
   * Send an email
   */
  async sendMessage(options: GmailSendOptions): Promise<{ messageId: string; threadId: string }> {
    const {
      to,
      subject,
      body,
      isHtml = false,
      cc,
      bcc,
      replyTo,
      inReplyTo,
      threadId,
      attachments,
    } = options;

    // Build MIME message
    const mimeMessage = this.buildMimeMessage({
      to,
      subject,
      body,
      isHtml,
      cc,
      bcc,
      replyTo,
      inReplyTo,
      attachments,
    });

    // Encode to base64url
    const encodedMessage = Buffer.from(mimeMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await this.gmail.users.messages.send({
      userId: this.userEmail,
      requestBody: {
        raw: encodedMessage,
        threadId,
      },
    });

    return {
      messageId: response.data.id || '',
      threadId: response.data.threadId || '',
    };
  }

  /**
   * Build MIME message string
   */
  private buildMimeMessage(options: {
    to: string[];
    subject: string;
    body: string;
    isHtml: boolean;
    cc?: string[];
    bcc?: string[];
    replyTo?: string;
    inReplyTo?: string;
    attachments?: Array<{
      filename: string;
      content: Buffer | string;
      mimeType: string;
    }>;
  }): string {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substring(2)}`;
    const lines: string[] = [];

    // Headers
    lines.push(`To: ${options.to.join(', ')}`);
    lines.push(`Subject: ${this.encodeMimeHeader(options.subject)}`);

    if (options.cc?.length) {
      lines.push(`Cc: ${options.cc.join(', ')}`);
    }

    if (options.bcc?.length) {
      lines.push(`Bcc: ${options.bcc.join(', ')}`);
    }

    if (options.replyTo) {
      lines.push(`Reply-To: ${options.replyTo}`);
    }

    if (options.inReplyTo) {
      lines.push(`In-Reply-To: ${options.inReplyTo}`);
      lines.push(`References: ${options.inReplyTo}`);
    }

    lines.push('MIME-Version: 1.0');

    if (options.attachments?.length) {
      // Multipart with attachments
      lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
      lines.push('');
      lines.push(`--${boundary}`);

      // Body part
      lines.push(`Content-Type: ${options.isHtml ? 'text/html' : 'text/plain'}; charset="UTF-8"`);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      lines.push(Buffer.from(options.body).toString('base64'));

      // Attachment parts
      for (const attachment of options.attachments) {
        lines.push(`--${boundary}`);
        lines.push(
          `Content-Type: ${attachment.mimeType}; name="${this.encodeMimeHeader(attachment.filename)}"`
        );
        lines.push('Content-Transfer-Encoding: base64');
        lines.push(
          `Content-Disposition: attachment; filename="${this.encodeMimeHeader(attachment.filename)}"`
        );
        lines.push('');

        const content =
          typeof attachment.content === 'string'
            ? Buffer.from(attachment.content)
            : attachment.content;
        lines.push(content.toString('base64'));
      }

      lines.push(`--${boundary}--`);
    } else {
      // Simple message without attachments
      lines.push(`Content-Type: ${options.isHtml ? 'text/html' : 'text/plain'}; charset="UTF-8"`);
      lines.push('Content-Transfer-Encoding: base64');
      lines.push('');
      lines.push(Buffer.from(options.body).toString('base64'));
    }

    return lines.join('\r\n');
  }

  /**
   * Encode header value for MIME (RFC 2047)
   */
  private encodeMimeHeader(value: string): string {
    // Check if encoding is needed
    if (/^[\x20-\x7E]*$/.test(value)) {
      return value;
    }
    // Use base64 encoding for non-ASCII
    return `=?UTF-8?B?${Buffer.from(value).toString('base64')}?=`;
  }

  // ===========================================================================
  // Reply to Message
  // ===========================================================================

  /**
   * Reply to an existing message
   */
  async replyToMessage(
    originalMessageId: string,
    body: string,
    options: {
      isHtml?: boolean;
      replyAll?: boolean;
      attachments?: Array<{
        filename: string;
        content: Buffer | string;
        mimeType: string;
      }>;
    } = {}
  ): Promise<{ messageId: string; threadId: string }> {
    // Get original message to get threading info
    const original = await this.getMessage(originalMessageId);

    // Build recipient list
    let to = [original.from];
    let cc: string[] | undefined;

    if (options.replyAll) {
      // Add other recipients (excluding self)
      const profile = await this.getProfile();
      const allRecipients = [...original.to, ...(original.cc || [])];
      const others = allRecipients.filter(
        (email) => !email.toLowerCase().includes(profile.email.toLowerCase())
      );
      to = [original.from, ...others.filter((e) => e !== original.from)];
      // Keep CC if present
      if (original.cc?.length) {
        cc = original.cc.filter((e) => !to.includes(e));
      }
    }

    // Build subject with Re: prefix
    let subject = original.subject;
    if (!subject.toLowerCase().startsWith('re:')) {
      subject = `Re: ${subject}`;
    }

    return this.sendMessage({
      to,
      cc,
      subject,
      body,
      isHtml: options.isHtml,
      inReplyTo: original.headers['Message-ID'],
      threadId: original.threadId,
      attachments: options.attachments,
    });
  }

  // ===========================================================================
  // Search Messages
  // ===========================================================================

  /**
   * Search messages using Gmail query syntax
   * @see https://support.google.com/mail/answer/7190
   */
  async searchMessages(options: GmailSearchOptions): Promise<GmailListResult> {
    return this.listMessages({
      query: options.query,
      maxResults: options.maxResults,
      pageToken: options.pageToken,
    });
  }

  // ===========================================================================
  // Modify Messages
  // ===========================================================================

  /**
   * Mark message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: this.userEmail,
      id: messageId,
      requestBody: {
        removeLabelIds: ['UNREAD'],
      },
    });
  }

  /**
   * Mark message as unread
   */
  async markAsUnread(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: this.userEmail,
      id: messageId,
      requestBody: {
        addLabelIds: ['UNREAD'],
      },
    });
  }

  /**
   * Star a message
   */
  async starMessage(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: this.userEmail,
      id: messageId,
      requestBody: {
        addLabelIds: ['STARRED'],
      },
    });
  }

  /**
   * Unstar a message
   */
  async unstarMessage(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: this.userEmail,
      id: messageId,
      requestBody: {
        removeLabelIds: ['STARRED'],
      },
    });
  }

  /**
   * Archive a message (remove from INBOX)
   */
  async archiveMessage(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: this.userEmail,
      id: messageId,
      requestBody: {
        removeLabelIds: ['INBOX'],
      },
    });
  }

  /**
   * Move to inbox
   */
  async moveToInbox(messageId: string): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: this.userEmail,
      id: messageId,
      requestBody: {
        addLabelIds: ['INBOX'],
      },
    });
  }

  /**
   * Add labels to message
   */
  async addLabels(messageId: string, labelIds: string[]): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: this.userEmail,
      id: messageId,
      requestBody: {
        addLabelIds: labelIds,
      },
    });
  }

  /**
   * Remove labels from message
   */
  async removeLabels(messageId: string, labelIds: string[]): Promise<void> {
    await this.gmail.users.messages.modify({
      userId: this.userEmail,
      id: messageId,
      requestBody: {
        removeLabelIds: labelIds,
      },
    });
  }

  // ===========================================================================
  // Delete Messages
  // ===========================================================================

  /**
   * Move message to trash
   */
  async trashMessage(messageId: string): Promise<void> {
    await this.gmail.users.messages.trash({
      userId: this.userEmail,
      id: messageId,
    });
  }

  /**
   * Untrash a message
   */
  async untrashMessage(messageId: string): Promise<void> {
    await this.gmail.users.messages.untrash({
      userId: this.userEmail,
      id: messageId,
    });
  }

  /**
   * Permanently delete a message (DANGEROUS - cannot be undone)
   */
  async deleteMessagePermanently(messageId: string): Promise<void> {
    await this.gmail.users.messages.delete({
      userId: this.userEmail,
      id: messageId,
    });
  }

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  /**
   * Batch modify messages
   */
  async batchModify(
    messageIds: string[],
    addLabelIds?: string[],
    removeLabelIds?: string[]
  ): Promise<void> {
    await this.gmail.users.messages.batchModify({
      userId: this.userEmail,
      requestBody: {
        ids: messageIds,
        addLabelIds,
        removeLabelIds,
      },
    });
  }

  /**
   * Batch delete messages (move to trash)
   */
  async batchTrash(messageIds: string[]): Promise<void> {
    // Gmail API doesn't have batch trash, so we do it sequentially
    for (const id of messageIds) {
      await this.trashMessage(id);
    }
  }

  // ===========================================================================
  // Thread Operations
  // ===========================================================================

  /**
   * Get a thread with all messages
   */
  async getThread(threadId: string): Promise<GmailMessageFull[]> {
    const response = await this.gmail.users.threads.get({
      userId: this.userEmail,
      id: threadId,
      format: 'full',
    });

    const messages: GmailMessageFull[] = [];

    for (const msg of response.data.messages || []) {
      if (msg.id) {
        // Parse each message in the thread
        const parsed = await this.getMessage(msg.id);
        messages.push(parsed);
      }
    }

    return messages;
  }

  /**
   * Trash an entire thread
   */
  async trashThread(threadId: string): Promise<void> {
    await this.gmail.users.threads.trash({
      userId: this.userEmail,
      id: threadId,
    });
  }

  // ===========================================================================
  // Drafts
  // ===========================================================================

  /**
   * Create a draft
   */
  async createDraft(options: GmailSendOptions): Promise<{ draftId: string; messageId: string }> {
    const mimeMessage = this.buildMimeMessage({
      to: options.to,
      subject: options.subject,
      body: options.body,
      isHtml: options.isHtml || false,
      cc: options.cc,
      bcc: options.bcc,
      replyTo: options.replyTo,
      inReplyTo: options.inReplyTo,
      attachments: options.attachments,
    });

    const encodedMessage = Buffer.from(mimeMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const response = await this.gmail.users.drafts.create({
      userId: this.userEmail,
      requestBody: {
        message: {
          raw: encodedMessage,
          threadId: options.threadId,
        },
      },
    });

    return {
      draftId: response.data.id || '',
      messageId: response.data.message?.id || '',
    };
  }

  /**
   * Send a draft
   */
  async sendDraft(draftId: string): Promise<{ messageId: string; threadId: string }> {
    const response = await this.gmail.users.drafts.send({
      userId: this.userEmail,
      requestBody: {
        id: draftId,
      },
    });

    return {
      messageId: response.data.id || '',
      threadId: response.data.threadId || '',
    };
  }

  /**
   * Delete a draft
   */
  async deleteDraft(draftId: string): Promise<void> {
    await this.gmail.users.drafts.delete({
      userId: this.userEmail,
      id: draftId,
    });
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a Gmail client instance
 */
export function createGmailClient(
  credentials: GmailCredentials,
  tokens: GmailTokens,
  onTokenRefresh?: TokenRefreshCallback
): GmailClient {
  return new GmailClient(credentials, tokens, onTokenRefresh);
}

// =============================================================================
// Query Builder Helpers
// =============================================================================

/**
 * Build Gmail search query
 * @see https://support.google.com/mail/answer/7190
 */
export function buildGmailQuery(options: {
  from?: string;
  to?: string;
  subject?: string;
  hasAttachment?: boolean;
  isUnread?: boolean;
  isStarred?: boolean;
  after?: Date;
  before?: Date;
  label?: string;
  in?: 'inbox' | 'sent' | 'trash' | 'spam' | 'draft' | 'starred' | 'important';
  text?: string;
}): string {
  const parts: string[] = [];

  if (options.from) parts.push(`from:${options.from}`);
  if (options.to) parts.push(`to:${options.to}`);
  if (options.subject) parts.push(`subject:${options.subject}`);
  if (options.hasAttachment) parts.push('has:attachment');
  if (options.isUnread) parts.push('is:unread');
  if (options.isStarred) parts.push('is:starred');
  if (options.label) parts.push(`label:${options.label}`);
  if (options.in) parts.push(`in:${options.in}`);
  if (options.text) parts.push(options.text);

  if (options.after) {
    const dateStr = options.after.toISOString().split('T')[0];
    parts.push(`after:${dateStr}`);
  }

  if (options.before) {
    const dateStr = options.before.toISOString().split('T')[0];
    parts.push(`before:${dateStr}`);
  }

  return parts.join(' ');
}
