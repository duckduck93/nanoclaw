import { createMatrixAdapter } from '@beeper/chat-adapter-matrix';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('matrix', () => {
  // createMatrixAdapter() reads from MATRIX_* env vars when called without args.
  // We gate on CSDK_MATRIX_BASE_URL to know if it's configured, then set the
  // standard env vars the adapter expects.
  if (!process.env.CSDK_MATRIX_BASE_URL) return null;

  // Map CSDK_ prefixed vars to the adapter's expected env vars
  process.env.MATRIX_BASE_URL = process.env.CSDK_MATRIX_BASE_URL;
  if (process.env.CSDK_MATRIX_ACCESS_TOKEN)
    process.env.MATRIX_ACCESS_TOKEN = process.env.CSDK_MATRIX_ACCESS_TOKEN;
  if (process.env.CSDK_MATRIX_USER_ID)
    process.env.MATRIX_USER_ID = process.env.CSDK_MATRIX_USER_ID;
  if (process.env.CSDK_MATRIX_BOT_USERNAME)
    process.env.MATRIX_BOT_USERNAME = process.env.CSDK_MATRIX_BOT_USERNAME;

  return createMatrixAdapter();
});
