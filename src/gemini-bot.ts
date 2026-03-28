import { ChildProcess } from 'child_process';
import {
  Client,
  Events,
  GatewayIntentBits,
  Message,
  TextChannel,
} from 'discord.js';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import {
  runGeminiContainerAgent,
  sendGeminiIpcMessage,
  sendGeminiIpcClose,
  loadGeminiSessionId,
  saveGeminiSessionId,
  GeminiContainerOutput,
} from './gemini-container-runner.js';

const MAX_MESSAGE_LENGTH = 2000;

// Read dynamic settings from .env on every call (no cache = hot reload)
function readDynamicSettings(): { noMentionChannels: Set<string> } {
  const envVars = readEnvFile(['GEMINI_NO_MENTION_CHANNELS']);
  const raw = envVars.GEMINI_NO_MENTION_CHANNELS || '';
  const noMentionChannels = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return { noMentionChannels };
}

export class GeminiBot {
  private client: Client | null = null;
  private botToken: string;
  private allowedChannels: Set<string>;

  // Per-channel state
  private sessionIds = new Map<string, string>(); // channelId → gemini session ID
  private activeContainers = new Map<string, ChildProcess>(); // channelId → running container
  private containerNames = new Map<string, string>(); // channelId → container name

  constructor(botToken: string, allowedChannels: string[]) {
    this.botToken = botToken;
    this.allowedChannels = new Set(allowedChannels);
  }

  async connect(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      if (!this.client?.user) return;
      if (message.author.id === this.client.user.id) return;

      const channelId = message.channelId;

      // Check allowed channel list (startup config)
      if (this.allowedChannels.size > 0 && !this.allowedChannels.has(channelId))
        return;

      const { noMentionChannels } = readDynamicSettings();
      const isMentioned = message.mentions.has(this.client.user);
      const mentionRequired = !noMentionChannels.has(channelId);
      if (mentionRequired && !isMentioned) return;

      const botId = this.client.user.id;
      let content = message.content
        .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
        .trim();

      const senderName =
        message.member?.displayName ||
        message.author.displayName ||
        message.author.username;

      const label = message.author.bot ? `${senderName} (bot)` : senderName;
      const userTurn = `${label}: ${content || '(empty message)'}`;

      // Derive channel name for per-channel group directory
      const channelName = message.guild
        ? (message.channel as TextChannel).name
        : senderName;

      try {
        if ('sendTyping' in message.channel) {
          await (message.channel as TextChannel).sendTyping();
        }
      } catch {
        /* ignore */
      }

      // If a container is already running for this channel, pipe message via IPC
      if (this.activeContainers.has(channelId)) {
        sendGeminiIpcMessage(channelName, userTurn);
        logger.info(
          { channelId, channelName, sender: senderName },
          'Gemini IPC message sent to running container',
        );
        return;
      }

      // Spawn a new container for this channel
      const sessionId =
        this.sessionIds.get(channelId) ?? loadGeminiSessionId(channelName);

      await runGeminiContainerAgent(
        {
          prompt: userTurn,
          sessionId,
          channelName,
          channelId,
          senderName,
        },
        (proc, containerName) => {
          this.activeContainers.set(channelId, proc);
          this.containerNames.set(channelId, containerName);

          proc.on('close', () => {
            this.activeContainers.delete(channelId);
            this.containerNames.delete(channelId);
          });
        },
        async (output: GeminiContainerOutput) => {
          if (output.newSessionId) {
            this.sessionIds.set(channelId, output.newSessionId);
            saveGeminiSessionId(channelName, output.newSessionId);
          }
          if (!output.result) return;

          const text = output.result;
          try {
            if (text.length <= MAX_MESSAGE_LENGTH) {
              await message.reply(text);
            } else {
              let first = true;
              for (let i = 0; i < text.length; i += MAX_MESSAGE_LENGTH) {
                const chunk = text.slice(i, i + MAX_MESSAGE_LENGTH);
                if (first) {
                  await message.reply(chunk);
                  first = false;
                } else if ('send' in message.channel) {
                  await (message.channel as TextChannel).send(chunk);
                }
              }
            }
            logger.info(
              { channelId, sender: senderName },
              'Gemini agent responded',
            );
          } catch (err) {
            logger.error({ err, channelId }, 'Failed to send Gemini response');
          }
        },
      );
    });

    this.client.on(Events.Error, (err) => {
      logger.error({ err: err.message }, 'Gemini Discord client error');
    });

    return new Promise<void>((resolve) => {
      this.client!.once(Events.ClientReady, (readyClient) => {
        logger.info({ username: readyClient.user.tag }, 'Gemini bot connected');
        console.log(`\n  Gemini bot: ${readyClient.user.tag}`);
        resolve();
      });
      this.client!.login(this.botToken);
    });
  }

  clearHistory(channelId?: string): void {
    if (channelId) {
      this.sessionIds.delete(channelId);
      // Close running container if any
      const channelName = this.containerNames.get(channelId);
      if (channelName) sendGeminiIpcClose(channelName);
    } else {
      this.sessionIds.clear();
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Gemini bot stopped');
    }
  }
}

export function clearGeminiHistory(channelId?: string): void {
  _instance?.clearHistory(channelId);
}

let _instance: GeminiBot | null = null;

export function createGeminiBot(): GeminiBot | null {
  const envVars = readEnvFile(['GEMINI_BOT_TOKEN', 'GEMINI_ALLOWED_CHANNELS']);
  const token = process.env.GEMINI_BOT_TOKEN || envVars.GEMINI_BOT_TOKEN || '';
  const allowedRaw =
    process.env.GEMINI_ALLOWED_CHANNELS ||
    envVars.GEMINI_ALLOWED_CHANNELS ||
    '';
  const allowedChannels = allowedRaw
    ? allowedRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (!token) return null;

  _instance = new GeminiBot(token, allowedChannels);
  return _instance;
}
