/**
 * Minimal HTTP server for Chat SDK adapter webhooks.
 *
 * Starts only when adapter-based channels need it.
 * Routes requests by path: /webhook/{adapterName} → chat.webhooks[adapterName](request)
 */
import http from 'http';

import type { Chat } from 'chat';

import { logger } from './logger.js';

const DEFAULT_WEBHOOK_PORT = 3002;

let server: http.Server | null = null;

/**
 * Convert Node.js IncomingMessage to Web Request.
 */
async function toWebRequest(req: http.IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const body = Buffer.concat(chunks);

  const protocol = 'http';
  const host = req.headers.host || 'localhost';
  const url = `${protocol}://${host}${req.url}`;

  return new Request(url, {
    method: req.method || 'GET',
    headers: Object.entries(req.headers).reduce(
      (acc, [key, value]) => {
        if (value) acc[key] = Array.isArray(value) ? value.join(', ') : value;
        return acc;
      },
      {} as Record<string, string>,
    ),
    body: ['GET', 'HEAD'].includes(req.method || 'GET') ? undefined : body,
  });
}

/**
 * Write a Web Response back to Node.js ServerResponse.
 */
async function fromWebResponse(
  webRes: Response,
  res: http.ServerResponse,
): Promise<void> {
  res.writeHead(webRes.status, Object.fromEntries(webRes.headers.entries()));
  if (webRes.body) {
    const reader = webRes.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  res.end();
}

/**
 * Start the webhook server for Chat SDK adapters.
 *
 * @param chat - The Chat instance whose webhooks to route to
 * @returns A cleanup function to shut down the server
 */
export function startWebhookServer(chat: Chat): () => Promise<void> {
  const port = parseInt(
    process.env.WEBHOOK_PORT || String(DEFAULT_WEBHOOK_PORT),
    10,
  );

  // Get available webhook adapter names from the chat instance
  const webhooks = chat.webhooks as Record<
    string,
    (req: Request) => Promise<Response>
  >;
  const adapterNames = Object.keys(webhooks);

  server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    // Route: /webhook/{adapterName}
    const match = url.match(/^\/webhook\/([^/?]+)/);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const adapterName = match[1];
    const handler = webhooks[adapterName];
    if (!handler) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Unknown adapter: ${adapterName}`);
      return;
    }

    try {
      const webReq = await toWebRequest(req);
      const webRes = await handler(webReq);
      await fromWebResponse(webRes, res);
    } catch (err) {
      logger.error({ adapterName, err }, 'Webhook handler error');
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  });

  server.listen(port, () => {
    logger.info({ port, adapters: adapterNames }, 'Webhook server started');
  });

  return async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = null;
      logger.info('Webhook server stopped');
    }
  };
}
