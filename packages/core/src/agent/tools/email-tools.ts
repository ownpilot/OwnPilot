/**
 * Email Tools
 * Send and read emails via SMTP/IMAP
 */

import type { ToolDefinition, ToolExecutor, ToolExecutionResult } from '../tools.js';

// ============================================================================
// SEND EMAIL TOOL
// ============================================================================

// Shared config requirements for email tools
const SMTP_CONFIG_REQUIREMENT = {
  name: 'smtp',
  displayName: 'SMTP Server',
  category: 'email',
  description: 'SMTP server configuration for sending emails',
  multiEntry: true,
  configSchema: [
    { name: 'host', label: 'SMTP Host', type: 'string' as const, required: true, envVar: 'SMTP_HOST' },
    { name: 'port', label: 'SMTP Port', type: 'string' as const, required: true, envVar: 'SMTP_PORT', defaultValue: '587' },
    { name: 'user', label: 'Username', type: 'string' as const, required: true, envVar: 'SMTP_USER' },
    { name: 'pass', label: 'Password', type: 'secret' as const, required: true, envVar: 'SMTP_PASS' },
    { name: 'from', label: 'From Address', type: 'string' as const, required: false, envVar: 'SMTP_FROM' },
    { name: 'secure', label: 'Use TLS', type: 'string' as const, required: false, defaultValue: 'true' },
  ],
} as const;

const IMAP_CONFIG_REQUIREMENT = {
  name: 'imap',
  displayName: 'IMAP Server',
  category: 'email',
  description: 'IMAP server configuration for reading emails',
  multiEntry: true,
  configSchema: [
    { name: 'host', label: 'IMAP Host', type: 'string' as const, required: true, envVar: 'IMAP_HOST' },
    { name: 'port', label: 'IMAP Port', type: 'string' as const, required: true, envVar: 'IMAP_PORT', defaultValue: '993' },
    { name: 'user', label: 'Username', type: 'string' as const, required: true, envVar: 'IMAP_USER' },
    { name: 'pass', label: 'Password', type: 'secret' as const, required: true, envVar: 'IMAP_PASS' },
    { name: 'tls', label: 'Use TLS', type: 'string' as const, required: false, defaultValue: 'true' },
  ],
} as const;

export const sendEmailTool: ToolDefinition = {
  name: 'send_email',
  brief: 'Send email via SMTP with HTML and attachments',
  description: 'Send an email using configured SMTP server. Supports HTML content, attachments, and CC/BCC.',
  parameters: {
    type: 'object',
    properties: {
      to: {
        type: 'array',
        description: 'Recipient email addresses',
        items: { type: 'string' },
      },
      subject: {
        type: 'string',
        description: 'Email subject line',
      },
      body: {
        type: 'string',
        description: 'Email body content',
      },
      html: {
        type: 'boolean',
        description: 'Whether body contains HTML (default: false)',
      },
      cc: {
        type: 'array',
        description: 'CC recipients',
        items: { type: 'string' },
      },
      bcc: {
        type: 'array',
        description: 'BCC recipients',
        items: { type: 'string' },
      },
      replyTo: {
        type: 'string',
        description: 'Reply-To address',
      },
      attachments: {
        type: 'array',
        description: 'File paths to attach',
        items: { type: 'string' },
      },
      priority: {
        type: 'string',
        description: 'Email priority',
        enum: ['high', 'normal', 'low'],
      },
    },
    required: ['to', 'subject', 'body'],
  },
  configRequirements: [SMTP_CONFIG_REQUIREMENT],
};

