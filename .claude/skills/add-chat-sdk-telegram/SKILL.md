---
name: add-chat-sdk-telegram
description: "Add an additional Telegram bot via the Chat SDK adapter bridge."
---

# Add Telegram (Chat SDK)

Adds a Telegram bot to NanoClaw via the Chat SDK adapter bridge. Uses long-polling (no webhook needed).

## Phase 1: Pre-flight

Check if `src/channels/adapters/telegram.ts` exists. If it does, skip to Phase 3.

## Phase 2: Apply Code

### Install the adapter package

```bash
npm install @chat-adapter/telegram
```

### Copy the adapter file

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-telegram/adapter.ts src/channels/adapters/telegram.ts
```

### Enable imports

In `src/channels/index.ts`, add these lines in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/telegram.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Create a Telegram Bot

> 1. Open Telegram > search for `@BotFather`
> 2. Send `/newbot` and follow prompts
> 3. Copy the bot token

No webhook needed — this adapter uses long-polling.

### Configure environment

Add to `.env`:

```
CSDK_TELEGRAM_BOT_TOKEN=<bot-token>
```

Sync: `mkdir -p data/env && cp .env data/env/env`

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

## Phase 4: Register

Send a message to your bot. The JID will be logged. Register it:

```bash
npx tsx setup/index.ts --step register -- --jid "csdk:telegram:<thread-id>" --name "<bot-name>" --folder "tg_csdk" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Removal

1. Delete `src/channels/adapters/telegram.ts`
2. Remove the `import './adapters/telegram.js'` line from `src/channels/index.ts`
3. Remove `CSDK_TELEGRAM_*` env vars from `.env`
4. `npm uninstall @chat-adapter/telegram`
5. Rebuild and restart
