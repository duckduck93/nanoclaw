import { createResendAdapter } from '@resend/chat-sdk-adapter';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('resend', () => {
  const fromAddress = process.env.CSDK_RESEND_FROM_ADDRESS;
  if (!fromAddress) return null;
  return createResendAdapter({
    fromAddress,
    fromName: process.env.CSDK_RESEND_FROM_NAME,
    apiKey: process.env.CSDK_RESEND_API_KEY,
    webhookSecret: process.env.CSDK_RESEND_WEBHOOK_SECRET,
  });
});
