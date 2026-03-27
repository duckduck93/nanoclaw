---
name: add-chat-sdk-slack
description: "Add an additional Slack workspace via the Chat SDK adapter bridge."
---

# Add Slack (Chat SDK)

Adds a Slack workspace to NanoClaw via the Chat SDK adapter bridge.

## Phase 1: Pre-flight

Check if `src/channels/adapters/slack.ts` exists. If it does, skip to Phase 3.

## Phase 2: Apply Code

### Install the adapter package

```bash
npm install @chat-adapter/slack
```

### Copy the adapter file

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-slack/adapter.ts src/channels/adapters/slack.ts
```

### Enable imports

In `src/channels/index.ts`, add these lines in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/slack.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Create a Slack App

> 1. [api.slack.com/apps](https://api.slack.com/apps) > Create New App
> 2. OAuth & Permissions > scopes: `chat:write`, `channels:history`, `groups:history`, `im:history`, `reactions:read`
> 3. Install to workspace > copy **Bot User OAuth Token** (`xoxb-...`)
> 4. Basic Information > copy **Signing Secret**
> 5. Event Subscriptions > Request URL: `https://<your-host>:3002/webhook/slack`
> 6. Subscribe to: `message.channels`, `message.groups`, `message.im`, `app_mention`

### Configure environment

Add to `.env`:

```
CSDK_SLACK_BOT_TOKEN=xoxb-...
CSDK_SLACK_SIGNING_SECRET=<signing-secret>
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
npx tsx setup/index.ts --step register -- --jid "csdk:slack:<thread-id>" --name "<channel-name>" --folder "slack_csdk" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Removal

1. Delete `src/channels/adapters/slack.ts`
2. Remove the `import './adapters/slack.js'` line from `src/channels/index.ts`
3. Remove `CSDK_SLACK_*` env vars from `.env`
4. `npm uninstall @chat-adapter/slack`
5. Rebuild and restart
