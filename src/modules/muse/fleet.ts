/**
 * Local fleet client for Muse.
 *
 * Thin wrapper around the Ollama helpers in `src/modules/llm/ollama.ts`
 * (`defaultOllamaConfig`, `probeOllama`, `chatOnce`, `assertOllamaAllowed`).
 * There is no separate client factory in that file. Health and chat are the
 * only calls, and both go through those helpers.
 *
 * Default host is `http://127.0.0.1:11434`. `OLLAMA_HOST` and `JEWBOT_MODEL`
 * are honored when the host is still local. Any other host is a new network
 * path: `assertLocalSpendOnly` refuses it, including when `JEWBOT_ALLOW_PAID=1`.
 * Vendor endpoints are not hardcoded here.
 */

import { assertLocalSpendOnly } from '../safety';
import {
  assertOllamaAllowed,
  chatOnce,
  type ChatMessage,
  type ChatStreamOptions,
  defaultOllamaConfig,
  isLocalOllamaHost,
  isPaidProviderHost,
  normalizeOllamaHost,
  type OllamaConfig,
  probeOllama,
} from '../llm/ollama';

export const DEFAULT_FLEET_HOST = 'http://127.0.0.1:11434';

export interface FleetHealth {
  ok: boolean;
  models: string[];
  error?: string;
}

export interface FleetClient {
  config: OllamaConfig;
  health: () => Promise<FleetHealth>;
  chat: (messages: ChatMessage[], options?: ChatStreamOptions) => Promise<string>;
}

/**
 * Local config only. `allowPaidApis` is forced off so Muse cannot opt into spend.
 * An explicit host does not consult `OLLAMA_HOST`. A missing host or model does.
 */
export function resolveFleetConfig(partial?: Partial<OllamaConfig>): OllamaConfig {
  const explicitHost = partial?.host?.trim();
  const explicitModel = partial?.model?.trim();
  if (explicitHost && explicitModel) {
    return { host: normalizeOllamaHost(explicitHost), model: explicitModel, allowPaidApis: false };
  }
  const base = defaultOllamaConfig();
  return {
    host: explicitHost ? normalizeOllamaHost(explicitHost) : base.host,
    model: explicitModel || base.model,
    allowPaidApis: false,
  };
}

/**
 * Refuse anything that is not local fleet Ollama before a socket opens.
 * Non-local hosts always hit `assertLocalSpendOnly(false)`.
 */
export function assertFleetLocal(partial?: Partial<OllamaConfig>): OllamaConfig {
  const cfg = resolveFleetConfig(partial);
  const local = isLocalOllamaHost(cfg.host) && !isPaidProviderHost(cfg.host);
  if (!local) {
    const decision = assertLocalSpendOnly(false);
    const reason = decision.ok ? 'Muse runs on fleet Ollama only.' : decision.reason;
    throw new Error(`${reason} Refusing ${cfg.host}.`);
  }
  if (!cfg.model) throw new Error('JEWBOT_MODEL is empty.');
  assertOllamaAllowed(cfg);
  return cfg;
}

export async function fleetHealth(partial?: Partial<OllamaConfig>): Promise<FleetHealth> {
  const cfg = assertFleetLocal(partial);
  return probeOllama(cfg);
}

export async function fleetChat(
  messages: ChatMessage[],
  partial?: Partial<OllamaConfig>,
  options?: ChatStreamOptions,
): Promise<string> {
  if (!messages.length) throw new Error('Fleet chat needs at least one message.');
  for (const message of messages) {
    if (!message.content.trim()) throw new Error('Fleet chat message is empty.');
  }
  const cfg = assertFleetLocal(partial);
  return chatOnce(messages, cfg, options);
}

/** Bound health + chat client. Built only from the Ollama helpers above. */
export function createFleetClient(partial?: Partial<OllamaConfig>): FleetClient {
  const config = assertFleetLocal(partial);
  return {
    config,
    health: () => fleetHealth(config),
    chat: (messages, options) => fleetChat(messages, config, options),
  };
}
