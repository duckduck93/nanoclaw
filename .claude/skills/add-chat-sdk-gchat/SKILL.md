---
name: add-chat-sdk-gchat
description: "Add Google Chat as a channel via the Chat SDK adapter bridge."
---

# Add Google Chat (Chat SDK)

Adds Google Chat to NanoClaw via the Chat SDK adapter bridge.

## Phase 1: Pre-flight

Check if `src/channels/adapters/gchat.ts` exists. If it does, skip to Phase 3.

## Phase 2: Apply Code

### Install the adapter package

```bash
npm install @chat-adapter/gchat
```

### Copy the adapter file

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-gchat/adapter.ts src/channels/adapters/gchat.ts
```

### Enable imports

In `src/channels/index.ts`, add these lines in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/gchat.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Create a Google Chat App

> 1. Go to [Google Cloud Console](https://console.cloud.google.com)
> 2. Enable the **Google Chat API**
> 3. Create a **Service Account** with Chat permissions
> 4. Download the service account JSON key
> 5. Configure the Chat App endpoint: `https://<your-host>:3002/webhook/gchat`

### Configure environment

Add to `.env`:

```
CSDK_GCHAT_CREDENTIALS=<paste-entire-service-account-json-as-one-line>
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
npx tsx setup/index.ts --step register -- --jid "csdk:gchat:<thread-id>" --name "<space-name>" --folder "gchat_main" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Removal

1. Delete `src/channels/adapters/gchat.ts`
2. Remove the `import './adapters/gchat.js'` line from `src/channels/index.ts`
3. Remove `CSDK_GCHAT_*` env vars from `.env`
4. `npm uninstall @chat-adapter/gchat`
5. Rebuild and restart
