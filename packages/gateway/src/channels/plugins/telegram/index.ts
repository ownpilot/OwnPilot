/**
 * Telegram Channel Plugin
 *
 * Registers Telegram as a channel plugin using grammy.
 * Provides bot token configuration via Config Center and
 * exposes ChannelPluginAPI for unified channel management.
 */

import { createChannelPlugin, type PluginCapability, type PluginPermission } from '@ownpilot/core';
import { TelegramChannelAPI } from './telegram-api.js';
import { configServicesRepo } from '../../../db/repositories/config-services.js';

export function buildTelegramChannelPlugin() {
  return createChannelPlugin()
    .meta({
      id: 'channel.telegram',
      name: 'Telegram',
      version: '1.0.0',
      description: 'Connect to Telegram via Bot API for real-time messaging',
      author: { name: 'OwnPilot' },
      capabilities: ['tools', 'events'] as PluginCapability[],
      permissions: ['network'] as PluginPermission[],
      icon: '✈️',
      requiredServices: [
        {
          name: 'telegram_bot',
          displayName: 'Telegram Bot',
          category: 'channels',
          docsUrl: 'https://core.telegram.org/bots#botfather',
          configSchema: [
            {
              name: 'bot_token',
              label: 'Bot Token',
              type: 'secret',
              required: true,
              description: 'Token from @BotFather',
              placeholder: '123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11',
              order: 0,
            },
            {
              name: 'allowed_users',
              label: 'Allowed User IDs',
              type: 'string',
              description: 'Comma-separated Telegram user IDs (empty = all)',
              placeholder: '123456789,987654321',
              order: 1,
            },
            {
              name: 'allowed_chats',
              label: 'Allowed Chat IDs',
              type: 'string',
              description: 'Comma-separated Telegram chat IDs (empty = all)',
              placeholder: '-1001234567890',
              order: 2,
            },
            {
              name: 'parse_mode',
              label: 'Message Parse Mode',
              type: 'select',
              defaultValue: 'HTML',
              options: [
                { value: 'HTML', label: 'HTML' },
                { value: 'Markdown', label: 'Markdown' },
                { value: 'MarkdownV2', label: 'MarkdownV2' },
              ],
              order: 3,
            },
            {
              name: 'webhook_url',
              label: 'Webhook Base URL',
              type: 'string',
              description:
                'Public HTTPS base URL for webhook mode (e.g. https://abc123.ngrok.io). Leave empty for polling mode.',
              placeholder: 'https://your-domain.com',
              order: 4,
            },
            {
              name: 'webhook_secret',
              label: 'Webhook Secret',
              type: 'secret',
              description:
                'Secret token for webhook URL path. Auto-generated on first webhook connect if empty.',
              placeholder: 'auto-generated',
              order: 5,
            },
          ],
        },
      ],
    })
    .platform('telegram')
    .channelApi((config) => {
      // Merge config from Config Center
      const resolvedConfig = {
        ...config,
        bot_token:
          config.bot_token ??
          (configServicesRepo.getFieldValue('telegram_bot', 'bot_token') as string) ??
          '',
        webhook_url:
          (config.webhook_url as string) ??
          (configServicesRepo.getFieldValue('telegram_bot', 'webhook_url') as string) ??
          '',
        webhook_secret:
          (config.webhook_secret as string) ??
          (configServicesRepo.getFieldValue('telegram_bot', 'webhook_secret') as string) ??
          '',
      };
      return new TelegramChannelAPI(resolvedConfig, 'channel.telegram');
    })
    .tool(
      {
        name: 'channel_telegram_send',
        description: 'Send a message to a Telegram chat via the connected bot',
        parameters: {
          type: 'object',
          properties: {
            chat_id: {
              type: 'string',
              description: 'Telegram chat ID to send the message to',
            },
            text: {
              type: 'string',
              description: 'Message text to send',
            },
          },
          required: ['chat_id', 'text'],
        },
      },
      async (params) => {
        const { getChannelService } = await import('@ownpilot/core');
        const service = getChannelService();
        const api = service.getChannel('channel.telegram');
        if (!api || api.getStatus() !== 'connected') {
          return {
            content: 'Telegram bot is not connected. Please connect it first.',
          };
        }
        const msgId = await api.sendMessage({
          platformChatId: String(params.chat_id),
          text: String(params.text),
        });
        return {
          content: `Message sent to chat ${params.chat_id} (message ID: ${msgId})`,
        };
      }
    )
    .build();
}