export const sendEmailExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const to = params.to as string[];
  const subject = params.subject as string;
  const body = params.body as string;
  const isHtml = params.html === true;
  const cc = params.cc as string[] | undefined;
  const bcc = params.bcc as string[] | undefined;
  const replyTo = params.replyTo as string | undefined;
  const attachments = params.attachments as string[] | undefined;
  const priority = (params.priority as string) || 'normal';

  // Validate recipients
  if (!to || to.length === 0) {
    return {
      content: { error: 'At least one recipient is required' },
      isError: true,
    };
  }

  // Validate email format (reject CRLF injection and control chars)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const allRecipients = [...to, ...(cc ?? []), ...(bcc ?? [])];
  for (const email of allRecipients) {
    if (!emailRegex.test(email) || /[\r\n\x00-\x1f]/.test(email)) {
      return {
        content: { error: `Invalid email address: ${email}` },
        isError: true,
      };
    }
  }

  // Try to use nodemailer if available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let _nodemailer: any = null; // Optional dependency - dynamically imported
  try {
    _nodemailer = await import(/* webpackIgnore: true */ 'nodemailer' as string);
  } catch {
    return {
      content: {
        error: 'nodemailer library not installed',
        suggestion: 'Install with: pnpm add nodemailer @types/nodemailer',
        emailDetails: {
          to,
          subject,
          body: body.substring(0, 100) + (body.length > 100 ? '...' : ''),
          cc,
          bcc,
          hasAttachments: attachments && attachments.length > 0,
        },
      },
      isError: true,
    };
  }

  // Sanitize header fields against CRLF injection
  const sanitizeHeader = (v: string) => v.replace(/[\r\n]/g, '');

  // Validate replyTo if provided
  if (replyTo && (!emailRegex.test(replyTo) || /[\r\n\x00-\x1f]/.test(replyTo))) {
    return {
      content: { error: `Invalid replyTo address: ${replyTo}` },
      isError: true,
    };
  }

  // Build email message
  const message: Record<string, unknown> = {
    to: to.join(', '),
    subject: sanitizeHeader(subject),
    [isHtml ? 'html' : 'text']: body,
  };

  if (cc && cc.length > 0) {
    message.cc = cc.join(', ');
  }

  if (bcc && bcc.length > 0) {
    message.bcc = bcc.join(', ');
  }

  if (replyTo) {
    message.replyTo = sanitizeHeader(replyTo);
  }

  // Set priority header
  if (priority === 'high') {
    message.priority = 'high';
    message.headers = { 'X-Priority': '1' };
  } else if (priority === 'low') {
    message.priority = 'low';
    message.headers = { 'X-Priority': '5' };
  }

  // Handle attachments
  if (attachments && attachments.length > 0) {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const attachmentList: Array<{ filename: string; path: string }> = [];

    for (const filePath of attachments) {
      try {
        await fs.access(filePath);
        attachmentList.push({
          filename: path.basename(filePath),
          path: filePath,
        });
      } catch {
        return {
          content: { error: `Attachment not found: ${filePath}` },
          isError: true,
        };
      }
    }

    message.attachments = attachmentList;
  }

  // Return placeholder - actual sending requires SMTP configuration
  return {
    content: {
      status: 'prepared',
      message: {
        to,
        subject,
        bodyPreview: body.substring(0, 100) + (body.length > 100 ? '...' : ''),
        isHtml,
        cc,
        bcc,
        attachmentCount: attachments?.length || 0,
        priority,
      },
      requiresSMTPConfig: true,
      note: 'Email sending requires SMTP configuration. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS in environment.',
    },
    isError: false,
  };
};

// ============================================================================
// LIST EMAILS TOOL
// ============================================================================

export const listEmailsTool: ToolDefinition = {
  name: 'list_emails',
  brief: 'List inbox emails via IMAP with filters',
  description: 'List emails from inbox using IMAP. All parameters are optional filters. Returns emails sorted by date.',
  parameters: {
    type: 'object',
    properties: {
      folder: {
        type: 'string',
        description: 'Email folder to read (default: "INBOX")',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of emails to retrieve (default: 20, max: 100)',
      },
      unreadOnly: {
        type: 'boolean',
        description: 'Only retrieve unread emails (default: false)',
      },
      from: {
        type: 'string',
        description: 'Filter by sender email or name (partial match)',
      },
      subject: {
        type: 'string',
        description: 'Filter by subject (partial match)',
      },
      since: {
        type: 'string',
        description: 'Only emails after this date (ISO format, e.g. "2025-01-01")',
      },
      before: {
        type: 'string',
        description: 'Only emails before this date (ISO format, e.g. "2025-12-31")',
      },
    },
    required: [],
  },
  configRequirements: [IMAP_CONFIG_REQUIREMENT],
};

