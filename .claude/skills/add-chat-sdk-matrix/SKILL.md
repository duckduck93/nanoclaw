---
name: add-chat-sdk-matrix
description: "Add Matrix (Beeper) as a channel via the Chat SDK adapter bridge. Vendor-maintained by Beeper."
---

# Add Matrix / Beeper (Chat SDK)

Adds Matrix protocol support to NanoClaw via Beeper's official Chat SDK adapter. Works with any Matrix homeserver or Beeper. Supports E2EE, room invites, and message history.

## Phase 1: Pre-flight

Check if `src/channels/adapters/matrix.ts` exists. If it does, skip to Phase 3.

## Phase 2: Apply Code

### Install the adapter package

```bash
npm install @beeper/chat-adapter-matrix
```

### Copy the adapter file

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-matrix/adapter.ts src/channels/adapters/matrix.ts
```

### Enable imports

In `src/channels/index.ts`, add in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/matrix.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Get Matrix credentials

> **Access token auth (recommended):**
> 1. Log in to your Matrix homeserver with a bot account
> 2. Get the access token (Element: Settings > Help & About > Advanced > Access Token)
>
> **Password auth (alternative):**
> 1. Create a bot account on your homeserver
> 2. Use username + password directly

### Configure environment

Add to `.env`:

```
CSDK_MATRIX_BASE_URL=https://matrix.example.com
CSDK_MATRIX_ACCESS_TOKEN=<access-token>
CSDK_MATRIX_USER_ID=@bot:example.com
CSDK_MATRIX_BOT_USERNAME=bot
```

Sync: `mkdir -p data/env && cp .env data/env/env`

No webhook needed — the Matrix adapter uses the Matrix sync protocol (long-polling).

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

## Phase 4: Register

Invite the bot to a room and send a message. The JID will be logged. Register it:

```bash
npx tsx setup/index.ts --step register -- --jid "csdk:matrix:<thread-id>" --name "<room-name>" --folder "matrix_main" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Removal

1. Delete `src/channels/adapters/matrix.ts`
2. Remove the `import './adapters/matrix.js'` line from `src/channels/index.ts`
3. Remove `CSDK_MATRIX_*` env vars from `.env`
4. `npm uninstall @beeper/chat-adapter-matrix`
5. Rebuild and restart
