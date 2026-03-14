/**
 * Email Channel Plugin
 *
 * Registers Email as a channel plugin using SMTP (nodemailer) for outbound
 * and an HTTP webhook endpoint for inbound messages.
 * Provides IMAP/SMTP credential configuration via Config Center.
 */

import { createChannelPlugin, type PluginCapability, type PluginPermission } from '@ownpilot/core';
import { EmailChannelAPI } from './email-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildEmailChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.email',
      name: 'Email',
      version: '1.0.0',
      description: 'Email messaging via IMAP/SMTP — receive and send emails',
      author: { name: 'OwnPilot' },
      capabilities: ['events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '📧',
      requiredServices: [
        {
          name: 'email_channel',
          displayName: 'Email (IMAP/SMTP)',
          category: 'channels',
          description: 'Email credentials for IMAP receiving and SMTP sending',
          configSchema: [
            {
              name: 'smtp_host',
              label: 'SMTP Host',
              type: 'string',
              required: true,
              placeholder: 'smtp.gmail.com',
              order: 0,
            },
            {
              name: 'smtp_port',
              label: 'SMTP Port',
              type: 'number',
              required: true,
              defaultValue: 587,
              description: 'Use 587 for STARTTLS or 465 for SSL',
              order: 1,
            },
            {
              name: 'smtp_user',
              label: 'SMTP Username',
              type: 'string',
              required: true,
              placeholder: 'user@example.com',
              order: 2,
            },
            {
              name: 'smtp_pass',
              label: 'SMTP Password',
              type: 'secret',
              required: true,
              description: 'SMTP password or app-specific password',
              order: 3,
            },
            {
              name: 'from_address',
              label: 'From Email Address',
              type: 'string',
              required: true,
              description: 'Email address to send from',
              placeholder: 'assistant@example.com',
              order: 4,
            },
            {
              name: 'imap_host',
              label: 'IMAP Host',
              type: 'string',
              description: 'IMAP host for future inbound polling (not currently used — inbound via webhook)',
              placeholder: 'imap.gmail.com',
              order: 5,
            },
            {
              name: 'imap_port',
              label: 'IMAP Port',
              type: 'number',
              defaultValue: 993,
              description: 'IMAP port (reserved for future use)',
              order: 6,
            },
            {
              name: 'imap_user',
              label: 'IMAP Username',
              type: 'string',
              description: 'IMAP username (reserved for future use)',
              order: 7,
            },
            {
              name: 'imap_pass',
              label: 'IMAP Password',
              type: 'secret',
              description: 'IMAP password (reserved for future use)',
              order: 8,
            },
          ],
        },
      ],
    })
    .platform('email')
    .channelApi((config) => {
      const resolvedConfig = {
        ...config,
        smtp_host:
          (config.smtp_host as string) ??
          (configServicesRepo.getFieldValue('email_channel', 'smtp_host') as string) ??
          '',
        smtp_port:
          (config.smtp_port as number) ??
          (configServicesRepo.getFieldValue('email_channel', 'smtp_port') as number) ??
          587,
        smtp_user:
          (config.smtp_user as string) ??
          (configServicesRepo.getFieldValue('email_channel', 'smtp_user') as string) ??
          '',
        smtp_pass:
          (config.smtp_pass as string) ??
          (configServicesRepo.getFieldValue('email_channel', 'smtp_pass') as string) ??
          '',
        from_address:
          (config.from_address as string) ??
          (configServicesRepo.getFieldValue('email_channel', 'from_address') as string) ??
          '',
      };
      return new EmailChannelAPI(resolvedConfig, 'channel.email');
    })
    .build();
}

export { EmailChannelAPI } from './email-api.js';
