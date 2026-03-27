import { createTeamsAdapter } from '@chat-adapter/teams';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('teams', () => {
  if (!process.env.CSDK_TEAMS_APP_ID) return null;
  return createTeamsAdapter({
    appId: process.env.CSDK_TEAMS_APP_ID,
    appPassword: process.env.CSDK_TEAMS_APP_PASSWORD,
  });
});
