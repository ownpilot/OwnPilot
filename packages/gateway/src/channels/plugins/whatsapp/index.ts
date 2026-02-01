/**
 * WhatsApp Channel Plugin
 *
 * Self-hosted WhatsApp Web bridge using @whiskeysockets/baileys.
 * QR code auth flow, multi-device support, session persistence.
 */

import {
  createChannelPlugin,
  type PluginCapability,
  type PluginPermission,
} from '@ownpilot/core';
import { WhatsAppChannelAPI } from './whatsapp-api.js';

export function buildWhatsAppChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.whatsapp',
      name: 'WhatsApp',
      version: '1.0.0',
      description: 'Connect to WhatsApp via Web bridge for real-time messaging',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'events', 'storage'] as PluginCapability[],
      permissions: ['network', 'storage'] as PluginPermission[],
      icon: '💬',
      requiredServices: [
        {
          name: 'whatsapp_web',
          displayName: 'WhatsApp Web',
          category: 'channels',
          docsUrl: 'https://github.com/WhiskeySockets/Baileys',
          configSchema: [
            {
              name: 'session_id',
              label: 'Session ID',
              type: 'string',
              defaultValue: 'ownpilot-whatsapp',
              description: 'Unique session identifier for persistence',
              order: 0,
            },
            {
              name: 'allowed_numbers',
              label: 'Allowed Phone Numbers',
              type: 'string',
              description: 'Comma-separated phone numbers (empty = all)',
              placeholder: '1234567890,9876543210',
              order: 1,
            },
            {
              name: 'auto_read',
              label: 'Auto-mark as Read',
              type: 'boolean',
              defaultValue: true,
              description: 'Automatically mark messages as read',
              order: 2,
            },
          ],
        },
      ],
    })
    .platform('whatsapp')
    .channelApi((config) => new WhatsAppChannelAPI(config, 'channel.whatsapp'))
    .tool(
      {
        name: 'channel_whatsapp_send',
        description: 'Send a message via WhatsApp',
        parameters: {
          type: 'object',
          properties: {
            phone_number: {
              type: 'string',
              description: 'Phone number to send the message to (with country code)',
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
          return { content: 'WhatsApp is not connected. Please scan the QR code first.' };
        }
        const msgId = await api.sendMessage({
          platformChatId: String(params.phone_number),
          text: String(params.text),
        });
        return { content: `WhatsApp message sent to ${params.phone_number} (ID: ${msgId})` };
      }
    )
    .build();
}
