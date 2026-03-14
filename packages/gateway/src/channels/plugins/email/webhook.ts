/**
 * Email Inbound Webhook Handler
 *
 * HTTP webhook for receiving inbound emails from services like
 * SendGrid Inbound Parse, Mailgun Routes, or a custom forwarder.
 *
 * Supports common formats:
 * - SendGrid Inbound Parse (multipart/form-data with 'from', 'to', 'subject', 'text', 'html')
 * - Mailgun (similar format)
 * - Generic JSON POST with { from, to, subject, text }
 */

import { randomUUID } from 'node:crypto';
import type { ChannelIncomingMessage } from '@ownpilot/core';
import { getChannelServiceImpl } from '../../service-impl.js';
import { getLog } from '../../../services/log.js';

const log = getLog('Email-Webhook');

/**
 * Extract email address from "Display Name <email@example.com>" format.
 * Returns { email, displayName }.
 */
function parseEmailAddress(raw: string): { email: string; displayName: string } {
  const match = raw.match(/<([^>]+)>/);
  if (match) {
    return {
      email: match[1]!,
      displayName: raw.replace(/<[^>]+>/, '').trim() || match[1]!,
    };
  }
  return { email: raw.trim(), displayName: raw.trim() };
}

/**
 * Process a parsed inbound email payload and forward it to the channel service.
 * Used by the webhook route handler.
 */
export async function processInboundEmail(payload: {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId?: string;
  inReplyTo?: string;
}): Promise<void> {
  const { email: senderEmail, displayName: senderName } = parseEmailAddress(payload.from);

  if (!payload.text.trim()) {
    log.debug('Empty email ignored', { from: payload.from });
    return;
  }

  const incomingMessage: ChannelIncomingMessage = {
    id: `channel.email:${payload.messageId || randomUUID()}`,
    channelPluginId: 'channel.email',
    platform: 'email',
    platformChatId: senderEmail, // email address is the chat ID
    sender: {
      platformUserId: senderEmail,
      platform: 'email',
      displayName: senderName,
    },
    text: payload.text.trim(),
    replyToId: payload.inReplyTo || undefined,
    timestamp: new Date(),
    metadata: {
      subject: payload.subject,
      to: payload.to,
      messageId: payload.messageId,
      inReplyTo: payload.inReplyTo || undefined,
    },
  };

  const serviceImpl = getChannelServiceImpl();
  if (serviceImpl) {
    await serviceImpl.processIncomingMessage(incomingMessage);
  } else {
    log.error('ChannelServiceImpl not available');
  }
}
