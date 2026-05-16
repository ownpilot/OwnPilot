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
      capabilities: ['events'] as PluginCapability[],
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
              name: 'my_phone',
              label: 'My Phone Number',
              type: 'string',
              description:
                'Your WhatsApp number in international format without + or spaces (e.g. 905551234567)',
              placeholder: '905551234567',
              required: true,
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
        my_phone:
          (config.my_phone as string) ??
          (configServicesRepo.getFieldValue('whatsapp_baileys', 'my_phone') as string) ??
          '',
      };
      return new WhatsAppChannelAPI(resolvedConfig, 'channel.whatsapp');
    })
    .tool(
      {
        name: 'channel_whatsapp_send',
        description: 'Send a WhatsApp message to a contact or group via the connected account',
        parameters: {
          type: 'object',
          properties: {
            jid: {
              type: 'string',
              description:
                'Recipient JID. Personal chat: phone with country code suffixed by @s.whatsapp.net (e.g. 905551234567@s.whatsapp.net). Group: groupId@g.us.',
            },
            text: {
              type: 'string',
              description: 'Message text to send',
            },
          },
          required: ['jid', 'text'],
        },
      },
      async (params) => {
        const { getChannelService } = await import('@ownpilot/core');
        const service = getChannelService();
        const api = service.getChannel('channel.whatsapp');
        if (!api || api.getStatus() !== 'connected') {
          return {
            content: 'WhatsApp is not connected. Please scan the QR code first.',
          };
        }
        const msgId = await api.sendMessage({
          platformChatId: String(params.jid),
          text: String(params.text),
        });
        return {
          content: `Message sent to ${params.jid} (message ID: ${msgId})`,
        };
      }
    )
    .build();
}
