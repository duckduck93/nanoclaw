import { createTelegramAdapter } from '@chat-adapter/telegram';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('telegram', () => {
  if (!process.env.CSDK_TELEGRAM_BOT_TOKEN) return null;
  return createTelegramAdapter({
    botToken: process.env.CSDK_TELEGRAM_BOT_TOKEN,
    mode: 'polling',
  });
});
