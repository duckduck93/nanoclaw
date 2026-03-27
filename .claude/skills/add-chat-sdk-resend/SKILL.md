---
name: add-chat-sdk-resend
description: "Add bidirectional email via Resend through the Chat SDK adapter bridge. Supports threading and HTML email."
---

# Add Resend Email (Chat SDK)

Adds bidirectional email to NanoClaw via the Resend adapter. Emails become conversations the agent can read and reply to, with full threading support.

## Phase 1: Pre-flight

Check if `src/channels/adapters/resend.ts` exists. If it does, skip to Phase 3.

## Phase 2: Apply Code

### Install the adapter package

```bash
npm install @resend/chat-sdk-adapter
```

### Copy the adapter file

```bash
mkdir -p src/channels/adapters
cp .claude/skills/add-chat-sdk-resend/adapter.ts src/channels/adapters/resend.ts
```

### Enable imports

In `src/channels/index.ts`, add in the `chat-sdk` section:

```typescript
// adapter-registry is imported by index.ts
import './adapters/resend.js';
```

### Build and verify

```bash
npm run build
npm test
```

## Phase 3: Setup

### Get Resend credentials

> 1. Sign up at [resend.com](https://resend.com)
> 2. Go to API Keys > Create API Key
> 3. Configure a sending domain (or use the sandbox `onboarding@resend.dev` for testing)
> 4. Set up inbound webhook: Webhooks > Add endpoint > URL: `https://<your-host>:3002/webhook/resend` > Event: `email.received`

### Configure environment

Add to `.env`:

```
CSDK_RESEND_FROM_ADDRESS=bot@yourdomain.com
CSDK_RESEND_FROM_NAME=Andy
CSDK_RESEND_API_KEY=re_...
CSDK_RESEND_WEBHOOK_SECRET=<webhook-signing-secret>
WEBHOOK_PORT=3002
```

Sync: `mkdir -p data/env && cp .env data/env/env`

### Build and restart

```bash
npm run build
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # macOS
```

## Phase 4: Register

When the first email arrives, the JID will be logged. Register it:

```bash
npx tsx setup/index.ts --step register -- --jid "csdk:resend:<thread-id>" --name "email" --folder "email_csdk" --trigger "@${ASSISTANT_NAME}" --channel chat-sdk
```

## Removal

1. Delete `src/channels/adapters/resend.ts`
2. Remove the `import './adapters/resend.js'` line from `src/channels/index.ts`
3. Remove `CSDK_RESEND_*` env vars from `.env`
4. `npm uninstall @resend/chat-sdk-adapter`
5. Rebuild and restart
