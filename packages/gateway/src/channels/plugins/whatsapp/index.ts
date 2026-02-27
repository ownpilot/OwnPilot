/**
 * WhatsApp Channel Plugin (Baileys)
 *
 * Registers WhatsApp as a channel plugin using @whiskeysockets/baileys.
 * Connects via WhatsApp Web protocol with QR code authentication.
 * No Meta Business account needed — works with personal WhatsApp accounts.
 */

import { createChannelPlugin, type PluginCapability, type PluginPermission } from '@ownpilot/core';
import { WhatsAppChannelAPI } from './whatsapp-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildWhatsAppChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.whatsapp',
      name: 'WhatsApp',
      version: '2.0.0',
      description: 'Connect to WhatsApp via QR code scan — no Meta Business account needed',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '💬',
      requiredServices: [
        {
          name: 'whatsapp_baileys',
          displayName: 'WhatsApp',
          category: 'channels',
          docsUrl: 'https://github.com/WhiskeySockets/Baileys',
          configSchema: [
            {
              name: 'allowed_users',
              label: 'Allowed Phone Numbers',
              type: 'string',
              description:
                'Comma-separated phone numbers in international format (empty = allow all)',
              placeholder: '14155551234, 905551234567',
              order: 0,
            },
          ],
        },
      ],
    })
    .platform('whatsapp')
    .channelApi((config) => {
      const resolvedConfig = {
        ...config,
        allowed_users:
          (config.allowed_users as string) ??
          (configServicesRepo.getFieldValue('whatsapp_baileys', 'allowed_users') as string) ??
          '',
      };
      return new WhatsAppChannelAPI(resolvedConfig, 'channel.whatsapp');
    })
    .tool(
      {
        name: 'channel_whatsapp_send',
        description: 'Send a message to a WhatsApp user via the connected account',
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
