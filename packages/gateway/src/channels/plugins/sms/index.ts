/**
 * SMS Channel Plugin (Twilio)
 *
 * Registers SMS as a channel plugin using the Twilio REST API.
 * Provides Twilio credential configuration via Config Center and
 * exposes ChannelPluginAPI for unified channel management.
 */

import { createChannelPlugin, type PluginCapability, type PluginPermission } from '@ownpilot/core';
import { SmsChannelAPI } from './sms-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildSmsChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.sms',
      name: 'SMS (Twilio)',
      version: '1.0.0',
      description: 'SMS messaging via Twilio — send and receive text messages',
      author: { name: 'OwnPilot' },
      capabilities: ['events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '📱',
      requiredServices: [
        {
          name: 'twilio_sms',
          displayName: 'Twilio SMS',
          category: 'channels',
          docsUrl: 'https://www.twilio.com/docs/sms',
          configSchema: [
            {
              name: 'account_sid',
              label: 'Account SID',
              type: 'string' as const,
              required: true,
              description: 'Twilio Account SID from console.twilio.com',
              placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
              order: 0,
            },
            {
              name: 'auth_token',
              label: 'Auth Token',
              type: 'secret' as const,
              required: true,
              description: 'Twilio Auth Token from console.twilio.com',
              order: 1,
            },
            {
              name: 'from_number',
              label: 'From Phone Number',
              type: 'string' as const,
              required: true,
              description: 'Twilio phone number in E.164 format (e.g. +15551234567)',
              placeholder: '+15551234567',
              order: 2,
            },
            {
              name: 'webhook_path',
              label: 'Webhook Path',
              type: 'string' as const,
              description: 'Custom webhook path (default: /webhooks/sms)',
              placeholder: '/webhooks/sms',
              order: 3,
            },
          ],
        },
      ],
    })
    .platform('sms')
    .channelApi((config) => {
      const resolvedConfig = {
        ...config,
        account_sid:
          (config.account_sid as string) ??
          (configServicesRepo.getFieldValue('twilio_sms', 'account_sid') as string) ??
          '',
        auth_token:
          (config.auth_token as string) ??
          (configServicesRepo.getFieldValue('twilio_sms', 'auth_token') as string) ??
          '',
        from_number:
          (config.from_number as string) ??
          (configServicesRepo.getFieldValue('twilio_sms', 'from_number') as string) ??
          '',
      };
      return new SmsChannelAPI(resolvedConfig, 'channel.sms');
    })
    .build();
}

export { SmsChannelAPI } from './sms-api.js';
