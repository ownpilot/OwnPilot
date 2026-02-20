/**
 * Email Tool Overrides
 *
 * Replaces placeholder executors in core/email-tools with real implementations:
 *   - send_email:    Sends via nodemailer (SMTP)
 *   - list_emails:   Lists inbox via imapflow (IMAP)
 *   - read_email:    Reads specific email via imapflow
 *   - search_emails: Searches via imapflow
 *   - reply_email:   Reply via nodemailer + imapflow
 *   - delete_email:  Delete/trash via imapflow
 */

import type { ToolRegistry, ToolExecutor, ToolExecutionResult } from '@ownpilot/core';
import { configServicesRepo } from '../db/repositories/config-services.js';
import { getLog } from './log.js';
import { getErrorMessage } from '../routes/helpers.js';

const log = getLog('EmailOverrides');

// ============================================================================
// Config Center Registration
// ============================================================================

async function ensureEmailServices(): Promise<void> {
  try {
    await configServicesRepo.upsert({
      name: 'smtp',
      displayName: 'SMTP Server',
      category: 'email',
      description: 'SMTP server for sending emails (Gmail, Outlook, custom)',
      configSchema: [
        { name: 'host', label: 'SMTP Host', type: 'string' as const, required: true, description: 'e.g. smtp.gmail.com, smtp.office365.com' },
        { name: 'port', label: 'SMTP Port', type: 'string' as const, required: true, defaultValue: '587' },
        { name: 'user', label: 'Username', type: 'string' as const, required: true, description: 'Email address or username' },
        { name: 'pass', label: 'Password', type: 'secret' as const, required: true, description: 'App password (Gmail) or account password' },
        { name: 'from', label: 'From Address', type: 'string' as const, required: false, description: 'Sender address (defaults to username)' },
        { name: 'secure', label: 'Use TLS', type: 'string' as const, required: false, defaultValue: 'true' },
      ],
    });
    await configServicesRepo.upsert({
      name: 'imap',
      displayName: 'IMAP Server',
      category: 'email',
      description: 'IMAP server for reading emails (Gmail, Outlook, custom)',
      configSchema: [
        { name: 'host', label: 'IMAP Host', type: 'string' as const, required: true, description: 'e.g. imap.gmail.com, outlook.office365.com' },
        { name: 'port', label: 'IMAP Port', type: 'string' as const, required: true, defaultValue: '993' },
        { name: 'user', label: 'Username', type: 'string' as const, required: true },
        { name: 'pass', label: 'Password', type: 'secret' as const, required: true },
        { name: 'tls', label: 'Use TLS', type: 'string' as const, required: false, defaultValue: 'true' },
      ],
    });
  } catch (error) {
    log.debug('Config upsert for email services:', getErrorMessage(error));
  }
}

// ============================================================================
// Config Helpers
// ============================================================================

interface SmtpConfig { host: string; port: number; user: string; pass: string; from: string; secure: boolean }
interface ImapConfig { host: string; port: number; user: string; pass: string; tls: boolean }

function getSmtpConfig(): SmtpConfig | null {
  const host = configServicesRepo.getFieldValue('smtp', 'host') as string | undefined;
  const user = configServicesRepo.getFieldValue('smtp', 'user') as string | undefined;
  const pass = configServicesRepo.getFieldValue('smtp', 'pass') as string | undefined;
  if (!host || !user || !pass) return null;

  const port = parseInt(String(configServicesRepo.getFieldValue('smtp', 'port') ?? '587'), 10);
  const from = (configServicesRepo.getFieldValue('smtp', 'from') as string) || user;
  const secure = String(configServicesRepo.getFieldValue('smtp', 'secure') ?? 'true') !== 'false';

  return { host, port, user, pass, from, secure };
}

function getImapConfig(): ImapConfig | null {
  const host = configServicesRepo.getFieldValue('imap', 'host') as string | undefined;
  const user = configServicesRepo.getFieldValue('imap', 'user') as string | undefined;
  const pass = configServicesRepo.getFieldValue('imap', 'pass') as string | undefined;
  if (!host || !user || !pass) return null;

  const port = parseInt(String(configServicesRepo.getFieldValue('imap', 'port') ?? '993'), 10);
  const tls = String(configServicesRepo.getFieldValue('imap', 'tls') ?? 'true') !== 'false';

  return { host, port, user, pass, tls };
}

