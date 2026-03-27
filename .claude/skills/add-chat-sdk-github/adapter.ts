import { createGitHubAdapter } from '@chat-adapter/github';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('github', () => {
  if (!process.env.CSDK_GITHUB_TOKEN) return null;
  return createGitHubAdapter({
    token: process.env.CSDK_GITHUB_TOKEN,
    webhookSecret: process.env.CSDK_GITHUB_WEBHOOK_SECRET,
  });
});
