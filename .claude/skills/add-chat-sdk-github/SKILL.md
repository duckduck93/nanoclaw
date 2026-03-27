---
name: add-chat-sdk-github
description: "Add GitHub Issues/Discussions as a channel via the Chat SDK adapter bridge."
---

# Add GitHub (Chat SDK)

Adds GitHub Issues and Discussions to NanoClaw via the Chat SDK adapter bridge.

## Phase 1: Pre-flight

Check if `src/channels/adapters/github.ts` exists. If it does, skip to Phase 3.

## Phase 2: Apply Code

### Install the adapter package

```bash
npm install @chat-adapter/github
```

### Copy the adapter file

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-github/adapter.ts src/channels/adapters/github.ts
```

### Enable imports

In `src/channels/index.ts`, add these lines in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/github.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Get credentials

> **Personal Access Token:** GitHub > Settings > Developer settings > Fine-grained tokens > Create with `issues:write`, `discussions:write`
>
> **Webhook:** Repo > Settings > Webhooks > Add webhook > URL: `https://<your-host>:3002/webhook/github` > Events: Issues, Issue comments, Discussions, Discussion comments

### Configure environment

Add to `.env`:

```
CSDK_GITHUB_TOKEN=ghp_...
CSDK_GITHUB_WEBHOOK_SECRET=<webhook-secret>
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
npx tsx setup/index.ts --step register -- --jid "csdk:github:<thread-id>" --name "<repo-name>" --folder "github_main" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Removal

1. Delete `src/channels/adapters/github.ts`
2. Remove the `import './adapters/github.js'` line from `src/channels/index.ts`
3. Remove `CSDK_GITHUB_*` env vars from `.env`
4. `npm uninstall @chat-adapter/github`
5. Rebuild and restart
