/**
 * Gmail Tool Executors
 *
 * Real Gmail API implementations that override the placeholder email tools.
 * Uses OAuth tokens from database and integrates with the GmailClient.
 */

import type { ToolExecutor, ToolExecutionResult } from '@ownpilot/core';
import {
  GmailClient,
  createGmailClient,
  buildGmailQuery,
  type GmailCredentials,
  type GmailTokens,
  type GmailMessageHeader,
  type GmailLabel,
  type GmailAttachment,
} from '@ownpilot/core';
import { oauthIntegrationsRepo, settingsRepo } from '../db/repositories/index.js';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get Gmail client for a user
 */
async function getGmailClient(userId: string = 'default'): Promise<GmailClient | null> {
  // Get OAuth credentials from settings
  const clientId = await settingsRepo.get<string>('google_oauth_client_id');
  const clientSecret = await settingsRepo.get<string>('google_oauth_client_secret');

  if (!clientId || !clientSecret) {
    return null;
  }

  // Get OAuth integration
  const integration = await oauthIntegrationsRepo.getByUserProviderService(userId, 'google', 'gmail');

  if (!integration) {
    return null;
  }

  // Get tokens
  const tokens = await oauthIntegrationsRepo.getTokens(integration.id);

  if (!tokens?.accessToken) {
    return null;
  }

  const credentials: GmailCredentials = {
    clientId,
    clientSecret,
  };

  const gmailTokens: GmailTokens = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
  };

  // Create client with token refresh callback
  return createGmailClient(credentials, gmailTokens, async (newTokens: GmailTokens) => {
    // Update tokens in database when refreshed
    await oauthIntegrationsRepo.updateTokens(integration.id, {
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken,
      expiresAt: newTokens.expiresAt,
    });
  });
}

/**
 * Check if Gmail is connected for user
 */
async function isGmailConnected(userId: string = 'default'): Promise<boolean> {
  return await oauthIntegrationsRepo.isConnected(userId, 'google', 'gmail');
}

/**
 * Format error response
 */
function errorResult(error: string, suggestion?: string): ToolExecutionResult {
  return {
    content: { error, suggestion },
    isError: true,
  };
}

/**
 * Format not connected error
 */
function notConnectedError(): ToolExecutionResult {
  return errorResult(
    'Gmail is not connected',
    'Connect Gmail in Settings → Integrations first'
  );
}

// =============================================================================
// SEND EMAIL EXECUTOR
// =============================================================================