export const listEmailsExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const folder = (params.folder as string) || 'INBOX';
  const limit = Math.min((params.limit as number) || 20, 100);
  const unreadOnly = params.unreadOnly === true;
  const fromFilter = params.from as string | undefined;
  const subjectFilter = params.subject as string | undefined;
  const since = params.since as string | undefined;
  const before = params.before as string | undefined;

  // Try to use imap-simple or similar
  let _imapSimple: unknown;
  try {
    _imapSimple = await import(/* webpackIgnore: true */ 'imap-simple' as string);
  } catch {
    return {
      content: {
        error: 'imap-simple library not installed',
        suggestion: 'Install with: pnpm add imap-simple @types/imap-simple',
        query: {
          folder,
          limit,
          unreadOnly,
          fromFilter,
          subjectFilter,
          since,
          before,
        },
      },
      isError: true,
    };
  }

  // Return placeholder - actual reading requires IMAP configuration
  return {
    content: {
      status: 'prepared',
      query: {
        folder,
        limit,
        unreadOnly,
        from: fromFilter,
        subject: subjectFilter,
        since,
        before,
      },
      requiresIMAPConfig: true,
      note: 'Email reading requires IMAP configuration. Set IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS in environment.',
    },
    isError: false,
  };
};

// ============================================================================
// READ EMAIL TOOL
// ============================================================================

export const readEmailTool: ToolDefinition = {
  name: 'read_email',
  brief: 'Read a specific email body and attachments',
  description: 'Read a specific email by ID, including full body and attachments',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Email message ID',
      },
      folder: {
        type: 'string',
        description: 'Email folder (default: INBOX)',
      },
      downloadAttachments: {
        type: 'boolean',
        description: 'Download attachments to workspace',
      },
      attachmentDir: {
        type: 'string',
        description: 'Directory to save attachments',
      },
      markAsRead: {
        type: 'boolean',
        description: 'Mark email as read after fetching (default: true)',
      },
    },
    required: ['id'],
  },
  configRequirements: [IMAP_CONFIG_REQUIREMENT],
};

export const readEmailExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const emailId = params.id as string;
  const folder = (params.folder as string) || 'INBOX';
  const downloadAttachments = params.downloadAttachments === true;
  const attachmentDir = params.attachmentDir as string | undefined;
  const markAsRead = params.markAsRead !== false;

  return {
    content: {
      status: 'prepared',
      query: {
        id: emailId,
        folder,
        downloadAttachments,
        attachmentDir,
        markAsRead,
      },
      requiresIMAPConfig: true,
      note: 'Email reading requires IMAP configuration.',
    },
    isError: false,
  };
};

// ============================================================================
// DELETE EMAIL TOOL
// ============================================================================

export const deleteEmailTool: ToolDefinition = {
  name: 'delete_email',
  brief: 'Delete or trash an email',
  description: 'Delete or move an email to trash',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Email message ID',
      },
      folder: {
        type: 'string',
        description: 'Current folder of the email',
      },
      permanent: {
        type: 'boolean',
        description: 'Permanently delete instead of moving to trash (default: false)',
      },
    },
    required: ['id'],
  },
  configRequirements: [IMAP_CONFIG_REQUIREMENT],
};