const SMTP_NOT_CONFIGURED = 'SMTP not configured. Go to Settings → Config Center → SMTP Server and enter host, username, and password.';
const IMAP_NOT_CONFIGURED = 'IMAP not configured. Go to Settings → Config Center → IMAP Server and enter host, username, and password.';

// ============================================================================
// IMAP Client Helper
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function withImapClient<T>(folder: string, fn: (client: any) => Promise<T>): Promise<T> {
  const config = getImapConfig();
  if (!config) throw new Error(IMAP_NOT_CONFIGURED);

  const { ImapFlow } = await import('imapflow');
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.tls,
    auth: { user: config.user, pass: config.pass },
    logger: false,
  });

  await client.connect();
  const lock = await client.getMailboxLock(folder);
  try {
    return await fn(client);
  } finally {
    lock.release();
    await client.logout();
  }
}

// ============================================================================
// Email Address Helpers
// ============================================================================

interface EmailAddress { name?: string; address?: string }

function formatAddress(addr: EmailAddress | EmailAddress[] | undefined): string {
  if (!addr) return '';
  const list = Array.isArray(addr) ? addr : [addr];
  return list.map(a => a.name ? `${a.name} <${a.address}>` : a.address ?? '').join(', ');
}

function formatAddressList(addr: EmailAddress | EmailAddress[] | undefined): string[] {
  if (!addr) return [];
  const list = Array.isArray(addr) ? addr : [addr];
  return list.map(a => a.address ?? '').filter(Boolean);
}

// ============================================================================
// Basic Text Extraction from Raw Email
// ============================================================================

function extractTextFromRaw(raw: string): { text: string; html?: string } {
  const boundaryMatch = raw.match(/boundary="?([^";\r\n]+)/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1]!;
    const parts = raw.split(`--${boundary}`);
    let text = '';
    let html = '';

    for (const part of parts) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd < 0) continue;
      const headers = part.slice(0, headerEnd).toLowerCase();
      let body = part.slice(headerEnd + 4).trim();

      // Remove trailing boundary marker
      if (body.endsWith('--')) body = body.slice(0, -2).trim();

      // Handle transfer encoding
      if (headers.includes('content-transfer-encoding: base64')) {
        try { body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf-8'); } catch { /* keep as-is */ }
      } else if (headers.includes('content-transfer-encoding: quoted-printable')) {
        body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      }

      if (headers.includes('text/plain') && !text) {
        text = body;
      } else if (headers.includes('text/html') && !html) {
        html = body;
      }
    }

    if (text) return { text, html: html || undefined };
    if (html) return { text: html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), html };
  }

  // Simple message (no multipart)
  const headerEnd = raw.indexOf('\r\n\r\n');
  const body = headerEnd >= 0 ? raw.slice(headerEnd + 4).trim() : raw;
  return { text: body };
}

// ============================================================================
// send_email Override
// ============================================================================

const sendEmailOverride: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const to = params.to as string[];
  const subject = params.subject as string;
  const body = params.body as string;
  const isHtml = params.html === true;
  const cc = params.cc as string[] | undefined;
  const bcc = params.bcc as string[] | undefined;
  const replyTo = params.replyTo as string | undefined;
  const attachments = params.attachments as string[] | undefined;
  const priority = (params.priority as string) || 'normal';

  if (!to || to.length === 0) {
    return { content: { error: 'At least one recipient is required' }, isError: true };
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  for (const email of [...to, ...(cc ?? []), ...(bcc ?? [])]) {
    if (!emailRegex.test(email) || /[\r\n\x00-\x1f]/.test(email)) {
      return { content: { error: `Invalid email address: ${email}` }, isError: true };
    }
  }

  const smtpConfig = getSmtpConfig();
  if (!smtpConfig) {
    return { content: { error: SMTP_NOT_CONFIGURED }, isError: true };
  }

  try {
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: { user: smtpConfig.user, pass: smtpConfig.pass },
    });

    // Build message
    const sanitize = (v: string) => v.replace(/[\r\n]/g, '');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message: Record<string, any> = {
      from: smtpConfig.from,
      to: to.join(', '),
      subject: sanitize(subject),
      [isHtml ? 'html' : 'text']: body,
    };

    if (cc?.length) message.cc = cc.join(', ');
    if (bcc?.length) message.bcc = bcc.join(', ');
    if (replyTo) message.replyTo = sanitize(replyTo);

    if (priority === 'high') {
      message.priority = 'high';
      message.headers = { 'X-Priority': '1' };
    } else if (priority === 'low') {
      message.priority = 'low';
      message.headers = { 'X-Priority': '5' };
    }

    // Attachments
    if (attachments?.length) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const attachmentList: Array<{ filename: string; path: string }> = [];
      for (const filePath of attachments) {
        try {
          await fs.access(filePath);
          attachmentList.push({ filename: path.basename(filePath), path: filePath });
        } catch {
          return { content: { error: `Attachment not found: ${filePath}` }, isError: true };
        }
      }
      message.attachments = attachmentList;
    }

    const info = await transport.sendMail(message as Parameters<typeof transport.sendMail>[0]);
    log.info(`Email sent: ${info.messageId} → ${to.join(', ')}`);

    return {
      content: {
        success: true,
        messageId: info.messageId,
        to,
        subject,
        cc,
        bcc,
        attachmentCount: attachments?.length ?? 0,
      },
      isError: false,
    };
  } catch (error) {
    return { content: { error: `Failed to send email: ${getErrorMessage(error)}` }, isError: true };
  }
};

