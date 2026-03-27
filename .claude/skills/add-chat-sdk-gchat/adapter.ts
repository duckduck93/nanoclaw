import { createGoogleChatAdapter } from '@chat-adapter/gchat';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('gchat', () => {
  const creds = process.env.CSDK_GCHAT_CREDENTIALS;
  if (!creds) return null;
  return createGoogleChatAdapter({
    credentials: JSON.parse(creds),
  });
});
