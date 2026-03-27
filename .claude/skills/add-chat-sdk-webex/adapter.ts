import { createWebexAdapter } from '@bitbasti/chat-adapter-webex';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('webex', () => {
  if (!process.env.CSDK_WEBEX_BOT_TOKEN) return null;
  return createWebexAdapter({
    botToken: process.env.CSDK_WEBEX_BOT_TOKEN,
    webhookSecret: process.env.CSDK_WEBEX_WEBHOOK_SECRET,
  });
});
