import { createSlackAdapter } from '@chat-adapter/slack';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('slack', () => {
  if (!process.env.CSDK_SLACK_BOT_TOKEN) return null;
  return createSlackAdapter({
    botToken: process.env.CSDK_SLACK_BOT_TOKEN,
    signingSecret: process.env.CSDK_SLACK_SIGNING_SECRET,
  });
});