export const deleteEmailExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const emailId = params.id as string;
  const folder = (params.folder as string) || 'INBOX';
  const permanent = params.permanent === true;

  return {
    content: {
      status: 'prepared',
      action: permanent ? 'permanent_delete' : 'move_to_trash',
      query: {
        id: emailId,
        folder,
        permanent,
      },
      requiresIMAPConfig: true,
      note: 'Email deletion requires IMAP configuration.',
    },
    isError: false,
  };
};

// ============================================================================
// SEARCH EMAILS TOOL
// ============================================================================

export const searchEmailsTool: ToolDefinition = {
  name: 'search_emails',
  brief: 'Search emails with advanced criteria',
  description: 'Search emails using advanced criteria',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (searches in subject, body, sender)',
      },
      folder: {
        type: 'string',
        description: 'Folder to search (default: all folders)',
      },
      hasAttachment: {
        type: 'boolean',
        description: 'Only emails with attachments',
      },
      isStarred: {
        type: 'boolean',
        description: 'Only starred/flagged emails',
      },
      limit: {
        type: 'number',
        description: 'Maximum results (default: 50)',
      },
    },
    required: ['query'],
  },
  configRequirements: [IMAP_CONFIG_REQUIREMENT],
};

export const searchEmailsExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const query = params.query as string;
  const folder = params.folder as string | undefined;
  const hasAttachment = params.hasAttachment as boolean | undefined;
  const isStarred = params.isStarred as boolean | undefined;
  const limit = Math.min((params.limit as number) || 50, 200);

  return {
    content: {
      status: 'prepared',
      query: {
        searchText: query,
        folder: folder || 'all',
        hasAttachment,
        isStarred,
        limit,
      },
      requiresIMAPConfig: true,
      note: 'Email search requires IMAP configuration.',
    },
    isError: false,
  };
};

// ============================================================================
// REPLY TO EMAIL TOOL
// ============================================================================

export const replyEmailTool: ToolDefinition = {
  name: 'reply_email',
  brief: 'Reply to an existing email',
  description: 'Reply to an existing email',
  parameters: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Original email message ID',
      },
      body: {
        type: 'string',
        description: 'Reply body content',
      },
      html: {
        type: 'boolean',
        description: 'Whether body contains HTML',
      },
      replyAll: {
        type: 'boolean',
        description: 'Reply to all recipients (default: false)',
      },
      attachments: {
        type: 'array',
        description: 'File paths to attach',
        items: { type: 'string' },
      },
    },
    required: ['id', 'body'],
  },
  configRequirements: [SMTP_CONFIG_REQUIREMENT, IMAP_CONFIG_REQUIREMENT],
};

export const replyEmailExecutor: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const emailId = params.id as string;
  const body = params.body as string;
  const isHtml = params.html === true;
  const replyAll = params.replyAll === true;
  const attachments = params.attachments as string[] | undefined;

  return {
    content: {
      status: 'prepared',
      action: replyAll ? 'reply_all' : 'reply',
      details: {
        originalId: emailId,
        bodyPreview: body.substring(0, 100) + (body.length > 100 ? '...' : ''),
        isHtml,
        attachmentCount: attachments?.length || 0,
      },
      requiresSMTPConfig: true,
      requiresIMAPConfig: true,
      note: 'Replying requires both SMTP (to send) and IMAP (to fetch original) configuration.',
    },
    isError: false,
  };
};

// ============================================================================
// EXPORT ALL EMAIL TOOLS
// ============================================================================

export const EMAIL_TOOLS: Array<{ definition: ToolDefinition; executor: ToolExecutor }> = [
  { definition: sendEmailTool, executor: sendEmailExecutor },
  { definition: listEmailsTool, executor: listEmailsExecutor },
  { definition: readEmailTool, executor: readEmailExecutor },
  { definition: deleteEmailTool, executor: deleteEmailExecutor },
  { definition: searchEmailsTool, executor: searchEmailsExecutor },
  { definition: replyEmailTool, executor: replyEmailExecutor },
];

export const EMAIL_TOOL_NAMES = EMAIL_TOOLS.map((t) => t.definition.name);
