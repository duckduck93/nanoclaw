import fs from 'fs';
import path from 'path';
import { Client, Events, GatewayIntentBits, Message, TextChannel } from 'discord.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';

const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';
const MAX_HISTORY_TURNS = 20;
const MAX_MESSAGE_LENGTH = 2000;
const GEMINI_MD_PATH = path.join(process.cwd(), 'groups', 'gemini', 'GEMINI.md');
const GEMINI_MEMORY_PATH = path.join(process.cwd(), 'groups', 'gemini', 'memory.md');
const FALLBACK_SYSTEM_INSTRUCTION = 'You are 젬미니덕, a helpful AI assistant.';
const MEMORY_TAG_RE = /\[\[MEMORY:\s*(.*?)\]\]/g;

function readSystemInstruction(): string {
  try {
    return fs.readFileSync(GEMINI_MD_PATH, 'utf-8').trim();
  } catch {
    logger.warn({ path: GEMINI_MD_PATH }, 'GEMINI.md not found, using fallback');
    return FALLBACK_SYSTEM_INSTRUCTION;
  }
}

function readMemory(): string {
  try {
    return fs.readFileSync(GEMINI_MEMORY_PATH, 'utf-8').trim();
  } catch {
    return '';
  }
}

function extractAndSaveMemory(response: string): string {
  const entries: string[] = [];
  const cleaned = response.replace(MEMORY_TAG_RE, (_, entry) => {
    if (entry.trim()) entries.push(entry.trim());
    return '';
  }).trim();

  if (entries.length > 0) {
    const existing = readMemory();
    const updated = existing ? `${existing}\n${entries.join('\n')}` : entries.join('\n');
    fs.writeFileSync(GEMINI_MEMORY_PATH, updated, 'utf-8');
    logger.info({ count: entries.length }, 'Gemini memory updated');
  }

  return cleaned;
}

interface HistoryTurn {
  role: 'user' | 'model';
  text: string;
}

// In-memory conversation history per Discord channel
const channelHistory = new Map<string, HistoryTurn[]>();

export function clearGeminiHistory(channelId?: string): void {
  if (channelId) {
    channelHistory.delete(channelId);
  } else {
    channelHistory.clear();
  }
}

function getHistory(channelId: string): HistoryTurn[] {
  if (!channelHistory.has(channelId)) {
    channelHistory.set(channelId, []);
  }
  return channelHistory.get(channelId)!;
}

function addToHistory(channelId: string, role: 'user' | 'model', text: string): void {
  const history = getHistory(channelId);
  history.push({ role, text });
  if (history.length > MAX_HISTORY_TURNS * 2) {
    history.splice(0, 2);
  }
}

// Read dynamic settings from .env on every call (no cache = hot reload)
function readDynamicSettings(): { model: string; noMentionChannels: Set<string> } {
  const envVars = readEnvFile(['GEMINI_MODEL', 'GEMINI_NO_MENTION_CHANNELS']);
  const model = process.env.GEMINI_MODEL || envVars.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const raw = envVars.GEMINI_NO_MENTION_CHANNELS || '';
  const noMentionChannels = new Set(raw.split(',').map((s) => s.trim()).filter(Boolean));
  return { model, noMentionChannels };
}

export class GeminiBot {
  private client: Client | null = null;
  private genAI: GoogleGenerativeAI;
  private botToken: string;
  private allowedChannels: Set<string>;

  constructor(botToken: string, apiKey: string, allowedChannels: string[]) {
    this.botToken = botToken;
    this.genAI = new GoogleGenerativeAI(apiKey);
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
      if (this.allowedChannels.size > 0 && !this.allowedChannels.has(channelId)) return;

      // Read model and no-mention channels fresh from .env on every message
      const { model, noMentionChannels } = readDynamicSettings();

      const isMentioned = message.mentions.has(this.client.user);
      const mentionRequired = !noMentionChannels.has(channelId);

      if (mentionRequired && !isMentioned) return;

      const botId = this.client.user.id;

      // Strip the @Gemini mention from content
      let content = message.content
        .replace(new RegExp(`<@!?${botId}>`, 'g'), '')
        .trim();

      const senderName =
        message.member?.displayName ||
        message.author.displayName ||
        message.author.username;

      const label = message.author.bot ? `${senderName} (bot)` : senderName;
      const userTurn = `${label}: ${content || '(empty message)'}`;

      addToHistory(channelId, 'user', userTurn);

      // Show typing indicator
      try {
        if ('sendTyping' in message.channel) {
          await (message.channel as TextChannel).sendTyping();
        }
      } catch { /* ignore */ }

      try {
        const geminiModel = this.genAI.getGenerativeModel({
          model,
          systemInstruction: readSystemInstruction(),
        });

        const memory = readMemory();
        const memoryBlock = memory ? `## Saved Memory\n${memory}\n\n` : '';

        const history = getHistory(channelId);
        const previousTurns = history.slice(0, -1);
        const contextBlock = previousTurns.length > 0
          ? `## Recent Conversation\n${previousTurns.map(h => `[${h.role === 'user' ? 'User' : 'Gemini'}] ${h.text}`).join('\n')}\n\n`
          : '';

        const fullPrompt = `${memoryBlock}${contextBlock}${userTurn}`;
        const result = await geminiModel.generateContent(fullPrompt);
        const rawResponse = result.response.text().trim();

        // Extract [[MEMORY: ...]] tags, save to file, strip from visible response
        const responseText = extractAndSaveMemory(rawResponse);

        addToHistory(channelId, 'model', responseText);

        if (responseText.length <= MAX_MESSAGE_LENGTH) {
          await message.reply(responseText);
        } else {
          let first = true;
          for (let i = 0; i < responseText.length; i += MAX_MESSAGE_LENGTH) {
            const chunk = responseText.slice(i, i + MAX_MESSAGE_LENGTH);
            if (first) {
              await message.reply(chunk);
              first = false;
            } else if ('send' in message.channel) {
              await (message.channel as TextChannel).send(chunk);
            }
          }
        }

        logger.info({ channelId, sender: senderName, model, fromBot: message.author.bot }, 'Gemini responded');
      } catch (err) {
        logger.error({ err, channelId }, 'Gemini API error');
        await message.reply('❌ Gemini API error. Please try again.').catch(() => {});
      }
    });

    this.client.on(Events.Error, (err) => {
      logger.error({ err: err.message }, 'Gemini Discord client error');
    });

    return new Promise<void>((resolve) => {
      this.client!.once(Events.ClientReady, (readyClient) => {
        logger.info(
          { username: readyClient.user.tag, id: readyClient.user.id },
          'Gemini bot connected',
        );
        console.log(`\n  Gemini bot: ${readyClient.user.tag}`);
        resolve();
      });

      this.client!.login(this.botToken);
    });
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      logger.info('Gemini bot stopped');
    }
  }
}

export function createGeminiBot(): GeminiBot | null {
  const envVars = readEnvFile(['GEMINI_BOT_TOKEN', 'GEMINI_API_KEY', 'GEMINI_ALLOWED_CHANNELS']);
  const token = process.env.GEMINI_BOT_TOKEN || envVars.GEMINI_BOT_TOKEN || '';
  const apiKey = process.env.GEMINI_API_KEY || envVars.GEMINI_API_KEY || '';
  const allowedRaw = process.env.GEMINI_ALLOWED_CHANNELS || envVars.GEMINI_ALLOWED_CHANNELS || '';
  const allowedChannels = allowedRaw ? allowedRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];

  if (!token || !apiKey) {
    return null;
  }

  return new GeminiBot(token, apiKey, allowedChannels);
}
