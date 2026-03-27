---
name: add-chat-sdk-baileys
description: "Add WhatsApp via Baileys (unofficial API) through the Chat SDK adapter bridge. Compatible with NanoClaw's existing Baileys-based WhatsApp approach."
---

# Add WhatsApp Baileys (Chat SDK)

Adds WhatsApp via the Baileys adapter through the Chat SDK bridge. Uses the same unofficial WhatsApp Web API as NanoClaw's native WhatsApp channel.

## Phase 1: Pre-flight

Check if `src/channels/adapters/baileys.ts` exists. If it does, skip to Phase 3.

Ask the user if they want this alongside or instead of the native `/add-whatsapp` channel. If replacing, the native channel should be removed first to avoid two Baileys instances fighting over the same session.

## Phase 2: Apply Code

### Install packages

```bash
npm install chat-adapter-baileys baileys
```

### Copy the adapter file

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-baileys/adapter.ts src/channels/adapters/baileys.ts
```

### Enable imports

In `src/channels/index.ts`, add in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/baileys.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Configure environment

Add to `.env`:

```
CSDK_BAILEYS_AUTH_DIR=./data/baileys-auth
# Optional: for pairing code auth instead of QR
# CSDK_BAILEYS_PHONE_NUMBER=1234567890
```

Sync: `mkdir -p data/env && cp .env data/env/env`

### Authenticate

Start NanoClaw. The adapter will print a QR code to the console for scanning with WhatsApp. Alternatively, set `CSDK_BAILEYS_PHONE_NUMBER` (E.164 format without `+`) for pairing code auth.

Auth state is persisted to `CSDK_BAILEYS_AUTH_DIR` — subsequent restarts reconnect automatically.

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

## Phase 4: Register

When the first message arrives, the JID will be logged. Register it:

```bash
npx tsx setup/index.ts --step register -- --jid "csdk:baileys:<thread-id>" --name "<chat-name>" --folder "wa_csdk" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Notes

- WebSocket-based transport (no webhooks needed, no `WEBHOOK_PORT` required)
- Message history fetch is not supported (returns empty arrays)
- Cards render as plain-text fallback
- Auto-reconnects on unexpected disconnects

## Removal

1. Delete `src/channels/adapters/baileys.ts`
2. Remove the `import './adapters/baileys.js'` line from `src/channels/index.ts`
3. Remove `CSDK_BAILEYS_*` env vars from `.env`
4. `npm uninstall chat-adapter-baileys baileys`
5. Rebuild and restart
