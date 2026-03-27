---
name: add-chat-sdk-linear
description: "Add Linear as a channel via the Chat SDK adapter bridge."
---

# Add Linear (Chat SDK)

Adds Linear issue tracking to NanoClaw via the Chat SDK adapter bridge.

## Phase 1: Pre-flight

Check if `src/channels/adapters/linear.ts` exists. If it does, skip to Phase 3.

## Phase 2: Apply Code

### Install the adapter package

```bash
npm install @chat-adapter/linear
```

### Copy the adapter file

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-linear/adapter.ts src/channels/adapters/linear.ts
```

### Enable imports

In `src/channels/index.ts`, add these lines in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/linear.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Get credentials

> 1. Linear > Settings > API > Personal API keys > Create
> 2. Linear > Settings > API > Webhooks > Add webhook > URL: `https://<your-host>:3002/webhook/linear`

### Configure environment

Add to `.env`:

```
CSDK_LINEAR_API_KEY=lin_api_...
CSDK_LINEAR_WEBHOOK_SECRET=<signing-secret>
WEBHOOK_PORT=3002
```

Sync: `mkdir -p data/env && cp .env data/env/env`

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

## Phase 4: Register

When the first webhook arrives, register the JID:

```bash
npx tsx setup/index.ts --step register -- --jid "csdk:linear:<thread-id>" --name "<team-name>" --folder "linear_main" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Removal

1. Delete `src/channels/adapters/linear.ts`
2. Remove the `import './adapters/linear.js'` line from `src/channels/index.ts`
3. Remove `CSDK_LINEAR_*` env vars from `.env`
4. `npm uninstall @chat-adapter/linear`
5. Rebuild and restart
