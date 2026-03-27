import { createLinearAdapter } from '@chat-adapter/linear';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('linear', () => {
  if (!process.env.CSDK_LINEAR_API_KEY) return null;
  return createLinearAdapter({
    apiKey: process.env.CSDK_LINEAR_API_KEY,
    webhookSecret: process.env.CSDK_LINEAR_WEBHOOK_SECRET,
  });
});