export const gmailSendEmailExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const to = params.to as string[];
  const subject = params.subject as string;
  const body = params.body as string;
  const isHtml = params.html === true;
  const cc = params.cc as string[] | undefined;
  const bcc = params.bcc as string[] | undefined;
  const replyTo = params.replyTo as string | undefined;
  const userId = (params.userId as string) || 'default';

  // Validate recipients
  if (!to || to.length === 0) {
    return errorResult('At least one recipient is required');
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const email of to) {
    if (!emailRegex.test(email)) {
      return errorResult(`Invalid email address: ${email}`);
    }
  }

  // Check Gmail connection
  if (!await isGmailConnected(userId)) {
    return notConnectedError();
  }

  // Get Gmail client
  const gmail = await getGmailClient(userId);
  if (!gmail) {
    return errorResult('Failed to initialize Gmail client');
  }

  try {
    const result = await gmail.sendMessage({
      to,
      subject,
      body,
      isHtml,
      cc,
      bcc,
      replyTo,
    });

    return {
      content: {
        success: true,
        messageId: result.messageId,
        threadId: result.threadId,
        message: `Email sent successfully to ${to.join(', ')}`,
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to send email';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// LIST EMAILS EXECUTOR
// =============================================================================

export const gmailListEmailsExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const folder = (params.folder as string) || 'INBOX';
  const limit = Math.min((params.limit as number) || 20, 100);
  const unreadOnly = params.unreadOnly === true;
  const fromFilter = params.from as string | undefined;
  const subjectFilter = params.subject as string | undefined;
  const since = params.since as string | undefined;
  const before = params.before as string | undefined;
  const userId = (params.userId as string) || 'default';

  // Check Gmail connection
  if (!await isGmailConnected(userId)) {
    return notConnectedError();
  }

  // Get Gmail client
  const gmail = await getGmailClient(userId);
  if (!gmail) {
    return errorResult('Failed to initialize Gmail client');
  }

  try {
    // Build query
    const query = buildGmailQuery({
      from: fromFilter,
      subject: subjectFilter,
      isUnread: unreadOnly || undefined,
      after: since ? new Date(since) : undefined,
      before: before ? new Date(before) : undefined,
      in: folder.toLowerCase() as 'inbox' | 'sent' | 'trash' | 'spam' | 'draft',
    });

    const result = await gmail.listMessages({
      maxResults: limit,
      query: query || undefined,
    });

    // Format messages for response
    const emails = result.messages.map((msg: GmailMessageHeader) => ({
      id: msg.id,
      threadId: msg.threadId,
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      date: msg.date?.toISOString(),
      snippet: msg.snippet,
      isUnread: msg.isUnread,
      hasAttachment: msg.hasAttachment,
      labels: msg.labelIds,
    }));

    return {
      content: {
        success: true,
        emails,
        count: emails.length,
        hasMore: !!result.nextPageToken,
        nextPageToken: result.nextPageToken,
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to list emails';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// READ EMAIL EXECUTOR
// =============================================================================

export const gmailReadEmailExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const emailId = params.id as string;
  const markAsRead = params.markAsRead !== false;
  const userId = (params.userId as string) || 'default';

  if (!emailId) {
    return errorResult('Email ID is required');
  }

  // Check Gmail connection
  if (!await isGmailConnected(userId)) {
    return notConnectedError();
  }

  // Get Gmail client
  const gmail = await getGmailClient(userId);
  if (!gmail) {
    return errorResult('Failed to initialize Gmail client');
  }

  try {
    const message = await gmail.getMessage(emailId);

    // Mark as read if requested
    if (markAsRead && message.isUnread) {
      await gmail.markAsRead(emailId);
    }

    return {
      content: {
        success: true,
        email: {
          id: message.id,
          threadId: message.threadId,
          from: message.from,
          to: message.to,
          cc: message.cc,
          subject: message.subject,
          date: message.date.toISOString(),
          body: message.body.text || message.body.html,
          isHtml: !!message.body.html && !message.body.text,
          attachments: message.attachments.map((a: GmailAttachment) => ({
            id: a.id,
            filename: a.filename,
            mimeType: a.mimeType,
            size: a.size,
          })),
          labels: message.labelIds,
          isUnread: message.isUnread,
        },
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to read email';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// DELETE EMAIL EXECUTOR
// =============================================================================

export const gmailDeleteEmailExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const emailId = params.id as string;
  const permanent = params.permanent === true;
  const userId = (params.userId as string) || 'default';

  if (!emailId) {
    return errorResult('Email ID is required');
  }

  // Check Gmail connection
  if (!await isGmailConnected(userId)) {
    return notConnectedError();
  }

  // Get Gmail client
  const gmail = await getGmailClient(userId);
  if (!gmail) {
    return errorResult('Failed to initialize Gmail client');
  }

  try {
    if (permanent) {
      // Permanent delete - this is dangerous!
      await gmail.deleteMessagePermanently(emailId);
      return {
        content: {
          success: true,
          message: 'Email permanently deleted',
          warning: 'This action cannot be undone',
        },
        isError: false,
      };
    } else {
      // Move to trash (safer default)
      await gmail.trashMessage(emailId);
      return {
        content: {
          success: true,
          message: 'Email moved to trash',
          hint: 'You can recover this email from the Trash folder',
        },
        isError: false,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete email';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// SEARCH EMAILS EXECUTOR
// =============================================================================

export const gmailSearchEmailsExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const query = params.query as string;
  const folder = params.folder as string | undefined;
  const hasAttachment = params.hasAttachment as boolean | undefined;
  const isStarred = params.isStarred as boolean | undefined;
  const limit = Math.min((params.limit as number) || 50, 200);
  const userId = (params.userId as string) || 'default';

  if (!query) {
    return errorResult('Search query is required');
  }

  // Check Gmail connection
  if (!await isGmailConnected(userId)) {
    return notConnectedError();
  }

  // Get Gmail client
  const gmail = await getGmailClient(userId);
  if (!gmail) {
    return errorResult('Failed to initialize Gmail client');
  }

  try {
    // Build enhanced query
    const searchParts = [query];
    if (hasAttachment) searchParts.push('has:attachment');
    if (isStarred) searchParts.push('is:starred');
    if (folder && folder !== 'all') {
      searchParts.push(`in:${folder.toLowerCase()}`);
    }

    const result = await gmail.searchMessages({
      query: searchParts.join(' '),
      maxResults: limit,
    });

    const emails = result.messages.map((msg: GmailMessageHeader) => ({
      id: msg.id,
      threadId: msg.threadId,
      from: msg.from,
      to: msg.to,
      subject: msg.subject,
      date: msg.date?.toISOString(),
      snippet: msg.snippet,
      isUnread: msg.isUnread,
      hasAttachment: msg.hasAttachment,
    }));

    return {
      content: {
        success: true,
        query: searchParts.join(' '),
        emails,
        count: emails.length,
        hasMore: !!result.nextPageToken,
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to search emails';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// REPLY EMAIL EXECUTOR
// =============================================================================

export const gmailReplyEmailExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const emailId = params.id as string;
  const body = params.body as string;
  const isHtml = params.html === true;
  const replyAll = params.replyAll === true;
  const userId = (params.userId as string) || 'default';

  if (!emailId) {
    return errorResult('Original email ID is required');
  }

  if (!body) {
    return errorResult('Reply body is required');
  }

  // Check Gmail connection
  if (!await isGmailConnected(userId)) {
    return notConnectedError();
  }

  // Get Gmail client
  const gmail = await getGmailClient(userId);
  if (!gmail) {
    return errorResult('Failed to initialize Gmail client');
  }

  try {
    const result = await gmail.replyToMessage(emailId, body, {
      isHtml,
      replyAll,
    });

    return {
      content: {
        success: true,
        messageId: result.messageId,
        threadId: result.threadId,
        message: replyAll ? 'Reply sent to all recipients' : 'Reply sent',
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to send reply';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// ADDITIONAL GMAIL TOOLS
// =============================================================================

/**
 * Mark email as read/unread
 */
export const gmailMarkReadExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const emailId = params.id as string;
  const read = params.read !== false;
  const userId = (params.userId as string) || 'default';

  if (!emailId) {
    return errorResult('Email ID is required');
  }

  if (!await isGmailConnected(userId)) {
    return notConnectedError();
  }

  const gmail = await getGmailClient(userId);
  if (!gmail) {
    return errorResult('Failed to initialize Gmail client');
  }

  try {
    if (read) {
      await gmail.markAsRead(emailId);
    } else {
      await gmail.markAsUnread(emailId);
    }

    return {
      content: {
        success: true,
        message: read ? 'Email marked as read' : 'Email marked as unread',
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to update email';
    return errorResult(errorMessage);
  }
};

/**
 * Star/unstar email
 */
export const gmailStarExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const emailId = params.id as string;
  const star = params.star !== false;
  const userId = (params.userId as string) || 'default';

  if (!emailId) {
    return errorResult('Email ID is required');
  }

  if (!await isGmailConnected(userId)) {
    return notConnectedError();
  }

  const gmail = await getGmailClient(userId);
  if (!gmail) {
    return errorResult('Failed to initialize Gmail client');
  }

  try {
    if (star) {
      await gmail.starMessage(emailId);
    } else {
      await gmail.unstarMessage(emailId);
    }

    return {
      content: {
        success: true,
        message: star ? 'Email starred' : 'Email unstarred',
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to update email';
    return errorResult(errorMessage);
  }
};

/**
 * Archive email
 */
export const gmailArchiveExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const emailId = params.id as string;
  const userId = (params.userId as string) || 'default';

  if (!emailId) {
    return errorResult('Email ID is required');
  }

  if (!await isGmailConnected(userId)) {
    return notConnectedError();
  }

  const gmail = await getGmailClient(userId);
  if (!gmail) {
    return errorResult('Failed to initialize Gmail client');
  }

  try {
    await gmail.archiveMessage(emailId);
    return {
      content: {
        success: true,
        message: 'Email archived (removed from inbox)',
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to archive email';
    return errorResult(errorMessage);
  }
};

/**
 * Get email labels
 */
export const gmailGetLabelsExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const userId = (params.userId as string) || 'default';

  if (!await isGmailConnected(userId)) {
    return notConnectedError();
  }

  const gmail = await getGmailClient(userId);
  if (!gmail) {
    return errorResult('Failed to initialize Gmail client');
  }

  try {
    const labels = await gmail.getLabels();

    return {
      content: {
        success: true,
        labels: labels.map((l: GmailLabel) => ({
          id: l.id,
          name: l.name,
          type: l.type,
          messagesTotal: l.messagesTotal,
          messagesUnread: l.messagesUnread,
        })),
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get labels';
    return errorResult(errorMessage);
  }
};

/**
 * Get attachment
 */
export const gmailGetAttachmentExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const messageId = params.messageId as string;
  const attachmentId = params.attachmentId as string;
  const userId = (params.userId as string) || 'default';

  if (!messageId || !attachmentId) {
    return errorResult('Message ID and Attachment ID are required');
  }

  if (!await isGmailConnected(userId)) {
    return notConnectedError();
  }

  const gmail = await getGmailClient(userId);
  if (!gmail) {
    return errorResult('Failed to initialize Gmail client');
  }

  try {
    const data = await gmail.getAttachment(messageId, attachmentId);

    return {
      content: {
        success: true,
        data: data.toString('base64'),
        encoding: 'base64',
        size: data.length,
      },
      isError: false,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to get attachment';
    return errorResult(errorMessage);
  }
};

// =============================================================================
// EXPORT ALL GMAIL EXECUTORS
// =============================================================================

export const GMAIL_TOOL_EXECUTORS: Record<string, ToolExecutor> = {
  // Standard email tools (override placeholders)
  send_email: gmailSendEmailExecutor,
  list_emails: gmailListEmailsExecutor,
  read_email: gmailReadEmailExecutor,
  delete_email: gmailDeleteEmailExecutor,
  search_emails: gmailSearchEmailsExecutor,
  reply_email: gmailReplyEmailExecutor,
  // Additional Gmail-specific tools
  mark_email_read: gmailMarkReadExecutor,
  star_email: gmailStarExecutor,
  archive_email: gmailArchiveExecutor,
  get_email_labels: gmailGetLabelsExecutor,
  get_attachment: gmailGetAttachmentExecutor,
};

/**
 * Check if Gmail tools should be used (i.e., Gmail is connected)
 */
export async function shouldUseGmailTools(userId: string = 'default'): Promise<boolean> {
  return await isGmailConnected(userId);
}
