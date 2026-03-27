---
name: add-chat-sdk-webex
description: "Add Cisco Webex as a channel via the Chat SDK adapter bridge. Supports spaces, threads, and adaptive cards."
---

# Add Webex (Chat SDK)

Adds Cisco Webex to NanoClaw via the Chat SDK adapter bridge.

## Phase 1: Pre-flight

Check if `src/channels/adapters/webex.ts` exists. If it does, skip to Phase 3.

## Phase 2: Apply Code

### Install the adapter package

```bash
npm install @bitbasti/chat-adapter-webex
```

### Copy the adapter file

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-webex/adapter.ts src/channels/adapters/webex.ts
```

### Enable imports

In `src/channels/index.ts`, add these lines in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/webex.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Create a Webex Bot

> 1. Go to [developer.webex.com](https://developer.webex.com) > My Apps > Create a Bot
> 2. Copy the **Bot Access Token**
> 3. Set up a webhook pointing to `https://<your-host>:3002/webhook/webex`
> 4. Note the **Webhook Secret**

### Configure environment

Add to `.env`:

```
CSDK_WEBEX_BOT_TOKEN=<bot-access-token>
CSDK_WEBEX_WEBHOOK_SECRET=<webhook-secret>
WEBHOOK_PORT=3002
```

Sync: `mkdir -p data/env && cp .env data/env/env`

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

## Phase 4: Register

When the first message arrives, register the JID:

```bash
npx tsx setup/index.ts --step register -- --jid "csdk:webex:<thread-id>" --name "<space-name>" --folder "webex_main" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Removal

1. Delete `src/channels/adapters/webex.ts`
2. Remove the `import './adapters/webex.js'` line from `src/channels/index.ts`
3. Remove `CSDK_WEBEX_*` env vars from `.env`
4. `npm uninstall @bitbasti/chat-adapter-webex`
5. Rebuild and restart