// ============================================================================
// list_emails Override
// ============================================================================

const listEmailsOverride: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const folder = (params.folder as string) || 'INBOX';
  const limit = Math.min((params.limit as number) || 20, 100);
  const unreadOnly = params.unreadOnly === true;
  const fromFilter = params.from as string | undefined;
  const subjectFilter = params.subject as string | undefined;
  const since = params.since as string | undefined;
  const before = params.before as string | undefined;

  try {
    return await withImapClient(folder, async (client) => {
      // Build search criteria
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const criteria: Record<string, any> = {};
      if (unreadOnly) criteria.unseen = true;
      if (fromFilter) criteria.from = fromFilter;
      if (subjectFilter) criteria.subject = subjectFilter;
      if (since) criteria.since = new Date(since);
      if (before) criteria.before = new Date(before);

      let fetchRange: string;
      const hasCriteria = Object.keys(criteria).length > 0;

      if (hasCriteria) {
        const uids = await client.search(criteria, { uid: true });
        if (uids.length === 0) {
          return { content: { emails: [], total: 0, folder }, isError: false };
        }
        // Take the most recent UIDs (higher = newer)
        const recentUids = uids.sort((a: number, b: number) => b - a).slice(0, limit);
        fetchRange = recentUids.join(',');
      } else {
        // No criteria — get most recent by sequence number
        const mailbox = client.mailbox;
        const total = mailbox?.exists ?? 0;
        if (total === 0) {
          return { content: { emails: [], total: 0, folder }, isError: false };
        }
        const startSeq = Math.max(1, total - limit + 1);
        fetchRange = `${startSeq}:*`;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const emails: any[] = [];
      for await (const msg of client.fetch(fetchRange, { envelope: true, flags: true, uid: true })) {
        emails.push({
          uid: msg.uid,
          from: formatAddress(msg.envelope?.from),
          to: formatAddress(msg.envelope?.to),
          subject: msg.envelope?.subject ?? '(no subject)',
          date: msg.envelope?.date?.toISOString() ?? null,
          isRead: msg.flags?.has('\\Seen') ?? false,
          isFlagged: msg.flags?.has('\\Flagged') ?? false,
          messageId: msg.envelope?.messageId ?? null,
        });
      }

      // Sort by date descending (most recent first)
      emails.sort((a, b) => {
        if (!a.date || !b.date) return 0;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      return {
        content: { emails: emails.slice(0, limit), total: emails.length, folder },
        isError: false,
      };
    });
  } catch (error) {
    return { content: { error: `Failed to list emails: ${getErrorMessage(error)}` }, isError: true };
  }
};

// ============================================================================
// read_email Override
// ============================================================================

const readEmailOverride: ToolExecutor = async (params, context): Promise<ToolExecutionResult> => {
  const emailUid = params.id as string;
  const folder = (params.folder as string) || 'INBOX';
  const _downloadAttachments = params.downloadAttachments === true;
  const _attachmentDir = params.attachmentDir as string | undefined;
  const markAsRead = params.markAsRead !== false;

  if (!emailUid) {
    return { content: { error: 'Email ID (uid) is required' }, isError: true };
  }

  try {
    return await withImapClient(folder, async (client) => {
      const uid = parseInt(emailUid, 10);

      // Fetch envelope and flags
      let envelope = null;
      let flags = null;
      for await (const msg of client.fetch(uid.toString(), { envelope: true, flags: true, bodyStructure: true, uid: true })) {
        envelope = msg.envelope;
        flags = msg.flags;
      }

      if (!envelope) {
        return { content: { error: `Email not found: UID ${emailUid}` }, isError: true };
      }

      // Download full message source for body extraction
      const download = await client.download(uid.toString(), undefined, { uid: true });
      const chunks: Buffer[] = [];
      for await (const chunk of download.content) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const rawSource = Buffer.concat(chunks).toString('utf-8');
      const { text, html } = extractTextFromRaw(rawSource);

      // Mark as read
      if (markAsRead && !flags?.has('\\Seen')) {
        try {
          await client.messageFlagsAdd(uid.toString(), ['\\Seen'], { uid: true });
        } catch {
          // Non-fatal — some servers don't allow flag changes
        }
      }

      return {
        content: {
          uid: emailUid,
          from: formatAddress(envelope.from),
          to: formatAddress(envelope.to),
          cc: formatAddress(envelope.cc),
          subject: envelope.subject ?? '(no subject)',
          date: envelope.date?.toISOString() ?? null,
          messageId: envelope.messageId ?? null,
          inReplyTo: envelope.inReplyTo ?? null,
          isRead: flags?.has('\\Seen') ?? false,
          isFlagged: flags?.has('\\Flagged') ?? false,
          body: text,
          html: html ?? undefined,
        },
        isError: false,
      };
    });
  } catch (error) {
    return { content: { error: `Failed to read email: ${getErrorMessage(error)}` }, isError: true };
  }
};

// ============================================================================
// search_emails Override
// ============================================================================

const searchEmailsOverride: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const query = params.query as string;
  const folder = params.folder as string | undefined;
  const isStarred = params.isStarred as boolean | undefined;
  const limit = Math.min((params.limit as number) || 50, 200);

  if (!query?.trim()) {
    return { content: { error: 'Search query is required' }, isError: true };
  }

  try {
    const searchFolder = folder || 'INBOX';

    return await withImapClient(searchFolder, async (client) => {
      // Build search criteria
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const criteria: Record<string, any> = { text: query };
      if (isStarred) criteria.flagged = true;

      const uids = await client.search(criteria, { uid: true });
      if (uids.length === 0) {
        return { content: { results: [], total: 0, query, folder: searchFolder }, isError: false };
      }

      // Fetch envelope data for matching UIDs (most recent first)
      const recentUids = uids.sort((a: number, b: number) => b - a).slice(0, limit);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const results: any[] = [];

      for await (const msg of client.fetch(recentUids.join(','), { envelope: true, flags: true, uid: true })) {
        results.push({
          uid: msg.uid,
          from: formatAddress(msg.envelope?.from),
          to: formatAddress(msg.envelope?.to),
          subject: msg.envelope?.subject ?? '(no subject)',
          date: msg.envelope?.date?.toISOString() ?? null,
          isRead: msg.flags?.has('\\Seen') ?? false,
          isFlagged: msg.flags?.has('\\Flagged') ?? false,
        });
      }

      results.sort((a, b) => {
        if (!a.date || !b.date) return 0;
        return new Date(b.date).getTime() - new Date(a.date).getTime();
      });

      return {
        content: { results, total: uids.length, query, folder: searchFolder },
        isError: false,
      };
    });
  } catch (error) {
    return { content: { error: `Failed to search emails: ${getErrorMessage(error)}` }, isError: true };
  }
};

// ============================================================================
// reply_email Override
// ============================================================================

const replyEmailOverride: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const emailId = params.id as string;
  const body = params.body as string;
  const isHtml = params.html === true;
  const replyAll = params.replyAll === true;
  const attachments = params.attachments as string[] | undefined;

  if (!emailId || !body) {
    return { content: { error: 'Email ID and reply body are required' }, isError: true };
  }

  const smtpConfig = getSmtpConfig();
  if (!smtpConfig) return { content: { error: SMTP_NOT_CONFIGURED }, isError: true };

  try {
    // Fetch original email metadata via IMAP
    const original = await withImapClient('INBOX', async (client) => {
      const uid = parseInt(emailId, 10);
      for await (const msg of client.fetch(uid.toString(), { envelope: true, uid: true })) {
        return msg.envelope;
      }
      return null;
    });

    if (!original) {
      return { content: { error: `Original email not found: UID ${emailId}` }, isError: true };
    }

    // Build reply
    const nodemailer = await import('nodemailer');
    const transport = nodemailer.default.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: { user: smtpConfig.user, pass: smtpConfig.pass },
    });

    const replyTo = formatAddressList(original.from);
    const allRecipients = replyAll
      ? [...new Set([...replyTo, ...formatAddressList(original.to), ...formatAddressList(original.cc)])]
        .filter(a => a !== smtpConfig.from && a !== smtpConfig.user)
      : replyTo;

    const replySubject = original.subject?.startsWith('Re:')
      ? original.subject
      : `Re: ${original.subject ?? ''}`;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const message: Record<string, any> = {
      from: smtpConfig.from,
      to: allRecipients.join(', '),
      subject: replySubject.replace(/[\r\n]/g, ''),
      [isHtml ? 'html' : 'text']: body,
      inReplyTo: original.messageId,
      references: original.messageId,
    };

    // Attachments
    if (attachments?.length) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const attachmentList: Array<{ filename: string; path: string }> = [];
      for (const filePath of attachments) {
        try {
          await fs.access(filePath);
          attachmentList.push({ filename: path.basename(filePath), path: filePath });
        } catch {
          return { content: { error: `Attachment not found: ${filePath}` }, isError: true };
        }
      }
      message.attachments = attachmentList;
    }

    const info = await transport.sendMail(message as Parameters<typeof transport.sendMail>[0]);
    log.info(`Reply sent: ${info.messageId} → ${allRecipients.join(', ')}`);

    return {
      content: {
        success: true,
        messageId: info.messageId,
        to: allRecipients,
        subject: replySubject,
        replyAll,
        originalId: emailId,
      },
      isError: false,
    };
  } catch (error) {
    return { content: { error: `Failed to reply: ${getErrorMessage(error)}` }, isError: true };
  }
};

