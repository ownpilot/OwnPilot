/**
 * WhatsApp Channel Plugin
 *
 * Registers WhatsApp as a channel plugin using Meta Cloud API.
 * Provides configuration via Config Center and exposes
 * ChannelPluginAPI for unified channel management.
 *
 * Requires a Meta Business account with WhatsApp Business API access.
 */

import { createChannelPlugin, type PluginCapability, type PluginPermission } from '@ownpilot/core';
import { WhatsAppChannelAPI } from './whatsapp-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildWhatsAppChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.whatsapp',
      name: 'WhatsApp',
      version: '1.0.0',
      description: 'Connect to WhatsApp via Meta Cloud API for business messaging',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '💬',
      requiredServices: [
        {
          name: 'whatsapp_business',
          displayName: 'WhatsApp Business',
          category: 'channels',
          docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api/get-started',
          configSchema: [
            {
              name: 'access_token',
              label: 'Access Token',
              type: 'secret',
              required: true,
              description: 'Permanent system user token from Meta Business Settings',
              placeholder: 'EAABs...',
              order: 0,
            },
            {
              name: 'phone_number_id',
              label: 'Phone Number ID',
              type: 'string',
              required: true,
              description: 'WhatsApp Business phone number ID',
              placeholder: '123456789012345',
              order: 1,
            },
            {
              name: 'business_account_id',
              label: 'Business Account ID',
              type: 'string',
              description: 'WhatsApp Business Account ID (for template management)',
              placeholder: '123456789012345',
              order: 2,
            },
            {
              name: 'webhook_verify_token',
              label: 'Webhook Verify Token',
              type: 'secret',
              required: true,
              description: 'Token for webhook verification challenge (you choose this value)',
              placeholder: 'my-verify-token-123',
              order: 3,
            },
            {
              name: 'app_secret',
              label: 'App Secret',
              type: 'secret',
              description: 'Meta App Secret for webhook payload signature verification',
              placeholder: 'abc123...',
              order: 4,
            },
          ],
        },
      ],
    })
    .platform('whatsapp')
    .channelApi((config) => {
      const resolvedConfig = {
        ...config,
        access_token:
          config.access_token ??
          (configServicesRepo.getFieldValue('whatsapp_business', 'access_token') as string) ??
          '',
        phone_number_id:
          (config.phone_number_id as string) ??
          (configServicesRepo.getFieldValue('whatsapp_business', 'phone_number_id') as string) ??
          '',
        webhook_verify_token:
          (config.webhook_verify_token as string) ??
          (configServicesRepo.getFieldValue(
            'whatsapp_business',
            'webhook_verify_token'
          ) as string) ??
          '',
        app_secret:
          (config.app_secret as string) ??
          (configServicesRepo.getFieldValue('whatsapp_business', 'app_secret') as string) ??
          '',
      };
      return new WhatsAppChannelAPI(resolvedConfig, 'channel.whatsapp');
    })
    .tool(
      {
        name: 'channel_whatsapp_send',
        description: 'Send a message to a WhatsApp user via the connected business account',
        parameters: {
          type: 'object',
          properties: {
            phone_number: {
              type: 'string',
              description:
                'Recipient phone number in international format (e.g. 14155551234)',
            },
            text: {
              type: 'string',
              description: 'Message text to send',
            },
          },
          required: ['phone_number', 'text'],
        },
      },
      async (params) => {
        const { getChannelService } = await import('@ownpilot/core');
        const service = getChannelService();
        const api = service.getChannel('channel.whatsapp');
        if (!api || api.getStatus() !== 'connected') {
          return {
            content: 'WhatsApp is not connected. Please connect it first.',
          };
        }
        const msgId = await api.sendMessage({
          platformChatId: String(params.phone_number),
          text: String(params.text),
        });
        return {
          content: `Message sent to ${params.phone_number} (message ID: ${msgId})`,
        };
      }
    )
    .build();
}
