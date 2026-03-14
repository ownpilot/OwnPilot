/**
 * Email Channel API (nodemailer SMTP)
 *
 * Implements ChannelPluginAPI using nodemailer for outbound SMTP.
 * Inbound emails are received via the webhook endpoint (webhook.ts).
 */

import type {
  ChannelPluginAPI,
  ChannelConnectionStatus,
  ChannelOutgoingMessage,
  ChannelPlatform,
} from '@ownpilot/core';
import { getLog } from '../../../services/log.js';

const log = getLog('Email');

// Minimal interface for nodemailer's transporter — avoids hard dependency on @types/nodemailer
interface SmtpTransporter {
  sendMail(options: {
    from: string;
    to: string;
    subject: string;
    text: string;
    html?: string;
    inReplyTo?: string;
    references?: string;
  }): Promise<{ messageId: string }>;
  verify(): Promise<true>;
  close(): void;
}

export class EmailChannelAPI implements ChannelPluginAPI {
  private status: ChannelConnectionStatus = 'disconnected';
  private transporter: SmtpTransporter | null = null;
  private fromAddress = '';
  private readonly pluginId: string;

  constructor(
    private readonly config: Record<string, unknown>,
    pluginId: string,
  ) {
    this.pluginId = pluginId;
  }

  async connect(): Promise<void> {
    const smtpHost = String(this.config.smtp_host ?? '');
    const smtpPort = Number(this.config.smtp_port ?? 587);
    const smtpUser = String(this.config.smtp_user ?? '');
    const smtpPass = String(this.config.smtp_pass ?? '');
    this.fromAddress = String(this.config.from_address ?? '');

    if (!smtpHost || !smtpUser || !smtpPass || !this.fromAddress) {
      this.status = 'error';
      log.warn('Email channel missing SMTP credentials — configure in Config Center');
      return;
    }

    try {
      // Dynamic import of nodemailer (may not be installed)
      const nodemailer = await import('nodemailer');
      this.transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      }) as unknown as SmtpTransporter;

      // Verify connection
      await this.transporter.verify();
      this.status = 'connected';
      log.info('Email channel connected via SMTP', { host: smtpHost, from: this.fromAddress });
    } catch (error) {
      this.status = 'error';
      log.error('Failed to connect email channel', { error: String(error) });
      // If nodemailer not installed, provide helpful message
      if (
        String(error).includes('Cannot find module') ||
        String(error).includes('MODULE_NOT_FOUND')
      ) {
        log.error('nodemailer not installed. Run: pnpm add nodemailer');
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.transporter) {
      this.transporter.close();
      this.transporter = null;
    }
    this.status = 'disconnected';
    log.info('Email channel disconnected');
  }

  async sendMessage(message: ChannelOutgoingMessage): Promise<string> {
    if (this.status !== 'connected' || !this.transporter) {
      throw new Error('Email channel not connected');
    }

    const toAddress = message.platformChatId; // email address is the chat ID
    const subject = (message.options?.subject as string) ?? 'Re: OwnPilot';
    const text = message.text;

    try {
      const result = await this.transporter.sendMail({
        from: this.fromAddress,
        to: toAddress,
        subject,
        text,
        html: `<div style="font-family: sans-serif; line-height: 1.5;">${text.replace(/\n/g, '<br>')}</div>`,
        inReplyTo: message.replyToId,
        references: message.replyToId,
      });

      log.info('Email sent', { to: toAddress, messageId: result.messageId });
      return result.messageId;
    } catch (error) {
      log.error('Failed to send email', { error: String(error), to: toAddress });
      throw error;
    }
  }

  getStatus(): ChannelConnectionStatus {
    return this.status;
  }

  getPlatform(): ChannelPlatform {
    return 'email';
  }

  async sendTyping(_platformChatId: string): Promise<void> {
    // Email doesn't support typing indicators — no-op
  }

  /** Get from address for webhook processing */
  getFromAddress(): string {
    return this.fromAddress;
  }

  /** Get plugin ID */
  getPluginId(): string {
    return this.pluginId;
  }
}