// ============================================================================
// delete_email Override
// ============================================================================

const deleteEmailOverride: ToolExecutor = async (params, _context): Promise<ToolExecutionResult> => {
  const emailId = params.id as string;
  const folder = (params.folder as string) || 'INBOX';
  const permanent = params.permanent === true;

  if (!emailId) {
    return { content: { error: 'Email ID (uid) is required' }, isError: true };
  }

  try {
    return await withImapClient(folder, async (client) => {
      const uid = parseInt(emailId, 10);

      if (permanent) {
        await client.messageDelete(uid.toString(), { uid: true });
        log.info(`Email permanently deleted: UID ${emailId}`);
      } else {
        // Move to Trash (try common trash folder names)
        const trashFolders = ['Trash', '[Gmail]/Trash', 'Deleted Items', 'Deleted Messages'];
        let moved = false;
        for (const trash of trashFolders) {
          try {
            await client.messageMove(uid.toString(), trash, { uid: true });
            moved = true;
            break;
          } catch {
            // Try next trash folder name
          }
        }
        if (!moved) {
          // Fall back to adding \\Deleted flag
          await client.messageFlagsAdd(uid.toString(), ['\\Deleted'], { uid: true });
        }
        log.info(`Email moved to trash: UID ${emailId}`);
      }

      return {
        content: {
          success: true,
          action: permanent ? 'permanently_deleted' : 'moved_to_trash',
          uid: emailId,
          folder,
        },
        isError: false,
      };
    });
  } catch (error) {
    return { content: { error: `Failed to delete email: ${getErrorMessage(error)}` }, isError: true };
  }
};

// ============================================================================
// Registration
// ============================================================================

function tryUpdateExecutor(registry: ToolRegistry, name: string, executor: ToolExecutor): void {
  if (registry.updateExecutor(name, executor)) {
    log.info(`Overrode ${name}`);
  } else if (registry.updateExecutor(`core.${name}`, executor)) {
    log.info(`Overrode core.${name}`);
  }
}

export async function registerEmailOverrides(registry: ToolRegistry): Promise<void> {
  tryUpdateExecutor(registry, 'send_email', sendEmailOverride);
  tryUpdateExecutor(registry, 'list_emails', listEmailsOverride);
  tryUpdateExecutor(registry, 'read_email', readEmailOverride);
  tryUpdateExecutor(registry, 'search_emails', searchEmailsOverride);
  tryUpdateExecutor(registry, 'reply_email', replyEmailOverride);
  tryUpdateExecutor(registry, 'delete_email', deleteEmailOverride);

  // Register Config Center services (async, non-blocking)
  ensureEmailServices().catch((err) => log.debug('ensureEmailServices:', getErrorMessage(err)));
}
