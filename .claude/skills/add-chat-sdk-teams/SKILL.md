---
name: add-chat-sdk-teams
description: "Add Microsoft Teams as a channel via the Chat SDK adapter bridge."
---

# Add Teams (Chat SDK)

Adds Microsoft Teams to NanoClaw via the Chat SDK adapter bridge.

## Phase 1: Pre-flight

Check if `src/channels/adapters/teams.ts` exists. If it does, skip to Phase 3.

## Phase 2: Apply Code

### Install the adapter package

```bash
npm install @chat-adapter/teams
```

### Copy the adapter file

Copy the co-located `adapter.ts` from this skill's directory to the adapters folder:

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-teams/adapter.ts src/channels/adapters/teams.ts
```

### Enable imports

In `src/channels/index.ts`, add these lines (if not already present) in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/teams.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Create a Teams Bot

If the user doesn't have a Teams app:

> 1. Go to [Azure Portal](https://portal.azure.com) > **Azure Bot** > **Create**
> 2. Create a Bot Channel Registration
> 3. Note the **App ID** and generate an **App Password** (client secret)
> 4. Under Channels, enable **Microsoft Teams**
> 5. Set the messaging endpoint to `https://<your-host>:3002/webhook/teams`

### Configure environment

Add to `.env`:

```
CSDK_TEAMS_APP_ID=<app-id>
CSDK_TEAMS_APP_PASSWORD=<app-password>
WEBHOOK_PORT=3002
```

Sync: `mkdir -p data/env && cp .env data/env/env`

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
# Linux: systemctl --user restart nanoclaw
```

## Phase 4: Register

When the first message arrives, the JID will be logged. Register it:

```bash
npx tsx setup/index.ts --step register -- --jid "csdk:teams:<thread-id>" --name "<chat-name>" --folder "teams_main" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Removal

1. Delete `src/channels/adapters/teams.ts`
2. Remove the `import './adapters/teams.js'` line from `src/channels/index.ts`
3. Remove `CSDK_TEAMS_*` env vars from `.env`
4. `npm uninstall @chat-adapter/teams`
5. Rebuild and restart
