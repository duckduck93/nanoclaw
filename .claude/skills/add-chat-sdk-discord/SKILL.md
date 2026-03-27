---
name: add-chat-sdk-discord
description: "Add an additional Discord bot via the Chat SDK adapter bridge."
---

# Add Discord (Chat SDK)

Adds a Discord bot to NanoClaw via the Chat SDK adapter bridge.

## Phase 1: Pre-flight

Check if `src/channels/adapters/discord.ts` exists. If it does, skip to Phase 3.

## Phase 2: Apply Code

### Install the adapter package

```bash
npm install @chat-adapter/discord
```

### Copy the adapter file

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-discord/adapter.ts src/channels/adapters/discord.ts
```

### Enable imports

In `src/channels/index.ts`, add these lines in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/discord.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Create a Discord Bot

> 1. [discord.com/developers/applications](https://discord.com/developers/applications) > New Application
> 2. Bot > create bot > copy **Token**
> 3. General Information > copy **Public Key**
> 4. Bot > enable **Message Content Intent**
> 5. Interactions Endpoint URL: `https://<your-host>:3002/webhook/discord`
> 6. Invite bot to your server with appropriate permissions

### Configure environment

Add to `.env`:

```
CSDK_DISCORD_BOT_TOKEN=<bot-token>
CSDK_DISCORD_PUBLIC_KEY=<public-key>
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
npx tsx setup/index.ts --step register -- --jid "csdk:discord:<thread-id>" --name "<server-name>" --folder "discord_csdk" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Removal

1. Delete `src/channels/adapters/discord.ts`
2. Remove the `import './adapters/discord.js'` line from `src/channels/index.ts`
3. Remove `CSDK_DISCORD_*` env vars from `.env`
4. `npm uninstall @chat-adapter/discord`
5. Rebuild and restart
