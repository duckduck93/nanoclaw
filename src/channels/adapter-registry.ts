/**
 * Chat SDK adapter registry.
 * Per-platform adapter files call registerChatAdapter() to register
 * their adapter factory. index.ts collects them to create the Chat instance.
 */
import type { Adapter } from 'chat';

type AdapterFactory = () => Adapter | null;

const adapterFactories = new Map<string, AdapterFactory>();

/**
 * Register a Chat SDK adapter. Called from per-platform files
 * (e.g., .claude/skills/add-chat-sdk-teams/adapter.ts → src/channels/adapters/teams.ts).
 *
 * The factory should return null if required env vars are missing.
 */
export function registerChatAdapter(
  name: string,
  factory: AdapterFactory,
): void {
  adapterFactories.set(name, factory);
}

/** Get all registered adapter factory names. */
export function getRegisteredAdapterNames(): string[] {
  return [...adapterFactories.keys()];
}

/** Get an adapter factory by name. */
export function getChatAdapterFactory(
  name: string,
): AdapterFactory | undefined {
  return adapterFactories.get(name);
}
