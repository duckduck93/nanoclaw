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
  runCodexContainerAgent,
  sendCodexIpcMessage,
  sendCodexIpcClose,
  CodexContainerOutput,
} from './codex-container-runner.js';

const MAX_MESSAGE_LENGTH = 2000;

function readDynamicSettings(): { noMentionChannels: Set<string> } {
  const envVars = readEnvFile(['CODEX_NO_MENTION_CHANNELS']);
  const raw = envVars.CODEX_NO_MENTION_CHANNELS || '';
  const noMentionChannels = new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return { noMentionChannels };
}

export class CodexBot {
  private client: Client | null = null;
  private botToken: string;
  private allowedChannels: Set<string>;

  private activeContainers = new Map<string, ChildProcess>();
  private containerNames = new Map<string, string>();

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

      if (this.allowedChannels.size > 0 && !this.allowedChannels.has(channelId))
        return;

      const { noMentionChannels } = readDynamicSettings();
      const isMentioned = message.mentions.has(this.client.user);
      const mentionRequired = !noMentionChannels.has(channelId);
      if (mentionRequired && !isMentioned) return;

      const botId = this.client.user.id;
      const content = message.content
        .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
        .trim();

      const senderName =
        message.member?.displayName ||
        message.author.displayName ||
        message.author.username;

      const label = message.author.bot ? `${senderName} (bot)` : senderName;
      const userTurn = `${label}: ${content || '(empty message)'}`;

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

      if (this.activeContainers.has(channelId)) {
        sendCodexIpcMessage(channelName, userTurn);
        logger.info(
          { channelId, channelName, sender: senderName },
          'Codex IPC message sent to running container',
        );
        return;
      }

      await runCodexContainerAgent(
        {
          prompt: userTurn,
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
        async (output: CodexContainerOutput) => {
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
              'Codex agent responded',
            );
          } catch (err) {
            logger.error({ err, channelId }, 'Failed to send Codex response');
          }
        },
      );
    });

    this.client.on(Events.Error, (err) => {
      logger.error({ err: err.message }, 'Codex Discord client error');
    });

    return new Promise<void>((resolve) => {
      this.client!.once(Events.ClientReady, (readyClient) => {
        logger.info({ username: readyClient.user.tag }, 'Codex bot connected');
        console.log(`\n  Codex bot: ${readyClient.user.tag}`);
        resolve();
      });
      this.client!.login(this.botToken);
    });
  }

  clearHistory(channelId?: string): void {
    if (channelId) {
      const channelName = this.containerNames.get(channelId);
      if (channelName) sendCodexIpcClose(channelName);
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Codex bot stopped');
    }
  }
}

export function clearCodexHistory(channelId?: string): void {
  _instance?.clearHistory(channelId);
}

let _instance: CodexBot | null = null;

export function createCodexBot(): CodexBot | null {
  const envVars = readEnvFile(['CODEX_BOT_TOKEN', 'CODEX_ALLOWED_CHANNELS']);
  const token = process.env.CODEX_BOT_TOKEN || envVars.CODEX_BOT_TOKEN || '';
  const allowedRaw =
    process.env.CODEX_ALLOWED_CHANNELS || envVars.CODEX_ALLOWED_CHANNELS || '';
  const allowedChannels = allowedRaw
    ? allowedRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];

  if (!token) return null;

  _instance = new CodexBot(token, allowedChannels);
  return _instance;
}
