---
name: add-chat-sdk-imessage
description: "Add iMessage as a channel via the Chat SDK adapter bridge. Supports local Mac and Photon remote iMessage integration."
---

# Add iMessage (Chat SDK)

Adds iMessage to NanoClaw via the Photon Chat SDK adapter.

**Two modes:**
- **Local**: Reads from the Mac's Messages.app directly (requires macOS + Full Disk Access)
- **Remote**: Uses Photon's cloud relay (requires Photon account)

## Phase 1: Pre-flight

Check if `src/channels/adapters/imessage.ts` exists. If it does, skip to Phase 3.

Ask the user which mode they want: local or remote (Photon).

## Phase 2: Apply Code

### Install the adapter package

```bash
npm install chat-adapter-imessage
```

### Copy the adapter file

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-imessage/adapter.ts src/channels/adapters/imessage.ts
```

### Enable imports

In `src/channels/index.ts`, add in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/imessage.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Local mode

> 1. Grant **Full Disk Access** to the terminal/process running NanoClaw (System Settings > Privacy & Security > Full Disk Access)
> 2. Messages.app must be configured and signed in with an Apple ID

Add to `.env`:

```
CSDK_IMESSAGE_ENABLED=true
CSDK_IMESSAGE_LOCAL=true
```

### Remote mode (Photon)

> 1. Sign up at Photon and get an API key
> 2. Configure your Photon relay

Add to `.env`:

```
CSDK_IMESSAGE_LOCAL=false
CSDK_IMESSAGE_SERVER_URL=<photon-server-url>
CSDK_IMESSAGE_API_KEY=<photon-api-key>
```

Sync: `mkdir -p data/env && cp .env data/env/env`

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS only
```

## Phase 4: Register

When the first message arrives, the JID will be logged. Register it:

```bash
npx tsx setup/index.ts --step register -- --jid "csdk:imessage:<thread-id>" --name "<contact-name>" --folder "imessage_main" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Removal

1. Delete `src/channels/adapters/imessage.ts`
2. Remove the `import './adapters/imessage.js'` line from `src/channels/index.ts`
3. Remove `CSDK_IMESSAGE_*` env vars from `.env`
4. `npm uninstall chat-adapter-imessage`
5. Rebuild and restart
