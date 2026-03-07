/**
 * SOR File Download Route
 *
 * Serves SOR binary files that were written to disk by the WhatsApp channel plugin.
 * Auth is enforced automatically by the global /api/v1/* middleware in app.ts.
 */

import { Hono } from 'hono';
import fs from 'fs/promises';
import path from 'path';
import { ChannelMessagesRepository } from '../db/repositories/channel-messages.js';
import { apiError } from './helpers.js';

export const sorFilesRoutes = new Hono();

sorFilesRoutes.get('/:messageId', async (c) => {
  const messageId = c.req.param('messageId');
  const messagesRepo = new ChannelMessagesRepository();

  const message = await messagesRepo.getById(messageId);
  if (!message) {
    return apiError(c, 'Message not found', 404);
  }

  const attachment = message.attachments?.[0];
  const localPath = attachment?.local_path;
  if (!localPath) {
    return apiError(c, 'File not available on disk', 404);
  }

  try {
    const data = await fs.readFile(localPath);
    const filename = path.basename(localPath);
    c.header('Content-Disposition', `attachment; filename="${filename}"`);
    c.header('Content-Type', 'application/octet-stream');
    return c.body(data);
  } catch {
    return apiError(c, 'File not found on disk', 404);
  }
});
