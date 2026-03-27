import { createiMessageAdapter } from 'chat-adapter-imessage';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('imessage', () => {
  const isLocal = process.env.CSDK_IMESSAGE_LOCAL !== 'false';

  // In remote mode, require server URL
  if (!isLocal && !process.env.CSDK_IMESSAGE_SERVER_URL) return null;
  // In local mode, just need the env var to exist as a signal
  if (isLocal && !process.env.CSDK_IMESSAGE_ENABLED) return null;

  return createiMessageAdapter({
    local: isLocal,
    serverUrl: process.env.CSDK_IMESSAGE_SERVER_URL,
    apiKey: process.env.CSDK_IMESSAGE_API_KEY,
  });
});
