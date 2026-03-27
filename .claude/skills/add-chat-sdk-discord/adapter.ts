import { createDiscordAdapter } from '@chat-adapter/discord';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('discord', () => {
  if (!process.env.CSDK_DISCORD_BOT_TOKEN) return null;
  return createDiscordAdapter({
    botToken: process.env.CSDK_DISCORD_BOT_TOKEN,
    publicKey: process.env.CSDK_DISCORD_PUBLIC_KEY!,
  });
});
