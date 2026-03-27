import { createBaileysAdapter } from 'chat-adapter-baileys';
import { useMultiFileAuthState } from 'baileys';

import { registerChatAdapter } from '../adapter-registry.js';

registerChatAdapter('baileys', () => {
  const authDir = process.env.CSDK_BAILEYS_AUTH_DIR;
  if (!authDir) return null;

  // Auth state is loaded asynchronously — the adapter handles this in connect()
  let authState: Awaited<ReturnType<typeof useMultiFileAuthState>> | null = null;

  const adapter = createBaileysAdapter({
    get auth() {
      if (!authState) throw new Error('Auth state not yet loaded');
      return { state: authState.state, saveCreds: authState.saveCreds };
    },
    onQR: async (qr) => {
      // Log QR to console for scanning
      console.log('Scan this QR code in WhatsApp:');
      console.log(qr);
    },
    phoneNumber: process.env.CSDK_BAILEYS_PHONE_NUMBER,
  });

  // Patch: load auth state before connect
  const origConnect = adapter.connect.bind(adapter);
  adapter.connect = async () => {
    authState = await useMultiFileAuthState(authDir);
    return origConnect();
  };

  return adapter;
});
